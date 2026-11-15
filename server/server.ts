// Japanchansky API: our own small backend on the Hertz server.
//
// Run:  node --experimental-strip-types server/server.ts
// Settings (environment variables):
//   PORT           default 5020
//   DATA_DIR       where the database + photos live (default ./data)
//   COOKIE_PATH    the website path the login cookie belongs to (default "/")
//   COOKIE_SECURE  "false" only for local testing over plain http
//
// How privacy works:
//   POST /api/join with the right trip code → the server gives this phone a long random
//   key in a cookie (HttpOnly, so page scripts can't read it; 10 years). Every other
//   /api/ request must carry a valid key, otherwise it gets "401 Unauthorized".
//   The trip code itself is only stored as a scrypt hash (set it with set-code.ts).
//
// Endpoints (all JSON unless noted):
//   GET    /api/health                        → { ok: true, codeSet }   (no key needed)
//   POST   /api/join            { code }      → sets the cookie          (no key needed)
//   GET    /api/state                         → everything (places' status, photos list, trips…)
//   GET    /api/events                        → live "something changed" messages (Server-Sent Events)
//   PATCH  /api/place-state/:placeId          { status?, years?, notes?, coverPhotoId?, hidden? }
//   PUT    /api/destinations/:id              { name, jp, prefecture, lat, lng, desc }   (ours, id "c-…")
//   DELETE /api/destinations/:id              (also deletes its spots)
//   PUT    /api/spots/:id                     { destinationId, type, name, jp, lat, lng, desc }  (ours, id "s-…")
//   DELETE /api/spots/:id
//   PUT    /api/trips/:id                     { title, start, end }
//   DELETE /api/trips/:id
//   PUT    /api/stops                         [ { id, tripId, day, position, placeId }, … ]
//   DELETE /api/stops/:id
//   PUT    /api/photos/:id/full  (body: JPEG)  upload the big version
//   PUT    /api/photos/:id/thumb (body: JPEG)  upload the small version
//   POST   /api/photos                        { id, placeId, width, height }  → photo is saved
//   GET    /api/photos/:id/full|thumb         → the JPEG
//   DELETE /api/photos/:id

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { SPOT_TYPES, backup, bumpVersion, getSetting, openDatabase, readAll } from "./db.ts";

const PORT = Number(process.env.PORT ?? 5020);
const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), "data");
const COOKIE_PATH = process.env.COOKIE_PATH ?? "/";
const COOKIE_SECURE = process.env.COOKIE_SECURE !== "false";
const COOKIE = "jc_key";

const db = openDatabase(DATA_DIR);
const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

// ---------- small helpers ----------

/** Thrown inside a handler to answer with an error status. */
class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(JSON.stringify(body));
}

/** Reads the request body (with a size limit, so nobody can fill the memory). */
async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    // Too big: keep reading (and throwing away) until the end. Stopping in the middle
    // would break the connection. (nginx stops anything over 10 MB before it gets here.)
    if (size <= limit) chunks.push(chunk as Buffer);
  }
  if (size > limit) throw new HttpError(413, "Too large");
  return Buffer.concat(chunks);
}

async function readJson(req: IncomingMessage): Promise<any> {
  const raw = await readBody(req, 1_000_000);
  try {
    return JSON.parse(raw.toString("utf8") || "null");
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
}

function getCookie(req: IncomingMessage, name: string): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

/** The visitor's IP address (nginx passes the real one in X-Real-IP). */
const ipOf = (req: IncomingMessage) => String(req.headers["x-real-ip"] ?? req.socket.remoteAddress ?? "?");

// ---------- checking input ----------
// Every value from the phone is checked before it goes into the database.

const ID = /^[a-z0-9-]{1,60}$/; // place ids ("kyoto", "c-1a2b…") and uuids
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown, max: number, field: string): string => {
  if (typeof v !== "string" || v.length > max) throw new HttpError(400, `Bad ${field}`);
  return v;
};
const num = (v: unknown, min: number, max: number, field: string): number => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) throw new HttpError(400, `Bad ${field}`);
  return v;
};
const id = (v: unknown, field = "id"): string => {
  if (typeof v !== "string" || !ID.test(v)) throw new HttpError(400, `Bad ${field}`);
  return v;
};
const date = (v: unknown, field: string): string => {
  if (typeof v !== "string" || !DATE.test(v) || Number.isNaN(Date.parse(v))) throw new HttpError(400, `Bad ${field}`);
  return v;
};

