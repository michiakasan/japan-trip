// The database: one SQLite file (built into Node, no extra packages).
//
// All our shared data lives here: status/notes per place, photo records, our own places,
// trips and the trip stops. Photo FILES are stored next to it in a "photos" folder.

import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

export function openDatabase(dataDir: string) {
  mkdirSync(join(dataDir, "photos"), { recursive: true });
  mkdirSync(join(dataDir, "backups"), { recursive: true });
  const db = new DatabaseSync(join(dataDir, "japanchansky.db"));

  db.exec(`
    PRAGMA journal_mode = WAL;      -- safer + faster writes
    PRAGMA foreign_keys = ON;       -- e.g. deleting a trip deletes its stops

    -- Small settings: the trip code hash and the data "version" (goes up on every change)
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

    -- Phones that entered the right trip code. We keep only a hash of their key.
    CREATE TABLE IF NOT EXISTS devices (
      token_hash TEXT PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen  TEXT NOT NULL DEFAULT (datetime('now')),
      label      TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS place_state (
      place_id       TEXT PRIMARY KEY,
      status         TEXT CHECK (status IN ('want', 'visited')),
      years          TEXT NOT NULL DEFAULT '[]',   -- JSON list, e.g. [2023, 2025]
      notes          TEXT NOT NULL DEFAULT '',
      cover_photo_id TEXT,
      updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS photos (
      id         TEXT PRIMARY KEY,
      place_id   TEXT NOT NULL,
      width      INTEGER,
      height     INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS custom_places (
      id         TEXT PRIMARY KEY CHECK (id LIKE 'c-%'),
      category   TEXT NOT NULL CHECK (category IN ('restaurant', 'hotel', 'city', 'sight', 'other')),
      name       TEXT NOT NULL,
      jp         TEXT NOT NULL DEFAULT '',
      area       TEXT NOT NULL DEFAULT '',
      lat        REAL NOT NULL,
      lng        REAL NOT NULL,
      descr      TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS trips (
      id         TEXT PRIMARY KEY,
      title      TEXT NOT NULL DEFAULT '',
      start_date TEXT NOT NULL,
      end_date   TEXT NOT NULL,
      year       INTEGER NOT NULL UNIQUE,         -- one trip per year
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK (end_date >= start_date)
    );

    CREATE TABLE IF NOT EXISTS trip_stops (
      id       TEXT PRIMARY KEY,
      trip_id  TEXT NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
      day      TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      place_id TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS trip_stops_trip ON trip_stops (trip_id);
  `);
  return db;
}

export type Db = ReturnType<typeof openDatabase>;

// ---------- settings ----------

export function getSetting(db: Db, key: string): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

export function setSetting(db: Db, key: string, value: string) {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(key, value);
}

/** The data version goes up by one on every change; phones use it to know when to reload. */
export function bumpVersion(db: Db): number {
  const next = Number(getSetting(db, "version") ?? "0") + 1;
  setSetting(db, "version", String(next));
  return next;
}

// ---------- reading everything ----------

/** Everything the app needs, in the same shape as the app's own types. */
export function readAll(db: Db) {
  const states: Record<string, unknown> = {};
  for (const r of db.prepare("SELECT * FROM place_state").all() as Array<Record<string, string | null>>) {
    states[r.place_id!] = {
      status: r.status ?? "",
      years: JSON.parse(r.years ?? "[]"),
      notes: r.notes ?? "",
      coverPhotoId: r.cover_photo_id,
    };
  }
  const photos = (db.prepare("SELECT * FROM photos ORDER BY created_at").all() as Array<Record<string, unknown>>).map((r) => ({
    id: r.id, placeId: r.place_id, width: r.width, height: r.height, createdAt: r.created_at,
  }));
  const customs = (db.prepare("SELECT * FROM custom_places ORDER BY created_at").all() as Array<Record<string, unknown>>).map((r) => ({
    id: r.id, kind: "custom", category: r.category, name: r.name, jp: r.jp, area: r.area, lat: r.lat, lng: r.lng, desc: r.descr,
  }));
  const trips = (db.prepare("SELECT * FROM trips").all() as Array<Record<string, unknown>>).map((r) => ({
    id: r.id, title: r.title, start: r.start_date, end: r.end_date,
  }));
  const stops = (db.prepare("SELECT * FROM trip_stops").all() as Array<Record<string, unknown>>).map((r) => ({
    id: r.id, tripId: r.trip_id, day: r.day, position: r.position, placeId: r.place_id,
  }));
  return { version: Number(getSetting(db, "version") ?? "0"), states, photos, customs, trips, stops };
}

// ---------- daily backup ----------

/** Writes a copy of the database to backups/ and keeps the newest 14 copies. */
export function backup(db: Db, dataDir: string) {
  const dir = join(dataDir, "backups");
  const file = join(dir, `japanchansky-${new Date().toISOString().slice(0, 10)}.db`);
  rmSync(file, { force: true });
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const old = readdirSync(dir).filter((f) => f.endsWith(".db")).sort().slice(0, -14);
  for (const f of old) rmSync(join(dir, f), { force: true });
}
