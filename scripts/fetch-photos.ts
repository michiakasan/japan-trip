// Finds one free-licence photo per place on Wikimedia Commons and saves its URL
// and credit (photographer + licence) into public/places.json.
//
// Run it with:
//   npm run photos                       → only places that don't have a photo yet
//   npm run photos -- --force            → redo every place
//   npm run photos -- --only kyoto,yoron → redo just these places
//
// Don't like a photo? Find a better one on commons.wikimedia.org, copy its file name
// (e.g. "File:Kabira Bay 2.jpg" → "Kabira Bay 2.jpg") into that place's "photoFile"
// in places.json, and run:  npm run photos -- --only <id>
//
// Only these licences are accepted: CC BY, CC BY-SA, CC0 and public domain.

import fs from "node:fs";
import type { CommonsPhoto, Place, PlacesFile } from "../src/types";

const FILE = new URL("../public/places.json", import.meta.url);

// Wikimedia asks scripts to identify themselves with a User-Agent.
const HEADERS = { "User-Agent": "japan-places-photo-script/1.0 (personal travel app)" };

// What to search for on Commons if the Wikipedia article's main image isn't usable.
// A famous view of the place usually gives the nicest photo.
const SEARCH: Record<string, string> = {
  ishigaki: "Kabira Bay Ishigaki",
  taketomi: "Taketomi island village",
  iriomote: "Iriomote mangrove river",
  kohama: "Kohama island Okinawa",
  kuroshima: "Kuroshima Taketomi Okinawa",
  hateruma: "Hateruma Nishihama beach",
  yonaguni: "Yonaguni Irizaki",
  miyakojima: "Yonaha Maehama beach",
  irabu: "Irabu bridge",
  tarama: "Tarama island Okinawa",
  kerama: "Zamami island beach",
  kumejima: "Hatenohama Kumejima",
  minnajima: "Minna island Okinawa",
  iheya: "Iheya island",
  yoron: "Yurigahama Yoron",
  okinoerabu: "Okinoerabu island",
  tokunoshima: "Tokunoshima island",
  amami: "Amami Oshima beach",
  kakeroma: "Kakeroma island",
  yakushima: "Yakushima forest",
  chichijima: "Chichijima Ogasawara beach",
  miyakejima: "Miyakejima island",
  mikurajima: "Mikurajima island",
  hachijojima: "Hachijojima Hachijo-Fuji",
  shikinejima: "Shikinejima",
  kozushima: "Kozushima island",
  niijima: "Niijima Habushiura",
  tokyo: "Tokyo skyline Tokyo Tower",
  kyoto: "Kiyomizu-dera Kyoto",
  osaka: "Osaka Castle",
  karuizawa: "Karuizawa Kumoba pond",
  takayama: "Takayama Sanmachi old town",
  suzuka: "Suzuka Circuit",
  hiroshima: "Itsukushima torii Miyajima",
  hakone: "Lake Ashi Hakone torii Fuji",
};

// English Wikipedia article for each place (its main image is tried first).
const WIKI: Record<string, string> = {
  ishigaki: "Ishigaki Island", taketomi: "Taketomi Island", iriomote: "Iriomote Island", kohama: "Kohama Island",
  kuroshima: "Kuroshima (Okinawa)", hateruma: "Hateruma", yonaguni: "Yonaguni", miyakojima: "Miyako-jima",
  irabu: "Irabu Island", tarama: "Tarama Island", kerama: "Kerama Islands", kumejima: "Kume Island",
  minnajima: "Minna Island", iheya: "Iheya Island", yoron: "Yoronjima", okinoerabu: "Okinoerabujima",
  tokunoshima: "Tokunoshima", amami: "Amami Ōshima", kakeroma: "Kakeromajima", yakushima: "Yakushima",
  chichijima: "Chichijima", miyakejima: "Miyake-jima", mikurajima: "Mikura-jima", hachijojima: "Hachijō-jima",
  shikinejima: "Shikine-jima", kozushima: "Kōzu-shima", niijima: "Nii-jima", tokyo: "Tokyo", kyoto: "Kyoto",
  osaka: "Osaka", karuizawa: "Karuizawa, Nagano", takayama: "Takayama, Gifu",
  suzuka: "Suzuka Circuit", hiroshima: "Hiroshima", hakone: "Hakone",
};

