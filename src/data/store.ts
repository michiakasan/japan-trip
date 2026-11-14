// Our own data: status, years visited, notes and photos per place, the places we added ourselves,
// and our trips. It is stored on our server (server/server.ts on Hertz) and shared live.
//
// Three ways this can run:
//   "shared"  The server is reachable and this phone entered the trip code.
//             Everything is saved on the server; changes from the other phone arrive live.
//   "offline" We can't reach the server (no signal). We show the last copy saved on the
//             phone; changes can't be saved until we're back online.
//   "local"   This copy of the app has no server at all (e.g. a plain file host).
//             Status, years, notes and trips are saved in this browser only; no photos.
//
// The rest of the app only uses the exported functions below, so it doesn't need to
// know which mode we're in.

import { ApiError, api, checkServer, photoLink } from "./api";
import { resizeImage } from "./photos";
import type { CustomPlace, Trip, TripStop } from "../types";

export type Status = "want" | "visited" | "";
export type Mode = "local" | "shared" | "offline";

export interface PlaceState {
  status: Status;
  years: number[];
  notes: string;
  coverPhotoId: string | null;
}

export interface OurPhoto {
  id: string;
  placeId: string;
  width: number | null;
  height: number | null;
  createdAt: string;
}

/** What GET /api/state returns. */
interface ServerState {
  version: number;
  states: Record<string, PlaceState>;
  photos: OurPhoto[];
  customs: CustomPlace[];
  trips: Trip[];
  stops: TripStop[];
}

const EMPTY: PlaceState = { status: "", years: [], notes: "", coverPhotoId: null };
const CACHE_KEY = "japan-places:cache";
const LOCAL_KEY = "japan-places:local-state";

let mode: Mode = "local";
const states = new Map<string, PlaceState>();
let photos: OurPhoto[] = [];
let customs: CustomPlace[] = [];
let trips: Trip[] = [];
let stops: TripStop[] = [];
/** The server's data version we have; goes up with every change on the server. */
let version = 0;

// ---------- reading ----------

export const getMode = () => mode;
export const getState = (placeId: string): PlaceState => states.get(placeId) ?? EMPTY;
export const getStatus = (placeId: string): Status => getState(placeId).status;
export const photosFor = (placeId: string) => photos.filter((p) => p.placeId === placeId);
/** Link to one of our photos ("thumb" = small, "full" = up to 1600 px). */
export const photoUrl = (photo: OurPhoto, size: "full" | "thumb") => photoLink(photo.id, size);
/** The places we added ourselves. */
export const customPlaces = (): CustomPlace[] => customs;
/** Our trips, newest first. */
export const getTrips = (): Trip[] => [...trips].sort((a, b) => b.start.localeCompare(a.start));
export const getTrip = (id: string) => trips.find((t) => t.id === id);
/** The stops of one trip, in order: by day, then by position. */
export const stopsOfTrip = (tripId: string): TripStop[] =>
  stops.filter((s) => s.tripId === tripId).sort((a, b) => a.day.localeCompare(b.day) || a.position - b.position);
/** Where a place is planned in our trips. */
export const stopsOfPlace = (placeId: string): TripStop[] => stops.filter((s) => s.placeId === placeId);

/** Our chosen cover photo for a place, or null (then the Wikimedia photo is used). */
export function coverFor(placeId: string): { thumb: string; url: string } | null {
  const id = getState(placeId).coverPhotoId;
  const photo = id && photos.find((p) => p.id === id);
  if (!photo) return null;
  return { thumb: photoUrl(photo, "thumb"), url: photoUrl(photo, "full") };
}

export function counts() {
  let want = 0, visited = 0;
  states.forEach((s) => (s.status === "want" ? want++ : s.status === "visited" ? visited++ : 0));
  return { want, visited };
}

// ---------- change notifications ----------

const listeners: Array<() => void> = [];
/** Run `fn` whenever our data changes (used to re-draw the screen). */
export function onChange(fn: () => void) {
  listeners.push(fn);
}
function changed() {
  saveCopy();
  listeners.forEach((fn) => fn());
}

// ---------- start-up ----------

/** How many things from "this device only" were uploaded when we joined (for a message). */
export let importedFromDevice = 0;

/**
 * Connects and loads everything.
 * Returns "needs-code" if this phone hasn't entered the trip code yet.
 */
export async function init(): Promise<"ready" | "needs-code"> {
  try {
    if ((await checkServer()) === "missing") {
      mode = "local";
      loadLocal();
      return "ready";
    }
    try {
      await loadShared();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return "needs-code";
      throw err;
    }
    await startShared();
    return "ready";
  } catch (err) {
    // Most likely no internet: fall back to the copy saved on this phone.
    console.warn("Could not reach the server, using saved copy", err);
    mode = "offline";
    loadCopy();
    retryWhenOnline();
    return "ready";
  }
}

