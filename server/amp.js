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
const DEV = /[ऀ-ॿ]/;
export async function ampShows(chartId) {
  const r = await fetch(`https://amplitude.com/api/3/chart/${chartId}/query`, { headers: { Authorization: AUTH }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('Amplitude chart ' + r.status);
  const data = (await r.json()).data || {};
  const labels = data.seriesLabels || [];
  const series = data.series || [];
  const map = new Map();
  for (let i = 0; i < series.length; i++) {
    let lab = labels[i]; lab = Array.isArray(lab) ? lab[lab.length - 1] : lab;
    const name = String(lab || '').replace(/[\x00-\x1F]/g, '').trim();
    if (!name || name === '(none)' || /^Episode\s+\d+$/i.test(name) || DEV.test(name)) continue;
    const vals = (series[i] || []).map((x) => (x && typeof x === 'object') ? (x.value || 0) : (x || 0));
    map.set(name, (map.get(name) || 0) + lastComplete(vals));
  }
  return [...map].map(([title, viewers]) => ({ title, viewers: Math.round(viewers) }))
    .sort((a, b) => b.viewers - a.viewers).slice(0, 10);
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
