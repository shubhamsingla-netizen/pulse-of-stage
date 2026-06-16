import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GAZ = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/cities_meta.json'), 'utf8'));
const ALIAS = { sonepat: 'sonipat', gurgaon: 'gurugram', bangalore: 'bengaluru', allahabad: 'prayagraj' };

function norm(s) {
  try { s = decodeURIComponent(s); } catch {}
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E]/g, '').toLowerCase().trim();
}
export function geocodeCity(name) {
  let k = norm(name); k = ALIAS[k] || k;
  return GAZ[k] || null; // { lat, lng, dialect }
}
