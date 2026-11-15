# Japanchansky 旅

Our Japan islands, cities and trips: what's great to visit in which month, what we want to see,
where we've been, our notes and photos, and a day-by-day trip planner.

**Live:** https://squash-results.com/akari/japan-place/ (also on https://squash-results.com/menu/)

Vite + plain TypeScript app, our own small Node server on Hertz (shared data, no login: a trip code
instead), Leaflet + OpenStreetMap, installable PWA that works offline.

## Everyday commands

```bash
npm run dev -- --host   # try the app locally (open the "Network" address on your phone, same Wi-Fi)
npm run server          # run the API locally too (in a second terminal), data in server/data/
npm run deploy          # build the app and upload it to squash-results.com/akari/japan-place/
npm run deploy:server   # upload server/*.ts to Hertz and restart the API
npm run hertz:set-code  # set or change the trip code on Hertz (asks for it, never stored in plain text)
npm run photos          # find Wikimedia photos for places without one (--force / --only id1,id2)
npm run climate         # re-download JMA climate normals into places.json
npm run icons           # redraw the app icons (needs Python + Pillow)
```

## Setup checklist

### 1. Set the trip code (once) — 1 minute

```bash
npm run hertz:set-code
```

Type 4+ random words (e.g. `kayak mango lantern sushi`, but your own). Spaces and capitals don't
matter when you enter it later. Then open the app on both phones and enter the code once.
Notes you saved before "on this device only" are uploaded automatically the first time.

To change the code later, run the same command. Phones that already joined stay joined; to sign
every phone out, run on Hertz: `cd /var/www/japanchansky-api && sudo -u www-data DATA_DIR=/var/lib/japanchansky node --experimental-strip-types set-code.ts --logout-all`.

### 2. Install on the phones

- **iPhone (Safari):** open the site → Share → **Add to Home Screen**.
  (The installed app has its own storage on iPhone, so enter the trip code once more inside it.)
- **Android (Chrome):** open the site → ⋮ menu → **Install app**.

Everything you've looked at (places, photos, map areas) keeps working offline; changes need a connection.

### 3. How it runs on Hertz (already set up)

| What | Where |
|---|---|
| App files | `/var/www/html/akari-japan-place/` (own folder, so the exam-prep deploy into `/akari/` can't wipe it) |
| API code | `/var/www/japanchansky-api/` (`server.ts`, `db.ts`, `set-code.ts`) |
| API service | `japanchansky-api.service` (systemd, user `www-data`, port 5020, sandboxed). Logs: `journalctl -u japanchansky-api` |
| Data | `/var/lib/japanchansky/`: `japanchansky.db` (SQLite), `photos/`, `backups/` (daily copy, last 14 kept) |
| nginx | in `/etc/nginx/nginx.conf`: `/akari/japan-place/api/` → port 5020 (unbuffered for live updates, 10 MB upload limit), `/akari/japan-place/` → app files (`no-cache`), plus the `.webmanifest` type |
| Menu | card "Japanchansky" in `/var/www/html/menu/index.html` |

Backups of edited config files: `/etc/nginx/nginx.conf.bak.*`, `/root/backups/`.

## How privacy works

No accounts. Entering the right trip code gives the phone a long random key in a cookie
(HttpOnly, SameSite=Strict, Secure, 10 years). Every API request without a valid key is refused
(401), including photo downloads. The code is stored only as a scrypt hash; wrong codes are slowed
down (2 s) and limited to 10 per 15 minutes per address. Changes also need an app-only header, so
other websites can't send changes on your behalf. Photos are resized to max 1600 px on the phone
before upload, which also strips GPS data.

## Where things are

| Path | What |
|---|---|
| `public/places.json` | the 35 built-in places: months, JMA temperatures, seasons, photos |
| `src/main.ts` | start-up, navigation (`#/`, `#/map`, `#/trips`, `#/place/<id>` …), taps |
| `src/data/` | `store.ts` (our data, live updates, offline copy), `api.ts` (talks to the server), `places.ts`, `photos.ts` |
| `src/ui/` | one file per screen: `results`, `sheet` (place page), `map`, `add-place`, `trips`, `ours`, `join` |
| `src/styles/` | `tokens.css` (colours, light/dark), `app.css` |
| `server/` | the API: `server.ts` (routes, trip code, live updates, photos), `db.ts` (SQLite tables, backups), `set-code.ts` |
| `scripts/` | photo, climate and icon scripts |
| `prototype/index.html` | the original prototype (data source only) |

Data credits: climate normals © Japan Meteorological Agency; photos from Wikimedia Commons (credited
in the app); map © OpenStreetMap contributors.
