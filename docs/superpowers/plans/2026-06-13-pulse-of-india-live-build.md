# Pulse of India — Live Build Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the validated prototype into a deployed, continuously-live web app where the numbers actually move — a Node service that re-queries Amplitude every ~60s and serves a clean JSON the map polls every ~20s — shareable as one URL with the team.

**Architecture:** Single Node/Express service that (a) polls Amplitude's Dashboard REST API for three saved charts, cleans/geocodes the results, caches a `PulseSnapshot`, and serves it at `/api/pulse`; and (b) serves the built Vite/React frontend. The frontend polls `/api/pulse` and **animates between updates** so values glide rather than jump. One Render web service = one shareable URL.

**Tech Stack:** Node 20 + Express, Vite + React + TypeScript, Canvas 2D (ported from the prototype), Amplitude Dashboard REST API (HTTP Basic auth). Deploy: Render.

---

## Prerequisites (must be resolved before live data works)

- [ ] **Amplitude API Key + Secret** for project **255032** (Amplitude → Settings → Projects → "Pulse..."/Mobile App - Prod → API Key & Secret Key). Stored as env `AMP_API_KEY`, `AMP_SECRET_KEY`. The app runs on **seeded fallback** without them, so all UI work is unblocked; live data needs them.
- [ ] **Three saved charts** (so the REST API has stable chart IDs). Save these via the Amplitude MCP `create_chart` (or in the UI) and record their saved IDs into `server/charts.json`:
  - `total` — Current Uniques of `consumption_video_start`, 5-min interval, IST (prototype edit id `j0m5zxal`).
  - `byCity` — `ce:NN_watching_user` uniques grouped by `[Amplitude] City`, 5-min (edit id `2n2t7lpk`).
  - `byContent` — `ce:NN_watching_user` uniques grouped by `content_name` (edit id `963e0apu`).
