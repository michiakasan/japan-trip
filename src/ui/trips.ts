// Trip planner: one trip per year, places added to days in order.
//
// Screens:
//   #/trips              list of our trips (TripsView)
//   #/trips/new          form: new trip            (in the sheet)
//   #/trip/<id>          one trip, day by day      (in the sheet)
//   #/trip/<id>/edit     form: change title/dates  (in the sheet)
// Plus a small "In our trips / Add to a trip" part on every place page.

import type { AnyPlace, PlacesFile, Trip, TripStop } from "../types";
import {
  addStop, deleteTrip, getTrip, getTrips, moveStop, moveStopToDay, removeStop, saveTrip, stopsOfPlace, stopsOfTrip,
} from "../data/store";
import { allPlaces, findPlace } from "../data/places";
import { $, esc, toast } from "./dom";
import { MONTHS, RATING_ORDER, ratingBadge } from "./month";
import { photoHtml } from "./placeholder";
import { backButton, showSheet } from "./sheet";

// ---------- dates ----------
// Dates are "YYYY-MM-DD" strings. We treat them as UTC so time zones never shift a day.

const toDate = (day: string) => new Date(day + "T00:00:00Z");
const toDay = (d: Date) => d.toISOString().slice(0, 10);
const monthOf = (day: string) => toDate(day).getUTCMonth();

/** Every date of a trip, from start to end. */
export function daysOf(trip: Trip): string[] {
  const days: string[] = [];
  for (let d = toDate(trip.start); d <= toDate(trip.end); d.setUTCDate(d.getUTCDate() + 1)) days.push(toDay(d));
  return days;
}

/** "Fri 3 Apr" and "4月3日(金)" */
function dayLabel(day: string) {
  const d = toDate(day);
  return {
    en: d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }),
    jp: d.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric", weekday: "short", timeZone: "UTC" }),
  };
}

/** "3 – 12 Apr 2027" */
function rangeLabel(trip: Trip) {
  const opts = { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" } as const;
  const a = toDate(trip.start).toLocaleDateString("en-GB", opts);
  const b = toDate(trip.end).toLocaleDateString("en-GB", opts);
  return trip.start === trip.end ? a : `${a} – ${b}`;
}

const tripTitle = (t: Trip) => t.title || `Our ${t.start.slice(0, 4)} trip`;

// ---------- warnings ----------

/** If a place is rated "avoid" in the month of `day`, returns the reason; otherwise null. */
function avoidReason(place: AnyPlace | undefined, day: string): string | null {
  if (!place || place.kind === "custom") return null;
  const m = place.months[monthOf(day)];
  return m.rating === "avoid" ? m.reason : null;
}

function warningsOf(trip: Trip, data: PlacesFile) {
  return stopsOfTrip(trip.id).filter((s) => avoidReason(findPlace(data, s.placeId), s.day)).length;
}

// ---------- the Trips tab ----------

export function renderTripsView(el: HTMLElement, data: PlacesFile) {
  const trips = getTrips();
  const cards = trips
    .map((t) => {
      const n = stopsOfTrip(t.id).length;
      const warn = warningsOf(t, data);
      return `<a class="trip-card" href="#/trip/${t.id}">
        <div class="trip-year">${t.start.slice(0, 4)}<span class="jp">年</span></div>
        <div class="trip-main">
          <b class="trip-title">${esc(tripTitle(t))}</b>
          <span class="muted small">${esc(rangeLabel(t))} · ${daysOf(t).length} days · ${n} place${n === 1 ? "" : "s"}</span>
          ${warn ? `<span class="warn-inline">⚠ ${warn} in an "avoid" month</span>` : ""}
        </div>
      </a>`;
    })
    .join("");
  el.innerHTML = `
    <header class="top trips-top">
      <div class="seal" aria-hidden="true">旅</div>
      <div class="title"><h1>Our trips <span class="jp">旅程</span></h1><p class="muted small">One trip per year, planned day by day</p></div>
    </header>
    <a class="btn-primary new-trip" href="#/trips/new">＋ New trip</a>
    <div class="trip-list">${cards || `<p class="empty">No trips yet. Plan the next one!</p>`}</div>`;
}

// ---------- new / edit trip form ----------

export function openTripForm(existing?: Trip) {
  const t = existing;
  const nextYear = new Date().getFullYear() + 1;
  $("#sheet").innerHTML = `
    <div class="form-top">${backButton("Cancel", t ? `#/trip/${t.id}` : "#/trips")}<h2>${t ? "Edit trip" : "New trip"} <span class="jp">${t ? "編集" : "新しい旅"}</span></h2></div>
    <form class="place-form sheet-body trip-form" novalidate>
      <label class="field"><span class="field-label">Title (optional)</span>
        <input name="title" maxlength="120" value="${esc(t?.title)}" placeholder="e.g. Yaeyama island hopping" /></label>
      <div class="date-row">
        <label class="field"><span class="field-label">First day *</span>
          <input name="start" type="date" required value="${esc(t?.start ?? `${nextYear}-04-01`)}" /></label>
        <label class="field"><span class="field-label">Last day *</span>
          <input name="end" type="date" required value="${esc(t?.end ?? `${nextYear}-04-14`)}" /></label>
      </div>
      <p class="muted small">One trip per year. If you shorten a trip, places on removed days are kept under "Not on a trip day".</p>
      <p class="form-error" id="formError" role="alert"></p>
      <button class="btn-primary" type="submit">${t ? "Save changes" : "Create trip"}</button>
    </form>`;
  showSheet();

  const form = $("#sheet").querySelector<HTMLFormElement>("form")!;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const start = String(f.get("start") || ""), end = String(f.get("end") || "");
    const error = $("#formError");
    if (!start || !end) return void (error.textContent = "Please pick both dates.");
    if (end < start) return void (error.textContent = "The last day is before the first day.");
    if ((toDate(end).getTime() - toDate(start).getTime()) / 864e5 > 90) return void (error.textContent = "A trip can be at most 90 days.");
    const trip: Trip = { id: t?.id ?? crypto.randomUUID(), title: String(f.get("title") || "").trim(), start, end };
    try {
      await saveTrip(trip);
      location.hash = `#/trip/${trip.id}`;
    } catch (err) {
      error.textContent = (err as Error).message;
    }
  });
}

