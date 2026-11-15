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
// It also finds 3 more photos per place for the "Photos" strip on the place page ("gallery"):
//   npm run photos -- --gallery                → only places that have no gallery yet
//   npm run photos -- --gallery --force        → redo every gallery
//   npm run photos -- --gallery --only kyoto   → redo just these galleries
// Don't like a gallery photo? Add its file name to NOT_FOR_GALLERY below, or pin your own
// choices in that place's "galleryFiles" in places.json, then rerun with --only <id>.
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
  matsumoto: "Matsumoto Castle",
  miyajima: "Itsukushima Shrine torii",
  kumano: "Kumano Kodo Nakahechi",
  nara: "Todai-ji Daibutsuden",
  fuji: "Mount Fuji Chureito Pagoda",
  tateyama: "Tateyama snow corridor Murodo",
  kanazawa: "Kenrokuen Kotojitoro",
  shirakawago: "Shirakawa-go gassho village",
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
  matsumoto: "Matsumoto Castle", miyajima: "Itsukushima", kumano: "Kumano Kodō", nara: "Nara (city)", fuji: "Mount Fuji",
  tateyama: "Tateyama Kurobe Alpine Route", kanazawa: "Kanazawa", shirakawago: "Shirakawa-gō",
};

/** How many extra photos each place gets. */
const GALLERY_SIZE = 3;

/** For the gallery: one search per theme, so the photos show different things. */
const GALLERY_SEARCH: Record<string, string[]> = {
  ishigaki: ["Kabira Bay", "Ishigaki Tamatorizaki", "Ishigaki Yonehara beach"],
  taketomi: ["Taketomi water buffalo cart", "Kondoi beach Taketomi", "Taketomi Nagomi tower"],
  iriomote: ["Iriomote Pinaisara falls", "Iriomote Urauchi river", "Iriomote Hoshizuna beach"],
  kohama: ["Kohama Okinawa sugar cane", "Kohama island Okinawa sea", "Kohama island beach"],
  kuroshima: ["Kuroshima Okinawa cattle", "Kuroshima Okinawa pier", "Kuroshima Okinawa"],
  hateruma: ["Nishihama beach Hateruma", "Hateruma southernmost", "Hateruma island"],
  yonaguni: ["Yonaguni horse", "Yonaguni Tachigami rock", "Yonaguni cape Irizaki"],
  miyakojima: ["Yonaha Maehama beach", "Higashi-hennazaki", "Ikema bridge Miyako"],
  irabu: ["Irabu bridge", "Shimoji island Toorike", "Sawada beach Irabu"],
  tarama: ["Tarama island", "Tarama Okinawa beach", "Tarama Okinawa"],
  kerama: ["Zamami island beach", "Tokashiki island beach", "Aka island Kerama"],
  kumejima: ["Hatenohama Kumejima", "Kumejima Tatami-ishi", "Kumejima Eef beach"],
  minnajima: ["Minna Island Motobu", "Minnajima", "Minna island beach"],
  iheya: ["Iheya island", "Izena island", "Iheya Okinawa"],
  yoron: ["Yurigahama Yoron", "Yoron island beach", "Yoronjima"],
  okinoerabu: ["Okinoerabu Fucya", "Okinoerabu island", "Okinoerabu beach"],
  tokunoshima: ["Tokunoshima Inutabu", "Tokunoshima bullfighting", "Tokunoshima beach"],
  amami: ["Amami Oshima mangrove", "Amami Oshima Ohama beach", "Amami Oshima forest"],
  kakeroma: ["Kakeroma island", "Kakeromajima", "Kakeroma Amami"],
  yakushima: ["Jomon Sugi", "Shiratani Unsuikyo", "Yakushima Ohko falls"],
  chichijima: ["Chichijima Miyanohama", "Chichijima Kominato beach", "Ogasawara Chichijima sunset"],
  miyakejima: ["Miyakejima Tairo pond", "Miyakejima lava", "Miyake-jima coast"],
  mikurajima: ["Mikurajima dolphins", "Mikurajima island", "Mikura-jima"],
  hachijojima: ["Hachijo-Fuji", "Hachijojima Nanbara lava", "Hachijojima onsen"],
  shikinejima: ["Shikinejima Jinata onsen", "Shikinejima Tomari beach", "Shikine-jima"],
  kozushima: ["Kozushima Tenjosan", "Kozushima Tako bay", "Kozu-shima"],
  niijima: ["Habushiura beach", "Niijima Yunohama onsen", "Nii-jima"],
  tokyo: ["Senso-ji Asakusa", "Shibuya crossing", "Meiji Jingu"],
  kyoto: ["Fushimi Inari torii", "Arashiyama bamboo grove", "Kinkaku-ji"],
  osaka: ["Dotonbori", "Osaka Castle cherry blossoms", "Shinsekai Tsutenkaku"],
  karuizawa: ["Shiraito falls Karuizawa", "Kyu-Karuizawa Ginza", "Karuizawa Stone Church"],
  takayama: ["Takayama Sanmachi", "Takayama Festival yatai", "Hida Folk Village"],
  suzuka: ["Suzuka Circuit grandstand", "Suzuka Circuit Formula One", "Ise Grand Shrine"],
  hiroshima: ["Hiroshima Peace Memorial Park", "Hiroshima Castle", "Shukkeien garden"],
  hakone: ["Owakudani", "Hakone Shrine torii", "Hakone Tozan railway"],
  matsumoto: ["Kamikochi Kappa bridge", "Nakamachi Matsumoto", "Matsumoto Castle cherry blossoms"],
  miyajima: ["Miyajima deer", "Mount Misen Miyajima", "Itsukushima five-storied pagoda"],
  kumano: ["Nachi waterfall pagoda", "Kumano Hongu Taisha Oyunohara torii", "Yunomine onsen"],
  nara: ["Nara Park deer", "Kasuga Taisha lanterns", "Kofuku-ji pagoda"],
  fuji: ["Lake Kawaguchi Mount Fuji", "Fuji Shibazakura", "Mount Fuji summit crater"],
  tateyama: ["Kurobe Dam", "Mikurigaike Tateyama", "Tateyama ropeway"],
  kanazawa: ["Higashi Chaya Kanazawa", "Omicho market Kanazawa", "21st Century Museum Kanazawa"],
  shirakawago: ["Shirakawa-go winter light-up", "Ogimachi Shirakawa autumn", "Gassho-zukuri interior"],
};

