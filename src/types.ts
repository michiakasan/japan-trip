// Shared TypeScript types for the place data in public/places.json.
// If you add a field to places.json, add it here too so TypeScript knows about it.
//
// Three levels:
//   Prefecture   only used as a filter (each destination has a `prefecture`)
//   Destination  the main card: a city, town or island. Built-in ones (`Place`) have month
//                ratings, temperatures, photos and seasons; ours (`OwnDestination`) don't.
//   Spot         belongs to one destination: a beach, temple, restaurant, onsen…

/** How good a month is for visiting a place. */
export type Rating = "great" | "ok" | "avoid";

/** Feature tags used by the feature filter. */
export type FeatureId = "beach" | "snorkel" | "nature" | "hiking" | "onsen" | "culture" | "food" | "ryokan";

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
  /** Region shown on the card, e.g. "Yaeyama" (for cities the same as the prefecture or "Kansai"…). */
  area: string;
  /** Prefecture name in English, e.g. "Okinawa" (one of PlacesFile.prefectures). */
  prefecture: string;
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
  /** More Commons photos for the place page (the photo script finds up to 3). */
  gallery?: CommonsPhoto[];
  /** Optional: Commons file names we picked ourselves for the gallery (tried first). */
  galleryFiles?: string[];
}

/** A name in English + Japanese, used for areas and prefectures. */
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
  /** Prefectures for the filter, roughly south-west to north-east. */
  prefectures: Area[];
  features: Feature[];
  places: Place[];
  /** Well-known spots (in places.json they have no `kind`/`builtIn`; loadPlaces adds them). */
  spots: Spot[];
}

// ---------- destinations we added ourselves ----------

/** A town or island we added ourselves. Saved on our server (table our_destinations). */
export interface OwnDestination {
  id: string; // starts with "c-"
  kind: "custom";
  name: string;
  /** Japanese name (optional, can be "") */
  jp: string;
  prefecture: string;
  lat: number;
  lng: number;
  /** Short description / why we saved it */
  desc: string;
}

/** A destination: built-in (kind "island" or "city") or ours (kind "custom"). */
export type Destination = Place | OwnDestination;

// ---------- spots ----------

export type SpotType = "beach" | "temple" | "onsen" | "view" | "nature" | "sight" | "food" | "cafe" | "stay" | "shop" | "other";

/** A spot inside a destination. Built-in ones come from places.json, ours from the server (id "s-…"). */
export interface Spot {
  id: string;
  kind: "spot";
  /** true = from places.json (can be hidden, not edited); false = added by us. */
  builtIn: boolean;
  /** Id of the destination it belongs to ("" = not set: the app uses the nearest one). */
  destinationId: string;
  type: SpotType;
  name: string;
  jp: string;
  lat: number;
  lng: number;
  desc: string;
}

/** Anything with its own page: a destination or a spot. Check `kind` to tell them apart. */
export type AnyPlace = Destination | Spot;

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
