// Filtering, sorting and drawing the destinations as a grid of cards or a compact list.
// (Spots are not in this list: they are shown on their destination's page and on the map.)

import type { Destination, PlacesFile } from "../types";
import { ui } from "../state";
import { getState, getStatus } from "../data/store";
import { allDestinations, allPrefectures, isBuiltIn, spotType, spotsOf, whereLine } from "../data/places";
import { esc } from "./dom";
import { MONTHS, RATING_ORDER, ratingBadge, temps } from "./month";
import { photoHtml } from "./placeholder";

/** Words a search can match for a destination, including its spots (so "bamboo" finds Kyoto). */
function searchWords(d: Destination, data: PlacesFile): string {
  const spots = spotsOf(data, d).flatMap((s) => [s.name, s.jp, s.desc, spotType(s.type).name, getState(s.id).notes]);
  const own = [d.name, d.jp, d.prefecture, d.desc, getState(d.id).notes, ...spots];
  const extra = isBuiltIn(d) ? [d.area, d.access, d.months[ui.month].reason, ...Object.values(d.seasons), ...d.features] : [];
  return [...own, ...extra].join(" ").toLowerCase();
}

/** Does this destination pass all the filters EXCEPT the "avoid" rule? */
function matchesFilters(d: Destination, data: PlacesFile): boolean {
  const builtIn = isBuiltIn(d);
  if (ui.type === "island" && d.kind !== "island") return false;
  if (ui.type === "city" && d.kind !== "city") return false;
  if (ui.type === "gem" && !(builtIn && d.gem)) return false;
  if (ui.type === "ours" && builtIn) return false;
  if (ui.prefecture && d.prefecture !== ui.prefecture) return false;
  // Every selected feature must be on the destination (ours have no feature tags).
  if (ui.features.length && !(builtIn && ui.features.every((f) => d.features.includes(f)))) return false;
  if (ui.query && !searchWords(d, data).includes(ui.query.toLowerCase())) return false;
  return true;
}

/** Rating of a destination in the selected month. Ours have no rating (null). */
const ratingOf = (d: Destination) => (isBuiltIn(d) ? d.months[ui.month].rating : null);

const STATUS_ORDER = { want: 0, visited: 1, "": 2 } as const;

/** Sort a copy of the list according to ui.sort. */
function sortDestinations(list: Destination[], data: PlacesFile): Destination[] {
  const prefectures = allPrefectures(data).map((p) => p.name);
  const byName = (a: Destination, b: Destination) => a.name.localeCompare(b.name);
  // Destinations without a rating (ours) go between "ok" and "avoid".
  const rating = (d: Destination) => { const r = ratingOf(d); return r ? RATING_ORDER[r] : 1.5; };
  const compare: Record<typeof ui.sort, (a: Destination, b: Destination) => number> = {
    best: (a, b) => rating(a) - rating(b) || byName(a, b),
    name: byName,
    // Prefectures go roughly south-west to north-east, in the order listed in places.json.
    prefecture: (a, b) => prefectures.indexOf(a.prefecture) - prefectures.indexOf(b.prefecture) || rating(a) - rating(b) || byName(a, b),
    status: (a, b) => STATUS_ORDER[getStatus(a.id)] - STATUS_ORDER[getStatus(b.id)] || rating(a) - rating(b) || byName(a, b),
  };
  return [...list].sort(compare[ui.sort]);
}

/** Works out what to show. Returns the visible destinations and how many "avoid" ones were hidden. */
export function computeResults(data: PlacesFile) {
  const matching = allDestinations(data).filter((d) => matchesFilters(d, data));
  const avoid = matching.filter((d) => ratingOf(d) === "avoid");
  const visible = ui.showAvoid ? matching : matching.filter((d) => ratingOf(d) !== "avoid");
  const great = matching.filter((d) => ratingOf(d) === "great").length;
  return { places: sortDestinations(visible, data), hiddenAvoid: ui.showAvoid ? 0 : avoid.length, great };
}

