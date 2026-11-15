// The place page: opens over the list or map when you tap a place (URL becomes #/place/<id>).
// The same sliding panel ("sheet") is also used by the add/edit form (add-place.ts).

import type { AnyPlace, Place, PlacesFile } from "../types";
import { ui } from "../state";
import { getStatus } from "../data/store";
import { categoryOf } from "../data/places";
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
  renderSheet(data);
  showSheet();
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

/** The parts only built-in places have: month chart, seasons, about, data sources. */
function builtInSections(p: Place, data: PlacesFile) {
  const source =
    `Air: JMA climate normals ${esc(p.climate.period ?? "")}, station ${esc(p.climate.station)}` +
    (p.climate.airSource === "nearby"
      ? p.kind === "island"
        ? " (on a neighbouring island, so approximate)"
        : " (a nearby town, so approximate)"
      : "") +
    (p.climate.seaSource ? ". Sea temperatures are rough estimates." : ".");
  return {
    top: `<section class="panel">
        <h3>Best time to go <span class="jp">いつ行く</span></h3>
        ${monthStrip(p, sheetMonth)}
        ${monthDetail(p, sheetMonth)}
      </section>`,
    bottom: `<section>
        <h3>Through the year <span class="jp">四季</span></h3>
        <div class="seasons">
          ${SEASONS.map(
            ([key, label, jp]) =>
              `<div class="season"><b>${label} <span class="jp">${jp}</span></b><p>${esc(p.seasons[key])}</p></div>`,
          ).join("")}
        </div>
      </section>
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

/** Re-draw the open sheet (e.g. after the status changes). */
export function renderSheet(data: PlacesFile) {
  const p = current;
  if (!p) return;
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
  const areaJp = data.areas.find((a) => a.name === p.area)?.jp ?? "";
  const custom = p.kind === "custom";
  const parts = custom
    ? {
        top: p.desc ? `<p class="custom-desc">${esc(p.desc)}</p>` : "",
        bottom: `<div class="custom-actions">
            <a class="text-link" href="#/map/${esc(p.id)}">Show on map</a>
            <a class="btn-secondary" href="#/edit/${esc(p.id)}">Edit</a>
            <button class="btn-danger" data-action="delete-place">Delete</button>
          </div>`,
        subtitle: `${categoryOf(p.category).name} <span class="jp">${categoryOf(p.category).jp}</span> · added by us`,
      }
    : builtInSections(p, data);

  sheet.innerHTML = `
    <div class="sheet-photo">
      ${photoHtml(p, "large", true)}
      ${backButton()}
    </div>
    <div class="sheet-body">
      <header class="sheet-head">
        <h2><span class="name">${esc(p.name)}</span> <span class="jp">${esc(p.jp)}</span></h2>
        <p class="muted">${esc(p.area)} <span class="jp">${esc(areaJp)}</span>${!custom && p.gem ? ` · <span class="gem-inline">Hidden gem</span>` : ""}</p>
        <p class="muted small">${parts.subtitle}</p>
      </header>

      <div class="status-btns" role="group" aria-label="Our status">
        <button data-status="want" aria-pressed="${status === "want"}">♡ Want to go</button>
        <button data-status="visited" aria-pressed="${status === "visited"}">✓ Visited</button>
      </div>

      ${parts.top}
      ${placeTripsHtml(p)}
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
