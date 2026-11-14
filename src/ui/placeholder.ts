// Place pictures: the Wikimedia photo if we have one, otherwise a little
// landscape drawn with <canvas> (sea, beach, jungle, volcano, city…), based on
// the drawings in the old prototype.

import type { AnyPlace, Category } from "../types";
import { esc } from "./dom";
import { coverFor } from "../data/store";

// ---------- drawn placeholder ----------

/** A tiny "random" number generator that always gives the same numbers for the same seed,
 *  so each place always gets the same drawing. */
function seededRandom(text: string) {
  let seed = 2166136261;
  for (const ch of text) seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619);
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
}

/** Draws a simple landscape for the place's "scene" type onto a canvas. */
function drawScene(c: CanvasRenderingContext2D, w: number, h: number, place: AnyPlace) {
  const r = seededRandom(place.id);
  const k = sceneOf(place);
  const circle = (x: number, y: number, rad: number) => { c.beginPath(); c.arc(x, y, rad, 0, Math.PI * 2); c.fill(); };

  // Sky (sometimes an evening sky) with a sun and clouds
  const evening = r() < 0.25;
  const sky = c.createLinearGradient(0, 0, 0, h * 0.6);
  sky.addColorStop(0, evening ? "#e9a07f" : "#8fc6df");
  sky.addColorStop(1, evening ? "#f7dcb4" : "#e2f1f4");
  c.fillStyle = sky;
  c.fillRect(0, 0, w, h);
  c.fillStyle = "rgba(255,250,235,.9)";
  circle(80 + r() * 480, 60 + r() * 50, 24 + r() * 10);
  c.fillStyle = "rgba(255,255,255,.85)";
  for (let i = 0; i < 3; i++) {
    const x = r() * w, y = 40 + r() * 80;
    for (let j = 0; j < 4; j++) circle(x + j * 18, y + (j % 2) * 6, 14 + r() * 8);
  }

  const horizon = h * (k === "city" || k === "mountain" ? 0.62 : 0.5);

  if (k === "city") {
    c.fillStyle = "#a9bcc4";
    for (let x = 0; x < w; x += 28 + r() * 20) { const bh = 40 + r() * 140; c.fillRect(x, horizon - bh, 24 + r() * 16, bh); }
    c.fillStyle = "#7b929b";
    for (let x = 10; x < w; x += 40 + r() * 30) { const bh = 30 + r() * 90; c.fillRect(x, horizon - bh, 18 + r() * 14, bh); }
    c.fillStyle = "#d3c3a6";
    c.fillRect(0, horizon, w, h - horizon);
    const blossom = r() < 0.6; // cherry blossoms or green trees
    for (let i = 0; i < 9; i++) {
      const x = r() * w, y = horizon + 20 + r() * 90;
      c.fillStyle = "#6b4a3a"; c.fillRect(x - 3, y, 6, 44);
      c.fillStyle = blossom ? "#f3bccb" : "#86bf72";
      for (let j = 0; j < 6; j++) circle(x + (r() - 0.5) * 50, y - 8 + (r() - 0.5) * 30, 16 + r() * 8);
    }
    return;
  }

  if (k === "mountain") {
    c.fillStyle = "#8fa9b3";
    c.beginPath(); c.moveTo(0, horizon); c.lineTo(w * 0.45, horizon - 170); c.lineTo(w * 0.9, horizon); c.fill();
    c.fillStyle = "#ffffff";
    c.beginPath(); c.moveTo(w * 0.45 - 42, horizon - 128); c.lineTo(w * 0.45, horizon - 170); c.lineTo(w * 0.45 + 42, horizon - 128); c.fill();
    c.fillStyle = "#55905a"; c.fillRect(0, horizon, w, h - horizon);
    for (let i = 0; i < 46; i++) {
      const x = r() * w, y = horizon + r() * (h - horizon);
      c.fillStyle = r() < 0.5 ? "#3a6f41" : "#62a058";
      c.beginPath(); c.moveTo(x, y - 36); c.lineTo(x - 13, y); c.lineTo(x + 13, y); c.fill();
    }
    return;
  }

  // Everything else is an island: sea first
  const sea = c.createLinearGradient(0, horizon, 0, h);
  sea.addColorStop(0, k === "volcano" || k === "cliff" ? "#22618b" : "#1890a8");
  sea.addColorStop(1, k === "volcano" ? "#2b80a8" : "#46d0d2");
  c.fillStyle = sea;
  c.fillRect(0, horizon, w, h - horizon);
  c.strokeStyle = "rgba(255,255,255,.35)";
  c.lineWidth = 2;
  for (let i = 0; i < 14; i++) {
    const y = horizon + 8 + r() * (h - horizon - 20), x = r() * w;
    c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + 15, y - 4, x + 30, y); c.stroke();
  }

  // The land
  if (k === "volcano") {
    c.fillStyle = "#4d5c51";
    c.beginPath(); c.moveTo(w * 0.15, horizon + 4); c.lineTo(w * 0.45, horizon - 140); c.lineTo(w * 0.52, horizon - 140); c.lineTo(w * 0.85, horizon + 4); c.fill();
    c.fillStyle = "#62905c";
    c.beginPath(); c.moveTo(w * 0.15, horizon + 4); c.lineTo(w * 0.3, horizon - 64); c.lineTo(w * 0.7, horizon - 64); c.lineTo(w * 0.85, horizon + 4); c.fill();
    c.fillStyle = "rgba(235,235,235,.75)";
    for (let i = 0; i < 5; i++) circle(w * 0.49 + i * 12, horizon - 155 - i * 16, 12 + i * 3);
  } else if (k === "cliff") {
    c.fillStyle = "#5f8d5c";
    c.beginPath(); c.moveTo(w * 0.5, horizon + 2); c.lineTo(w * 0.62, horizon - 76); c.lineTo(w, horizon - 96); c.lineTo(w, h * 0.82); c.lineTo(w * 0.7, h * 0.82); c.fill();
    c.fillStyle = "#bba98c";
    c.beginPath(); c.moveTo(w * 0.62, horizon - 76); c.lineTo(w * 0.7, h * 0.82); c.lineTo(w * 0.6, h * 0.82); c.lineTo(w * 0.5, horizon + 2); c.fill();
  } else if (k === "jungle" || k === "forest") {
    c.fillStyle = k === "forest" ? "#31603c" : "#317c47";
    c.beginPath(); c.moveTo(0, horizon + 2);
    for (let x = 0; x <= w; x += 40) c.lineTo(x, horizon - 50 - r() * 70);
    c.lineTo(w, horizon + 2); c.fill();
    c.fillStyle = k === "forest" ? "#41774b" : "#46a25c";
    for (let i = 0; i < 28; i++) circle(r() * w, horizon - 20 - r() * 34, 18 + r() * 14);
    if (k === "forest") { c.fillStyle = "rgba(255,255,255,.35)"; c.fillRect(0, horizon - 80, w, 20); } // mist
  } else {
    c.fillStyle = "#52995c"; // a low island on the horizon
    c.beginPath(); c.ellipse(w * (0.25 + r() * 0.5), horizon + 2, 90 + r() * 60, 18, 0, Math.PI, 0); c.fill();
  }

  // Beach in front
  if (k !== "volcano" && k !== "cliff") {
    c.fillStyle = "#f2e4c4";
    c.beginPath(); c.moveTo(0, h); c.lineTo(0, h * 0.8); c.quadraticCurveTo(w * 0.4, h * 0.74, w, h * 0.86); c.lineTo(w, h); c.fill();
    c.fillStyle = "rgba(255,255,255,.6)";
    c.beginPath(); c.moveTo(0, h * 0.8); c.quadraticCurveTo(w * 0.4, h * 0.74, w, h * 0.86); c.lineTo(w, h * 0.87);
    c.quadraticCurveTo(w * 0.4, h * 0.76, 0, h * 0.815); c.fill();
  }

  // Red-roofed village houses (or grey roofs + steam for hot-spring islands)
  if (k === "village" || k === "onsen") {
    for (let i = 0; i < 4; i++) {
      const x = 40 + i * 74 + r() * 20, y = h * 0.8;
      c.fillStyle = "#f4efe6"; c.fillRect(x, y - 28, 48, 28);
      c.fillStyle = k === "onsen" ? "#6b7f87" : "#c4553f";
      c.beginPath(); c.moveTo(x - 6, y - 28); c.lineTo(x + 24, y - 46); c.lineTo(x + 54, y - 28); c.fill();
    }
    if (k === "onsen") {
      c.fillStyle = "rgba(255,255,255,.7)";
      for (let i = 0; i < 6; i++) circle(w * 0.75 + (r() - 0.5) * 40, h * 0.78 - i * 13, 8 + i * 2);
    }
  }

  // A palm tree
  if (k === "beach" || k === "jungle") {
    const px = w * (0.72 + r() * 0.2), py = h * 0.88;
    c.strokeStyle = "#7a5638"; c.lineWidth = 7;
    c.beginPath(); c.moveTo(px, py); c.quadraticCurveTo(px - 10, py - 70, px + 8, py - 130); c.stroke();
    c.strokeStyle = "#2f8a4a"; c.lineWidth = 6;
    for (let a = 0; a < 6; a++) {
      const ang = -Math.PI / 2 + (a - 2.5) * 0.55;
      c.beginPath(); c.moveTo(px + 8, py - 130);
      c.quadraticCurveTo(px + 8 + Math.cos(ang) * 40, py - 140 + Math.sin(ang) * 30, px + 8 + Math.cos(ang) * 70, py - 100 + Math.sin(ang) * 40);
      c.stroke();
    }
  }
}