/** Gallery photos we looked at and didn't want (wrong place, ugly, duplicate view…). */
const NOT_FOR_GALLERY = new Set<string>([
  "Friendship and Health Square at Iheya Island 202603 01.jpg",
  "Iheya Clinic 202603.jpg",
  "Wadomari port Okinoerabu Island Kagoshima JAPAN.jpg",
  "沖永良部島 (897425348).jpg",
  "Michinoeki Amamioshima Sumiyo.jpg",
  "Ogasawara Islands, Tokyo, Japan.jpg",
  "男湯 厠 2017 (32817272036).jpg",
  "Niijima village Shikinejima branch.jpg",
  "Snow in Ogimachi Area, Shirakawa village, Gifu.JPG",
  "Shikasenbei.jpg",
  "Kappa Bridge Monument at Kamikōchi, Morinaga & Co.,Ltd. Gifts (2).jpg",
  "Shika senbei 2017.jpg",
  "Higashi Chaya district, Kanazawa (3809893551).jpg",
  "Takayama festival Yatai Kaikan No,1.JPG",
  "Gassho-zukuri farmhouse-03.jpg",
  "Interior of cafe at Shirakawa-go in Gifu, Japan (213).jpg",
  "Taketomi Island, Kondoi Beach 360-degree.jpg",
  "Japan, Iriomote island- Urauchi river 2017 2.jpg",
  "Kohama Island, Coral Beach 360-degree.jpg",
  "Irabu ohashi monument.jpg",
  "Tarama Airport Aerial photograph 2022.jpg",
  "多良間島全景.jpg",
  "Friendship and Health Square at Iheya Island 202603 02.jpg",
  "Iheya branch office of the JA Okinawa 202603.jpg",
  "Pumice from the 13 August 2021 explosive eruption of Fukutoku-Okanoba Volcano (Bonin Islands, western Pacific Ocean) 4.jpg",
  "2021-04-09 Yoronjima-seito 与論島製糖（株）DJI Mini2-0023.jpg",
  "Wadomari port Okinoerabu Island Kagoshima.jpg",
  "Okinoerabu Island faintly seen from Mount Kuba at Iheya Island 202603 03.jpg",
  "Okinoerabu Island seen from Mount Katsuu 202607.jpg",
  "Mangrove Park by countermeasures COVID-19(attention sign board).jpg",
  "Kakeroma Bus at Ikenma Port 20180430.jpg",
  "Shinyo at Kakeromajima.jpg",
  "Kakeroma Bus at Seso Port 20180430.jpg",
  "Ogasawara Village Bus Kominato Kaigan Bus Stop.jpg",
  "霧の縄文杉 (Jomon Sugi) 26 May, 2013 - panoramio.jpg",
  "Nakanogo Onsen Bunsekisyo.jpg",
  "Shikine-jima aerial.jpg",
  "Meiji Jingu Stadium aerial view.jpg",
  "Kyu-Karuizawa Main Street, Vintage Photos2.jpg",
  "Suzuka circuit ino station 2026.jpg",
]);

