// The place page: opens over the list or map when you tap a destination or a spot
// (URL becomes #/place/<id>). Three kinds of page:
//   built-in destination  month chart, spots, seasons, photos, about
//   our own destination   description, spots
//   spot                  its destination's month chart, description
// All of them have our status, trips and "our record" (years, notes, photos).
// The same sliding panel ("sheet") is also used by the add/edit form (add-place.ts).

import type { AnyPlace, Destination, Place, PlacesFile, Spot, SpotType } from "../types";
import { ui } from "../state";
import { getState, getStatus } from "../data/store";
import { destinationOf, findPlace, isBuiltIn, spotType, spotsOf, SPOT_TYPES, whereLine } from "../data/places";
import { $, esc } from "./dom";
import { monthDetail, monthStrip } from "./month";
import { creditHtml, photoHtml } from "./placeholder";
import { oursHtml } from "./ours";
import { placeTripsHtml } from "./trips";

const SEASONS = [
  ["spring", "Spring", "春"],
  ["summer", "Summer", "夏"],
  ["autumn", "Autumn", "秋"],
  ["winter", "Winter", "冬"],
] as const;

/** Which month is highlighted on the open place page (starts at the month chosen in the list). */
let sheetMonth = 0;
let current: AnyPlace | null = null;
/** Where "back" goes: the list ("#/") or the map ("#/map"). Set by main.ts. */
let backHref = "#/";

/** Id of the place that is open right now (or null). */
export const currentPlaceId = () => current?.id ?? null;
export const currentPlace = () => current;
export const setBackHref = (href: string) => (backHref = href);
export const getBackHref = () => backHref;

/** The back button used at the top of every sheet. */
export const backButton = (label = "Back", href = backHref) =>
  `<a class="back" href="${href}" aria-label="${label}">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>
  </a>`;

/** Shows the sheet panel (whatever is drawn in it). */
export function showSheet() {
  const sheet = $("#sheet");
  sheet.hidden = false;
  $("#sheetBg").hidden = false;
  document.body.classList.add("no-scroll");
  sheet.scrollTop = 0;
  // Move keyboard focus into the sheet (helps screen readers and keyboard users).
  sheet.querySelector<HTMLElement>(".back")?.focus({ preventScroll: true });
}

export function openSheet(place: AnyPlace, data: PlacesFile) {
  const samePlace = current?.id === place.id && !$("#sheet").hidden;
  current = place;
  if (samePlace) return renderSheet(data); // e.g. coming back from "edit": keep scroll position
  sheetMonth = ui.month;
  // A new destination starts with all its spots shown.
  if (place.kind !== "spot") {
    spotFilter = "all";
    showHiddenSpots = false;
  }
  renderSheet(data);
  showSheet();
}

// ---------- the spots list on a destination page ----------

/** Which type of spot is shown ("all" or e.g. "beach"), and whether hidden built-in spots are shown. */
let spotFilter: SpotType | "all" = "all";
let showHiddenSpots = false;

/** Called when a type chip above the spots is tapped. */
export function setSpotFilter(type: SpotType | "all", data: PlacesFile) {
  spotFilter = type;
  renderSheet(data);
}

/** Called by "Show hidden spots". */
export function toggleHiddenSpots(data: PlacesFile) {
  showHiddenSpots = !showHiddenSpots;
  renderSheet(data);
}

function statusMark(id: string) {
  const s = getStatus(id);
  return s === "want" ? `<span class="status status--want">♡</span>` : s === "visited" ? `<span class="status status--visited">✓</span>` : "";
}

