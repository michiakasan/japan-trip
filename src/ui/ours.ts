// "Our record" section of the place page: years visited, notes and our photos.
// Also handles the taps/typing on the place page that change our data
// (including the Want to go / Visited buttons at the top).

import type { AnyPlace } from "../types";
import {
  addPhotos, addYear, deletePhoto, getMode, getState, photosFor, photoUrl, removeYear, setCover, setNotes, setStatus,
  type Status,
} from "../data/store";
import { $, esc, toast } from "./dom";
import { commonsCredit } from "./placeholder";
import { currentPlace } from "./sheet";

/** The HTML for the section. */
export function oursHtml(place: AnyPlace): string {
  const s = getState(place.id);
  const mode = getMode();
  const thisYear = new Date().getFullYear();

  const years = s.years
    .map((y) => `<span class="year">${y}<button data-our="remove-year" data-year="${y}" aria-label="Remove ${y}">×</button></span>`)
    .join("");

  const photos = photosFor(place.id)
    .map((p) => {
      const isCover = s.coverPhotoId === p.id;
      return `<figure class="our-photo">
        <button class="our-photo-img" data-our="view" data-photo="${p.id}" aria-label="View photo">
          <img src="${esc(photoUrl(p, "thumb"))}" alt="Our photo of ${esc(place.name)}" loading="lazy" crossorigin="anonymous" />
        </button>
        <button class="our-photo-btn cover-btn" data-our="cover" data-photo="${p.id}" aria-pressed="${isCover}"
          aria-label="${isCover ? "Cover photo (tap to stop using it)" : "Use as cover photo"}">${isCover ? "★" : "☆"}</button>
        <button class="our-photo-btn del-btn" data-our="delete-photo" data-photo="${p.id}" aria-label="Delete photo">×</button>
      </figure>`;
    })
    .join("");

  const photoHint =
    mode === "local"
      ? `<p class="muted small">Photos need our server; this copy of the app has none.</p>`
      : `<label class="add-photo"><input type="file" accept="image/*" multiple data-our="upload" hidden />＋ Add photos</label>
         <span class="muted small" id="uploadState"></span>`;

  return `<section class="ours">
    <h3>Our record <span class="jp">わたしたちの記録</span>${syncBadge()}</h3>

    <div class="field">
      <span class="field-label">Years visited</span>
      <div class="years">
        ${years}
        <form class="year-add" data-our="add-year">
          <label class="sr-only" for="yearInput">Year</label>
          <input id="yearInput" type="number" inputmode="numeric" min="1980" max="${thisYear + 5}" value="${thisYear}" />
          <button type="submit">Add</button>
        </form>
      </div>
    </div>

    <div class="field">
      <label class="field-label" for="notes">Notes</label>
      <textarea id="notes" data-our="notes" data-saved="${esc(s.notes)}" rows="3" placeholder="Where we stayed, what to book early, what we loved…">${esc(s.notes)}</textarea>
      <span class="muted small" id="notesState" aria-live="polite"></span>
    </div>

    <div class="field">
      <span class="field-label">Our photos</span>
      <div class="our-photos">${photos}</div>
      ${photoHint}
    </div>
  </section>`;
}

function syncBadge() {
  const mode = getMode();
  if (mode === "shared") return `<span class="sync sync--live" title="Shared live with your partner">● shared</span>`;
  if (mode === "offline") return `<span class="sync sync--off" title="No connection: showing the last saved copy">offline</span>`;
  return `<span class="sync" title="No server: saved in this browser only">this device only</span>`;
}

/** Shows an error from the server or the network as a short message. */
function showError(err: unknown) {
  console.error(err);
  toast((err as Error)?.message || "Something went wrong");
}

/** Notes are saved automatically one second after you stop typing. */
let notesTimer: number | undefined;