/** Gallery file names that are rarely a nice travel photo (signs, buses, aerial shots…). */
const GALLERY_BAD_NAME = /360|aerial|airport|bus\b|bus stop|office|station|stadium|vintage|pumice|sign|monument|senbei|toilet|clinic/i;

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

/** Gets file info for many names (the API takes at most 50 per request). */
async function fileInfoMany(names: string[]): Promise<Map<string, ImageInfo>> {
  const byName = new Map<string, ImageInfo>();
  for (let i = 0; i < names.length; i += 50) {
    for (const page of await fileInfo(names.slice(i, i + 50))) byName.set(page.title.replace(/^File:/, ""), page);
  }
  return byName;
}

/** "Kabira Bay 2.jpg" and "Kabira_Bay_3.JPG" are probably the same view: compare without digits. */
const stem = (name: string) => name.toLowerCase().replace(/\.[a-z]+$/, "").replace(/[\d_\s()-]+/g, " ").trim();

/** Up to GALLERY_SIZE more photos, different from the main photo and from each other. */
async function findGallery(place: Place): Promise<CommonsPhoto[]> {
  const pinned = [...(place.galleryFiles ?? [])]; // our own picks first

  // One search per theme: the first good photo of each theme is taken first.
  const themes: string[][] = [];
  for (const words of GALLERY_SEARCH[place.id] ?? []) {
    const search = await api("commons.wikimedia.org", {
      action: "query", list: "search", srnamespace: "6", srlimit: "12", srsearch: `${words} filetype:bitmap`,
    });
    themes.push((search.query?.search ?? []).map((hit: { title: string }) => hit.title));
  }

  // Fallbacks if the themes don't give enough: pictures used in the English Wikipedia article
  // (chosen by editors, so usually on topic) and a general search.
  const names: string[] = [];
  // Pictures used in the English Wikipedia article (chosen by editors, so usually on topic).
  const wiki = await api("en.wikipedia.org", {
    action: "query", prop: "images", imlimit: "60", titles: WIKI[place.id] ?? place.name, redirects: "1",
  });
  for (const img of wiki.query?.pages?.[0]?.images ?? []) names.push(img.title);

  // Plus a Commons search (the same words as for the main photo, and just the name).
  for (const words of new Set([SEARCH[place.id] ?? place.name, `${place.name} ${place.kind === "island" ? "island" : "Japan"}`])) {
    const search = await api("commons.wikimedia.org", {
      action: "query", list: "search", srnamespace: "6", srlimit: "25", srsearch: `${words} filetype:bitmap`,
    });
    for (const hit of search.query?.search ?? []) names.push(hit.title);
  }

  const clean = (t: string) => t.replace(/^File:/, "").replace(/_/g, " ");
  const all = [...new Set([...pinned, ...themes.flat(), ...names].map(clean))];
  const byName = await fileInfoMany(all);
  const picked: CommonsPhoto[] = [];
  const seen = new Set(place.photo ? [stem(place.photo.file)] : []);
  /** Takes the first usable photo from a list of names; returns true if it found one. */
  const takeFirst = (list: string[]) => {
    for (const name of list.map(clean)) {
      if (picked.length >= GALLERY_SIZE) return false;
      if (name === place.photo?.file || NOT_FOR_GALLERY.has(name) || GALLERY_BAD_NAME.test(name) || seen.has(stem(name))) continue;
      const page = byName.get(name);
      const result = page ? judge(page) : "missing";
      if (typeof result === "string") continue;
      picked.push(result);
      seen.add(stem(name));
      return true;
    }
    return false;
  };
  for (const name of pinned) takeFirst([name]); // every pinned photo
  for (const theme of themes) takeFirst(theme); // one per theme
  while (picked.length < GALLERY_SIZE && takeFirst(all)); // fill up with whatever is left
  return picked;
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const onlyArg = args.find((a) => a.startsWith("--only"));
  const only = onlyArg ? (onlyArg.includes("=") ? onlyArg.split("=")[1] : args[args.indexOf(onlyArg) + 1]).split(",") : null;

  const data: PlacesFile = JSON.parse(fs.readFileSync(FILE, "utf8"));

  if (args.includes("--gallery")) {
    for (const place of data.places) {
      if (only ? !only.includes(place.id) : place.gallery?.length && !force) continue;
      try {
        place.gallery = await findGallery(place);
        console.log(`✓ ${place.name.padEnd(16)} ${place.gallery.length} photo(s): ${place.gallery.map((g) => g.file).join(" | ")}`);
      } catch (err) {
        console.error(`✗ ${place.name}: ${(err as Error).message}`);
      }
      fs.writeFileSync(FILE, JSON.stringify(data, null, 2) + "\n");
    }
    return;
  }

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