function spotsHtml(d: Destination, data: PlacesFile) {
  const all = spotsOf(data, d, showHiddenSpots);
  const hiddenCount = spotsOf(data, d, true).length - spotsOf(data, d).length;
  // Only offer the types this destination actually has.
  const types = SPOT_TYPES.filter((t) => all.some((s) => s.type === t.id));
  if (spotFilter !== "all" && !types.some((t) => t.id === spotFilter)) spotFilter = "all";
  const shown = spotFilter === "all" ? all : all.filter((s) => s.type === spotFilter);
  const chip = (id: string, label: string, n: number) =>
    `<button class="chip chip--small" data-spot-type="${id}" aria-pressed="${spotFilter === id}">${label} <small>${n}</small></button>`;
  const chips = types.length > 1
    ? `<div class="chips chips--wrap">${chip("all", "All", all.length)}${types
        .map((t) => chip(t.id, `${t.icon} ${esc(t.name)}`, all.filter((s) => s.type === t.id).length))
        .join("")}</div>`
    : "";
  const rows = shown
    .map((s) => {
      const t = spotType(s.type);
      const hidden = s.builtIn && getState(s.id).hidden;
      return `<li><a class="spot-row${hidden ? " spot-row--hidden" : ""}" href="#/place/${esc(s.id)}">
        <span class="spot-icon" aria-hidden="true">${t.icon}</span>
        <span class="spot-text"><b>${esc(s.name)}</b> <span class="jp">${esc(s.jp)}</span>
          <span class="muted small">${esc(t.name)}${s.builtIn ? "" : " · added by us"}${hidden ? " · hidden" : ""}${s.desc ? ` · ${esc(s.desc)}` : ""}</span></span>
        ${statusMark(s.id)}
      </a></li>`;
    })
    .join("");
  return `<section class="spots" id="spots">
      <div class="spots-head">
        <h3>Spots <span class="jp">スポット</span></h3>
        <a class="btn-secondary btn-small" href="#/add/${esc(d.id)}">＋ Add spot</a>
      </div>
      ${chips}
      ${rows ? `<ul class="spot-list">${rows}</ul>` : `<p class="muted small">No spots yet. Add the beaches, temples, restaurants… you want to see here.</p>`}
      ${hiddenCount ? `<button class="link-btn" data-action="toggle-hidden">${showHiddenSpots ? "Hide" : "Show"} ${hiddenCount} hidden spot${hiddenCount > 1 ? "s" : ""}</button>` : ""}
    </section>`;
}

/** Forget the open place (used when the sheet shows the add/edit form instead). */
export function clearCurrentPlace() {
  current = null;
}

export function closeSheet() {
  current = null;
  $("#sheet").hidden = true;
  $("#sheetBg").hidden = true;
  document.body.classList.remove("no-scroll");
}

/** Called when a month in the strip is tapped. */
export function selectSheetMonth(i: number, data: PlacesFile) {
  sheetMonth = i;
  renderSheet(data);
}

/** The month chart of a built-in destination ("Best time to go"). */
function monthPanel(p: Place, title = "Best time to go") {
  return `<section class="panel">
      <h3>${esc(title)} <span class="jp">いつ行く</span></h3>
      ${monthStrip(p, sheetMonth)}
      ${monthDetail(p, sheetMonth)}
    </section>`;
}

/** The parts of a built-in destination page: month chart, spots, seasons, photos, about, sources. */
function builtInSections(p: Place, data: PlacesFile) {
  const source =
    `Air: JMA climate normals ${esc(p.climate.period ?? "")}, station ${esc(p.climate.station)}` +
    (p.climate.airSource === "nearby" ? " (a nearby station, so approximate)" : "") +
    (p.climate.seaSource ? ". Sea temperatures are rough estimates." : ".");
  return {
    top: monthPanel(p) + spotsHtml(p, data),
    bottom: `<section>
        <h3>Through the year <span class="jp">四季</span></h3>
        <div class="seasons">
          ${SEASONS.map(
            ([key, label, jp]) =>
              `<div class="season"><b>${label} <span class="jp">${jp}</span></b><p>${esc(p.seasons[key])}</p></div>`,
          ).join("")}
        </div>
      </section>
      ${galleryHtml(p)}
      <section>
        <h3>About <span class="jp">概要</span></h3>
        <p>${esc(p.desc)}</p>
        <p><b>Getting there:</b> ${esc(p.access)}</p>
        <p><a class="text-link" href="#/map/${esc(p.id)}">Show on map</a></p>
      </section>
      <p class="source small muted">${source}${p.photo ? `<br>${creditHtml(p)}` : ""}</p>`,
    subtitle: p.features.map((id) => data.features.find((f) => f.id === id)?.name ?? id).join(" · "),
  };
}

/** "Photos" strip: more Commons photos of the place, swipe sideways, tap to see one big. */
function galleryHtml(p: Place) {
  if (!p.gallery?.length) return "";
  return `<section>
      <h3>Photos <span class="jp">写真</span></h3>
      <div class="gallery">
        ${p.gallery
          .map(
            (g, i) => `<button class="gallery-item" data-our="gallery" data-index="${i}" aria-label="View photo ${i + 1}">
              <img src="${esc(g.thumb)}" alt="${esc(p.name)}, photo ${i + 1}" loading="lazy" decoding="async"
                crossorigin="anonymous" title="${esc(`Photo: ${g.author} · ${g.license}`)}" />
            </button>`,
          )
          .join("")}
      </div>
    </section>`;
}

