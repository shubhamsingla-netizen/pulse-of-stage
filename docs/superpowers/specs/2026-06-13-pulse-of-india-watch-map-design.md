# Pulse of India — Stage Live Watch-Map (Design Spec)

**Date:** 2026-06-13
**Author:** Shubham Singla (PM, Stage)
**Status:** Approved design — ready for implementation plan

## 1. Purpose

A cinematic, live-feeling "Pulse of India" map for leadership demos and all-hands. It
shows, in real time, **where across India people are watching Stage and in which dialect**.
Optimized for impact and storytelling. Primary audience: Vinay / leadership. Success =
"show this to Vinay" reaction.

It measures **consumption** (what is being watched right now), not acquisition. (An
acquisition view — "where Khejdi is winning new signups" from trial events — is noted as a
future variant, not in scope.)

## 2. What it shows (validated by the working prototype)

Single full-bleed dark page. The hero is India at night.

- **Base map:** real India outline (district GeoJSON), dimmed and neutral — NOT fully
  colored. Only places with actual viewers light up.
- **City nodes:** one glowing dot per city at its **true lat/lng**.
  - **Color = dominant watch-dialect** in that city: Haryanvi `#efa73f`, Bhojpuri
    `#e0563f`, Rajasthani `#b07cf0`, Gujarati `#2ecf7a`, Marathi `#ff5d8f`,
    Hindi/other `#4ea8de`.
  - **Brightness / size = live viewers** in that city.
- **Motion:** ambient twinkle + event-bloom when a play lands (the "constellation" feel).
- **Headline counter:** animated "Watching now" count, with a live IST clock.
- **Live ticker:** rolling "‹Show› — ‹City› · in ‹Dialect›" using each city's **actual
  top show**. Content + city + dialect only — never user identity.
- **Dialect legend.**
- **Hover a city:** tooltip — city, #1 show, dialect, live viewers.
- **Zoom + pan** (wheel + drag).

## 3. Content & dialect model

- Content is **dialect-agnostic** — the same title (e.g. *Saanwari*) exists across dialects.
- **Dialect is a property of the watch**, not the title: which language version was watched.
- **`dominantDialect` per city** = the most-watched watch-language there. The map reveals
  regional language preference (Jaipur → Rajasthani, Pune → Marathi, Patna → Bhojpuri).
- **`topShow` per city** = the actual #1 title watched there.

## 4. Data — VERIFIED against the live ClickHouse (connected via MCP)

The brainstorm proved out the real sources by querying ClickHouse directly. Key findings:

- `raw_prod_events.consumption_video_start` (no suffix) is a **stale one-day snapshot**
  (Apr 19–20). It also has no `show_title` and no Khejdi → do NOT use it.
- `raw_prod_events_web.consumption_video_start_web` is a **real full year** (Jun'25–Apr'26)
  with `context_geo_city`, `context_geo_location` (precise "lat,lng"), `dialect`,
  `show_slug` — and **does contain Khejdi** (incl. #1 Marathi web title). Frozen at Apr 20.
- **`raw_prod_events_backend.user_watch_log` is LIVE — current to today** (updates in real
  time). Columns: `content_id`, `context_ip`, `timestamp`, `consumed_duration`, `user_id`.
  This is the live source.
- **Title + dialect join:** `user_watch_log.content_id` → `analytics_prod_core.dim_content`
  (`content_title` / `show_title`, `content_dialect`). Verified on last-2-days data: returns
  current shows (Bhikhaari Bana C.M, Mahapunarjanam, Plus Minus, Contract Marriage…).
  Dialect is reliable; show_title resolves for most rows (some content_ids are
  episode/microdrama-level → title null; refine via `show_id` join later).
- **Geo:** there is NO in-DB geo-IP dictionary. The backend converts `context_ip` → city +
  lat/lng using **MaxMind GeoLite2** (in-process `.mmdb` file, no external API calls).

### Khejdi note (important for expectations)
Khejdi drives **acquisition**, not consumption volume — a movie logs one play, a 50-episode
series logs fifty. So a consumption map is correctly dominated by *Saanwari* / *Akhada* /
*Mahapunarjanam*; Khejdi appears modestly. This is real, not a data error.

## 5. Architecture

```
[ React map UI ]  <-- JSON (poll ~20s) --  [ /api/pulse  (Node on Render) ]
                                                  |  read-only ClickHouse creds
                                                  |  MaxMind GeoLite2 (.mmdb)
                                                  v
              raw_prod_events_backend.user_watch_log  (live)
                 ⋈ analytics_prod_core.dim_content    (title + dialect)
                 + GeoLite2(context_ip) -> city, lat, lng
```

The UI talks only to a `PulseDataSource` interface. Two implementations:
- `LivePulseSource` — fetches `/api/pulse` (production).
- `SeededPulseSource` — the verified Apr web slice, replayed on a day-clock (offline/demo
  fallback, and what the current prototype runs on).

### Backend `/api/pulse` (Node, Render)
Every ~20s (cached), runs a windowed query over the **last N minutes** of `user_watch_log`:
join `dim_content` for title+dialect, geolocate `context_ip` → city, group by city. Returns:

```ts
type Dialect = 'haryanvi'|'bhojpuri'|'rajasthani'|'gujarati'|'marathi'|'hindi';
type PulseSnapshot = {
  totals: { watchersNow: number; citiesLive: number };
  cities: Array<{
    city: string; lat: number; lng: number;
    dominantDialect: Dialect; watchers: number;       // distinct users active in window
    topShow: string;
  }>;
  recentEvents: Array<{ show: string; city: string; dialect: Dialect; ts: number }>;
};
```

- **"Watching now" = live concurrency proxy:** distinct `user_id` with a watch event in the
  last ~5 minutes, per city and total. Real and honest.
- Backend never exposes ClickHouse to the browser; serves only aggregated JSON.

## 6. Tech stack
- **Vite + React + TypeScript** — standalone app.
- **d3-geo** — India projection + plotting cities at lat/lng.
- **Canvas 2D** — glow / pulse / animation (60fps for a few hundred dots).
- **India district GeoJSON** — dim base (already sourced & simplified to ~244KB).
- **Backend:** Node + `@clickhouse/client` (read-only) + `maxmind` (GeoLite2), on Render.
- **Deploy:** frontend static on Render; backend service on Render → public URL for Vinay.

## 7. Scope

### v1 (truly-live consumption map)
- Dark India + live city dots by dominant dialect, brightness = live viewers.
- Ambient + event-bloom animation, headline "Watching now" + IST clock.
- Live ticker of real top shows per city; dialect legend; hover tooltip; zoom/pan.
- `/api/pulse` backed by `user_watch_log` ⋈ `dim_content` + GeoLite2, polled ~20s.
- `SeededPulseSource` fallback (verified Apr slice) so it always renders.

### Deferred
- Acquisition view / toggle (trial events — "where Khejdi wins signups").
- Click → city deep panel (top 5 shows + dialect split).
- Refine episode/microdrama `content_id` → show via `show_id` join for fuller titles.
- Auto camera-tour; time-scrubber / historical playback; dialect filtering.

## 8. Open items (non-blocking)
1. ClickHouse read-only credentials reachable from the Render backend (the MCP proves the
   data exists; the deployed backend needs its own connection string).
2. GeoLite2 license key (free) for the `.mmdb` file.
3. Confirm `user_id` is the right concurrency key (vs `device_id`/`anonymous_id`).

## 9. Privacy
All surfaces show **content + city + dialect only**. No user identity, phone, or PII. City
is the finest geographic unit displayed; IPs are used server-side for geolocation only and
never returned to the browser.