// ---------- trip code + device keys ----------

/** Checks a typed trip code against the stored scrypt hash ("salt:hash"). */
async function codeMatches(code: string): Promise<boolean> {
  const stored = getSetting(db, "code_hash");
  if (!stored) return false;
  const [salt, hash] = stored.split(":");
  const typed = await scryptAsync(code.trim().toLowerCase(), Buffer.from(salt, "hex"), 32);
  return timingSafeEqual(typed, Buffer.from(hash, "hex"));
}

/** Wrong-code attempts per IP address: max 10 per 15 minutes. */
const failures = new Map<string, { count: number; until: number }>();
function tooManyFailures(ip: string) {
  const f = failures.get(ip);
  return !!f && f.until > Date.now() && f.count >= 10;
}
function recordFailure(ip: string) {
  const f = failures.get(ip);
  if (!f || f.until < Date.now()) failures.set(ip, { count: 1, until: Date.now() + 15 * 60_000 });
  else f.count++;
}

/** Is this request from a phone that entered the code? */
function isMember(req: IncomingMessage): boolean {
  const key = getCookie(req, COOKIE);
  if (!key) return false;
  const row = db.prepare("SELECT token_hash FROM devices WHERE token_hash = ?").get(sha256(key));
  if (row) db.prepare("UPDATE devices SET last_seen = datetime('now') WHERE token_hash = ?").run(sha256(key));
  return !!row;
}

// ---------- live updates (Server-Sent Events) ----------

const listeners = new Set<ServerResponse>();

/** Call after every change: bumps the version and tells every open app to reload. */
function changed() {
  const version = bumpVersion(db);
  for (const res of listeners) res.write(`event: change\ndata: ${JSON.stringify({ version })}\n\n`);
  return { version };
}

// A comment line every 25 s keeps connections from being closed as "idle".
setInterval(() => {
  for (const res of listeners) res.write(": ping\n\n");
}, 25_000);

// ---------- photos on disk ----------

const photoFile = (photoId: string, size: "full" | "thumb") => join(DATA_DIR, "photos", `${photoId}-${size}.jpg`);
const isJpeg = (b: Buffer) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

function deletePhotoFiles(photoId: string) {
  rmSync(photoFile(photoId, "full"), { force: true });
  rmSync(photoFile(photoId, "thumb"), { force: true });
}

/** Removes a photo (database row + files) and clears it as a cover. */
function deletePhoto(photoId: string) {
  db.prepare("DELETE FROM photos WHERE id = ?").run(photoId);
  db.prepare("UPDATE place_state SET cover_photo_id = NULL WHERE cover_photo_id = ?").run(photoId);
  deletePhotoFiles(photoId);
}

/** Removes everything we saved about a place: notes/status, photos and trip stops. */
function forgetPlace(placeId: string) {
  for (const row of db.prepare("SELECT id FROM photos WHERE place_id = ?").all(placeId) as Array<{ id: string }>) deletePhoto(row.id);
  db.prepare("DELETE FROM trip_stops WHERE place_id = ?").run(placeId);
  db.prepare("DELETE FROM place_state WHERE place_id = ?").run(placeId);
}

