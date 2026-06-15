# Pulse of India — Stage Live Watch-Map (Design Spec)

**Date:** 2026-06-13 (updated through prototype validation)
**Author:** Shubham Singla (PM, Stage)
**Status:** Prototype validated on real data — ready for implementation plan

## 1. Purpose

A cinematic, live "Pulse of India" map for leadership demos and all-hands: where across
India people are watching Stage right now, in which dialect, and what's hot. Optimized for
impact and storytelling. Audience: Vinay / leadership. Measures **consumption** (what's
being watched), not acquisition.

## 2. What's on screen (validated in the prototype)

- **Dark India base** (district GeoJSON), dimmed — only cities with real viewers glow.
- **City nodes** at true lat/lng, **colored by dominant watch-dialect** (Haryanvi gold,
  Bhojpuri red, Rajasthani violet, Gujarati green, Marathi pink, Hindi/other blue),
  **sized/brightened by live viewers**. Soft glow (tuned down — no harsh sparkle).
- **Top-left HUD:** "Watching now" = the real total for the current time, a live IST clock,
  cities-live count, and a **"🔥 #1 now"** line (the top show).
- **Right panel — "Top shows now" leaderboard** (replaces the old per-second ticker):
  ranked shows with bars; each number is that show's share of the live total, so the panel
  reconciles with the headline. Khejdi sits #1.
- **Interactions:** wheel-zoom, drag-pan, hover a city → its dialect + live viewers.
- All numbers are ONE consistent metric (live concurrency); per-city values sum to the
  headline total. No per-second noise.

## 3. Content & dialect model

Content is dialect-agnostic (same title across dialects). **Dialect = the watch-language**,
not a property of the title. `dominantDialect` per city = the most-watched language there.

## 4. Data — VALIDATED. Live source = Amplitude.

The map is driven by **Amplitude** (project `255032`, Mobile App – Prod), event
**`ce:NN_watching_user`** (Stage's "currently watching" custom event). Three real feeds,
confirmed by querying Amplitude live:

| Feed | Amplitude chart (validated) | Drives |
|------|------------------------------|--------|
| **Total live** | `j0m5zxal` — Current Uniques of `consumption_video_start`, 5-min, IST. Real intraday curve: ~25 at 4 AM → ~350 peak afternoon/evening. | Headline "Watching now" by time of day |
| **By city** | `6a3mklxy` / `2n2t7lpk` — `NN_watching_user` uniques grouped by `[Amplitude] City` (30-day & live 5-min) | City dot sizes + per-city tooltip (as shares of total) |
| **By content** | `963e0apu` — `NN_watching_user` uniques grouped by `content_name` (ignore "(none)") | Leaderboard. **Khejdi #1 (~154), then Saanwari (~83), Naate (~64)** |

**Key data findings (important for the backend):**
- `content_name` exists ONLY on `ce:NN_watching_user`. The standard `consumption_video_start`
  event has show identity EMPTY (`show_title`/`content_name` = "(none)").
- Amplitude's **ad-hoc query API rejects the custom event** `ce:NN_watching_user` — so the
  backend must read these via the **saved-chart / Dashboard REST API** (the charts above) or
  the Export API, NOT ad-hoc segmentation.
- Amplitude double-counts the same show across scripts (Khejdi + खेजड़ी; Saanwari + साँवरी)
  and emits junk values ("(none)", "Episode N") — the backend must **merge script variants
  and filter junk**.
- City names arrive percent-encoded / with diacritics (Sonīpat, Karnāl) — normalize.
- Geo is **city-level only** in Amplitude (no lat/lng) — geocode city → coordinates (a
  static gazetteer; ~98% of volume covered by ~140 cities). Prototype geocodes via a
  city→centroid table.

**Khejdi note:** Khejdi leads *live consumption* in Amplitude (`NN_watching_user`). It did
NOT appear in the older ClickHouse `consumption_video_start` snapshot — that table was a
stale Apr sample. Trust Amplitude for the live picture.

## 5. Architecture

```
[ React map UI ]  <-- JSON (poll ~30s) --  [ /api/pulse  (Node on Render) ]
                                                 |  Amplitude Dashboard REST API
                                                 |  (charts j0m5zxal, 2n2t7lpk, 963e0apu)
                                                 |  + city→latlng gazetteer
                                                 |  + script-variant merge / junk filter
```

UI talks only to a `PulseDataSource`:
- `LivePulseSource` — fetches `/api/pulse` (production).
- `SeededPulseSource` — the validated real snapshot (today's Amplitude curve + city/content
  values) replayed on the live clock. This is what the current prototype runs on, and the
  offline/demo fallback.

### `/api/pulse` (Node, Render), refreshed ~30s
Reads the three Amplitude charts via the Dashboard REST API, merges/cleans, geocodes cities,
returns:
```ts
type Dialect='haryanvi'|'bhojpuri'|'rajasthani'|'gujarati'|'marathi'|'hindi';
type PulseSnapshot={
  totals:{ watchingNow:number };                                  // chart j0m5zxal current bucket
  cities:Array<{city:string;lat:number;lng:number;dominantDialect:Dialect;watchers:number}>;
  topShows:Array<{title:string;watchers:number;dialect?:Dialect}>;// chart 963e0apu, cleaned
};
```
- `watchingNow` = current 5-min bucket of the Current-Uniques chart (real, time-accurate).
- Per-city `watchers` = total × city share; sums to `watchingNow`.
- Browser never sees Amplitude credentials.

## 6. Tech stack
- **Vite + React + TypeScript**; **d3-geo** projection; **Canvas 2D** glow/animation.
- India district GeoJSON (dim base, simplified ~244KB) + city→latlng gazetteer.
- Backend: Node + Amplitude Dashboard REST API client, on Render. Frontend static on Render.

## 7. Scope

### v1 (truly-live consumption map)
- Dark India + live city dots by dominant dialect, sized by live viewers, soft glow.
- HUD: real "Watching now" (time-accurate), live IST clock, "🔥 #1 now".
- **Top-shows leaderboard** (shares of total), Khejdi-led.
- Hover tooltip; zoom/pan.
- `/api/pulse` over the three Amplitude charts (clean + geocode), polled ~30s; seeded
  fallback so it always renders.

### Deferred (backend-dependent)
- **Click-to-spotlight (show → its cities).** Needs `content_name × city` on the same row,
  which only the raw-event backend can compute (Amplitude ad-hoc can't; ClickHouse web table
  covers a different/older show set and is thin on Khejdi). Build once the backend exposes it.
- **Dialect-tinted leaderboard bars** — needs authoritative content→dialect from the backend
  (avoid guessing).
- Day-timeline scrubber; city drill-down; acquisition view (Khejdi signups).

## 8. Open items (non-blocking)
1. Backend Amplitude API credentials (Dashboard REST API key/secret for project 255032).
2. Confirm the canonical id for the `NN_watching_user` custom event for backend queries.
3. Authoritative content→dialect mapping (for bar tints + spotlight).

## 9. Privacy
Surfaces show **content + city + dialect only** — no user identity or PII. City is the
finest geographic unit displayed.