/** Checks the trip code. On success, loads the shared data. */
export async function join(code: string): Promise<boolean> {
  try {
    await api("join", { method: "POST", json: { code } });
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) return false;
    throw err;
  }
  await loadShared();
  await startShared();
  changed();
  return true;
}

async function startShared() {
  mode = "shared";
  listen();
  importedFromDevice = await importLocal();
}

// ---------- shared mode: loading + live updates ----------

async function loadShared() {
  const s = await api<ServerState>("state");
  version = s.version;
  states.clear();
  for (const [id, st] of Object.entries(s.states)) states.set(id, st);
  photos = s.photos;
  customs = s.customs;
  trips = s.trips;
  stops = s.stops;
}

/** Reloads everything (it's small), e.g. after the other phone changed something. */
let reloading: Promise<void> | null = null;
function reload() {
  reloading ??= loadShared()
    .then(changed)
    .catch((err) => console.warn("Reload failed", err))
    .finally(() => (reloading = null));
  return reloading;
}

/**
 * Live updates: the server keeps a connection open ("Server-Sent Events") and sends
 * "change" with a version number whenever anything is saved. If the version is newer
 * than ours, we reload. The browser reconnects by itself if the connection drops.
 */
let events: EventSource | null = null;
function listen() {
  if (events) return;
  events = new EventSource("./api/events");
  const onVersion = (e: MessageEvent) => {
    if (JSON.parse(e.data).version > version) reload();
  };
  events.addEventListener("change", onVersion);
  events.addEventListener("hello", onVersion); // sent on every (re)connect: catches missed changes
  // Phones pause apps in the background; check for news when we come back.
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && reload());
}

function retryWhenOnline() {
  window.addEventListener(
    "online",
    async () => {
      try {
        await loadShared();
        await startShared();
        changed();
      } catch {
        /* still not reachable (or needs the code): reopening the app retries */
      }
    },
    { once: true },
  );
}

// ---------- copies saved on the phone ----------

/** Keep a copy so the app can show our data offline (or, in local mode, as the only copy). */
function saveCopy() {
  try {
    const data = { states: Object.fromEntries(states), customs, trips, stops };
    if (mode === "local") localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
    else localStorage.setItem(CACHE_KEY, JSON.stringify({ ...data, photos }));
  } catch {
    /* storage full or blocked: not critical */
  }
}

function loadCopy() {
  try {
    const copy = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    if (!copy) return;
    Object.entries(copy.states as Record<string, PlaceState>).forEach(([id, s]) => states.set(id, s));
    photos = (copy.photos ?? []).filter((p: OurPhoto) => p.id && !("path" in p)); // skip old Supabase-era entries
    customs = copy.customs ?? [];
    trips = copy.trips ?? [];
    stops = copy.stops ?? [];
  } catch {
    /* no usable copy */
  }
}

/** Reads what was saved in "this device only" mode. */
function readLocal() {
  const saved = JSON.parse(localStorage.getItem(LOCAL_KEY) || "null");
  if (saved) {
    // (an early version saved only the states, without the "states" wrapper)
    const savedStates = (saved.states ?? saved) as Record<string, Partial<PlaceState>>;
    return {
      states: savedStates,
      customs: (saved.customs ?? []) as CustomPlace[],
      trips: (saved.trips ?? []) as Trip[],
      stops: (saved.stops ?? []) as TripStop[],
    };
  }
  // Step 2 saved only statuses under another key.
  const old = JSON.parse(localStorage.getItem("japan-places:status") || "{}") as Record<string, Status>;
  const statesOnly: Record<string, Partial<PlaceState>> = {};
  Object.entries(old).forEach(([id, status]) => status && (statesOnly[id] = { status }));
  return { states: statesOnly, customs: [], trips: [], stops: [] };
}

function loadLocal() {
  try {
    const local = readLocal();
    Object.entries(local.states).forEach(([id, s]) => states.set(id, { ...EMPTY, ...s }));
    customs = local.customs;
    trips = local.trips;
    stops = local.stops;
  } catch {
    /* nothing saved */
  }
}

/**
 * The first time a phone joins: upload what it had saved in "this device only" mode,
 * without overwriting what's already on the server. Returns how many things were uploaded.
 */
