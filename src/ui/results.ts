// Filtering, sorting and drawing the places as a grid of cards or a compact list.

import type { AnyPlace, PlacesFile } from "../types";
import { ui } from "../state";
import { getState, getStatus } from "../data/store";
import { allAreas, allPlaces, categoryOf } from "../data/places";
import { esc } from "./dom";
import { MONTHS, RATING_ORDER, ratingBadge, temps } from "./month";
import { photoHtml } from "./placeholder";

/** Does this place pass all the filters EXCEPT the "avoid" rule? */
function matchesFilters(p: AnyPlace): boolean {
  const custom = p.kind === "custom";
  if (ui.type === "island" && p.kind !== "island") return false;
  if (ui.type === "city" && !(p.kind === "city" || (custom && p.category === "city"))) return false;
  if (ui.type === "gem" && (custom || !p.gem)) return false;
  if (ui.type === "ours" && !custom) return false;
  if (ui.area && p.area !== ui.area) return false;
  // Every selected feature must be on the place (our own places have no feature tags).
  if (ui.features.length && (custom || !ui.features.every((f) => p.features.includes(f)))) return false;
  if (ui.query) {
    const own = getState(p.id).notes;
    const words = custom
      ? [p.name, p.jp, p.area, p.desc, categoryOf(p.category).name, own]
      : [p.name, p.jp, p.area, p.desc, p.access, p.months[ui.month].reason, own, ...Object.values(p.seasons), ...p.features];
    if (!words.join(" ").toLowerCase().includes(ui.query.toLowerCase())) return false;
  }
  return true;
}

/** Rating of a place in the selected month. Our own places have no rating (null). */
const ratingOf = (p: AnyPlace) => (p.kind === "custom" ? null : p.months[ui.month].rating);

const STATUS_ORDER = { want: 0, visited: 1, "": 2 } as const;

/** Sort a copy of the list according to ui.sort. */
function sortPlaces(list: AnyPlace[], data: PlacesFile): AnyPlace[] {
  const areas = allAreas(data).map((a) => a.name);
  const byName = (a: AnyPlace, b: AnyPlace) => a.name.localeCompare(b.name);
  // Places without a rating (ours) go between "ok" and "avoid".
  const rating = (p: AnyPlace) => { const r = ratingOf(p); return r ? RATING_ORDER[r] : 1.5; };
  const compare: Record<typeof ui.sort, (a: AnyPlace, b: AnyPlace) => number> = {
    best: (a, b) => rating(a) - rating(b) || byName(a, b),
    name: byName,
    // Areas go roughly south to north, in the order listed in places.json.
    area: (a, b) => areas.indexOf(a.area) - areas.indexOf(b.area) || rating(a) - rating(b) || byName(a, b),
    status: (a, b) => STATUS_ORDER[getStatus(a.id)] - STATUS_ORDER[getStatus(b.id)] || rating(a) - rating(b) || byName(a, b),
  };
  return [...list].sort(compare[ui.sort]);
}

/** Works out what to show. Returns the visible places and how many "avoid" ones were hidden. */
export function computeResults(data: PlacesFile) {
  const matching = allPlaces(data).filter(matchesFilters);
  const avoid = matching.filter((p) => ratingOf(p) === "avoid");
  const visible = ui.showAvoid ? matching : matching.filter((p) => ratingOf(p) !== "avoid");
  const great = matching.filter((p) => ratingOf(p) === "great").length;
  return { places: sortPlaces(visible, data), hiddenAvoid: ui.showAvoid ? 0 : avoid.length, great };
}

function statusHtml(id: string): string {
  const s = getStatus(id);
  if (s === "want") return `<span class="status status--want">♡ Want to go</span>`;
  if (s === "visited") return `<span class="status status--visited">✓ Visited</span>`;
  return "";
}

function jpArea(data: PlacesFile, area: string) {
  return data.areas.find((a) => a.name === area)?.jp ?? "";
}

/** Small label for our own places, shown where built-in places show their rating. */
function categoryBadge(p: AnyPlace) {
  if (p.kind !== "custom") return "";
  const c = categoryOf(p.category);
  return `<span class="cat-badge">${esc(c.jp)}<span class="sr-only"> ${esc(c.name)}</span></span>`;
}

/** One card in the grid. The whole card is a link that opens the place. */
function cardHtml(p: AnyPlace, data: PlacesFile): string {
  const custom = p.kind === "custom";
  const m = custom ? null : p.months[ui.month];
  const badge = custom ? categoryBadge(p) : ratingBadge(m!.rating);
  const line = custom ? p.desc || categoryOf(p.category).name : m!.reason;
  return `<a class="card${custom ? " card--ours" : ""}" href="#/place/${esc(p.id)}">
    <div class="card-photo">${photoHtml(p, "small", true)}${badge}${!custom && p.gem ? `<span class="gem">Gem</span>` : ""}</div>
    <div class="card-body">
      <div class="names"><b class="name">${esc(p.name)}</b> <span class="jp">${esc(p.jp)}</span></div>
      <div class="muted small">${esc(p.area)} <span class="jp">${esc(jpArea(data, p.area))}</span></div>
      <div class="reason small">${esc(line)}</div>
      <div class="card-foot">${custom ? `<span class="small muted">${esc(categoryOf(p.category).name)}</span>` : temps(p, m!)}${statusHtml(p.id)}</div>
    </div>
  </a>`;
}

/** One row in the compact list. */
function rowHtml(p: AnyPlace): string {
  const custom = p.kind === "custom";
  const line = custom ? p.desc || categoryOf(p.category).name : p.months[ui.month].reason;
  return `<a class="row" href="#/place/${esc(p.id)}">
    <div class="row-thumb">${photoHtml(p)}</div>
    <div class="row-main">
      <div class="names"><b class="name">${esc(p.name)}</b> <span class="jp">${esc(p.jp)}</span></div>
      <div class="muted small ellipsis">${esc(p.area)} · ${esc(line)}</div>
      ${statusHtml(p.id) || `<span class="status status--none">Not marked</span>`}
    </div>
    <div class="row-rate">${custom ? categoryBadge(p) : ratingBadge(p.months[ui.month].rating)}</div>
  </a>`;
}

export function renderResults(el: HTMLElement, data: PlacesFile) {
  const { places, hiddenAvoid } = computeResults(data);
  const items =
    ui.view === "grid"
      ? `<div class="grid">${places.map((p) => cardHtml(p, data)).join("")}</div>`
      : `<div class="list">${places.map((p) => rowHtml(p)).join("")}</div>`;
  const empty =
    places.length === 0
      ? `<p class="empty">${ui.type === "ours" ? `No places of our own yet. Tap <b>＋ Add</b> below.` : "No places match. Try removing a filter."}</p>`
      : "";
  const more = hiddenAvoid
    ? `<button class="link-btn" data-action="show-avoid">Show ${hiddenAvoid} place${hiddenAvoid > 1 ? "s" : ""} to avoid in ${MONTHS[ui.month]}</button>`
    : "";
  el.innerHTML = items + empty + more;
}