function statusHtml(id: string): string {
  const s = getStatus(id);
  if (s === "want") return `<span class="status status--want">♡ Want to go</span>`;
  if (s === "visited") return `<span class="status status--visited">✓ Visited</span>`;
  return "";
}

/** Small label for our own destinations, shown where built-in ones show their rating. */
const oursBadge = `<span class="cat-badge">私たち<span class="sr-only"> Added by us</span></span>`;

/** "5 spots · 2 want" under a destination. */
function spotsLine(d: Destination, data: PlacesFile) {
  const spots = spotsOf(data, d);
  if (!spots.length) return "";
  const want = spots.filter((s) => getStatus(s.id) === "want").length;
  return `${spots.length} spot${spots.length > 1 ? "s" : ""}${want ? ` · ${want} want` : ""}`;
}

/** One card in the grid. The whole card is a link that opens the destination. */
function cardHtml(d: Destination, data: PlacesFile): string {
  const builtIn = isBuiltIn(d);
  const m = builtIn ? d.months[ui.month] : null;
  const where = whereLine(data, d);
  const spots = spotsLine(d, data);
  return `<a class="card${builtIn ? "" : " card--ours"}" href="#/place/${esc(d.id)}">
    <div class="card-photo">${photoHtml(d, "small", true)}${m ? ratingBadge(m.rating) : oursBadge}${builtIn && d.gem ? `<span class="gem">Gem</span>` : ""}</div>
    <div class="card-body">
      <div class="names"><b class="name">${esc(d.name)}</b> <span class="jp">${esc(d.jp)}</span></div>
      <div class="muted small">${esc(where.en)} <span class="jp">${esc(where.jp)}</span></div>
      <div class="reason small">${esc(m ? m.reason : d.desc || "Added by us")}</div>
      ${spots ? `<div class="spots-line small muted">${spots}</div>` : ""}
      <div class="card-foot">${m && builtIn ? temps(d, m) : ""}${statusHtml(d.id)}</div>
    </div>
  </a>`;
}

/** One row in the compact list. */
function rowHtml(d: Destination, data: PlacesFile): string {
  const m = isBuiltIn(d) ? d.months[ui.month] : null;
  const spots = spotsLine(d, data);
  return `<a class="row" href="#/place/${esc(d.id)}">
    <div class="row-thumb">${photoHtml(d)}</div>
    <div class="row-main">
      <div class="names"><b class="name">${esc(d.name)}</b> <span class="jp">${esc(d.jp)}</span></div>
      <div class="muted small ellipsis">${esc(whereLine(data, d).en)} · ${esc(m ? m.reason : d.desc || "Added by us")}</div>
      ${statusHtml(d.id) || `<span class="status status--none">Not marked</span>`}${spots ? ` <span class="small muted">· ${spots}</span>` : ""}
    </div>
    <div class="row-rate">${m ? ratingBadge(m.rating) : oursBadge}</div>
  </a>`;
}

export function renderResults(el: HTMLElement, data: PlacesFile) {
  const { places, hiddenAvoid } = computeResults(data);
  const items =
    ui.view === "grid"
      ? `<div class="grid">${places.map((d) => cardHtml(d, data)).join("")}</div>`
      : `<div class="list">${places.map((d) => rowHtml(d, data)).join("")}</div>`;
  const empty =
    places.length === 0
      ? `<p class="empty">${ui.type === "ours" ? `No destinations of our own yet. Tap <b>＋ Add</b> below.` : "Nothing matches. Try removing a filter."}</p>`
      : "";
  const more = hiddenAvoid
    ? `<button class="link-btn" data-action="show-avoid">Show ${hiddenAvoid} place${hiddenAvoid > 1 ? "s" : ""} to avoid in ${MONTHS[ui.month]}</button>`
    : "";
  el.innerHTML = items + empty + more;
}
