// Form for adding (or editing) a spot or one of our own destinations.
//   #/add              new spot (or switch to "Destination")
//   #/add/<destId>     new spot in that destination
//   #/edit/<id>        edit one of our spots or destinations
// The location is picked on a small map: tap the map, search for a name, or use "my location".

import L from "leaflet";
import type { AnyPlace, Destination, OwnDestination, PlacesFile, Spot } from "../types";
import { SPOT_TYPES, allDestinations, allPrefectures, distanceKm, nearestDestination } from "../data/places";
import { newDestinationId, newSpotId, saveDestination, saveSpot } from "../data/store";
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

/**
 * Opens the form.
 * @param existing  one of our spots or destinations to edit
 * @param destinationId  for a new spot: the destination it belongs to
 */
export function openPlaceForm(data: PlacesFile, existing?: Spot | OwnDestination, destinationId?: string) {
  destroyPicker();
  const spot = existing?.kind === "spot" ? existing : undefined;
  const dest = existing?.kind === "custom" ? existing : undefined;
  /** "spot" or "destination": what we're adding. Fixed when editing. */
  let what: "spot" | "destination" = dest ? "destination" : "spot";
  const destinations = allDestinations(data).sort((a, b) => a.name.localeCompare(b.name));
  const startDest = destinations.find((d) => d.id === (spot?.destinationId || destinationId));
  /** Did we pick the destination ourselves? If not, it follows the pin (nearest destination). */
  let destChosen = !!startDest;

  const types = SPOT_TYPES.map(
    (t, i) => `<label class="cat-option">
      <input type="radio" name="type" value="${t.id}" ${(spot ? spot.type === t.id : i === 0) ? "checked" : ""} />
      <span>${t.icon} ${esc(t.name)} <span class="jp">${esc(t.jp)}</span></span>
    </label>`,
  ).join("");
  const destOptions = destinations
    .map((d) => `<option value="${esc(d.id)}" ${startDest?.id === d.id ? "selected" : ""}>${esc(d.name)} ${esc(d.jp)}</option>`)
    .join("");
  const prefOptions = allPrefectures(data).map((p) => `<option value="${esc(p.name)}">${esc(p.jp)}</option>`).join("");
  const backTo = existing ? `#/place/${existing.id}` : destinationId ? `#/place/${destinationId}` : undefined;
  const title = existing ? `Edit ${what}` : startDest ? `Add a spot in ${startDest.name}` : "Add";

  const sheet = $("#sheet");
  sheet.innerHTML = `
    <div class="form-top">${backButton("Cancel", backTo)}<h2>${esc(title)} <span class="jp">${existing ? "編集" : "追加"}</span></h2></div>
    <form class="place-form sheet-body" novalidate>
      ${existing || startDest ? "" : `
      <div class="seg" role="radiogroup" aria-label="What to add">
        <label><input type="radio" name="what" value="spot" checked /><span>Spot <span class="jp">スポット</span><small>beach, temple, restaurant…</small></span></label>
        <label><input type="radio" name="what" value="destination" /><span>Destination <span class="jp">行き先</span><small>a town or island</small></span></label>
      </div>`}
      <label class="field"><span class="field-label">Name *</span>
        <input name="name" required maxlength="120" value="${esc(existing?.name)}" placeholder="e.g. Yunangi, Kabira Bay" /></label>
      <label class="field"><span class="field-label">Japanese name (optional)</span>
        <input name="jp" maxlength="120" value="${esc(existing?.jp)}" placeholder="e.g. ゆうなんぎい" /></label>

      <fieldset class="field only-spot"><legend class="field-label">Type</legend><div class="cat-options">${types}</div></fieldset>

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
          <span class="muted small" id="locText">${existing ? "Drag the pin or tap the map to move it." : "Tap the map to set the pin."}</span>
          <button type="button" class="btn-secondary" data-form="here">Use my location</button>
        </div>
      </div>

      <label class="field only-spot"><span class="field-label">Destination *</span>
        <select name="destination"><option value="">(the nearest one to the pin)</option>${destOptions}</select>
        <span class="muted small" id="destHint"></span></label>

      <label class="field only-dest"><span class="field-label">Prefecture</span>
        <input name="prefecture" list="prefList" maxlength="60" value="${esc(dest?.prefecture)}" placeholder="e.g. Okinawa, Hokkaido" />
        <datalist id="prefList">${prefOptions}</datalist></label>
      <label class="field"><span class="field-label">Note (optional)</span>
        <textarea name="desc" rows="2" maxlength="500" placeholder="e.g. Best soki soba, cash only">${esc(existing?.desc)}</textarea></label>

      <p class="form-error" id="formError" role="alert"></p>
      <button class="btn-primary" type="submit">${existing ? "Save changes" : "Add"}</button>
    </form>`;
  showSheet();

  const form = sheet.querySelector<HTMLFormElement>("form")!;
  const destSelect = form.elements.namedItem("destination") as HTMLSelectElement;
  const prefInput = form.elements.namedItem("prefecture") as HTMLInputElement;

  /** Shows the fields for a spot or for a destination. */
  const showFields = () => {
    form.querySelectorAll<HTMLElement>(".only-spot").forEach((el) => (el.hidden = what !== "spot"));
    form.querySelectorAll<HTMLElement>(".only-dest").forEach((el) => (el.hidden = what !== "destination"));
  };
  showFields();
  form.querySelectorAll<HTMLInputElement>("input[name=what]").forEach((r) =>
    r.addEventListener("change", () => {
      what = r.value as typeof what;
      showFields();
    }),
  );
  destSelect.addEventListener("change", () => (destChosen = !!destSelect.value));

  // ----- the picker map -----
  const start: [number, number, number] = existing
    ? [existing.lat, existing.lng, 15]
    : startDest
      ? [startDest.lat, startDest.lng, startDest.kind === "island" ? 12 : 13]
      : [34.5, 135, 5];
  picker = L.map("pickMap").setView([start[0], start[1]], start[2]);
  osmTiles().addTo(picker);

  const setPin = (lat: number, lng: number, zoom?: number) => {
    if (!pin) {
      pin = L.marker([lat, lng], { draggable: true, icon: L.divIcon({ className: "", html: '<span class="pin pin--pick"></span>', iconSize: [30, 30], iconAnchor: [15, 15] }) }).addTo(picker!);
      pin.on("dragend", () => describe());
    } else pin.setLatLng([lat, lng]);
    if (zoom) picker!.setView([lat, lng], zoom);
    describe();
  };
  /** Shows the coordinates; picks the nearest destination (spot) or fills in the prefecture (destination). */
  const describe = () => {
    const { lat, lng } = pin!.getLatLng();
    $("#locText").textContent = `Pin at ${lat.toFixed(4)}, ${lng.toFixed(4)}. Drag it to adjust.`;
    const near: Destination = nearestDestination(data, lat, lng);
    const km = distanceKm(lat, lng, near.lat, near.lng);
    if (!destChosen) destSelect.value = near.id;
    $("#destHint").textContent = destChosen ? "" : `Nearest: ${near.name} (${Math.round(km)} km). Change it if it belongs somewhere else.`;
    if (!prefInput.value && km < 60) prefInput.value = near.prefecture;
  };
  if (existing) setPin(existing.lat, existing.lng);
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
      // Results near the map's current view come first.
      const b = picker!.getBounds();
      const viewbox = [b.getWest(), b.getNorth(), b.getEast(), b.getSouth()].map((n) => n.toFixed(4)).join(",");
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=jp&accept-language=en&viewbox=${viewbox}&q=${encodeURIComponent(q)}`;
      const results: Array<{ display_name: string; name: string; lat: string; lon: string }> = await (await fetch(url)).json();
      box.innerHTML = results.length
        ? results
            .map((r, i) => `<button type="button" data-form="result" data-i="${i}"><b>${esc(r.name || r.display_name.split(",")[0])}</b> <span class="muted small">${esc(r.display_name)}</span></button>`)
            .join("")
        : `<p class="muted small">Nothing found. Try fewer words, or tap the map instead.</p>`;
      box.onclick = (e) => {
        const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-i]");
        if (!btn) return;
        const r = results[Number(btn.dataset.i)];
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
    if (!name) return void (error.textContent = "Please give it a name.");
    if (!pin) return void (error.textContent = "Please set the location on the map.");
    const { lat, lng } = pin.getLatLng();
    const common = {
      name,
      jp: String(f.get("jp") ?? "").trim(),
      lat: Number(lat.toFixed(6)),
      lng: Number(lng.toFixed(6)),
      desc: String(f.get("desc") ?? "").trim(),
    };
    const button = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
    button.disabled = true;
    try {
      let id: string;
      if (what === "spot") {
        const destinationId = destSelect.value || nearestDestination(data, lat, lng).id;
        const s: Spot = { ...common, id: spot?.id ?? newSpotId(), kind: "spot", builtIn: false, destinationId, type: f.get("type") as Spot["type"] };
        await saveSpot(s);
        id = s.id;
      } else {
        const d: OwnDestination = { ...common, id: dest?.id ?? newDestinationId(), kind: "custom", prefecture: String(f.get("prefecture") ?? "").trim() };
        await saveDestination(d);
        id = d.id;
      }
      toast(existing ? "Saved" : `${name} added`);
      location.hash = `#/place/${id}`;
    } catch (err) {
      error.textContent = (err as Error).message || "Could not save";
      button.disabled = false;
    }
  });
}

/** Is this one of the things the form can edit (our own spot or destination)? */
export function isEditable(p: AnyPlace | undefined): p is Spot | OwnDestination {
  return !!p && ((p.kind === "spot" && !p.builtIn) || p.kind === "custom");
}