// ---------- one trip, day by day ----------

/** Id of the trip shown in the sheet right now (so main.ts can re-draw it when data changes). */
let openTripId: string | null = null;
export const openTrip = () => openTripId;
export const closeTrip = () => (openTripId = null);

function stopHtml(stop: TripStop, data: PlacesFile, days: string[]) {
  const place = findPlace(data, stop.placeId);
  if (!place) return ""; // a place that was deleted
  const custom = place.kind === "custom";
  const month = monthOf(stop.day);
  const avoid = avoidReason(place, stop.day);
  const info = custom
    ? `<span class="muted small">${esc(place.area)}</span>`
    : `<span class="muted small">${esc(place.months[month].reason)}</span>`;
  const options = days
    .map((d, i) => `<option value="${d}" ${d === stop.day ? "selected" : ""}>Day ${i + 1} · ${dayLabel(d).en}</option>`)
    .join("");
  return `<li class="stop${avoid ? " stop--avoid" : ""}">
    <a class="stop-thumb" href="#/place/${esc(place.id)}">${photoHtml(place)}</a>
    <div class="stop-main">
      <a class="names" href="#/place/${esc(place.id)}"><b class="name">${esc(place.name)}</b> <span class="jp">${esc(place.jp)}</span></a>
      ${avoid ? `<p class="warn">⚠ Rated "avoid" in ${MONTHS[month]}: ${esc(avoid)}</p>` : info}
      <div class="stop-tools">
        <button data-trip="up" data-stop="${stop.id}" aria-label="Move up">↑</button>
        <button data-trip="down" data-stop="${stop.id}" aria-label="Move down">↓</button>
        <label class="sr-only" for="mv-${stop.id}">Move to day</label>
        <select id="mv-${stop.id}" data-trip="move-day" data-stop="${stop.id}">${days.includes(stop.day) ? "" : `<option selected>Not on a trip day</option>`}${options}</select>
        <button data-trip="remove" data-stop="${stop.id}" aria-label="Remove from trip">×</button>
      </div>
    </div>
    <div class="stop-rate">${custom ? "" : ratingBadge(place.months[month].rating)}</div>
  </li>`;
}

