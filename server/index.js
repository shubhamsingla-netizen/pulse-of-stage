import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPulse, hasCH } from './ch.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed.json'), 'utf8'));

let snap = { ...seed, ts: Date.now() };

async function refresh() {
  if (!hasCH) { snap = { ...seed, stale: true, ts: Date.now() }; return; }
  try { snap = await buildPulse(); }
  catch (e) { console.error('[pulse] refresh failed:', e.message); snap = { ...seed, stale: true, ts: Date.now() }; }
}
refresh();
setInterval(refresh, 60_000);

const app = express();
app.get('/api/pulse', (req, res) => { res.set('Cache-Control', 'no-store'); res.json(snap); });
app.get('/healthz', (req, res) => res.json({ ok: true, live: hasCH, stale: !!snap.stale }));
app.use(express.static(path.join(__dirname, '../public')));

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => console.log(`pulse on :${PORT} [${hasCH ? 'LIVE clickhouse' : 'SEED fallback'}]`));
