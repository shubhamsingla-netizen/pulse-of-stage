# Pulse of India — Stage Live Watch-Map (Design Spec)

**Date:** 2026-06-13
**Author:** Shubham Singla (PM, Stage)
**Status:** Approved design — ready for implementation plan

## 1. Purpose

A cinematic, live-feeling "Pulse of India" map for leadership demos and all-hands. It
shows, at a glance, where across India people are watching Stage right now and in which
dialect. Optimized for **impact and storytelling**, not deep analysis. Primary audience:
Vinay / leadership. Success = "show this to Vinay" reaction.

## 2. What it shows

Single full-bleed dark page. The hero is India at night.

- **Base map:** real India outline with district boundaries (GeoJSON), dimmed so it reads
  as "night India."
- **District nodes:** one glowing dot per district, placed at its true centroid.
  - **Color = dominant watch-dialect** in that district (which language version wins
    there): Haryanvi (gold `#efa73f`), Bhojpuri (warm-red `#e0563f`), Rajasthani
    (violet `#b07cf0`), Gujarati (green `#2ecf7a`), Hindi/other (blue `#4ea8de`).
  - **Brightness / size = people watching now** in that district.
- **Motion:** ambient twinkle so the map is always alive; when a watch event lands in a
  district, that node blooms briefly (the "constellation" feel).
- **Headline counter (top):** animated count-up — e.g. "12,480 watching across 412
  districts."
- **Live ticker (side panel):** rolling feed — "Saanwari just started in Rohtak ·
  Bahadhur in Patna …". Shows **content + district + dialect only — never user identity.**
- **Dialect legend:** clicking a dialect spotlights only those districts.
- **Hover a district:** tooltip with district name, dominant dialect, #1 title, watcher
  count.

## 3. Content & dialect model (important)

Content is **dialect-agnostic**. A title such as *Saanwari* exists in every dialect.
Therefore:

- **Dialect is a property of the watch, not the title** — it is which dialect/language
  version a user chose to watch in.
- **`dominantDialect` per district** = the most-watched watch-language there. The same
  shows can play everywhere; the map reveals *regional language preference*
  (Rohtak watches in Haryanvi, Patna in Bhojpuri).
- **`topTitles` per district** = plain titles (no dialect attached), with an optional
  per-title dialect breakdown shown on detail.

## 4. Architecture

Three layers with one critical seam — the UI never knows where data comes from.

```
[ React map UI ]  <-- JSON --  [ PulseDataSource interface ]
                                      |-- SeededPulseSource  (realistic values, runs today)
                                      |-- ClickHousePulseSource (real backend; swap-in later)
```

The UI talks only to `PulseDataSource`. Going from seeded to live ClickHouse is a
**one-line config swap**, no UI changes.

### Data contract (fixed now, identical for both sources)

```ts
type Dialect = 'haryanvi' | 'bhojpuri' | 'rajasthani' | 'gujarati' | 'hindi';

type PulseSnapshot = {
  totals: { watchersNow: number; districtsLive: number };
  districts: Array<{
    id: string;              // district code (matches GeoJSON feature id)
    name: string;
    centroid: [number, number];  // [lng, lat]
    dominantDialect: Dialect;
    watchers: number;            // concurrent watchers now
    topTitles: Array<{ title: string; watchers: number }>;  // dialect-agnostic
  }>;
  recentEvents: Array<{          // feeds the ticker, newest last
    title: string;
    district: string;
    dialect: Dialect;
    ts: number;                  // epoch ms
  }>;
};
```

## 5. Data strategy — real query, seeded values now, live later

Decision: **build against the real ClickHouse aggregation and the real district list now,
seeded with realistic values so it runs today; swap to the live connection when read-only
access is granted.** Rationale: wiring a public app to production ClickHouse needs network +
security coordination (credentials, IP allowlist) outside one person's control; building the
real query + structure now makes go-live a switch-flip, not a rebuild, and yields a
demo-able artifact this week.

### Seeded source (v1, ships now)

- District names + centroids come from the **real India district GeoJSON** (honest geography).
- Each district gets a **regional dialect bias** (Haryana→Haryanvi, Bihar/east-UP→Bhojpuri,
  Rajasthan→Rajasthani, Gujarat→Gujarati, else Hindi) so the map looks believable.
- A small pool of **real Stage titles** (dialect-agnostic), e.g. Saanwari + others Shubham
  provides.
- A **simulation loop** generates weighted watch events over time so counts rise/fall, the
  ticker flows, and nodes pulse — looks genuinely live.

### ClickHouse source (v2, swap-in)

- A small Node service holds read-only ClickHouse credentials, runs the
  district→dialect→title aggregation on an interval, caches it, and serves the same
  `PulseSnapshot` JSON at `/api/pulse`.
- Frontend polls every N seconds.
- **Open item:** confirm exact ClickHouse table + column names (district, watch-dialect,
  title, timestamp, session/user) when access is provided. The SQL is written against
  assumed columns until then.

## 6. Tech stack

- **Vite + React + TypeScript** — lightweight standalone app, faster than Next.js for a
  self-contained viz.
- **d3-geo** — India projection + placing dots at district centroids.
- **Canvas 2D** — glow / pulse / animation (handles a few hundred glowing dots at 60fps with
  full aesthetic control). deck.gl/WebGL is the upgrade path if richer bloom is wanted later.
- **India district GeoJSON** — public dataset (to be sourced).
- **Deploy:** Render static site (Shubham's usual) → public URL to share with Vinay.

## 7. Scope

### In v1 (the demo-able wow-piece)
- Real India outline + district dots colored by dominant watch-dialect, brightness = watchers.
- Ambient twinkle + event-bloom animation.
- Headline animated count-up.
- Live ticker (content + district + dialect).
- Dialect legend with spotlight-on-click.
- Hover tooltip per district.
- `PulseDataSource` interface with `SeededPulseSource` implementation + the real SQL written
  out (unused until access).

### Deferred (clean follow-ups)
- `ClickHousePulseSource` live backend behind the same interface (step 2).
- Click → district deep panel (top 3 titles + dialect split) — v1.1.
- Auto camera-tour between hotspots; time-scrubber / historical playback; dialect filtering.

## 8. Open items (do not block design)
1. Source an India district GeoJSON (Shubham OK with a public one; Claude to fetch).
2. Real Stage title list per region (Shubham to provide; else seed with known titles —
   Saanwari, etc.).
3. Exact ClickHouse table/column names — confirmed when read-only access is granted.

## 9. Privacy
The ticker and all surfaces show **content + geography + dialect only**. No user identity,
phone, or PII ever appears. District is the finest geographic unit shown.
