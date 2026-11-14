// The map tab: every place as a pin on an OpenStreetMap map (drawn with the Leaflet library).
// Pin colour = our status. Round pins = built-in places, square pins = places we added.
// Tapping a pin opens the place.

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { AnyPlace, PlacesFile } from "../types";
import { allPlaces } from "../data/places";
import { getStatus, type Status } from "../data/store";
import { esc } from "./dom";

type PinFilter = "all" | "want" | "visited" | "none";
let filter: PinFilter = "all";
let map: L.Map | null = null;
let pins: L.LayerGroup;

/** OpenStreetMap's free map tiles. Their rules ask for the credit line below. */
export function osmTiles() {
  return L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    // "crossOrigin" lets the offline cache store tiles at their real size.
    crossOrigin: true,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  });
}

/** The little coloured dot for one place. The look comes from .pin in app.css. */
function pinIcon(p: AnyPlace) {
  const status = getStatus(p.id) || "none";
  return L.divIcon({
    className: "", // no default Leaflet styling
    html: `<span class="pin pin--${status}${p.kind === "custom" ? " pin--ours" : ""}"></span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

const matches = (s: Status) => filter === "all" || (filter === "none" ? s === "" : s === filter);

/** Draws (or re-draws) the pins and the legend. */
export function refreshMap(data: PlacesFile) {
  if (!map) return;
  pins.clearLayers();
  const places = allPlaces(data);
  for (const p of places) {
    if (!matches(getStatus(p.id))) continue;
    L.marker([p.lat, p.lng], { icon: pinIcon(p), title: `${p.name} ${p.jp}`, alt: p.name, riseOnHover: true })
      .bindTooltip(`<b>${esc(p.name)}</b> ${esc(p.jp)}`, { direction: "top", offset: [0, -12] })
      .on("click", () => (location.hash = `#/place/${encodeURIComponent(p.id)}`))
      .addTo(pins);
  }
  const count = (f: PinFilter) => places.filter((p) => { const s = getStatus(p.id); return f === "all" || (f === "none" ? s === "" : s === f); }).length;
  const button = (f: PinFilter, label: string) =>
    `<button data-pin-filter="${f}" aria-pressed="${filter === f}"><i class="pin pin--${f === "all" ? "none" : f}"></i>${label} <small>${count(f)}</small></button>`;
  document.querySelector("#mapLegend")!.innerHTML =
    button("all", "All") + button("want", "Want to go") + button("visited", "Visited") + button("none", "Not marked");
}

/** Shows the map. If `focusId` is given, zooms to that place. */
export function showMap(data: PlacesFile, focusId?: string) {
  const view = document.querySelector<HTMLElement>("#mapView")!;
  view.hidden = false;
  if (!map) {
    map = L.map("mapCanvas", { zoomControl: false }).setView([30, 133], 5);
    L.control.zoom({ position: "bottomright" }).addTo(map); // top is used by the pin filter
    osmTiles().addTo(map);
    pins = L.layerGroup().addTo(map);
    // Start zoomed out so all places fit on screen.
    map.fitBounds(L.latLngBounds(allPlaces(data).map((p) => [p.lat, p.lng] as [number, number])), { padding: [30, 30] });
    document.querySelector("#mapLegend")!.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-pin-filter]");
      if (!b) return;
      filter = b.dataset.pinFilter as PinFilter;
      refreshMap(data);
    });
  }
  // The map was hidden while the list showed, so tell Leaflet to measure its size again.
  map.invalidateSize();
  refreshMap(data);
  const focus = focusId && allPlaces(data).find((p) => p.id === focusId);
  if (focus) {
    map.setView([focus.lat, focus.lng], focus.kind === "custom" ? 15 : 11);
    pins.eachLayer((m) => {
      const marker = m as L.Marker;
      if (marker.getLatLng().equals([focus.lat, focus.lng])) marker.openTooltip();
    });
  }
}

export function hideMap() {
  const view = document.querySelector<HTMLElement>("#mapView");
  if (view) view.hidden = true;
}
