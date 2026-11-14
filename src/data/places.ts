// Loads the built-in places from public/places.json, and combines them with our own places.

import type { AnyPlace, Category, PlacesFile } from "../types";
import { customPlaces } from "./store";

export async function loadPlaces(): Promise<PlacesFile> {
  // import.meta.env.BASE_URL is "./" (set in vite.config.ts): places.json sits next to
  // index.html, wherever the app is hosted.
  const res = await fetch(import.meta.env.BASE_URL + "places.json");
  if (!res.ok) throw new Error(`Could not load places.json (HTTP ${res.status})`);
  return res.json();
}

/** Built-in places + the places we added ourselves. */
export function allPlaces(data: PlacesFile): AnyPlace[] {
  return [...data.places, ...customPlaces()];
}

export function findPlace(data: PlacesFile, id: string): AnyPlace | undefined {
  return allPlaces(data).find((p) => p.id === id);
}

/** The types of place we can add ourselves, with English + Japanese labels. */
export const CATEGORIES: Array<{ id: Category; name: string; jp: string }> = [
  { id: "restaurant", name: "Restaurant / café", jp: "食事" },
  { id: "hotel", name: "Hotel / inn", jp: "宿" },
  { id: "city", name: "City / town", jp: "町" },
  { id: "sight", name: "Sight / nature", jp: "名所" },
  { id: "other", name: "Other", jp: "その他" },
];

export function categoryOf(id: Category) {
  return CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[CATEGORIES.length - 1];
}

/** Areas for the area menu: the ones in places.json first, then any new ones we typed. */
export function allAreas(data: PlacesFile): Array<{ name: string; jp: string }> {
  const known = new Set(data.areas.map((a) => a.name));
  const extra = [...new Set(customPlaces().map((c) => c.area.trim()).filter((a) => a && !known.has(a)))].sort();
  return [...data.areas, ...extra.map((name) => ({ name, jp: "" }))];
}
