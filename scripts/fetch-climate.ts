// Fetches monthly mean air temperatures (climate normals 1991–2020) from the
// Japan Meteorological Agency (JMA) website and writes them into public/places.json.
//
// Run it with:   npm run climate
//
// Which station each place uses is stored in places.json under climate.stationRef.
// To change a station, edit that entry and run the script again.
// Station IDs can be found on https://www.data.jma.go.jp/stats/etrn/select/prefecture00.php

import fs from "node:fs";
import type { PlacesFile } from "../src/types";

const FILE = new URL("../public/places.json", import.meta.url);

// JMA has two kinds of stations, and each has its own page and table layout:
//  - "s": main weather stations (気象台・測候所)
//  - "a": AMeDAS automatic stations (more of them, also on small islands)
// In the table, the mean temperature (平均気温) is in a different column for each kind.
const PAGES = {
  s: { path: "nml_sfc_ym.php", tempColumn: 4 },
  a: { path: "nml_amd_ym.php", tempColumn: 2 },
} as const;

/** Wait a bit between requests so we don't hammer the JMA server. */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Turns an HTML table cell into plain text. */
const cellText = (html: string) => html.replace(/<[^>]+>/g, "").trim();

/** Downloads one station's page and returns 12 temperatures plus the statistics period. */
async function fetchStation(type: "s" | "a", prec: number, block: number) {
  const page = PAGES[type];
  // AMeDAS block numbers are 4 digits with leading zeros, e.g. 0980.
  const blockNo = type === "a" ? String(block).padStart(4, "0") : String(block);
  const url = `https://www.data.jma.go.jp/stats/etrn/view/${page.path}?prec_no=${prec}&block_no=${blockNo}`;

  const res = await fetch(url, { headers: { "User-Agent": "japan-places-climate-script" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const html = await res.text();

  // Each table row looks like <tr class="mtx">...<td>..</td>...</tr>
  const rows = [...html.matchAll(/<tr class="mtx"[^>]*>([\s\S]*?)<\/tr>/g)].map((m) =>
    [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => cellText(c[1])),
  );

  const period = rows.find((r) => r[0] === "統計期間")?.[page.tempColumn] ?? null;
  const temps: number[] = [];
  for (let m = 1; m <= 12; m++) {
    const row = rows.find((r) => r[0] === `${m}月`);
    // Values can carry quality marks like "18.9 )" — keep only the number.
    const value = row ? parseFloat(row[page.tempColumn].replace(/[^\d.-]/g, "")) : NaN;
    // Sanity check: a Japanese monthly mean is always between -20 and 35 °C.
    if (!Number.isFinite(value) || value < -20 || value > 35) {
      throw new Error(`Unexpected value for month ${m} at ${url}: "${row?.[page.tempColumn]}"`);
    }
    temps.push(value);
  }
  return { temps, period, url };
}

async function main() {
  const data: PlacesFile = JSON.parse(fs.readFileSync(FILE, "utf8"));
  // Several places can share a station, so remember results we already fetched.
  const cache = new Map<string, Awaited<ReturnType<typeof fetchStation>>>();
  let failed = 0;

  for (const place of data.places) {
    const { type, prec, block } = place.climate.stationRef;
    const key = `${type}/${prec}/${block}`;
    try {
      if (!cache.has(key)) {
        cache.set(key, await fetchStation(type, prec, block));
        await sleep(600);
      }
      const { temps, period } = cache.get(key)!;
      place.months.forEach((m, i) => (m.air = temps[i]));
      place.climate.period = period;
      console.log(`✓ ${place.name.padEnd(16)} ${place.climate.station.padEnd(28)} Jan ${temps[0]}°  Aug ${temps[7]}°`);
    } catch (err) {
      failed++;
      console.error(`✗ ${place.name}: ${(err as Error).message}`);
    }
  }

  fs.writeFileSync(FILE, JSON.stringify(data, null, 2) + "\n");
  console.log(failed ? `\nDone with ${failed} error(s); those places kept their old values.` : "\nDone. places.json updated.");
}

main();
