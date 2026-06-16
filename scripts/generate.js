// Run by GitHub Actions on a schedule: query Amplitude (+ ClickHouse fallback),
// write public/pulse.json. Secrets come from Actions env. No deps.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { ampTotal, ampCities, ampShows, hasAmp } = await import('../server/amp.js');
const { buildPulse, hasCH } = await import('../server/ch.js');
const { geocodeCity } = await import('../server/geo.js');
const seed = JSON.parse(fs.readFileSync(path.join(__dirname, '../server/seed.json'), 'utf8'));

async function build() {
  if (hasAmp) {
    try {
      const [total, cityRows] = await Promise.all([ampTotal(), ampCities()]);
      const cities = [];
      for (const r of cityRows) {
        const g = geocodeCity(r.city);
        if (g) cities.push({ city: r.city, lat: g.lat, lng: g.lng, dialect: g.dialect, viewers: r.viewers });
      }
      let topShows = seed.topShows;
      if (process.env.AMP_CONTENT_CHART_ID) {
        try { topShows = await ampShows(process.env.AMP_CONTENT_CHART_ID); }
        catch (e) { console.error('[shows] amp chart failed:', e.message); }
      }
      return { ts: Date.now(), total, cities, topShows, source: 'amplitude' };
    } catch (e) { console.error('[gen] Amplitude failed:', e.message); }
  }
  if (hasCH) { try { const p = await buildPulse(); return { ...p, source: 'clickhouse' }; } catch (e) { console.error('[gen] ClickHouse failed:', e.message); } }
  return { ...seed, stale: true, ts: Date.now() };
}

const snap = await build();
// keep headline >= sum of top shows (whole >= its parts)
snap.total = Math.max(snap.total || 0, (snap.topShows || []).reduce((a, x) => a + (x.viewers || 0), 0));
const out = path.join(__dirname, '../public/pulse.json');
fs.writeFileSync(out, JSON.stringify(snap));
console.log('wrote pulse.json:', snap.source, '| total', snap.total, '| cities', snap.cities.length, '| shows', snap.topShows.length);
