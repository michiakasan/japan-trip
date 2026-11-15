// Loads the built-in destinations and spots from public/places.json, and combines them with
// the destinations and spots we added ourselves (from store.ts).

import type { AnyPlace, Area, Destination, Place, PlacesFile, Spot, SpotType } from "../types";
import { getState, ownDestinations, ownSpots } from "./store";

export async function loadPlaces(): Promise<PlacesFile> {
  // import.meta.env.BASE_URL is "./" (set in vite.config.ts): places.json sits next to
  // index.html, wherever the app is hosted.
  const res = await fetch(import.meta.env.BASE_URL + "places.json");
  if (!res.ok) throw new Error(`Could not load places.json (HTTP ${res.status})`);
  const data: PlacesFile = await res.json();
  // Mark the built-in spots, so the rest of the app can treat all spots the same way.
  data.spots = (data.spots ?? []).map((s) => ({ ...s, kind: "spot", builtIn: true }));
  return data;
}

// ---------- destinations ----------

/** Built-in destinations + the ones we added ourselves. */
export function allDestinations(data: PlacesFile): Destination[] {
  return [...data.places, ...ownDestinations()];
}

/** Is this destination one of the built-in ones (with month ratings)? */
export const isBuiltIn = (d: Destination): d is Place => d.kind !== "custom";

// ---------- spots ----------

/** Every spot, built-in and ours. Hidden built-in spots are left out unless `withHidden`. */
export function allSpots(data: PlacesFile, withHidden = false): Spot[] {
  const builtIn = withHidden ? data.spots : data.spots.filter((s) => !getState(s.id).hidden);
  return [...builtIn, ...ownSpots()];
}

/** Distance between two points in km (the "haversine" formula). */
export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad, dLng = (bLng - aLng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

/** The destination closest to a point. */
export function nearestDestination(data: PlacesFile, lat: number, lng: number): Destination {
  return allDestinations(data)
    .map((d) => ({ d, km: distanceKm(lat, lng, d.lat, d.lng) }))
    .sort((a, b) => a.km - b.km)[0].d;
}

/** The destination a spot belongs to. A spot without one (e.g. moved over from an older
 *  version of the app, or whose destination was deleted) goes to the nearest destination. */
export function destinationOf(data: PlacesFile, spot: Spot): Destination {
  return allDestinations(data).find((d) => d.id === spot.destinationId) ?? nearestDestination(data, spot.lat, spot.lng);
}

/** The spots of one destination, sorted by name. */
export function spotsOf(data: PlacesFile, destination: Destination, withHidden = false): Spot[] {
  return allSpots(data, withHidden)
    .filter((s) => destinationOf(data, s).id === destination.id)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ---------- looking things up ----------

/** Any destination or spot by its id (hidden spots included, so their page still opens). */
export function findPlace(data: PlacesFile, id: string): AnyPlace | undefined {
  return allDestinations(data).find((p) => p.id === id) ?? allSpots(data, true).find((s) => s.id === id);
}

/** For a spot, its destination; for a destination, itself. (Month ratings live on destinations.) */
export function destinationFor(data: PlacesFile, place: AnyPlace): Destination {
  return place.kind === "spot" ? destinationOf(data, place) : place;
}

/** The built-in destination whose month ratings apply to this place, or null (ours have none). */
export function ratedDestination(data: PlacesFile, place: AnyPlace | undefined): Place | null {
  if (!place) return null;
  const d = destinationFor(data, place);
  return isBuiltIn(d) ? d : null;
}

// ---------- names for spot types and prefectures ----------

/** The kinds of spot, with English + Japanese labels and an icon for the map. */
export const SPOT_TYPES: Array<{ id: SpotType; name: string; jp: string; icon: string }> = [
  { id: "beach", name: "Beach", jp: "ビーチ", icon: "🏖️" },
  { id: "temple", name: "Temple & shrine", jp: "寺社", icon: "⛩️" },
  { id: "onsen", name: "Onsen", jp: "温泉", icon: "♨️" },
  { id: "view", name: "Viewpoint", jp: "展望", icon: "🌄" },
  { id: "nature", name: "Nature & hike", jp: "自然", icon: "🌲" },
  { id: "sight", name: "Sight & museum", jp: "名所", icon: "🏯" },
  { id: "food", name: "Restaurant & market", jp: "食事", icon: "🍜" },
  { id: "cafe", name: "Café", jp: "カフェ", icon: "☕" },
  { id: "stay", name: "Hotel & ryokan", jp: "宿", icon: "🛏️" },
  { id: "shop", name: "Shopping & street", jp: "買い物", icon: "🛍️" },
  { id: "other", name: "Other", jp: "その他", icon: "📍" },
];

export function spotType(id: SpotType) {
  return SPOT_TYPES.find((t) => t.id === id) ?? SPOT_TYPES[SPOT_TYPES.length - 1];
}

/** Prefectures for the filter: the ones in places.json first, then any new ones we typed. */
export function allPrefectures(data: PlacesFile): Area[] {
  const known = new Set(data.prefectures.map((p) => p.name));
  const extra = [...new Set(ownDestinations().map((d) => d.prefecture.trim()).filter((p) => p && !known.has(p)))].sort();
  return [...data.prefectures, ...extra.map((name) => ({ name, jp: "" }))];
}

/** "Yaeyama · Okinawa 沖縄" style line for a destination (the area only if it adds something). */
export function whereLine(data: PlacesFile, d: Destination): { en: string; jp: string } {
  const pref = allPrefectures(data).find((p) => p.name === d.prefecture);
  const area = isBuiltIn(d) && d.area !== d.prefecture ? d.area : "";
  return { en: [area, d.prefecture].filter(Boolean).join(" · "), jp: pref?.jp ?? "" };
}
