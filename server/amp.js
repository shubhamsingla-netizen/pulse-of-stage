// Amplitude Dashboard REST (primary source): total + by-city via NN_watching_user.
const AK = process.env.AMP_API_KEY;
const SK = process.env.AMP_SECRET_KEY;
export const hasAmp = !!(AK && SK);
const AUTH = 'Basic ' + Buffer.from(`${AK}:${SK}`).toString('base64');
const EVENT = '{"event_type":"ce:NN_watching_user"}';

function istDate(daysBack = 0) {
  const n = new Date();
  const d = new Date(n.getTime() + n.getTimezoneOffset() * 60000 + 19800000 - daysBack * 864e5);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}
function lastNonZero(a) { if (!Array.isArray(a)) return 0; for (let i = a.length - 1; i >= 0; i--) if (a[i] > 0) return a[i]; return 0; }
// last COMPLETE 5-min bucket: skip the most recent (in-progress, partial) bucket
function lastComplete(a) {
  if (!Array.isArray(a)) return 0;
  const nz = [];
  for (let i = a.length - 1; i >= 0 && nz.length < 3; i--) if (a[i] > 0) nz.push(a[i]);
  return nz.length >= 2 ? nz[1] : (nz[0] || 0);
}

async function seg(extra) {
  const u = new URL('https://amplitude.com/api/2/events/segmentation');
  const p = { e: EVENT, m: 'uniques', start: istDate(0), end: istDate(0), i: '-300000', ...extra };
  for (const [k, v] of Object.entries(p)) u.searchParams.set(k, v);
  const r = await fetch(u, { headers: { Authorization: AUTH }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error('Amplitude ' + r.status + ': ' + (await r.text()).slice(0, 150));
  return (await r.json()).data;
}

export async function ampTotal() {
  const d = await seg({});
  return lastComplete(d.series && d.series[0]);
}
// Top shows from a SAVED Amplitude chart (content_name breakdown). Khejdi-led, live.
export async function ampShows(chartId) {
  const r = await fetch(`https://amplitude.com/api/3/chart/${chartId}/query`, { headers: { Authorization: AUTH }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('Amplitude chart ' + r.status);
  const j = await r.json();
  const rows = [];
  const cr = j && j.data && j.data.csvResponse && j.data.csvResponse.data;
  if (Array.isArray(cr)) {
    for (const row of cr) if (Array.isArray(row) && row.length >= 2 && typeof row[0] === 'string' && !isNaN(Number(row[1]))) rows.push([row[0], Number(row[1])]);
  } else if (j && j.data && Array.isArray(j.data.series)) {
    (j.data.seriesLabels || []).forEach((lab, idx) => rows.push([Array.isArray(lab) ? lab[lab.length - 1] : lab, lastNonZero(j.data.series[idx])]));
  }
  const DEV = /[ऀ-ॿ]/, map = new Map();
  for (let [name, v] of rows) {
    name = String(name).replace(/[\x00-\x1F]/g, '').trim();
    if (!name || name === '(none)' || /^Episode\s+\d+$/i.test(name) || DEV.test(name)) continue;
    map.set(name, (map.get(name) || 0) + v);
  }
  return [...map].map(([title, viewers]) => ({ title, viewers: Math.round(viewers) })).sort((a, b) => b.viewers - a.viewers).slice(0, 8);
}
export async function ampCities() {
  const d = await seg({ g: 'city', limit: '100' });
  const labels = d.seriesLabels || [];
  const out = [];
  labels.forEach((lab, idx) => {
    const city = Array.isArray(lab) ? lab[lab.length - 1] : lab;
    const v = lastComplete(d.series && d.series[idx]);
    if (v > 0 && city && city !== '(none)') out.push({ city, viewers: v });
  });
  return out.sort((a, b) => b.viewers - a.viewers).slice(0, 90);
}