/** Sets up taps, typing and file picking for the section. `currentPlaceId` tells us which place is open. */
export function setupOursEvents(currentPlaceId: () => string | null) {
  const sheet = $("#sheet");

  sheet.addEventListener("click", async (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("[data-status],[data-our]");
    const placeId = currentPlaceId();
    if (!t || !placeId) return;
    try {
      if (t.dataset.status) {
        await setStatus(placeId, t.dataset.status as Status);
      } else if (t.dataset.our === "remove-year") {
        await removeYear(placeId, Number(t.dataset.year));
      } else if (t.dataset.our === "cover") {
        const current = getState(placeId).coverPhotoId;
        await setCover(placeId, current === t.dataset.photo ? null : t.dataset.photo!);
      } else if (t.dataset.our === "delete-photo") {
        const photo = photosFor(placeId).find((p) => p.id === t.dataset.photo);
        if (photo && confirm("Delete this photo for both of you?")) await deletePhoto(photo);
      } else if (t.dataset.our === "view") {
        const photo = photosFor(placeId).find((p) => p.id === t.dataset.photo);
        if (photo) openViewer(photoUrl(photo, "full"));
      } else if (t.dataset.our === "gallery") {
        // A Commons photo from the "Photos" strip: show it big, with its credit.
        const p = currentPlace();
        const photo = p && p.kind !== "custom" ? p.gallery?.[Number(t.dataset.index)] : undefined;
        if (photo) openViewer(photo.url, commonsCredit(photo));
      }
    } catch (err) {
      showError(err);
    }
  });

  // "Add" year (a <form>, so pressing Enter on the keyboard works too)
  sheet.addEventListener("submit", async (e) => {
    const form = e.target as HTMLFormElement;
    if (form.dataset.our !== "add-year") return;
    e.preventDefault();
    const placeId = currentPlaceId();
    const year = Number(($("#yearInput", form) as HTMLInputElement).value);
    if (!placeId || !Number.isInteger(year) || year < 1980 || year > 2100) return toast("Please enter a year like 2025");
    try {
      await addYear(placeId, year);
    } catch (err) {
      showError(err);
    }
  });

  // Notes: save automatically after a pause in typing, and when leaving the box.
  const saveNotes = async (textarea: HTMLTextAreaElement) => {
    clearTimeout(notesTimer);
    const placeId = currentPlaceId();
    if (!placeId) return;
    const state = document.querySelector("#notesState");
    try {
      await setNotes(placeId, textarea.value);
      if (state) state.textContent = "Saved";
    } catch (err) {
      if (state) state.textContent = "Not saved";
      showError(err);
    }
  };
  sheet.addEventListener("input", (e) => {
    const t = e.target as HTMLTextAreaElement;
    if (t.dataset.our !== "notes") return;
    const state = document.querySelector("#notesState");
    if (state) state.textContent = "Typing…";
    clearTimeout(notesTimer);
    notesTimer = window.setTimeout(() => saveNotes(t), 1000);
  });
  sheet.addEventListener("focusout", (e) => {
    const t = e.target as HTMLTextAreaElement;
    if (t.dataset?.our === "notes") saveNotes(t);
  });

  // Photos picked from the phone's gallery or camera
  sheet.addEventListener("change", async (e) => {
    const input = e.target as HTMLInputElement;
    if (input.dataset.our !== "upload" || !input.files?.length) return;
    const placeId = currentPlaceId();
    if (!placeId) return;
    const files = [...input.files];
    input.value = ""; // empty the picker, so the same photo can be picked again later
    const state = () => document.querySelector("#uploadState");
    try {
      await addPhotos(placeId, files, (done, total) => {
        const el = state();
        if (el) el.textContent = done < total ? `Uploading ${done + 1} of ${total}…` : "Done";
      });
      toast(files.length === 1 ? "Photo added" : `${files.length} photos added`);
    } catch (err) {
      showError(err);
    }
  });
}

// ---------- full-screen photo viewer ----------

/** Shows a photo full screen; tap anywhere to close. `caption` is optional HTML (e.g. a credit). */
export function openViewer(url: string, caption = "") {
  const viewer = document.createElement("div");
  viewer.className = "viewer";
  viewer.setAttribute("role", "dialog");
  viewer.setAttribute("aria-label", "Photo");
  viewer.innerHTML = `<img src="${esc(url)}" alt="" crossorigin="anonymous" /><button class="viewer-close" aria-label="Close">×</button>` +
    (caption ? `<p class="viewer-caption">${caption}</p>` : "");
  // Tap anywhere to close (but a tap on the credit link opens the link instead).
  viewer.addEventListener("click", (e) => {
    if (!(e.target as HTMLElement).closest("a")) viewer.remove();
  });
  document.body.append(viewer);
  viewer.querySelector("button")!.focus();
}