export function renderTripPage(data: PlacesFile, tripId: string) {
  const trip = getTrip(tripId);
  if (!trip) return false;
  openTripId = tripId;
  const sheet = $("#sheet");
  const scroll = sheet.scrollTop;
  const days = daysOf(trip);
  const stops = stopsOfTrip(trip.id);
  const warn = warningsOf(trip, data);

  const dayBlocks = days
    .map((day, i) => {
      const label = dayLabel(day);
      const items = stops.filter((s) => s.day === day).map((s) => stopHtml(s, data, days)).join("");
      return `<section class="day">
        <h3>Day ${i + 1} <span class="jp">${i + 1}日目</span> <span class="day-date">${esc(label.en)} · <span class="jp">${esc(label.jp)}</span></span></h3>
        ${items ? `<ol class="stops">${items}</ol>` : ""}
        <button class="add-stop" data-trip="add" data-day="${day}">＋ Add place</button>
      </section>`;
    })
    .join("");
  const loose = stops.filter((s) => !days.includes(s.day));
  const looseBlock = loose.length
    ? `<section class="day day--loose"><h3>Not on a trip day <span class="jp">日程外</span></h3>
        <p class="muted small">These were on days that are no longer part of the trip. Move them to a day, or remove them.</p>
        <ol class="stops">${loose.map((s) => stopHtml(s, data, days)).join("")}</ol></section>`
    : "";

  sheet.innerHTML = `
    <div class="form-top">${backButton("Back to trips", "#/trips")}
      <div><h2>${esc(tripTitle(trip))}</h2><p class="muted small">${esc(rangeLabel(trip))} · ${days.length} days · <span class="jp">${trip.start.slice(0, 4)}年の旅</span></p></div>
    </div>
    <div class="sheet-body">
      ${warn ? `<p class="warn warn--box">⚠ ${warn} place${warn > 1 ? "s are" : " is"} planned in a month rated "avoid". See the red notes below.</p>` : ""}
      ${dayBlocks}
      ${looseBlock}
      <div class="custom-actions">
        <a class="btn-secondary" href="#/trip/${trip.id}/edit">Edit dates</a>
        <button class="btn-danger" data-trip="delete" data-id="${trip.id}">Delete trip</button>
      </div>
    </div>`;
  sheet.scrollTop = scroll;
  return true;
}

export function openTripPage(data: PlacesFile, tripId: string) {
  const wasOpen = openTripId === tripId && !$("#sheet").hidden;
  if (!renderTripPage(data, tripId)) return false;
  if (!wasOpen) showSheet();
  return true;
}

// ---------- choosing a place for a day ----------

function openPicker(data: PlacesFile, tripId: string, day: string) {
  const trip = getTrip(tripId)!;
  const month = monthOf(day);
  const dayNo = daysOf(trip).indexOf(day) + 1;
  const planned = new Map(stopsOfTrip(tripId).map((s) => [s.placeId, s.day]));
  // Best places for this month first; our own places (no rating) after "ok".
  const rank = (p: AnyPlace) => (p.kind === "custom" ? 1.5 : RATING_ORDER[p.months[month].rating]);
  const places = allPlaces(data).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));

  const el = document.createElement("div");
  el.className = "picker";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", `Add a place to day ${dayNo}`);
  el.innerHTML = `
    <div class="picker-card">
      <div class="picker-head">
        <b>Add to Day ${dayNo} · ${esc(dayLabel(day).en)}</b>
        <button class="picker-close" aria-label="Close">×</button>
      </div>
      <label class="search"><span class="sr-only">Search places</span>
        <input type="search" placeholder="Search places…" autocomplete="off" /></label>
      <p class="muted small">Sorted by how good they are in ${MONTHS[month]}.</p>
      <div class="picker-list">${places
        .map((p) => {
          const already = planned.get(p.id);
          const alreadyDay = already ? daysOf(trip).indexOf(already) + 1 : 0;
          const words = [p.name, p.jp, p.area].join(" ").toLowerCase();
          return `<button class="picker-item" data-pick="${esc(p.id)}" data-words="${esc(words)}">
            <span class="picker-thumb">${photoHtml(p)}</span>
            <span class="picker-text"><b>${esc(p.name)}</b> <span class="jp">${esc(p.jp)}</span>
              <span class="muted small">${esc(p.area)}${already ? ` · already on ${alreadyDay ? `Day ${alreadyDay}` : "this trip"}` : ""}</span></span>
            ${p.kind === "custom" ? "" : ratingBadge(p.months[month].rating)}
          </button>`;
        })
        .join("")}</div>
    </div>`;
  document.body.append(el);
  const input = el.querySelector<HTMLInputElement>("input")!;
  input.focus();
  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    el.querySelectorAll<HTMLElement>(".picker-item").forEach((b) => (b.hidden = !!q && !b.dataset.words!.includes(q)));
  });
  const close = () => el.remove();
  el.addEventListener("click", async (e) => {
    const target = e.target as HTMLElement;
    if (target === el || target.closest(".picker-close")) return close(); // tap outside or ×
    const item = target.closest<HTMLElement>("[data-pick]");
    if (!item) return;
    const place = findPlace(data, item.dataset.pick!);
    try {
      await addStop(tripId, day, item.dataset.pick!);
      close();
      const avoid = avoidReason(place, day);
      toast(avoid ? `Added, but ${MONTHS[month]} is rated "avoid": ${avoid}` : `${place?.name} added to Day ${dayNo}`);
    } catch (err) {
      toast((err as Error).message);
    }
  });
  el.addEventListener("keydown", (e) => e.key === "Escape" && close());
}

