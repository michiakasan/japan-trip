// Form for adding (or editing) one of our own places: restaurant, hotel, city…
// The location is picked on a small map: tap the map, search for a name, or use "my location".

import L from "leaflet";
import type { CustomPlace, PlacesFile } from "../types";
import { CATEGORIES, allAreas } from "../data/places";
import { newCustomId, saveCustomPlace } from "../data/store";
import { $, esc, toast } from "./dom";
import { osmTiles } from "./map";
import { backButton, showSheet } from "./sheet";

let picker: L.Map | null = null;
let pin: L.Marker | null = null;

/** Removes the little picker map (call when the form closes). */
export function destroyPicker() {
  picker?.remove();
  picker = null;
  pin = null;
}

/** Distance between two points in km (the "haversine" formula). */
function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad, dLng = (bLng - aLng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

/** Opens the form. Pass `existing` to edit one of our places. */
export function openPlaceForm(data: PlacesFile, existing?: CustomPlace) {
  destroyPicker();
  const p = existing;
  const categories = CATEGORIES.map(
    (c, i) => `<label class="cat-option">
      <input type="radio" name="category" value="${c.id}" ${(p ? p.category === c.id : i === 0) ? "checked" : ""} />
      <span>${esc(c.name)} <span class="jp">${esc(c.jp)}</span></span>
    </label>`,
  ).join("");
  const areaOptions = allAreas(data).map((a) => `<option value="${esc(a.name)}">${esc(a.jp)}</option>`).join("");

  const sheet = $("#sheet");
  sheet.innerHTML = `
    <div class="form-top">${backButton("Cancel", p ? `#/place/${p.id}` : undefined)}<h2>${p ? "Edit place" : "Add a place"} <span class="jp">${p ? "編集" : "追加"}</span></h2></div>
    <form class="place-form sheet-body" novalidate>
      <label class="field"><span class="field-label">Name *</span>
        <input name="name" required maxlength="120" value="${esc(p?.name)}" placeholder="e.g. Yunangi, Hotel Patina" /></label>
      <label class="field"><span class="field-label">Japanese name (optional)</span>
        <input name="jp" maxlength="120" value="${esc(p?.jp)}" placeholder="e.g. ゆうなんぎい" /></label>

      <fieldset class="field"><legend class="field-label">Type</legend><div class="cat-options">${categories}</div></fieldset>

      <div class="field">
        <span class="field-label">Location *</span>
        <div class="loc-search">
          <label class="sr-only" for="locQuery">Search for a place</label>
          <input id="locQuery" type="search" placeholder="Search: shop name, address…" />
          <button type="button" data-form="search">Find</button>
        </div>
        <div class="loc-results" id="locResults"></div>
        <div id="pickMap" class="pick-map" aria-label="Map: tap to set the location"></div>
        <div class="loc-row">
          <span class="muted small" id="locText">${p ? "Drag the pin or tap the map to move it." : "Tap the map to set the pin."}</span>
          <button type="button" class="btn-secondary" data-form="here">Use my location</button>
        </div>
      </div>

      <label class="field"><span class="field-label">Area</span>
        <input name="area" list="areaList" maxlength="60" value="${esc(p?.area)}" placeholder="e.g. Yaeyama, Kansai, Hokkaido" />
        <datalist id="areaList">${areaOptions}</datalist></label>
      <label class="field"><span class="field-label">Why we saved it (optional)</span>
        <textarea name="desc" rows="2" maxlength="500" placeholder="e.g. Best soki soba, cash only">${esc(p?.desc)}</textarea></label>

      <p class="form-error" id="formError" role="alert"></p>
      <button class="btn-primary" type="submit">${p ? "Save changes" : "Add place"}</button>
    </form>`;
  showSheet();

  // ----- the picker map -----
  picker = L.map("pickMap").setView(p ? [p.lat, p.lng] : [34.5, 135], p ? 15 : 5);
  osmTiles().addTo(picker);
  const form = sheet.querySelector<HTMLFormElement>("form")!;
  const areaInput = form.elements.namedItem("area") as HTMLInputElement;

  const setPin = (lat: number, lng: number, zoom?: number) => {
    if (!pin) {
      pin = L.marker([lat, lng], { draggable: true, icon: L.divIcon({ className: "", html: '<span class="pin pin--pick"></span>', iconSize: [30, 30], iconAnchor: [15, 15] }) }).addTo(picker!);
      pin.on("dragend", () => describe());
    } else pin.setLatLng([lat, lng]);
    if (zoom) picker!.setView([lat, lng], zoom);
    describe();
  };
  // Shows the coordinates, and fills in the area from the nearest built-in place if it's close.
  const describe = () => {
    const { lat, lng } = pin!.getLatLng();
    $("#locText").textContent = `Pin at ${lat.toFixed(4)}, ${lng.toFixed(4)}. Drag it to adjust.`;
    if (!areaInput.value) {
      const nearest = data.places
        .map((b) => ({ b, km: distanceKm(lat, lng, b.lat, b.lng) }))
        .sort((x, y) => x.km - y.km)[0];
      if (nearest && nearest.km < 60) areaInput.value = nearest.b.area;
    }
  };
  if (p) setPin(p.lat, p.lng);
  picker.on("click", (e: L.LeafletMouseEvent) => setPin(e.latlng.lat, e.latlng.lng));
  // The sheet slides in with an animation; measure the map again once it has its final size.
  setTimeout(() => picker?.invalidateSize(), 300);

  // ----- search and "my location" -----
  const search = async () => {
    const q = $<HTMLInputElement>("#locQuery").value.trim();
    if (!q) return;
    const box = $("#locResults");
    box.innerHTML = `<p class="muted small">Searching…</p>`;
    try {
      // Nominatim = OpenStreetMap's free place search. Only used when we press "Find".
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=jp&accept-language=en&q=${encodeURIComponent(q)}`;
      const results: Array<{ display_name: string; name: string; lat: string; lon: string }> = await (await fetch(url)).json();
      box.innerHTML = results.length
        ? results
            .map((r, i) => `<button type="button" data-form="result" data-i="${i}"><b>${esc(r.name || r.display_name.split(",")[0])}</b> <span class="muted small">${esc(r.display_name)}</span></button>`)
            .join("")
        : `<p class="muted small">Nothing found. Try fewer words, or tap the map instead.</p>`;
      box.onclick = (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>("[data-i]");
        if (!b) return;
        const r = results[Number(b.dataset.i)];
        setPin(Number(r.lat), Number(r.lon), 16);
        const nameInput = form.elements.namedItem("name") as HTMLInputElement;
        if (!nameInput.value && r.name) nameInput.value = r.name;
        box.innerHTML = "";
      };
    } catch {
      box.innerHTML = `<p class="muted small">Search needs an internet connection.</p>`;
    }
  };
  sheet.querySelector("[data-form=search]")!.addEventListener("click", search);
  $<HTMLInputElement>("#locQuery").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault(); // don't submit the whole form
      search();
    }
  });
  sheet.querySelector("[data-form=here]")!.addEventListener("click", () => {
    if (!navigator.geolocation) return toast("This browser can't share its location");
    toast("Finding your location…");
    navigator.geolocation.getCurrentPosition(
      (pos) => setPin(pos.coords.latitude, pos.coords.longitude, 16),
      () => toast("Location not available (permission denied or no signal)"),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  });

  // ----- save -----
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const name = String(f.get("name") ?? "").trim();
    const error = $("#formError");
    if (!name) return void (error.textContent = "Please give the place a name.");
    if (!pin) return void (error.textContent = "Please set the location on the map.");
    const { lat, lng } = pin.getLatLng();
    const place: CustomPlace = {
      id: p?.id ?? newCustomId(),
      kind: "custom",
      category: f.get("category") as CustomPlace["category"],
      name,
      jp: String(f.get("jp") ?? "").trim(),
      area: String(f.get("area") ?? "").trim(),
      lat: Number(lat.toFixed(6)),
      lng: Number(lng.toFixed(6)),
      desc: String(f.get("desc") ?? "").trim(),
    };
    const button = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
    button.disabled = true;
    try {
      await saveCustomPlace(place);
      toast(p ? "Saved" : `${place.name} added`);
      location.hash = `#/place/${place.id}`;
    } catch (err) {
      error.textContent = (err as Error).message || "Could not save";
      button.disabled = false;
    }
  });
}
