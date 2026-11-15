// App start-up: loads the data, draws the page and reacts to taps and typing.
//
// How the page updates: when something changes we update `ui` (src/state.ts)
// and re-draw only the part that changed. Clicks are handled in ONE place
// (the "click" listener below) by looking at data-* attributes on the button.

import "./styles/app.css";
import type { FeatureId, PlacesFile } from "./types";
import { ui, save, type ThemeChoice } from "./state";
import { allDestinations, allSpots, destinationOf, findPlace, loadPlaces, spotsOf } from "./data/places";
import {
  counts, deleteDestination, deleteSpot, importedFromDevice, init as initStore, onChange, setHidden,
} from "./data/store";
import { $, toast } from "./ui/dom";
import { renderChips, renderMonths, renderResultBar } from "./ui/filters";
import { computeResults, renderResults } from "./ui/results";
import {
  clearCurrentPlace, closeSheet, currentPlaceId, getBackHref, openSheet, renderSheet, selectSheetMonth, setBackHref,
  setSpotFilter, toggleHiddenSpots,
} from "./ui/sheet";
import { hideMap, refreshMap, showMap } from "./ui/map";
import { destroyPicker, isEditable, openPlaceForm } from "./ui/add-place";
import { closeTrip, openTrip, openTripForm, openTripPage, renderTripPage, renderTripsView, setupTripEvents } from "./ui/trips";
import { getTrip } from "./data/store";
import { setupOursEvents } from "./ui/ours";
import { askForTripCode } from "./ui/join";
import { placeholderUrl } from "./ui/placeholder";

let data: PlacesFile;

// ---------- the page skeleton ----------
function renderShell() {
  $("#app").innerHTML = `
    <div class="app" id="listView">
      <header class="top">
        <div class="seal" aria-hidden="true">旅</div>
        <div class="title">
          <h1>Japanchansky</h1>
          <p class="muted small"><span class="jp">わたしたちの日本</span> · <span id="stats"></span></p>
        </div>
        <button class="icon-btn" data-action="theme" id="themeBtn"></button>
      </header>

      <div id="months"></div>
      <div id="chips"></div>
      <label class="search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
        <span class="sr-only">Search destinations and spots</span>
        <input id="q" type="search" placeholder="Search: dolphins, onsen, bamboo, 竹富…" autocomplete="off" />
      </label>
      <div class="result-bar" id="resultBar"></div>
      <main id="results"></main>
    </div>

    <!-- The trips tab (shown instead of the list) -->
    <div class="app" id="tripsView" hidden></div>

    <!-- The map tab (shown instead of the list) -->
    <section class="map-view" id="mapView" hidden aria-label="Map of our places">
      <div class="map-legend" id="mapLegend" role="group" aria-label="Show pins"></div>
      <div class="map-canvas" id="mapCanvas"></div>
    </section>

    <nav class="tabbar" aria-label="Sections">
      <a href="#/" data-tab="list">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/></svg>
        <span>Places <span class="tab-jp">一覧</span></span></a>
      <a href="#/map" data-tab="map">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/></svg>
        <span>Map <span class="tab-jp">地図</span></span></a>
      <a href="#/trips" data-tab="trips">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>
        <span>Trips <span class="tab-jp">旅程</span></span></a>
      <a href="#/add" data-tab="add">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
        <span>Add <span class="tab-jp">追加</span></span></a>
    </nav>

    <div class="sheet-bg" id="sheetBg" hidden></div>
    <article class="sheet" id="sheet" role="dialog" aria-modal="true" aria-label="Place details" hidden></article>`;
}

// ---------- drawing ----------
function renderStats() {
  const c = counts();
  $("#stats").textContent = `${allDestinations(data).length} places · ${allSpots(data).length} spots · ${c.want} want · ${c.visited} visited`;
}

/** Re-draw the list and the line above it. */
function renderList() {
  const { places, great } = computeResults(data);
  renderResultBar($("#resultBar"), places.length, great);
  renderResults($("#results"), data);
}

function renderAll() {
  renderStats();
  renderMonths($("#months"));
  renderChips($("#chips"), data);
  renderList();
}

// ---------- light / dark mode ----------
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
const THEME_LABEL: Record<ThemeChoice, string> = { auto: "Auto", light: "Light", dark: "Dark" };

/** Puts data-mode="light" or "dark" on <html>; tokens.css picks the colours from that. */
function applyTheme() {
  const mode = ui.theme === "auto" ? (darkQuery.matches ? "dark" : "light") : ui.theme;
  const root = document.documentElement;
  root.dataset.mode = mode;
  // Colour of the phone's status bar / browser bar.
  const bg = getComputedStyle(root).getPropertyValue("--bg").trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", bg);
  const btn = document.querySelector("#themeBtn");
  if (btn) {
    btn.textContent = mode === "dark" ? "☾" : "☀";
    btn.setAttribute("aria-label", `Colour mode: ${THEME_LABEL[ui.theme]} (tap to change)`);
    btn.setAttribute("title", `Colour mode: ${THEME_LABEL[ui.theme]}`);
  }
}
darkQuery.addEventListener("change", applyTheme);