// ---------- on the place page: "In our trips" + "Add to a trip" ----------

export function placeTripsHtml(place: AnyPlace): string {
  const trips = getTrips();
  const planned = stopsOfPlace(place.id)
    .map((s) => {
      const trip = getTrip(s.tripId);
      if (!trip) return "";
      const dayNo = daysOf(trip).indexOf(s.day) + 1;
      const avoid = avoidReason(place, s.day);
      return `<li><a href="#/trip/${trip.id}">${esc(tripTitle(trip))}</a> · ${dayNo ? `Day ${dayNo}, ` : ""}${esc(dayLabel(s.day).en)}
        ${avoid ? `<span class="warn-inline">⚠ "avoid" in ${MONTHS[monthOf(s.day)]}</span>` : ""}</li>`;
    })
    .join("");
  const choose = trips.length
    ? `<form class="add-to-trip" data-trip="add-from-place">
        <label class="sr-only" for="tripDay">Trip day</label>
        <select id="tripDay" name="tripDay">${trips
          .map(
            (t) => `<optgroup label="${esc(tripTitle(t))}">${daysOf(t)
              .map((d, i) => {
                const avoid = avoidReason(place, d);
                return `<option value="${t.id}|${d}">Day ${i + 1} · ${esc(dayLabel(d).en)}${avoid ? " ⚠ avoid" : ""}</option>`;
              })
              .join("")}</optgroup>`,
          )
          .join("")}</select>
        <button type="submit">Add</button>
      </form>`
    : `<p class="muted small">No trips yet. <a class="text-link" href="#/trips/new">Plan one</a>.</p>`;
  return `<section class="place-trips">
    <h3>In our trips <span class="jp">旅程</span></h3>
    ${planned ? `<ul class="planned">${planned}</ul>` : ""}
    ${choose}
  </section>`;
}

// ---------- taps and changes ----------

export function setupTripEvents(getData: () => PlacesFile) {
  const findStop = (id: string) => getTrips().flatMap((t) => stopsOfTrip(t.id)).find((s) => s.id === id);
  const run = (p: Promise<unknown>) => p.catch((err) => toast((err as Error).message || "Something went wrong"));

  document.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("#sheet [data-trip]");
    if (!b || b.tagName === "SELECT" || b.tagName === "FORM") return;
    const action = b.dataset.trip;
    const stop = b.dataset.stop ? findStop(b.dataset.stop) : undefined;
    if (action === "add" && openTripId) openPicker(getData(), openTripId, b.dataset.day!);
    else if (action === "up" && stop) run(moveStop(stop, -1));
    else if (action === "down" && stop) run(moveStop(stop, 1));
    else if (action === "remove" && stop) run(removeStop(stop));
    else if (action === "delete") {
      const trip = getTrip(b.dataset.id!);
      if (trip && confirm(`Delete "${tripTitle(trip)}" and its whole plan, for both of you?`)) {
        run(deleteTrip(trip.id).then(() => (location.hash = "#/trips")));
      }
    }
  });

  document.addEventListener("change", (e) => {
    const s = e.target as HTMLSelectElement;
    if (s.dataset.trip !== "move-day") return;
    const stop = findStop(s.dataset.stop!);
    if (stop) run(moveStopToDay(stop, s.value));
  });

  // "Add" on a place page
  document.addEventListener("submit", (e) => {
    const form = e.target as HTMLFormElement;
    if (form.dataset.trip !== "add-from-place") return;
    e.preventDefault();
    const [tripId, day] = String(new FormData(form).get("tripDay")).split("|");
    const placeId = location.hash.match(/^#\/place\/(.+)$/)?.[1];
    if (!placeId) return;
    const place = findPlace(getData(), decodeURIComponent(placeId));
    run(
      addStop(tripId, day, decodeURIComponent(placeId)).then(() => {
        const avoid = avoidReason(place, day);
        toast(avoid ? `Added, but ${MONTHS[monthOf(day)]} is rated "avoid": ${avoid}` : "Added to the trip");
      }),
    );
  });
}