async function importLocal(): Promise<number> {
  let local;
  try {
    if (!localStorage.getItem(LOCAL_KEY) && !localStorage.getItem("japan-places:status")) return 0;
    local = readLocal();
  } catch {
    return 0;
  }
  let count = 0;
  for (const [placeId, s] of Object.entries(local.states)) {
    const server = getState(placeId);
    const patch: Partial<PlaceState> = {};
    if (s.status && !server.status) patch.status = s.status;
    const years = [...new Set([...server.years, ...(s.years ?? [])])].sort((a, b) => a - b);
    if (years.length !== server.years.length) patch.years = years;
    const notes = (s.notes ?? "").trim();
    if (notes && !server.notes.includes(notes)) patch.notes = server.notes ? `${server.notes}\n\n${notes}` : notes;
    if (Object.keys(patch).length) {
      await api(`place-state/${encodeURIComponent(placeId)}`, { method: "PATCH", json: patch }).catch(() => null);
      count++;
    }
  }
  for (const c of local.customs) {
    if (customs.some((x) => x.id === c.id)) continue;
    if (await api(`custom-places/${c.id}`, { method: "PUT", json: c }).catch(() => null)) count++;
  }
  for (const t of local.trips) {
    if (trips.some((x) => x.id === t.id)) continue;
    if (await api(`trips/${t.id}`, { method: "PUT", json: t }).catch(() => null)) count++; // skipped if that year exists
  }
  const tripIds = new Set([...trips.map((t) => t.id), ...local.trips.map((t) => t.id)]);
  const newStops = local.stops.filter((s) => tripIds.has(s.tripId) && !stops.some((x) => x.id === s.id));
  if (newStops.length) await api("stops", { method: "PUT", json: newStops }).catch(() => null);
  // Keep the old copy under another name (just in case), so it's never imported twice.
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (raw) localStorage.setItem(LOCAL_KEY + ":imported", raw);
    localStorage.removeItem(LOCAL_KEY);
    localStorage.removeItem("japan-places:status");
  } catch {
    /* ignore */
  }
  if (count || newStops.length) await loadShared();
  return count + newStops.length;
}

// ---------- writing ----------

class OfflineError extends Error {
  constructor() {
    super("You're offline, so this wasn't saved. Try again when you have signal.");
  }
}

/** Sends a change to the server and remembers the new version (so we don't reload our own change). */
async function send(path: string, method: string, json?: unknown) {
  const result = await api<{ version: number }>(path, { method, json });
  if (result?.version) version = Math.max(version, result.version);
}

/**
 * Saves some fields of one place. Only the fields given are changed on the server,
 * so if the other phone edits the notes while we change the status, nothing gets lost.
 */
async function savePlace(placeId: string, patch: Partial<PlaceState>) {
  if (mode === "offline") throw new OfflineError();
  const before = getState(placeId);
  states.set(placeId, { ...before, ...patch }); // show the change straight away
  changed();
  if (mode === "local") return;
  try {
    await send(`place-state/${encodeURIComponent(placeId)}`, "PATCH", patch);
  } catch (err) {
    states.set(placeId, before); // undo on screen
    changed();
    throw err;
  }
}

/** Tap a status once to set it, tap the same one again to clear it. */
export function setStatus(placeId: string, status: Status) {
  return savePlace(placeId, { status: getStatus(placeId) === status ? "" : status });
}

/** Adding a year also marks the place as visited. */
export function addYear(placeId: string, year: number) {
  const years = [...new Set([...getState(placeId).years, year])].sort((a, b) => a - b);
  return savePlace(placeId, { years, status: "visited" });
}

export function removeYear(placeId: string, year: number) {
  return savePlace(placeId, { years: getState(placeId).years.filter((y) => y !== year) });
}

export function setNotes(placeId: string, notes: string) {
  if (notes === getState(placeId).notes) return Promise.resolve();
  return savePlace(placeId, { notes });
}

/** Choose a photo as the cover (or null to go back to the Wikimedia photo). */
export function setCover(placeId: string, photoId: string | null) {
  return savePlace(placeId, { coverPhotoId: photoId });
}

/** Resizes and uploads photos. `progress` is called before each one ("2 of 5"). */
export async function addPhotos(placeId: string, files: File[], progress: (done: number, total: number) => void) {
  if (mode === "local") throw new Error("Photos need our server; this copy of the app has none.");
  if (mode === "offline") throw new OfflineError();
  for (let i = 0; i < files.length; i++) {
    progress(i, files.length);
    const full = await resizeImage(files[i], 1600);
    const thumb = await resizeImage(files[i], 500, 0.8);
    const id = crypto.randomUUID();
    // 1. upload both sizes, 2. tell the server the photo belongs to this place
    await api(`photos/${id}/full`, { method: "PUT", body: full.blob });
    await api(`photos/${id}/thumb`, { method: "PUT", body: thumb.blob });
    await send("photos", "POST", { id, placeId, width: full.width, height: full.height });
    photos.push({ id, placeId, width: full.width, height: full.height, createdAt: new Date().toISOString() });
    // The first photo of a place becomes its cover automatically.
    if (!getState(placeId).coverPhotoId) await setCover(placeId, id);
    else changed();
  }
  progress(files.length, files.length);
}