/** Our own places have no "scene", so pick one from their type. */
const CATEGORY_SCENE: Record<Category, string> = {
  restaurant: "village", hotel: "onsen", city: "city", sight: "mountain", other: "beach",
};
const sceneOf = (p: AnyPlace) => (p.kind === "custom" ? CATEGORY_SCENE[p.category] : p.scene);

/** Drawing is done once per place and kept as an image URL (memory cache). */
const drawn = new Map<string, string>();

export function placeholderUrl(place: AnyPlace): string {
  let url = drawn.get(place.id);
  if (!url) {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 480;
    drawScene(canvas.getContext("2d")!, canvas.width, canvas.height, place);
    url = canvas.toDataURL("image/webp", 0.8);
    drawn.set(place.id, url);
  }
  return url;
}

// ---------- the picture shown in cards, list rows and the place page ----------

/**
 * The picture for a place: our cover photo → Wikimedia photo → drawing.
 * size "small" = 500 px photo (cards, list). size "large" = 1280 px photo (place page).
 * withCredit adds the photographer + licence line on top of the photo.
 */
export function photoHtml(place: AnyPlace, size: "small" | "large" = "small", withCredit = false): string {
  // 1. Our own cover photo, if we picked one
  const cover = coverFor(place.id);
  if (cover) {
    return `<img class="photo" src="${esc(size === "large" ? cover.url : cover.thumb)}" alt="Our photo of ${esc(place.name)}"
      loading="${size === "large" ? "eager" : "lazy"}" decoding="async" crossorigin="anonymous" data-place="${esc(place.id)}" />`;
  }
  // 2. The Wikimedia Commons photo, 3. otherwise the drawing
  const p = place.kind === "custom" ? null : place.photo;
  if (!p) {
    return `<img class="photo photo--drawn" src="${placeholderUrl(place)}" alt="Drawing of ${esc(place.name)} (no photo yet)" />`;
  }
  const credit = `Photo: ${p.author} · ${p.license}`;
  // data-place lets main.ts swap in the drawing if the photo fails to load (e.g. offline).
  const img = `<img class="photo" src="${esc(size === "large" ? p.url : p.thumb)}" alt="${esc(place.name)}"
    loading="${size === "large" ? "eager" : "lazy"}" decoding="async" crossorigin="anonymous" data-place="${esc(place.id)}" title="${esc(credit)}" />`;
  if (!withCredit) return img;
  return `${img}<span class="credit">${esc(credit)}</span>`;
}

/** Full credit with links, for the place page. */
export function creditHtml(place: AnyPlace): string {
  const p = place.kind === "custom" ? null : place.photo;
  if (!p) return "";
  const license = p.licenseUrl ? `<a href="${esc(p.licenseUrl)}" target="_blank" rel="noopener">${esc(p.license)}</a>` : esc(p.license);
  return `Photo: <a href="${esc(p.sourcePage)}" target="_blank" rel="noopener">${esc(p.author)}</a>, ${license}, via Wikimedia Commons`;
}
