// The controls at the top: month picker, type chips, prefecture, features, search,
// result count, sort and grid/list switch.

import type { PlacesFile } from "../types";
import { allPrefectures } from "../data/places";
import { ui } from "../state";
import { esc } from "./dom";
import { MONTHS, monthPicker } from "./month";

const TYPES = [
  ["all", "All", "すべて"],
  ["island", "Islands", "島"],
  ["city", "Cities", "都市"],
  ["gem", "Hidden gems", "穴場"],
  ["ours", "Added by us", "私たちの"],
] as const;

const SORTS = [
  ["best", "Best first"],
  ["name", "Name"],
  ["prefecture", "Prefecture"],
  ["status", "Our status"],
] as const;

/** Draws the month picker. Re-drawn when the month changes. */
export function renderMonths(el: HTMLElement) {
  el.innerHTML = monthPicker(ui.month);
}

/** Draws the type chips, prefecture menu and feature chips. */
export function renderChips(el: HTMLElement, data: PlacesFile) {
  const types = TYPES.map(
    ([id, label, jp]) =>
      `<button class="chip" data-type="${id}" aria-pressed="${ui.type === id}">${label}<span class="chip-jp jp">${jp}</span></button>`,
  ).join("");
  const prefectures = allPrefectures(data)
    .map((p) => `<option value="${esc(p.name)}" ${ui.prefecture === p.name ? "selected" : ""}>${esc(p.name)} ${esc(p.jp)}</option>`)
    .join("");
  const features = data.features
    .map(
      (f) =>
        `<button class="chip chip--small" data-feature="${f.id}" aria-pressed="${ui.features.includes(f.id)}">${esc(f.name)}</button>`,
    )
    .join("");
  const clear = ui.features.length ? `<button class="chip chip--small chip--clear" data-feature="__clear">Clear</button>` : "";
  el.innerHTML = `
    <div class="chips">${types}
      <label class="select-chip"><span class="sr-only">Prefecture</span>
        <select data-prefecture><option value="">All prefectures</option>${prefectures}</select>
      </label>
    </div>
    <div class="chips">${features}${clear}</div>`;
}

/** The "Great in November · 12 places" line with sort and view buttons. */
export function renderResultBar(el: HTMLElement, count: number, great: number) {
  const sorts = SORTS.map(
    ([id, label]) => `<option value="${id}" ${ui.sort === id ? "selected" : ""}>${label}</option>`,
  ).join("");
  el.innerHTML = `
    <p class="result-text"><b>${great} great in ${MONTHS[ui.month].slice(0, 3)}</b> · ${count} shown</p>
    <div class="result-tools">
      <label class="sort"><span class="sr-only">Sort by</span><select data-sort>${sorts}</select></label>
      <div class="viewswitch" role="group" aria-label="View">
        <button data-view="grid" aria-pressed="${ui.view === "grid"}" aria-label="Grid view">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/></svg>
        </button>
        <button data-view="list" aria-pressed="${ui.view === "list"}" aria-label="List view">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h14M5 12h14M5 18h14"/></svg>
        </button>
      </div>
    </div>`;
}
