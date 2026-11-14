// Everything about months and ratings: the month picker, rating badges,
// temperatures and the 12-month "best time to go" strip.
//
// This file only builds HTML; how it looks is in styles/app.css.

import type { MonthInfo, Place, Rating } from "../types";
import { esc } from "./dom";

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));
/** Japanese month names: 1月, 2月, … */
export const MONTHS_JP = MONTHS.map((_, i) => `${i + 1}月`);

const RATING_WORD: Record<Rating, string> = { great: "Great", ok: "OK", avoid: "Avoid" };
/** The marks Japanese guidebooks use: ◎ excellent, ○ good, ✕ no. */
const RATING_MARK: Record<Rating, string> = { great: "◎", ok: "○", avoid: "✕" };
/** For sorting: lower number = better. */
export const RATING_ORDER: Record<Rating, number> = { great: 0, ok: 1, avoid: 2 };

/** A rating mark: ◎ with the word "Great" under it (the word is hidden on cards). */
export function ratingBadge(rating: Rating): string {
  return `<span class="rate rate--${rating}" title="${RATING_WORD[rating]}">
    <span class="rate-mark" aria-hidden="true">${RATING_MARK[rating]}</span><span class="rate-word">${RATING_WORD[rating]}</span>
  </span>`;
}

/**
 * Air (and sea) temperature for one month.
 * "~" in front means it's approximate: station on a neighbouring island, or a sea estimate.
 */
export function temps(place: Place, m: MonthInfo, decimals = 0): string {
  const approx = place.climate.airSource === "nearby" ? "~" : "";
  const air = m.air == null ? "?" : m.air.toFixed(decimals);
  const sea = m.sea != null ? `<span class="t t-sea"><b>~${m.sea}°</b><small>sea</small></span>` : "";
  return `<span class="temps"><span class="t t-air"><b>${approx}${air}°</b><small>air</small></span>${sea}</span>`;
}

/** The month picker at the top of the list: a 6 × 2 calendar grid. */
export function monthPicker(selected: number): string {
  const buttons = MONTHS_SHORT.map(
    (m, i) => `<button class="m" data-month="${i}" aria-pressed="${i === selected}" aria-label="${MONTHS[i]}">
        <span class="m-en">${m}</span><span class="m-jp">${MONTHS_JP[i]}</span>
      </button>`,
  ).join("");
  return `<div class="months" role="group" aria-label="Month">
    <div class="mlist">${buttons}</div>
  </div>`;
}

/**
 * The 12-month bar chart on the place page: bar height = air temperature,
 * bar colour + ◎ ○ ✕ = rating. Tapping a month shows its details underneath.
 * --t (the temperature) is passed to the CSS, which turns it into the bar height.
 */
export function monthStrip(place: Place, selected: number): string {
  const cells = place.months
    .map(
      (m, i) => `<button class="sm sm--${m.rating}" data-strip-month="${i}" aria-pressed="${i === selected}"
          style="--t:${m.air ?? 0}" aria-label="${MONTHS[i]}: ${RATING_WORD[m.rating]}, ${esc(m.reason)}">
        <span class="sm-temp">${m.air == null ? "" : Math.round(m.air)}</span>
        <span class="sm-bar"></span>
        <span class="sm-mark" aria-hidden="true">${RATING_MARK[m.rating]}</span>
        <span class="sm-label" aria-hidden="true">${MONTHS_JP[i]}</span>
      </button>`,
    )
    .join("");
  return `<div class="strip">${cells}</div>
    <div class="legend">
      <span><i class="lg lg--great"></i>${ratingWordAndMark("great")}</span>
      <span><i class="lg lg--ok"></i>${ratingWordAndMark("ok")}</span>
      <span><i class="lg lg--avoid"></i>${ratingWordAndMark("avoid")}</span>
    </div>`;
}

function ratingWordAndMark(r: Rating) {
  return `<span class="lg-mark">${RATING_MARK[r]}</span> ${RATING_WORD[r]}`;
}

/** The details shown under the strip for the chosen month. */
export function monthDetail(place: Place, i: number): string {
  const m = place.months[i];
  return `<div class="mdetail">
    <div>
      <div class="mdetail-title">${MONTHS[i]} <span class="jp">${MONTHS_JP[i]}</span> ${ratingBadge(m.rating)}</div>
      <p class="muted">${esc(m.reason)}</p>
    </div>
    ${temps(place, m, 1)}
  </div>`;
}
