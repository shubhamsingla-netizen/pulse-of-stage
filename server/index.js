import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// minimal .env loader (local only; Render injects real env)
try {
  const envPath = path.join(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
} catch {}

const { ampTotal, ampCities, hasAmp } = await import('./amp.js');
const { buildPulse, buildShows, hasCH } = await import('./ch.js');
const { geocodeCity } = await import('./geo.js');
const seed = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed.json'), 'utf8'));

async function buildSnapshot() {
  if (hasAmp) {
    try {
      const [total, cityRows] = await Promise.all([ampTotal(), ampCities()]);
      const cities = [];
      for (const r of cityRows) {
        const g = geocodeCity(r.city);
        if (g) cities.push({ city: r.city, lat: g.lat, lng: g.lng, dialect: g.dialect, viewers: r.viewers });
      }
      let topShows = seed.topShows;
      if (hasCH) { try { topShows = await buildShows(); } catch (e) { console.error('[shows] CH failed:', e.message); } }
      return { ts: Date.now(), total, cities, topShows, source: 'amplitude' };
    } catch (e) { console.error('[pulse] Amplitude failed, falling back:', e.message); }
  }
  if (hasCH) { try { const p = await buildPulse(); return { ...p, source: 'clickhouse' }; } catch (e) { console.error('[pulse] ClickHouse failed:', e.message); } }
  return { ...seed, stale: true, ts: Date.now() };
}

let snap = { ...seed, ts: Date.now() };
let refreshing = false;
async function refresh() {
  if (refreshing) return; refreshing = true;
  try { snap = await buildSnapshot(); } catch (e) { console.error('[pulse]', e.message); }
  finally { refreshing = false; }
}

const app = express();
app.get('/api/pulse', (req, res) => { res.set('Cache-Control', 'no-store'); res.json(snap); });
app.get('/healthz', (req, res) => res.json({ ok: true, amplitude: hasAmp, clickhouse: hasCH, source: snap.source || 'seed', total: snap.total, cities: snap.cities?.length }));
app.use(express.static(path.join(__dirname, '../public')));

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => {
  console.log(`pulse on :${PORT}  amplitude=${hasAmp} clickhouse=${hasCH}`);
  refresh();                      // first load in background (serves seed until ready)
  setInterval(refresh, 60_000);
});