- [ ] **Render account** (Shubham's). Deploy as a Web Service.
- [ ] Verify the REST endpoint shape: `GET https://amplitude.com/api/3/chart/{chartId}/query` with Basic auth returns the same CSV/series we saw via MCP. If realtime charts are not REST-queryable, fall back to the **Segmentation API** (`/api/2/events/segmentation`) — see Task 4 note.

## File Structure

```
watch-map-india/
├── server/
│   ├── index.js            # Express: serves /api/pulse + static web/dist
│   ├── amplitude.js        # Amplitude REST client (3 charts) + parsing
│   ├── pulse.js            # build PulseSnapshot: merge + clean + geocode
│   ├── clean.js            # script-dup merge, junk filter, city normalize
│   ├── charts.json         # { total, byCity, byContent } saved chart IDs
│   ├── seed.js             # seeded snapshot (verified real values) for fallback
│   └── data/
│       ├── cities_meta.json  # { "Jaipur": {lat,lng,dialect}, ... } gazetteer
│       └── curve.json        # 288-bucket day curve (fallback total)
├── web/
│   ├── index.html
│   ├── vite.config.ts
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── data/india.json     # {polys,bbox}
│       ├── lib/pulseSource.ts  # poll /api/pulse + interpolation
│       ├── components/MapCanvas.tsx   # canvas render (ported from prototype)
│       ├── components/Scoreboard.tsx
│       └── components/Hud.tsx
├── package.json            # scripts: dev, build, start
├── render.yaml             # Render web service config
└── .env.example            # AMP_API_KEY=, AMP_SECRET_KEY=
```

Source of truth for rendering + data shapes: the validated prototype at
`.superpowers/brainstorm/<session>/content/zz-original.html` (lift the canvas/scoreboard logic verbatim).

---

## Task 1: Scaffold the service

**Files:** Create `package.json`, `server/index.js`, `web/index.html`, `web/vite.config.ts`, `web/src/main.tsx`, `web/src/App.tsx`, `.env.example`, `.gitignore`.

- [ ] **Step 1: Root `package.json`**

```json
{
  "name": "pulse-of-india",
  "private": true,
  "type": "module",
  "scripts": {
    "dev:web": "vite --config web/vite.config.ts",
    "dev:server": "node --watch server/index.js",
    "build": "vite build --config web/vite.config.ts",
    "start": "node server/index.js"
  },
  "dependencies": { "express": "^4.19.2" },
  "devDependencies": { "vite": "^5.4.0", "@vitejs/plugin-react": "^4.3.1", "react": "^18.3.1", "react-dom": "^18.3.1", "typescript": "^5.5.0" }
}
```

- [ ] **Step 2: `web/vite.config.ts`** — build to `web/dist`, dev-proxy `/api` to `localhost:8787`.

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: { proxy: { '/api': 'http://localhost:8787' } },
});
```

- [ ] **Step 3: `server/index.js`** — Express serving `/api/pulse` (stub now) + static `web/dist`.

```js
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.get('/api/pulse', (req, res) => res.json({ ok: true, stub: true }));
app.use(express.static(path.join(__dirname, '../web/dist')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../web/dist/index.html')));
const PORT = process.env.PORT || 8787;
app.listen(PORT, () => console.log('pulse on :' + PORT));
```

- [ ] **Step 4: Verify** — `npm i`, `npm run dev:server`, `curl localhost:8787/api/pulse` → `{"ok":true,"stub":true}`.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "chore: scaffold pulse service"`.

---

## Task 2: Data assets (gazetteer, dialect map, india geometry, curve)

**Files:** Create `server/data/cities_meta.json`, `server/data/curve.json`, `web/src/data/india.json`.

These are generated from the validated prototype data already in `/tmp` (the session's working files).

- [ ] **Step 1:** Produce `cities_meta.json` from the prototype's `cities_amp.json` (`{c,x,y,p,d}` → `{ "<city>": { "lat": y, "lng": x, "dialect": d } }`). Keep all ~108 entries.
- [ ] **Step 2:** Copy `curve.json` (288 ints) and `india.json` (`{polys,bbox}` from `india_data.js`) into place.
- [ ] **Step 3: Verify** — `node -e "console.log(Object.keys(require('./server/data/cities_meta.json')).length)"` → ~108.
- [ ] **Step 4: Commit** — `git commit -am "data: city gazetteer + dialect map + india geometry + curve"`.

---

## Task 3: Cleaning utilities

**Files:** Create `server/clean.js`, `server/clean.test.mjs`.

- [ ] **Step 1: Write failing test** (`node --test`)

```js
import test from 'node:test'; import assert from 'node:assert';
import { normCity, cleanContent } from './clean.js';
test('normCity decodes + strips diacritics', () => {
  assert.equal(normCity('Son%c4%abpat'), 'Sonipat');
  assert.equal(normCity('Karnāl'), 'Karnal');
});
test('cleanContent merges script dups + drops junk', () => {
  const rows = [['Khejdi',154],['खेजड़ी',12],['(none)',18],['Episode 1',10],['Saanwari',83],['साँवरी',23]];
  const out = cleanContent(rows);              // [{title,watchers}], merged, sorted, junk removed
  assert.equal(out[0].title, 'Khejdi'); assert.equal(out[0].watchers, 166);
  assert.ok(!out.find(o => o.title === '(none)' || /^Episode/.test(o.title)));
});
```

- [ ] **Step 2: Run** `node --test server/clean.test.mjs` → FAIL.
- [ ] **Step 3: Implement `clean.js`**

```js
const DEV = /[ऀ-ॿ]/;
// transliteration pairs observed in the data (extend as needed)
const SCRIPT_ALIAS = { 'खेजड़ी':'Khejdi', 'साँवरी':'Saanwari', 'नाते':'Naate', 'दूजवर 2':'Doojvar 2', 'पित्तरदोष':'Pittardosh', 'मौत':'Maut' };
export function normCity(s){ try { s = decodeURIComponent(s); } catch {}
  return s.normalize('NFKD').replace(/[̀-ͯ]/g,'').replace(/[^\x20-\x7E]/g,'').trim(); }
export function cleanContent(rows){
  const map = new Map();
  for (let [name, v] of rows){ name=(name||'').replace(/[\x00-\x1F]/g,'').trim();
    if(!name || name==='(none)' || /^Episode\s+\d+$/.test(name)) continue;
    if(SCRIPT_ALIAS[name]) name = SCRIPT_ALIAS[name];
    if(DEV.test(name)) continue;                 // drop remaining devanagari dups
    map.set(name, (map.get(name)||0) + Number(v||0)); }
  return [...map].map(([title,watchers])=>({title,watchers:Math.round(watchers)})).sort((a,b)=>b.watchers-a.watchers);
}
```

- [ ] **Step 4: Run** `node --test server/clean.test.mjs` → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat: cleaning utils (city + content)"`.

---

## Task 4: Amplitude REST client

**Files:** Create `server/amplitude.js`, `server/charts.json`.

- [ ] **Step 1: `charts.json`** (fill saved IDs from Prerequisites):

```json
{ "total": "REPLACE_TOTAL_ID", "byCity": "REPLACE_CITY_ID", "byContent": "REPLACE_CONTENT_ID" }
```

- [ ] **Step 2: Implement `amplitude.js`** — Basic-auth chart query; returns parsed series.

```js
const AUTH = 'Basic ' + Buffer.from(`${process.env.AMP_API_KEY}:${process.env.AMP_SECRET_KEY}`).toString('base64');
async function chart(id){
  const r = await fetch(`https://amplitude.com/api/3/chart/${id}/query`, { headers: { Authorization: AUTH } });
  if(!r.ok) throw new Error('amp chart '+id+' '+r.status);
  return r.json();
}
// Each returns rows the way pulse.js expects. Parsing mirrors the CSV "data" matrix
// seen via MCP: header rows then [label, value...] rows.
export async function fetchTotalNow(){ const j = await chart(CHARTS.total); /* take latest non-zero 5-min bucket */ return latestBucket(j); }
export async function fetchByCity(){ const j = await chart(CHARTS.byCity); return rowsOf(j); }   // [[city, value], ...]
export async function fetchByContent(){ const j = await chart(CHARTS.byContent); return rowsOf(j); } // [[content, value], ...]
```

  Implement `latestBucket`/`rowsOf` to read the `data.csvResponse.data` / series structure (same shape returned by the MCP queries). Keep them small and unit-tested against a captured sample fixture in `server/amplitude.fixture.json`.

- [ ] **Step 3: Note / fallback** — If `/api/3/chart/{id}/query` does not return realtime 5-min data, switch to the Segmentation API: `GET https://amplitude.com/api/2/events/segmentation?e={...}&m=uniques&start=&end=&i=-300000&g=` with the same Basic auth. Keep the public functions identical so `pulse.js` is unaffected.
- [ ] **Step 4: Commit** — `git commit -am "feat: amplitude rest client"`.

---

## Task 5: Build the PulseSnapshot (+ seed fallback)

**Files:** Create `server/pulse.js`, `server/seed.js`, `server/pulse.test.mjs`.

- [ ] **Step 1: Shape (shared contract)**

```ts
type Dialect='haryanvi'|'bhojpuri'|'rajasthani'|'gujarati'|'marathi'|'hindi';
type PulseSnapshot = {
  ts: number;
  totals: { watchingNow: number };
  cities: { city:string; lat:number; lng:number; dominantDialect:Dialect; watchers:number }[];
  topShows: { title:string; watchers:number }[];
  stale?: boolean; // true when serving seed fallback
};
```

- [ ] **Step 2: `seed.js`** — export a `PulseSnapshot` built from the verified prototype values (today's curve current bucket + city shares + cleaned content). Used when Amplitude creds/calls fail, so the page never breaks.
- [ ] **Step 3: `pulse.js`** — `buildPulse()`:
  1. `total = await fetchTotalNow()`.
  2. `cityRows = await fetchByCity()`; for each, `meta = cities_meta[normCity(name)]`; skip if not geocoded; `watchers = round(total * share)` where share = cityValue / sum(cityValues); `dominantDialect = meta.dialect`.
  3. `topShows = cleanContent(await fetchByContent()).slice(0,8)`.
  4. Return `{ ts: Date.now(), totals:{watchingNow: total}, cities, topShows }`.
  - Wrap in try/catch → on error return `{ ...seed, stale:true }`.
- [ ] **Step 4: Test** `pulse.test.mjs` — feed fixture rows, assert cities sum ≈ total, topShows[0].title === 'Khejdi', all cities have lat/lng.
- [ ] **Step 5: Commit** — `git commit -am "feat: build pulse snapshot + seed fallback"`.

---

## Task 6: /api/pulse with caching

**Files:** Modify `server/index.js`.

- [ ] **Step 1:** Add a 60s in-memory cache that calls `buildPulse()` on an interval and serves the last good snapshot.

```js
import { buildPulse } from './pulse.js';
let snap = null; let last = 0;
async function refresh(){ try { snap = await buildPulse(); last = Date.now(); } catch(e){ console.error(e); } }
refresh(); setInterval(refresh, 60_000);
app.get('/api/pulse', (req,res)=>{ res.set('Cache-Control','no-store'); res.json(snap || { ts:0, totals:{watchingNow:0}, cities:[], topShows:[], stale:true }); });
```

- [ ] **Step 2: Verify** — `curl localhost:8787/api/pulse` returns a snapshot (seed if no creds). Confirm `topShows[0].title==='Khejdi'`.
- [ ] **Step 3: Commit** — `git commit -am "feat: /api/pulse with 60s refresh"`.

---

## Task 7: Frontend data source with smooth motion

**Files:** Create `web/src/lib/pulseSource.ts`.

- [ ] **Step 1:** Poll `/api/pulse` every 20s; expose a `getAnimated()` the render loop reads each frame which **eases current displayed values toward the latest fetched targets** (so numbers visibly glide/jitter between fetches rather than freezing).

```ts
export type Snap = { totals:{watchingNow:number}; cities:any[]; topShows:any[]; stale?:boolean };
let target: Snap | null = null;
let anim = { total: 0, shows: new Map<string,number>(), cityW: new Map<string,number>() };
export function start(){ const poll=async()=>{ try{ target = await (await fetch('/api/pulse')).json(); }catch{} setTimeout(poll,20_000); }; poll(); }
export function tick(dt:number){ if(!target) return anim;
  anim.total += (target.totals.watchingNow - anim.total) * 0.05;
  for(const s of target.topShows){ const c=anim.shows.get(s.title)??0; anim.shows.set(s.title, c+(s.watchers-c)*0.05); }
  for(const c of target.cities){ const v=anim.cityW.get(c.city)??0; anim.cityW.set(c.city, v+(c.watchers-v)*0.05); }
  return anim; }
export function snapshot(){ return target; }
```

  Note: easing means even a steady source visibly settles; combined with real ~60s source changes, the headline and bars move continuously. Do NOT add fake random jitter (the user explicitly rejected it).

- [ ] **Step 2: Commit** — `git commit -am "feat: pulse source with eased animation"`.

---

## Task 8: Port the visuals into React components

**Files:** Create `web/src/components/MapCanvas.tsx`, `Scoreboard.tsx`, `Hud.tsx`, `web/src/App.tsx`.

- [ ] **Step 1:** Lift the canvas render loop verbatim from the prototype `zz-original.html` into `MapCanvas.tsx` (dialect-dot India, glowing city nodes, halos, labels, vignette). Replace the embedded `CITIES`/`CURVE` constants with values read from `pulseSource` (`snapshot()` + `tick()` for animated city watchers and total).
- [ ] **Step 2:** `Scoreboard.tsx` — render `topShows`, each row's number = `tick().shows.get(title)` (eased). `Hud.tsx` — `watchingNow` = `tick().total`, real IST clock, "🔥 #1 now" = `topShows[0].title`.
- [ ] **Step 3:** `App.tsx` — `start()` the source on mount; lay out `MapCanvas` + `Hud` + `Scoreboard` + legend + a small **"updated 12s ago"** indicator (and an amber "showing cached data" pill when `stale`).
- [ ] **Step 4: Verify** — `npm run build && npm start`, open `localhost:8787`: numbers move (eased), map renders, scoreboard live. With creds, values change each minute; without, seed shows with the stale pill.
- [ ] **Step 5: Commit** — `git commit -am "feat: react components fed by live pulse"`.

---

## Task 9: Deploy to Render

**Files:** Create `render.yaml`, `.env.example`.

- [ ] **Step 1: `render.yaml`**

```yaml
services:
  - type: web
    name: pulse-of-india
    runtime: node
    plan: starter
    buildCommand: npm install && npm run build
    startCommand: npm start
    envVars:
      - key: AMP_API_KEY
        sync: false
      - key: AMP_SECRET_KEY
        sync: false
```

- [ ] **Step 2:** Push repo to GitHub (Shubham's fork pattern), create Render Web Service from `render.yaml`, set `AMP_API_KEY`/`AMP_SECRET_KEY` in the Render dashboard.
- [ ] **Step 3: Verify** — open the Render URL; confirm live numbers move and `stale` is false. Share URL with team.
- [ ] **Step 4: Commit** — `git commit -am "chore: render deploy config"`.

---

## Open risks / notes
- **Realtime via REST**: biggest unknown — confirm chart-query returns 5-min realtime; else Segmentation API fallback (Task 4).
- **Custom event over REST**: `ce:NN_watching_user` was rejected by Amplitude's *ad-hoc* API but is fine inside *saved charts*; querying saved charts via REST sidesteps it.
- **New cities** not in the gazetteer are skipped (logged). Expand `cities_meta.json` as needed; ~98% of volume already covered.
- **dominantDialect** comes from the static gazetteer (language preference per city is stable); revisit only if it drifts.
- **Rate limits**: Amplitude Dashboard API has cost/concurrency limits; 60s polling of 3 charts is well within them.