/** The parts of our own destination's page. */
function ownDestinationSections(d: Destination, data: PlacesFile) {
  return {
    top: (d.desc ? `<p class="custom-desc">${esc(d.desc)}</p>` : "") + spotsHtml(d, data),
    bottom: `<div class="custom-actions">
        <a class="text-link" href="#/map/${esc(d.id)}">Show on map</a>
        <a class="btn-secondary" href="#/edit/${esc(d.id)}">Edit</a>
        <button class="btn-danger" data-action="delete-place">Delete</button>
      </div>`,
    subtitle: "Added by us",
  };
}

/** The parts of a spot's page. */
function spotSections(s: Spot, data: PlacesFile) {
  const d = destinationOf(data, s);
  const t = spotType(s.type);
  const hidden = getState(s.id).hidden;
  const actions = s.builtIn
    ? `<button class="btn-secondary" data-action="${hidden ? "unhide-spot" : "hide-spot"}">${hidden ? "Show this spot again" : "Hide this spot"}</button>`
    : `<a class="btn-secondary" href="#/edit/${esc(s.id)}">Edit</a>
       <button class="btn-danger" data-action="delete-place">Delete</button>`;
  return {
    top:
      (s.desc ? `<p class="custom-desc">${esc(s.desc)}</p>` : "") +
      (hidden ? `<p class="muted small">Hidden: not shown in ${esc(d.name)}'s spots or on the map.</p>` : "") +
      (isBuiltIn(d) ? monthPanel(d, `Best time to visit ${d.name}`) : ""),
    bottom: `<div class="custom-actions">
        <a class="text-link" href="#/map/${esc(s.id)}">Show on map</a>
        ${actions}
      </div>`,
    subtitle: `${t.icon} ${esc(t.name)} <span class="jp">${esc(t.jp)}</span> · in <a class="text-link" href="#/place/${esc(d.id)}">${esc(d.name)}</a>`,
  };
}

/** Re-draw the open sheet (e.g. after the status changes). */
export function renderSheet(data: PlacesFile) {
  if (!current) return;
  // Look the place up again: it may have been edited (here or on the other phone).
  const p = (current = findPlace(data, current.id) ?? current);
  const sheet = $("#sheet");
  // Re-drawing replaces every element. If you are typing (e.g. in the notes) when an update
  // arrives from the other phone, remember what you typed and where the cursor was.
  const active = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
  // Only text that isn't saved yet is kept: "data-saved" holds what was last saved, so if the
  // box still shows exactly that, the new version from the other phone is shown instead.
  const typing = active && sheet.contains(active) && active.id && "value" in active
    ? {
        id: active.id, value: active.value, start: active.selectionStart, end: active.selectionEnd,
        unsaved: active.dataset.saved === undefined || active.value !== active.dataset.saved,
      }
    : null;
  const scroll = sheet.scrollTop;

  const status = getStatus(p.id);
  const parts = p.kind === "spot" ? spotSections(p, data) : isBuiltIn(p) ? builtInSections(p, data) : ownDestinationSections(p, data);
  // "Yaeyama · Okinawa 沖縄" (for a spot: its destination's)
  const where = whereLine(data, p.kind === "spot" ? destinationOf(data, p) : p);

  sheet.innerHTML = `
    <div class="sheet-photo">
      ${photoHtml(p, "large", true)}
      ${backButton()}
    </div>
    <div class="sheet-body">
      <header class="sheet-head">
        <h2><span class="name">${esc(p.name)}</span> <span class="jp">${esc(p.jp)}</span></h2>
        <p class="muted">${esc(where.en)} <span class="jp">${esc(where.jp)}</span>${p.kind !== "spot" && isBuiltIn(p) && p.gem ? ` · <span class="gem-inline">Hidden gem</span>` : ""}</p>
        <p class="muted small">${parts.subtitle}</p>
      </header>

      <div class="status-btns" role="group" aria-label="Our status">
        <button data-status="want" aria-pressed="${status === "want"}">♡ Want to go</button>
        <button data-status="visited" aria-pressed="${status === "visited"}">✓ Visited</button>
      </div>

      ${parts.top}
      ${placeTripsHtml(p, data)}
      ${oursHtml(p)}
      ${parts.bottom}
    </div>`;

  sheet.scrollTop = scroll;
  if (typing) {
    const el = document.getElementById(typing.id) as HTMLInputElement | HTMLTextAreaElement | null;
    if (el) {
      if (typing.unsaved) el.value = typing.value;
      el.focus({ preventScroll: true });
      try {
        el.setSelectionRange(typing.start, typing.end);
      } catch {
        /* number inputs don't support selection */
      }
    }
  }
}