// ---------- navigation (the part of the URL after #) ----------
//   #/              the list            #/place/<id>   a destination or spot (over the list or map)
//   #/map           the map             #/add          form: add a spot or destination
//   #/map/<id>      map, zoomed to one  #/add/<id>     form: add a spot to that destination
//                                       #/edit/<id>    form: edit one of our spots or destinations
//   #/trips         our trips           #/trip/<id>    one trip (#/trip/<id>/edit, #/trips/new: forms)

/** Highlights the right tab in the bottom bar. */
function markTab(tab: "list" | "map" | "add" | "trips") {
  document.querySelectorAll<HTMLElement>(".tabbar [data-tab]").forEach((a) => {
    if (a.dataset.tab === tab) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
}

/** Shows the list, the map or the trips underneath any open panel. */
function showView(view: "list" | "map" | "trips", focusId?: string) {
  // (named "screen", not "view": the grid/list buttons already use data-view)
  document.body.dataset.screen = view;
  setBackHref(view === "map" ? "#/map" : view === "trips" ? "#/trips" : "#/");
  $("#listView").hidden = view !== "list";
  $("#tripsView").hidden = view !== "trips";
  if (view === "trips") renderTripsView($("#tripsView"), data);
  if (view === "map") showMap(data, focusId);
  else hideMap();
  markTab(view);
}

/** The previous address, so a place opened from a trip can go "back" to that trip. */
let previousHash = "";

function route() {
  const hash = location.hash || "#/";
  const cameFrom = previousHash;
  previousHash = hash;
  const [, page, rawId] = hash.match(/^#\/([a-z]*)\/?(.*)$/) ?? [];
  const id = rawId ? decodeURIComponent(rawId) : "";
  if (page !== "trip" && page !== "trips") closeTrip();
  // Any open "add a place to this day" picker belongs to the old screen.
  document.querySelector(".picker")?.remove();

  if (page === "place") {
    const place = findPlace(data, id);
    if (!place) return void (location.hash = getBackHref()); // e.g. deleted
    destroyPicker();
    // Where "back" goes: the trip we came from; else, for a spot, its destination (or the map,
    // if opened there); for a destination, the tab underneath (list, map or trips).
    const screen = document.body.dataset.screen;
    const tab = screen === "map" ? "#/map" : screen === "trips" ? "#/trips" : "#/";
    if (/^#\/trip\/[^/]+$/.test(cameFrom)) setBackHref(cameFrom);
    else if (place.kind === "spot" && !(screen === "map" && cameFrom.startsWith("#/map"))) {
      setBackHref(`#/place/${encodeURIComponent(destinationOf(data, place).id)}`);
    } else setBackHref(tab);
    openSheet(place, data);
  } else if (page === "trips" && id === "new") {
    clearCurrentPlace();
    closeTrip();
    if (!document.body.dataset.screen) showView("trips");
    openTripForm();
  } else if (page === "trip") {
    clearCurrentPlace();
    destroyPicker();
    const [tripId, sub] = id.split("/");
    if (!getTrip(tripId)) return void (location.hash = "#/trips");
    if (document.body.dataset.screen !== "trips") showView("trips");
    setBackHref("#/trips");
    if (sub === "edit") {
      closeTrip();
      openTripForm(getTrip(tripId));
    } else openTripPage(data, tripId);
  } else if (page === "add" || page === "edit") {
    const found = findPlace(data, id);
    const existing = page === "edit" && isEditable(found) ? found : undefined;
    if (page === "edit" && !existing) return void (location.hash = getBackHref());
    clearCurrentPlace();
    openPlaceForm(data, existing, page === "add" ? id || undefined : undefined);
    if (page === "add" && !id) markTab("add");
  } else {
    // The list or the map, with no panel open.
    destroyPicker();
    closeSheet();
    showView(page === "map" ? "map" : page === "trips" ? "trips" : "list", id || undefined);
  }
}

// ---------- events ----------
function setupEvents() {
  document.addEventListener("click", (e) => {
    // Find the nearest element with one of our data-* attributes.
    const t = (e.target as HTMLElement).closest<HTMLElement>(
      "[data-month],[data-type],[data-feature],[data-view],[data-action],[data-strip-month],[data-spot-type]",
    );
    if (!t) return;
    const d = t.dataset;

    if (d.month !== undefined) {
      ui.month = Number(d.month);
    } else if (d.type) {
      ui.type = d.type as typeof ui.type;
    } else if (d.feature) {
      const f = d.feature as FeatureId;
      if (d.feature === "__clear") ui.features = [];
      else ui.features = ui.features.includes(f) ? ui.features.filter((x) => x !== f) : [...ui.features, f];
    } else if (d.view) {
      ui.view = d.view as typeof ui.view;
    } else if (d.spotType) {
      setSpotFilter(d.spotType as Parameters<typeof setSpotFilter>[0], data);
      return;
    } else if (d.action === "toggle-hidden") {
      toggleHiddenSpots(data);
      return;
    } else if (d.action === "hide-spot" || d.action === "unhide-spot") {
      const id = currentPlaceId();
      if (id) setHidden(id, d.action === "hide-spot")
        .then(() => toast(d.action === "hide-spot" ? "Hidden. You can show it again from its destination's spots." : "Shown again"))
        .catch((err) => toast(err.message || "Could not save"));
      return;
    } else if (d.stripMonth !== undefined) {
      selectSheetMonth(Number(d.stripMonth), data);
      return;
    } else if (d.action === "theme") {
      const order: ThemeChoice[] = ["auto", "light", "dark"];
      ui.theme = order[(order.indexOf(ui.theme) + 1) % order.length];
      save();
      applyTheme();
      toast(`Colour mode: ${THEME_LABEL[ui.theme]}`);
      return;
    } else if (d.action === "show-avoid") {
      ui.showAvoid = true;
    } else if (d.action === "soon") {
      toast(d.soon ?? "Coming soon");
      return;
    } else if (d.action === "delete-place") {
      const id = currentPlaceId();
      const place = id ? findPlace(data, id) : undefined;
      if (!isEditable(place)) return;
      // Deleting our destination also deletes the spots we added to it.
      const ours = place.kind === "custom" ? spotsOf(data, place).filter((s) => !s.builtIn) : [];
      const extra = ours.length ? ` and its ${ours.length} spot${ours.length > 1 ? "s" : ""}` : "";
      if (!confirm(`Delete "${place.name}"${extra} with notes and photos, for both of you?`)) return;
      const back = place.kind === "spot" ? `#/place/${destinationOf(data, place).id}` : getBackHref();
      (place.kind === "spot" ? deleteSpot(place.id) : deleteDestination(place.id))
        .then(() => {
          toast(`${place.name} deleted`);
          location.hash = back;
        })
        .catch((err: Error) => toast(err.message || "Could not delete"));
      return;
    } else {
      return;
    }

    // A filter changed: a new month hides "avoid" places again.
    if (d.month !== undefined) ui.showAvoid = false;
    save();
    renderAll();
  });

  // Dropdowns (prefecture and sort)
  document.addEventListener("change", (e) => {
    const t = e.target as HTMLSelectElement;
    if (t.matches("[data-prefecture]")) ui.prefecture = t.value;
    else if (t.matches("[data-sort]")) ui.sort = t.value as typeof ui.sort;
    else return;
    save();
    renderList();
  });

  // Search: re-draw only the results, so the text box keeps focus while typing.
  $<HTMLInputElement>("#q").addEventListener("input", (e) => {
    ui.query = (e.target as HTMLInputElement).value.trim();
    renderList();
  });

  // Close the place page by tapping the dark background or pressing Escape.
  $("#sheetBg").addEventListener("click", () => (location.hash = getBackHref()));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("#sheet").hidden && !document.querySelector(".viewer, .picker")) location.hash = getBackHref();
  });

  window.addEventListener("hashchange", route);

  // If a photo can't load (offline, or removed from Commons), show the drawing instead.
  // "error" events don't bubble, so we listen in the capture phase (the `true` at the end).
  document.addEventListener(
    "error",
    (e) => {
      const img = e.target as HTMLImageElement;
      const place = img.dataset?.place && findPlace(data, img.dataset.place);
      if (!place) return;
      delete img.dataset.place; // only once
      img.src = placeholderUrl(place);
      img.classList.add("photo--drawn");
      img.nextElementSibling?.classList.contains("credit") && img.nextElementSibling.remove();
    },
    true,
  );

  // Taps and typing on the place page that change our data (status, years, notes, photos)
  setupOursEvents(currentPlaceId);
  // Trip planner taps (move up/down, remove, add place, add to a trip…)
  setupTripEvents(() => data);

  // When our data changes (here or on the other phone), update the list, counts and open place page.
  onChange(() => {
    renderStats();
    renderChips($("#chips"), data); // new prefectures may have been added
    renderList();
    refreshMap(data);
    if (document.body.dataset.screen === "trips") renderTripsView($("#tripsView"), data);
    const trip = openTrip();
    if (trip && !renderTripPage(data, trip)) location.hash = "#/trips"; // trip deleted (maybe on the other phone)
    // If the open place was deleted (maybe on the other phone), go back.
    const open = currentPlaceId();
    if (open && !findPlace(data, open)) location.hash = getBackHref();
    else renderSheet(data);
  });
}

// ---------- start ----------
async function start() {
  renderShell();
  applyTheme();
  try {
    data = await loadPlaces();
  } catch (err) {
    $("#results").innerHTML = `<p class="empty">Could not load places: ${(err as Error).message}</p>`;
    return;
  }

  // Connect to the shared database. The first time on a phone, ask for the trip code.
  try {
    if ((await initStore()) === "needs-code") await askForTripCode();
    // Things saved earlier in "this device only" mode were just uploaded to our server.
    if (importedFromDevice) toast(`Uploaded ${importedFromDevice} thing${importedFromDevice > 1 ? "s" : ""} saved earlier on this phone`);
  } catch (err) {
    console.error(err);
  }

  renderAll();
  setupEvents();
  route();
}

start();
