// The app's UI state: which month, filters, view and sort are selected.
// Some of it is saved in the browser (localStorage) so the app reopens the way we left it.

import type { FeatureId } from "./types";

export type ThemeChoice = "auto" | "light" | "dark";
export type View = "grid" | "list";
export type SortBy = "best" | "name" | "prefecture" | "status";
export type TypeFilter = "all" | "island" | "city" | "gem" | "ours";

export interface UiState {
  theme: ThemeChoice;
  view: View;
  sort: SortBy;
  /** Selected month, 0 = January … 11 = December. */
  month: number;
  type: TypeFilter;
  /** "" = all prefectures. */
  prefecture: string;
  /** Places must have ALL selected features. */
  features: FeatureId[];
  query: string;
  /** Places rated "avoid" in the selected month are hidden unless this is true. */
  showAvoid: boolean;
}

const STORAGE_KEY = "japan-places:ui";
// Only these fields are remembered between visits. Filters start fresh each time.
const REMEMBERED = ["theme", "view", "sort", "month"] as const;

const defaults: UiState = {
  theme: "auto",
  view: "grid",
  sort: "best",
  month: new Date().getMonth(), // start on the current month
  type: "all",
  prefecture: "",
  features: [],
  query: "",
  showAvoid: false,
};

function load(): UiState {
  // localStorage can be blocked (private mode), so always use try/catch.
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    if (saved.sort === "area") saved.sort = "prefecture"; // renamed in the spots version
    return { ...defaults, ...saved };
  } catch {
    return { ...defaults };
  }
}

/** The one shared state object. Change it, then call save() and re-render. */
export const ui: UiState = load();

export function save() {
  try {
    const toSave: Partial<UiState> = {};
    for (const key of REMEMBERED) (toSave as Record<string, unknown>)[key] = ui[key];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch {
    /* ignore: the app still works, it just won't remember */
  }
}