// ---------- the routes ----------

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://x");
  const parts = url.pathname.replace(/\/+$/, "").split("/").slice(1); // ["api", "trips", "<id>"]
  const method = req.method ?? "GET";
  if (parts[0] !== "api") throw new HttpError(404, "Not found");
  const [, what, p1, p2] = parts;

  // --- open to everyone ---
  if (what === "health" && method === "GET") return send(res, 200, { ok: true, codeSet: !!getSetting(db, "code_hash") });

  if (what === "join" && method === "POST") {
    const ip = ipOf(req);
    if (tooManyFailures(ip)) throw new HttpError(429, "Too many wrong codes. Try again in 15 minutes.");
    const { code } = (await readJson(req)) ?? {};
    if (typeof code !== "string" || code.length > 200 || !(await codeMatches(code))) {
      recordFailure(ip);
      await new Promise((r) => setTimeout(r, 2000)); // slows down guessing
      return send(res, 403, { error: "Wrong code" });
    }
    const key = randomBytes(32).toString("base64url");
    const label = String(req.headers["user-agent"] ?? "").slice(0, 120);
    db.prepare("INSERT INTO devices (token_hash, label) VALUES (?, ?)").run(sha256(key), label);
    const cookie = [
      `${COOKIE}=${key}`, `Path=${COOKIE_PATH}`, "HttpOnly", "SameSite=Strict", `Max-Age=${60 * 60 * 24 * 3650}`,
      ...(COOKIE_SECURE ? ["Secure"] : []),
    ].join("; ");
    return send(res, 200, { ok: true }, { "Set-Cookie": cookie });
  }

  // --- everything below needs the key ---
  if (!isMember(req)) throw new HttpError(401, "Enter the trip code first");
  // Changes must come from our own app: browsers won't send this header from other websites.
  if (method !== "GET" && req.headers["x-japanchansky"] !== "1") throw new HttpError(403, "Missing app header");

  if (what === "state" && method === "GET") return send(res, 200, readAll(db));

  if (what === "events" && method === "GET") {
    if (listeners.size > 50) throw new HttpError(503, "Too many connections");
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
    res.write(`event: hello\ndata: ${JSON.stringify({ version: readAll(db).version })}\n\n`);
    listeners.add(res);
    req.on("close", () => listeners.delete(res));
    return;
  }

  // PATCH /api/place-state/:placeId — only the fields that are sent are changed
  if (what === "place-state" && method === "PATCH") {
    const placeId = id(p1, "place");
    const b = (await readJson(req)) ?? {};
    db.prepare("INSERT INTO place_state (place_id) VALUES (?) ON CONFLICT (place_id) DO NOTHING").run(placeId);
    if ("status" in b) {
      if (!["want", "visited", ""].includes(b.status)) throw new HttpError(400, "Bad status");
      db.prepare("UPDATE place_state SET status = ? WHERE place_id = ?").run(b.status || null, placeId);
    }
    if ("years" in b) {
      if (!Array.isArray(b.years) || b.years.length > 100) throw new HttpError(400, "Bad years");
      const years = b.years.map((y: unknown) => num(y, 1900, 2200, "year"));
      db.prepare("UPDATE place_state SET years = ? WHERE place_id = ?").run(JSON.stringify(years), placeId);
    }
    if ("notes" in b) db.prepare("UPDATE place_state SET notes = ? WHERE place_id = ?").run(str(b.notes, 20_000, "notes"), placeId);
    if ("hidden" in b) {
      if (typeof b.hidden !== "boolean") throw new HttpError(400, "Bad hidden");
      db.prepare("UPDATE place_state SET hidden = ? WHERE place_id = ?").run(b.hidden ? 1 : 0, placeId);
    }
    if ("coverPhotoId" in b) {
      const cover = b.coverPhotoId === null ? null : id(b.coverPhotoId, "cover");
      db.prepare("UPDATE place_state SET cover_photo_id = ? WHERE place_id = ?").run(cover, placeId);
    }
    db.prepare("UPDATE place_state SET updated_at = datetime('now') WHERE place_id = ?").run(placeId);
    return send(res, 200, changed());
  }

  if (what === "destinations" && method === "PUT") {
    const placeId = id(p1);
    if (!placeId.startsWith("c-")) throw new HttpError(400, "Our destination ids start with c-");
    const b = (await readJson(req)) ?? {};
    const name = str(b.name, 120, "name").trim();
    if (!name) throw new HttpError(400, "Name is required");
    db.prepare(
      `INSERT INTO our_destinations (id, name, jp, prefecture, lat, lng, descr) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, jp = excluded.jp, prefecture = excluded.prefecture,
         lat = excluded.lat, lng = excluded.lng, descr = excluded.descr`,
    ).run(placeId, name, str(b.jp ?? "", 120, "jp"), str(b.prefecture ?? "", 60, "prefecture"),
      num(b.lat, -90, 90, "lat"), num(b.lng, -180, 180, "lng"), str(b.desc ?? "", 500, "desc"));
    return send(res, 200, changed());
  }

  if (what === "destinations" && method === "DELETE") {
    const placeId = id(p1);
    db.exec("BEGIN");
    try {
      // Its spots go too (with their notes, photos and trip stops).
      for (const row of db.prepare("SELECT id FROM our_spots WHERE destination_id = ?").all(placeId) as Array<{ id: string }>) {
        forgetPlace(row.id);
        db.prepare("DELETE FROM our_spots WHERE id = ?").run(row.id);
      }
      forgetPlace(placeId);
      db.prepare("DELETE FROM our_destinations WHERE id = ?").run(placeId);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
    return send(res, 200, changed());
  }

  if (what === "spots" && method === "PUT") {
    const placeId = id(p1);
    if (!placeId.startsWith("s-")) throw new HttpError(400, "Our spot ids start with s-");
    const b = (await readJson(req)) ?? {};
    if (!SPOT_TYPES.includes(b.type)) throw new HttpError(400, "Bad type");
    const name = str(b.name, 120, "name").trim();
    if (!name) throw new HttpError(400, "Name is required");
    db.prepare(
      `INSERT INTO our_spots (id, destination_id, type, name, jp, lat, lng, descr) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET destination_id = excluded.destination_id, type = excluded.type, name = excluded.name,
         jp = excluded.jp, lat = excluded.lat, lng = excluded.lng, descr = excluded.descr`,
    ).run(placeId, b.destinationId === "" ? "" : id(b.destinationId, "destination"), b.type, name, str(b.jp ?? "", 120, "jp"),
      num(b.lat, -90, 90, "lat"), num(b.lng, -180, 180, "lng"), str(b.desc ?? "", 500, "desc"));
    return send(res, 200, changed());
  }

  if (what === "spots" && method === "DELETE") {
    const placeId = id(p1);
    forgetPlace(placeId);
    db.prepare("DELETE FROM our_spots WHERE id = ?").run(placeId);
    return send(res, 200, changed());
  }

  if (what === "trips" && method === "PUT") {
    const tripId = id(p1);
    const b = (await readJson(req)) ?? {};
    const start = date(b.start, "start"), end = date(b.end, "end");
    if (end < start) throw new HttpError(400, "The last day is before the first day.");
    if ((Date.parse(end) - Date.parse(start)) / 864e5 > 90) throw new HttpError(400, "A trip can be at most 90 days.");
    const year = Number(start.slice(0, 4));
    const clash = db.prepare("SELECT id FROM trips WHERE year = ? AND id != ?").get(year, tripId);
    if (clash) throw new HttpError(409, `We already have a trip in ${year}. Edit that one instead.`);
    db.prepare(
      `INSERT INTO trips (id, title, start_date, end_date, year) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET title = excluded.title, start_date = excluded.start_date,
         end_date = excluded.end_date, year = excluded.year`,
    ).run(tripId, str(b.title ?? "", 120, "title").trim(), start, end, year);
    return send(res, 200, changed());
  }

  if (what === "trips" && method === "DELETE") {
    db.prepare("DELETE FROM trips WHERE id = ?").run(id(p1)); // its stops go too (ON DELETE CASCADE)
    return send(res, 200, changed());
  }

  if (what === "stops" && method === "PUT" && !p1) {
    const list = await readJson(req);
    if (!Array.isArray(list) || list.length > 200) throw new HttpError(400, "Bad stops");
    const upsert = db.prepare(
      `INSERT INTO trip_stops (id, trip_id, day, position, place_id) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET trip_id = excluded.trip_id, day = excluded.day,
         position = excluded.position, place_id = excluded.place_id`,
    );
    db.exec("BEGIN");
    try {
      for (const s of list) {
        upsert.run(id(s.id), id(s.tripId, "trip"), date(s.day, "day"), num(s.position, 0, 10_000, "position"), id(s.placeId, "place"));
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err instanceof HttpError ? err : new HttpError(400, "Could not save (does the trip exist?)");
    }
    return send(res, 200, changed());
  }

  if (what === "stops" && method === "DELETE") {
    db.prepare("DELETE FROM trip_stops WHERE id = ?").run(id(p1));
    return send(res, 200, changed());
  }

  // --- photos ---
  if (what === "photos" && p1 && (p2 === "full" || p2 === "thumb")) {
    const photoId = id(p1);
    if (method === "PUT") {
      const body = await readBody(req, 6_000_000);
      if (!isJpeg(body)) throw new HttpError(400, "Only JPEG photos");
      writeFileSync(photoFile(photoId, p2), body);
      return send(res, 200, { ok: true });
    }
    if (method === "GET") {
      const file = photoFile(photoId, p2);
      if (!existsSync(file)) throw new HttpError(404, "No such photo");
      // A photo never changes once uploaded, so phones may keep it for a year.
      res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=31536000, immutable" });
      return res.end(readFileSync(file));
    }
  }

  if (what === "photos" && !p1 && method === "POST") {
    const b = (await readJson(req)) ?? {};
    const photoId = id(b.id), placeId = id(b.placeId, "place");
    if (!existsSync(photoFile(photoId, "full")) || !existsSync(photoFile(photoId, "thumb"))) {
      throw new HttpError(400, "Upload both sizes first");
    }
    db.prepare("INSERT INTO photos (id, place_id, width, height) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO NOTHING")
      .run(photoId, placeId, num(b.width ?? 0, 0, 10_000, "width"), num(b.height ?? 0, 0, 10_000, "height"));
    return send(res, 200, changed());
  }

  if (what === "photos" && p1 && !p2 && method === "DELETE") {
    deletePhoto(id(p1));
    return send(res, 200, changed());
  }

  throw new HttpError(404, "Not found");
}

// ---------- start ----------

createServer((req, res) => {
  handle(req, res).catch(async (err: unknown) => {
    if (res.headersSent) return res.end();
    // If we said "no" before reading everything the phone is sending (e.g. a bad id or a
    // too-big photo), read the rest first. Answering mid-upload breaks the connection.
    if (!req.complete) {
      req.resume();
      await new Promise((r) => { req.once("end", r); req.once("close", r); });
    }
    if (err instanceof HttpError) return send(res, err.status, { error: err.message });
    console.error(err);
    send(res, 500, { error: "Server error" });
  });
}).listen(PORT, "127.0.0.1", () => {
  console.log(`Japanchansky API on http://127.0.0.1:${PORT} (data in ${DATA_DIR})`);
  if (!getSetting(db, "code_hash")) console.log("No trip code set yet: run server/set-code.ts");
});

// Daily backup (first one 1 minute after start, then every 24 h)
const runBackup = () => {
  try {
    backup(db, DATA_DIR);
  } catch (err) {
    console.error("Backup failed", err);
  }
};
setTimeout(runBackup, 60_000);
setInterval(runBackup, 24 * 60 * 60_000);
