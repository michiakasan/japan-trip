// The map tab: an OpenStreetMap map (drawn with the Leaflet library).
//   Zoomed out (whole regions): one pin per destination.
//   Zoomed in (zoom level SPOT_ZOOM or closer): the spots, with an icon for their type,
//   plus small labels for the destinations.
// Pin colour = our status. Tapping a pin opens the destination or spot.

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { AnyPlace, PlacesFile } from "../types";
import { allDestinations, allSpots, findPlace, spotType } from "../data/places";
import { getStatus, type Status } from "../data/store";
import { esc } from "./dom";

/** From this zoom level on, spots are shown instead of destination pins (10 ≈ a city). */
const SPOT_ZOOM = 10;

type PinFilter = "all" | "want" | "visited" | "none";
let filter: PinFilter = "all";
let map: L.Map | null = null;
let pins: L.LayerGroup;
let currentData: PlacesFile;

/** OpenStreetMap's free map tiles. Their rules ask for the credit line below. */
export function osmTiles() {
  return L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    // "crossOrigin" lets the offline cache store tiles at their real size.
    crossOrigin: true,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  });
}

/** The pin for one place. The look comes from .pin in app.css. */
function pinIcon(p: AnyPlace, small = false) {
  const status = getStatus(p.id) || "none";
  if (p.kind === "spot") {
    return L.divIcon({
      className: "",
      html: `<span class="pin pin--spot pin--${status}">${spotType(p.type).icon}</span>`,
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    });
  }
  if (small) {
    // Zoomed in: the destination becomes a name label, so the spots stand out.
    return L.divIcon({
      className: "",
      html: `<span class="pin-label pin-label--${status}">${esc(p.name)}</span>`,
      iconSize: undefined,
      iconAnchor: [0, 10],
    });
  }
  return L.divIcon({
    className: "", // no default Leaflet styling
    html: `<span class="pin pin--${status}${p.kind === "custom" ? " pin--ours" : ""}"></span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

const matches = (s: Status) => filter === "all" || (filter === "none" ? s === "" : s === filter);

/** Destinations or spots, depending on how far we're zoomed in. */
const spotsShown = () => !!map && map.getZoom() >= SPOT_ZOOM;

/** Draws (or re-draws) the pins and the legend. */
export function refreshMap(data: PlacesFile) {
  if (!map) return;
  currentData = data;
  pins.clearLayers();
  const zoomedIn = spotsShown();
  const destinations = allDestinations(data);
  // What the status filter counts and filters: spots when zoomed in, destinations when zoomed out.
  const main: AnyPlace[] = zoomedIn ? allSpots(data) : destinations;
  const add = (p: AnyPlace, small = false) =>
    L.marker([p.lat, p.lng], {
      icon: pinIcon(p, small),
      title: `${p.name} ${p.jp}`,
      alt: p.name,
      riseOnHover: true,
      zIndexOffset: small ? -1000 : 0, // labels below the spots
    })
      .bindTooltip(`<b>${esc(p.name)}</b> ${esc(p.jp)}${p.kind === "spot" ? `<br><small>${esc(spotType(p.type).name)}</small>` : ""}`, {
        direction: "top",
        offset: [0, -14],
      })
      .on("click", () => (location.hash = `#/place/${encodeURIComponent(p.id)}`))
      .addTo(pins);

  if (zoomedIn) for (const d of destinations) add(d, true);
  for (const p of main) if (matches(getStatus(p.id))) add(p);

  const count = (f: PinFilter) =>
    main.filter((p) => { const s = getStatus(p.id); return f === "all" || (f === "none" ? s === "" : s === f); }).length;
  const button = (f: PinFilter, label: string) =>
    `<button data-pin-filter="${f}" aria-pressed="${filter === f}"><i class="pin pin--${f === "all" ? "none" : f}"></i>${label} <small>${count(f)}</small></button>`;
  document.querySelector("#mapLegend")!.innerHTML =
    button("all", zoomedIn ? "All spots" : "All") + button("want", "Want to go") + button("visited", "Visited") + button("none", "Not marked") +
    `<span class="map-hint">${zoomedIn ? "Zoom out for destinations" : "Zoom in to see spots"}</span>`;
}

/** Shows the map. If `focusId` is given, zooms to that destination or spot. */
export function showMap(data: PlacesFile, focusId?: string) {
  const view = document.querySelector<HTMLElement>("#mapView")!;
  view.hidden = false;
  currentData = data;
  if (!map) {
    map = L.map("mapCanvas", { zoomControl: false }).setView([30, 133], 5);
    L.control.zoom({ position: "bottomright" }).addTo(map); // top is used by the pin filter
    osmTiles().addTo(map);
    pins = L.layerGroup().addTo(map);
    // Start zoomed out so all destinations fit on screen.
    map.fitBounds(L.latLngBounds(allDestinations(data).map((p) => [p.lat, p.lng] as [number, number])), { padding: [30, 30] });
    // Crossing the spot zoom level switches between destinations and spots.
    let wasZoomedIn = spotsShown();
    map.on("zoomend", () => {
      if (spotsShown() !== wasZoomedIn) {
        wasZoomedIn = spotsShown();
        refreshMap(currentData);
      }
    });
    document.querySelector("#mapLegend")!.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-pin-filter]");
      if (!b) return;
      filter = b.dataset.pinFilter as PinFilter;
      refreshMap(currentData);
    });
  }
  // The map was hidden while the list showed, so tell Leaflet to measure its size again.
  map.invalidateSize();
  const focus = focusId ? findPlace(data, focusId) : undefined;
  // A spot: close up. A destination: close enough to see its spots.
  if (focus) map.setView([focus.lat, focus.lng], focus.kind === "spot" ? 16 : 12, { animate: false });
  refreshMap(data);
  if (focus) {
    pins.eachLayer((m) => {
      const marker = m as L.Marker;
      if (marker.getLatLng().equals([focus.lat, focus.lng]) && marker.options.zIndexOffset !== -1000) marker.openTooltip();
    });
  }
}

export function hideMap() {
  const view = document.querySelector<HTMLElement>("#mapView");
  if (view) view.hidden = true;
}
