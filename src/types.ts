// Shared TypeScript types for the place data in public/places.json.
// If you add a field to places.json, add it here too so TypeScript knows about it.

/** How good a month is for visiting a place. */
export type Rating = "great" | "ok" | "avoid";

/** Feature tags used by the feature filter. */
export type FeatureId = "beach" | "snorkel" | "nature" | "hiking" | "onsen" | "culture" | "food";

/** One month in a place's "best time to go" strip. Index 0 = January. */
export interface MonthInfo {
  rating: Rating;
  /** One short line explaining the rating, e.g. "rainy season". */
  reason: string;
  /** Mean air temperature in °C (JMA climate normal), or null if not fetched yet. */
  air: number | null;
  /** Sea surface temperature in °C. Islands only. Always an estimate. */
  sea?: number;
}

/** Where the climate numbers come from. */
export interface ClimateInfo {
  /** JMA station name, Japanese + English, e.g. "石垣島 Ishigakijima". */
  station: string;
  /** Which JMA page to read: type "s" = main weather station, "a" = AMeDAS station. */
  stationRef: { type: "s" | "a"; prec: number; block: number };
  /** "jma" = station is on the island / in the city; "nearby" = station on a neighbouring island. */
  airSource: "jma" | "nearby";
  /** Statistics period, e.g. "1991～2020". Filled in by the climate script. */
  period: string | null;
  /** Sea temperatures are rough estimates; null for cities. */
  seaSource: "estimate" | null;
}

/** Photo from Wikimedia Commons (filled in by scripts/fetch-photos.ts). */
export interface CommonsPhoto {
  /** Commons file name, e.g. "Kabira Bay.jpg". */
  file: string;
  /** 1280 px wide image (place page). */
  url: string;
  /** 500 px wide image (cards and list). */
  thumb: string;
  author: string;
  license: string;
  licenseUrl: string;
  sourcePage: string;
}

export interface Place {
  id: string;
  name: string;
  /** Japanese name, e.g. "石垣島". */
  jp: string;
  kind: "island" | "city";
  /** Landscape type, used to draw a placeholder picture when there is no photo. */
  scene: string;
  area: string;
  lat: number;
  lng: number;
  /** Hidden gem: little known, even among Japanese travellers. */
  gem: boolean;
  features: FeatureId[];
  desc: string;
  /** How to get there. */
  access: string;
  /** Exactly 12 entries, January first. */
  months: MonthInfo[];
  climate: ClimateInfo;
  seasons: { spring: string; summer: string; autumn: string; winter: string };
  photo: CommonsPhoto | null;
  /** Optional: a Commons file name we picked ourselves; the photo script uses it first. */
  photoFile?: string;
}

export interface Area {
  name: string;
  jp: string;
}

export interface Feature {
  id: FeatureId;
  name: string;
  jp: string;
}

/** The whole places.json file. */
export interface PlacesFile {
  areas: Area[];
  features: Feature[];
  places: Place[];
}

// ---------- our own places (restaurants, hotels, other cities…) ----------

export type Category = "restaurant" | "hotel" | "city" | "sight" | "other";

/** A place we added ourselves. Saved on our server (table custom_places). */
export interface CustomPlace {
  id: string; // starts with "c-"
  kind: "custom";
  category: Category;
  name: string;
  /** Japanese name (optional, can be "") */
  jp: string;
  area: string;
  lat: number;
  lng: number;
  /** Short description / why we saved it */
  desc: string;
}

/** Any place in the app: a built-in island/city, or one of ours. Check `kind === "custom"` to tell them apart. */
export type AnyPlace = Place | CustomPlace;

// ---------- trip planner ----------

/** One trip. Dates are "YYYY-MM-DD" strings. Only one trip per year (the start date's year). */
export interface Trip {
  id: string;
  title: string;
  start: string;
  end: string;
}

/** One place on one day of a trip. `position` sets the order within the day. */
export interface TripStop {
  id: string;
  tripId: string;
  day: string; // "YYYY-MM-DD"
  position: number;
  placeId: string;
}