export async function deletePhoto(photo: OurPhoto) {
  if (mode !== "shared") throw new OfflineError();
  await send(`photos/${photo.id}`, "DELETE");
  photos = photos.filter((p) => p.id !== photo.id);
  const state = getState(photo.placeId);
  if (state.coverPhotoId === photo.id) states.set(photo.placeId, { ...state, coverPhotoId: null });
  changed();
}

// ---------- our own places ----------

/** Replaces the item with the same id, or adds it. */
function upsertById<T extends { id: string }>(list: T[], item: T): T[] {
  return list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item];
}

/** Adds a new place or saves changes to an existing one. */
export async function saveCustomPlace(place: CustomPlace) {
  if (mode === "offline") throw new OfflineError();
  if (mode === "shared") await send(`custom-places/${place.id}`, "PUT", place);
  customs = upsertById(customs, place);
  changed();
}

/** Deletes one of our places, together with its status, notes, photos and trip stops. */
export async function deleteCustomPlace(id: string) {
  if (mode === "offline") throw new OfflineError();
  if (mode === "shared") await send(`custom-places/${id}`, "DELETE");
  states.delete(id);
  customs = customs.filter((c) => c.id !== id);
  photos = photos.filter((p) => p.placeId !== id);
  stops = stops.filter((s) => s.placeId !== id);
  changed();
}

/** A new, unique id for a place we add. */
export const newCustomId = () => "c-" + crypto.randomUUID().slice(0, 13);

// ---------- trips ----------

/** Creates a trip or saves changes to it. Only one trip per year is allowed. */
export async function saveTrip(trip: Trip) {
  if (mode === "offline") throw new OfflineError();
  const year = trip.start.slice(0, 4);
  if (trips.some((t) => t.id !== trip.id && t.start.slice(0, 4) === year)) {
    throw new Error(`We already have a trip in ${year}. Edit that one instead.`);
  }
  if (mode === "shared") await send(`trips/${trip.id}`, "PUT", trip);
  trips = upsertById(trips, trip);
  changed();
}

/** Deletes a trip and all its stops. */
export async function deleteTrip(id: string) {
  if (mode === "offline") throw new OfflineError();
  if (mode === "shared") await send(`trips/${id}`, "DELETE");
  trips = trips.filter((t) => t.id !== id);
  stops = stops.filter((s) => s.tripId !== id);
  changed();
}

/** Saves several stops at once (used when adding, moving and re-ordering). */
async function saveStops(list: TripStop[]) {
  if (mode === "offline") throw new OfflineError();
  if (mode === "shared") await send("stops", "PUT", list);
  for (const s of list) stops = upsertById(stops, s);
  changed();
}

const lastPosition = (tripId: string, day: string) =>
  Math.max(-1, ...stops.filter((s) => s.tripId === tripId && s.day === day).map((s) => s.position));

/** Adds a place at the end of a day. */
export function addStop(tripId: string, day: string, placeId: string) {
  return saveStops([{ id: crypto.randomUUID(), tripId, day, placeId, position: lastPosition(tripId, day) + 1 }]);
}

/** Moves a stop one place up (-1) or down (+1) within its day, by swapping with its neighbour. */
export function moveStop(stop: TripStop, direction: -1 | 1) {
  const day = stopsOfTrip(stop.tripId).filter((s) => s.day === stop.day);
  const i = day.findIndex((s) => s.id === stop.id);
  const other = day[i + direction];
  if (!other) return Promise.resolve();
  // Give every stop of the day a clean 0, 1, 2… position, with the two swapped.
  [day[i], day[i + direction]] = [day[i + direction], day[i]];
  return saveStops(day.map((s, position) => ({ ...s, position })));
}

/** Moves a stop to the end of another day. */
export function moveStopToDay(stop: TripStop, day: string) {
  if (day === stop.day) return Promise.resolve();
  return saveStops([{ ...stop, day, position: lastPosition(stop.tripId, day) + 1 }]);
}

export async function removeStop(stop: TripStop) {
  if (mode === "offline") throw new OfflineError();
  if (mode === "shared") await send(`stops/${stop.id}`, "DELETE");
  stops = stops.filter((s) => s.id !== stop.id);
  changed();
}
