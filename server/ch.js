import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GAZ = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/cities_meta.json'), 'utf8'));

const HOST = process.env.CLICKHOUSE_HOST;
const PORT = process.env.CLICKHOUSE_PORT || '8443';
const USER = process.env.CLICKHOUSE_USER || 'default';
const PASS = process.env.CLICKHOUSE_PASSWORD || '';
const DB   = process.env.CLICKHOUSE_DATABASE || 'default';
const PROTO = process.env.CLICKHOUSE_PROTOCOL || (PORT === '8443' ? 'https' : 'http');
export const hasCH = !!HOST;

const DMAP = { har: 'haryanvi', raj: 'rajasthani', bho: 'bhojpuri', guj: 'gujarati', mar: 'marathi' };
const ALIAS = { sonepat: 'sonipat', gurgaon: 'gurugram', bangalore: 'bengaluru' };

function norm(s) {
  try { s = decodeURIComponent(s); } catch {}
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E]/g, '').toLowerCase().trim();
}
function geocode(name) { let k = norm(name); k = ALIAS[k] || k; return GAZ[k] || null; }

async function ch(sql) {
  const url = `${PROTO}://${HOST}:${PORT}/?database=${encodeURIComponent(DB)}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64'),
      'Content-Type': 'text/plain',
    },
    body: sql + ' FORMAT JSON',
  });
  if (!r.ok) throw new Error('ClickHouse ' + r.status + ': ' + (await r.text()).slice(0, 200));
  return (await r.json()).data;
}

const WL = 'raw_prod_events_backend.user_watch_log';
const MT = `(SELECT max(timestamp) FROM ${WL})`;
const WINDOW = '15 MINUTE';

const Q_TOTAL = `SELECT uniqExact(user_id) AS total FROM ${WL} WHERE timestamp > ${MT} - INTERVAL ${WINDOW}`;

const Q_CITIES = `WITH ${MT} AS mt
SELECT u.current_city AS city, uniqExact(w.user_id) AS viewers, topK(1)(d.content_dialect)[1] AS dialect
FROM ${WL} w
LEFT JOIN analytics_prod_core.dim_users u ON w.user_id = u.user_id
LEFT JOIN analytics_prod_core.dim_content d ON toInt32OrNull(w.content_id) = d.content_id
WHERE w.timestamp > mt - INTERVAL ${WINDOW} AND u.current_city != '' AND u.current_city IS NOT NULL
GROUP BY city HAVING viewers >= 3 ORDER BY viewers DESC LIMIT 90`;

const Q_SHOWS = `WITH ${MT} AS mt
SELECT d.show_title AS title, uniqExact(w.user_id) AS viewers
FROM ${WL} w
INNER JOIN analytics_prod_core.dim_content d ON toInt32OrNull(w.content_id) = d.content_id
WHERE w.timestamp > mt - INTERVAL ${WINDOW} AND d.show_title NOT IN ('', 'NA') AND d.show_title IS NOT NULL
GROUP BY title ORDER BY viewers DESC LIMIT 10`;

export async function buildPulse() {
  const [t, cs, ss] = await Promise.all([ch(Q_TOTAL), ch(Q_CITIES), ch(Q_SHOWS)]);
  const total = Number(t[0]?.total || 0);
  const cities = [];
  let dropped = 0;
  for (const r of cs) {
    const ll = geocode(r.city);
    if (!ll) { dropped++; continue; }
    cities.push({ city: r.city, lat: ll[0], lng: ll[1], dialect: DMAP[r.dialect] || 'hindi', viewers: Number(r.viewers) });
  }
  if (dropped) console.log(`[pulse] ${dropped} cities not in gazetteer (skipped)`);
  const topShows = cleanShows(ss);
  return { ts: Date.now(), total, cities, topShows };
}

function cleanShows(rows) {
  const DEV = /[ऀ-ॿ]/, seen = new Set(), out = [];
  for (const r of rows) {
    const t = String(r.title).replace(/[\x00-\x1F]/g, '').trim();
    if (!t || DEV.test(t)) continue;            // drop devanagari dups (Latin equivalents present)
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ title: t, viewers: Number(r.viewers) });
  }
  return out.slice(0, 8);
}
export async function buildShows() {
  return cleanShows(await ch(Q_SHOWS));
}