/** File names that are almost never a nice landscape photo. */
const BAD_NAME = /map|locator|location|landsat|satellite|\biss\d|_iss|nasa|flag|emblem|logo|seal|symbol|diagram|chart|coat.of.arms|montage|collage|banner/i;
const OK_LICENSE = /^(cc[ -]by|cc0|public domain|pd)/i;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api(host: string, params: Record<string, string>) {
  const url = `https://${host}/w/api.php?` + new URLSearchParams({ format: "json", formatversion: "2", ...params });
  // Wikimedia answers "429 Too Many Requests" if we go too fast.
  // Then we wait (as long as it asks, or longer each time) and try again.
  for (let attempt = 1; attempt <= 6; attempt++) {
    const res = await fetch(url, { headers: HEADERS });
    if (res.status === 429) {
      const wait = Number(res.headers.get("retry-after")) || 5 * attempt;
      console.log(`   (Wikimedia says slow down; waiting ${wait}s)`);
      await sleep(wait * 1000);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${host}`);
    await sleep(1000); // be polite: about one request per second
    return res.json();
  }
  throw new Error(`still rate-limited by ${host}, try again later`);
}

/** Turns the HTML credit Commons gives us ("<a href=…>Jane Doe</a>") into plain text. */
const plain = (html = "") => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

interface ImageInfo {
  title: string;
  imageinfo?: Array<{
    width: number; height: number; mime: string; thumburl: string; descriptionurl: string;
    extmetadata?: Record<string, { value: string }>;
  }>;
}

/** Tidies Commons author text, e.g. "No machine-readable author provided. Geomr~commonswiki assumed …" → "Geomr". */
export function cleanAuthor(text: string): string {
  return text
    .replace(/^No machine-readable author provided\.\s*/i, "")
    .replace(/\s*assumed \(based on.*$/i, "")
    .replace(/~commonswiki/g, "")
    .replace(/^The original uploader was (.+?) at .*$/i, "$1")
    .trim();
}

/** Checks one Commons file. Returns a CommonsPhoto, or the reason it was rejected. */
function judge(page: ImageInfo): CommonsPhoto | string {
  const info = page.imageinfo?.[0];
  if (!info) return "no image info";
  const name = page.title.replace(/^File:/, "");
  if (BAD_NAME.test(name)) return "looks like a map/logo";
  if (info.mime !== "image/jpeg") return "not a photo (jpeg)";
  if (info.width < 1200 || info.width < info.height * 1.15) return "too small or not landscape";
  if (info.width > info.height * 2.2) return "panorama (too wide for a card)";
  const meta = info.extmetadata ?? {};
  const license = plain(meta.LicenseShortName?.value);
  if (!OK_LICENSE.test(license)) return `licence not accepted (${license || "unknown"})`;
  const author = cleanAuthor(plain(meta.Artist?.value) || plain(meta.Credit?.value) || "Unknown");
  return {
    file: name,
    url: info.thumburl, // 1280 px wide version
    thumb: info.thumburl.replace(/\/1280px-/, "/500px-"), // 500 px wide version for cards
    author: author.length > 80 ? author.slice(0, 77) + "…" : author,
    license,
    licenseUrl: meta.LicenseUrl?.value ?? "",
    sourcePage: info.descriptionurl,
  };
}

/** Gets size, licence and credit for several Commons files at once. */
async function fileInfo(titles: string[]): Promise<ImageInfo[]> {
  if (!titles.length) return [];
  const data = await api("commons.wikimedia.org", {
    action: "query",
    titles: titles.map((t) => (t.startsWith("File:") ? t : "File:" + t)).join("|"),
    prop: "imageinfo",
    iiprop: "url|size|mime|extmetadata",
    iiurlwidth: "1280",
  });
  return data.query?.pages ?? [];
}

/** Candidate files for a place, best first. */
async function candidates(place: Place & { photoFile?: string }): Promise<string[]> {
  const list: string[] = [];
  if (place.photoFile) list.push(place.photoFile); // pinned by us: always tried first

  const wiki = await api("en.wikipedia.org", {
    action: "query", prop: "pageimages", piprop: "name", titles: WIKI[place.id] ?? place.name, redirects: "1",
  });
  const lead = wiki.query?.pages?.[0]?.pageimage;
  if (lead) list.push(lead);

  const search = await api("commons.wikimedia.org", {
    action: "query", list: "search", srnamespace: "6", srlimit: "15",
    srsearch: `${SEARCH[place.id] ?? place.name} filetype:bitmap`,
  });
  for (const hit of search.query?.search ?? []) list.push(hit.title);
  return [...new Set(list.map((t: string) => t.replace(/^File:/, "")))];
}

async function findPhoto(place: Place & { photoFile?: string }): Promise<CommonsPhoto | null> {
  const names = await candidates(place);
  const pages = await fileInfo(names.slice(0, 20));
  // Keep the order of `names` (pinned → Wikipedia → search results).
  const byName = new Map(pages.map((p) => [p.title.replace(/^File:/, ""), p]));
  for (const name of names) {
    const page = byName.get(name.replace(/_/g, " "));
    if (!page) continue;
    const result = judge(page);
    if (typeof result !== "string") return result;
    if (name === place.photoFile) console.warn(`   pinned photo rejected: ${result}`);
  }
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const onlyArg = args.find((a) => a.startsWith("--only"));
  const only = onlyArg ? (onlyArg.includes("=") ? onlyArg.split("=")[1] : args[args.indexOf(onlyArg) + 1]).split(",") : null;

  const data: PlacesFile = JSON.parse(fs.readFileSync(FILE, "utf8"));
  let found = 0, missing = 0;
  for (const place of data.places) {
    if (only ? !only.includes(place.id) : place.photo && !force) continue;
    try {
      const photo = await findPhoto(place);
      if (photo) {
        place.photo = photo;
        found++;
        console.log(`✓ ${place.name.padEnd(16)} ${photo.file}  (${photo.license}, ${photo.author})`);
      } else {
        missing++;
        console.log(`– ${place.name.padEnd(16)} no suitable free photo found (placeholder will be used)`);
      }
    } catch (err) {
      missing++;
      console.error(`✗ ${place.name}: ${(err as Error).message}`);
    }
    // Save after every place, so an interrupted run keeps what it found.
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2) + "\n");
  }
  console.log(`\nDone: ${found} photo(s) found, ${missing} without.`);
}

main();
