/**
 * Builds the game board artwork from district boundaries.
 *
 *   node tools/map-build/build.mjs
 *
 * 1. Assigns each of the 641 census-2011 districts to one of the 42 territories.
 * 2. Dissolves districts into territories and territories into regions (mapshaper).
 * 3. Compares the borders the shapes actually share with the game's adjacency list.
 * 4. Writes packages/web/src/mapShapes.json: SVG paths and token positions.
 *
 * Boundary data: DataMeet India community, github.com/datameet/maps,
 * Districts/Census_2011, Creative Commons Attribution 2.5 India.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import mapshaper from 'mapshaper';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const build = join(here, 'build');
mkdirSync(build, { recursive: true });
process.chdir(here); // mapshaper command strings cannot contain paths with spaces
const gameMap = JSON.parse(readFileSync(join(root, 'packages/engine/src/map.json'), 'utf8'));

// ------------------------------------------------- 1. districts -> territories

const WHOLE_STATES = {
  'Andaman & Nicobar Island': 'AND', 'Arunanchal Pradesh': 'ARU', Assam: 'ASM', Bihar: 'BIH', Chandigarh: 'PUN',
  Chhattisgarh: 'CHH', 'Dadara & Nagar Havelli': 'GUJ', Goa: 'KON', Haryana: 'HAR', 'Himachal Pradesh': 'HIM',
  Jharkhand: 'JHA', Kerala: 'KER', Lakshadweep: 'LAK', Manipur: 'MAN', Meghalaya: 'MEG', Mizoram: 'MIZ',
  'NCT of Delhi': 'DEL', Nagaland: 'NAG', Odisha: 'ODI', Punjab: 'PUN', Sikkim: 'SIK', Tripura: 'TRI',
  Uttarakhand: 'UTK',
};

/** For split states: every territory but the last lists its districts; the last takes the rest. */
const SPLIT_STATES = {
  'Jammu & Kashmir': { LAD: ['Leh (ladakh)', 'Kargil'], JNK: null },
  'Daman & Diu': { KUT: ['Diu'], GUJ: null },
  // North Bengal is the Siliguri corridor: the only land link to the Northeast.
  'West Bengal': { NBN: ['Darjiling', 'Jalpaiguri', 'Koch Bihar'], BEN: null },
  Puducherry: { PAN: ['Karaikal'], KER: ['Mahe'], CAP: ['Yanam'], TON: null },
  'Uttar Pradesh': {
    BRJ: ['Saharanpur', 'Muzaffarnagar', 'Bijnor', 'Meerut', 'Baghpat', 'Ghaziabad', 'Gautam Buddha Nagar', 'Bulandshahr',
      'Aligarh', 'Mahamaya Nagar', 'Mathura', 'Agra', 'Firozabad', 'Mainpuri', 'Etah', 'Kansiram Nagar', 'Budaun',
      'Bareilly', 'Pilibhit', 'Rampur', 'Moradabad', 'Jyotiba Phule Nagar', 'Shahjahanpur', 'Farrukhabad', 'Etawah',
      'Auraiya', 'Kannauj'],
    PUR: ['Allahabad', 'Sant Ravi Das Nagar(bhadohi)', 'Mirzapur', 'Sonbhadra', 'Varanasi', 'Chandauli', 'Ghazipur',
      'Jaunpur', 'Azamgarh', 'Mau', 'Ballia', 'Deoria', 'Kushinagar', 'Gorakhpur', 'Maharajganj', 'Sant Kabir Nagar',
      'Basti', 'Siddharth Nagar'],
    AWD: null,
  },
  Rajasthan: {
    THR: ['Ganganagar', 'Hanumangarh', 'Bikaner', 'Churu', 'Jhunjhunun', 'Sikar', 'Nagaur', 'Jodhpur', 'Jaisalmer',
      'Barmer', 'Jalor', 'Pali', 'Sirohi'],
    ARV: null,
  },
  Gujarat: {
    KUT: ['Kachchh', 'Jamnagar', 'Porbandar', 'Junagadh', 'Amreli', 'Bhavnagar', 'Rajkot', 'Surendranagar'],
    GUJ: null,
  },
  'Madhya Pradesh': {
    MHK: ['Tikamgarh', 'Chhatarpur', 'Panna', 'Sagar', 'Damoh', 'Satna', 'Rewa', 'Sidhi', 'Singrauli', 'Shahdol',
      'Umaria', 'Anuppur', 'Katni', 'Jabalpur', 'Narsimhapur', 'Mandla', 'Dindori', 'Seoni', 'Balaghat', 'Chhindwara'],
    MAL: null,
  },
  Maharashtra: {
    KON: ['Thane', 'Mumbai', 'Mumbai Suburban', 'Raigarh', 'Ratnagiri', 'Sindhudurg'],
    VID: ['Buldana', 'Akola', 'Washim', 'Amravati', 'Yavatmal', 'Wardha', 'Nagpur', 'Bhandara', 'Gondiya', 'Chandrapur',
      'Garhchiroli'],
    DSH: null,
  },
  'Andhra Pradesh': {
    TEL: ['Adilabad', 'Nizamabad', 'Karimnagar', 'Medak', 'Warangal', 'Khammam', 'Nalgonda', 'Mahbubnagar', 'Rangareddy',
      'Hyderabad'],
    RAY: ['Kurnool', 'Anantapur', 'Y.s.r.', 'Chittoor'],
    CAP: null,
  },
  Karnataka: {
    NKA: ['Belgaum', 'Bagalkot', 'Bijapur', 'Gulbarga', 'Yadgir', 'Bidar', 'Raichur', 'Koppal', 'Gadag', 'Dharwad',
      'Haveri', 'Bellary', 'Uttara Kannada'],
    MYS: null,
  },
  'Tamil Nadu': {
    TON: ['Chennai', 'Thiruvallur', 'Kancheepuram', 'Vellore', 'Tiruvannamalai', 'Viluppuram', 'Cuddalore', 'Krishnagiri',
      'Dharmapuri', 'Salem'],
    PAN: null,
  },
};

function territoryFor(state, district) {
  if (WHOLE_STATES[state]) return WHOLE_STATES[state];
  const split = SPLIT_STATES[state];
  if (!split) throw new Error(`No rule for state "${state}" (district "${district}")`);
  for (const [terr, list] of Object.entries(split)) if (list === null || list.includes(district)) return terr;
  throw new Error('unreachable');
}

const csvCell = (s) => `"${String(s).replace(/"/g, '""')}"`;
const regionOf = Object.fromEntries(gameMap.territories.map((t) => [t.id, t.region ?? 'outposts']));

const listing = await mapshaper.applyCommands('-i data/2011_Dist.shp -o format=json districts.json');
const districts = JSON.parse(listing['districts.json']);

// Catch typos: every district named in a rule must exist in the data.
for (const [state, split] of Object.entries(SPLIT_STATES)) {
  const names = new Set(districts.filter((d) => d.ST_NM === state).map((d) => d.DISTRICT));
  for (const list of Object.values(split)) {
    for (const name of list ?? []) if (!names.has(name)) throw new Error(`"${name}" is not a district of ${state}`);
  }
}
const rows = ['k,terr,region'];
const counts = {};
for (const d of districts) {
  const terr = territoryFor(d.ST_NM, d.DISTRICT);
  counts[terr] = (counts[terr] ?? 0) + 1;
  rows.push([`${d.ST_NM}|${d.DISTRICT}`, terr, regionOf[terr]].map(csvCell).join(','));
}
for (const t of gameMap.territories) if (!counts[t.id]) throw new Error(`Territory ${t.id} has no districts`);
writeFileSync(join(build, 'assign.csv'), rows.join('\n'));
console.log(`Assigned ${districts.length} districts to ${Object.keys(counts).length} territories.`);

// ------------------------------------------------------ 2. dissolve and simplify

const PROJ = '+proj=lcc +lat_1=12 +lat_2=32 +lat_0=22 +lon_0=82 +datum=WGS84';
await mapshaper.runCommands(
  [
    '-i data/2011_Dist.shp',
    `-each "k = ST_NM + '|' + DISTRICT"`,
    `-join build/assign.csv keys=k,k string-fields=k,terr,region`,
    `-proj ${PROJ}`,
    '-dissolve terr copy-fields=region',
    '-simplify dp interval=2600 keep-shapes',
    '-clean',
    `-o build/territories.topojson format=topojson no-quantization`,
    `-o build/territories.geojson format=geojson`,
    '-dissolve region',
    `-o build/regions.geojson format=geojson`,
  ].join(' '),
);

// ----------------------------------------------------------- 3. check borders

const topo = JSON.parse(readFileSync(join(build, 'territories.topojson'), 'utf8'));
const layer = Object.values(topo.objects)[0];
const arcOwners = new Map();
for (const g of layer.geometries) {
  const flat = JSON.stringify(g.arcs).match(/-?\d+/g).map(Number);
  for (const a of flat) {
    const i = a < 0 ? ~a : a;
    if (!arcOwners.has(i)) arcOwners.set(i, new Set());
    arcOwners.get(i).add(g.properties.terr);
  }
}
function arcPoints(i) {
  const pts = topo.arcs[i];
  if (!topo.transform) return pts;
  const { scale, translate } = topo.transform;
  let x = 0;
  let y = 0;
  return pts.map(([dx, dy]) => [(x += dx) * scale[0] + translate[0], (y += dy) * scale[1] + translate[1]]);
}
function arcLengthKm(i) {
  const pts = arcPoints(i);
  let len = 0;
  for (let j = 1; j < pts.length; j++) len += Math.hypot(pts[j][0] - pts[j - 1][0], pts[j][1] - pts[j - 1][1]);
  return len / 1000;
}
const shared = new Map();
for (const [i, owners] of arcOwners) {
  if (owners.size !== 2) continue;
  const key = [...owners].sort().join('-');
  shared.set(key, (shared.get(key) ?? 0) + arcLengthKm(i));
}
const gameLand = new Set(gameMap.land.map(([a, b]) => [a, b].sort().join('-')));
const problems = [];
// Territories whose shapes meet only at a short stretch and which the game deliberately does not connect.
const WALLS = gameMap.walls ?? [];
const NOT_CROSSINGS = new Set(['BRJ-HIM', 'ODI-TEL', ...WALLS.map((w) => [w.a, w.b].sort().join('-'))]);
for (const [key, km] of shared) if (!gameLand.has(key) && !NOT_CROSSINGS.has(key)) problems.push(`shapes touch but game has no border: ${key} (${km.toFixed(0)} km)`);
for (const key of gameLand) if (!shared.has(key)) problems.push(`game border with no shared boundary:    ${key}`);
if (problems.length) process.exitCode = 1;
console.log(problems.length ? `Border mismatches:\n  ${problems.join('\n  ')}` : 'Shapes and game borders agree.');

// ------------------------------------------------------------- 4. SVG artwork

const WIDTH = 1000;
const PAD = 24;
const MIN_RING_AREA = 6; // px²; smaller islands are dropped unless they are all a territory has
const terrGeo = JSON.parse(readFileSync(join(build, 'territories.geojson'), 'utf8'));
const regionGeo = JSON.parse(readFileSync(join(build, 'regions.geojson'), 'utf8'));

const polygonsOf = (geom) => (geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates);
let minX = Infinity;
let maxX = -Infinity;
let minY = Infinity;
let maxY = -Infinity;
for (const f of terrGeo.features)
  for (const poly of polygonsOf(f.geometry))
    for (const [x, y] of poly[0]) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
const scale = (WIDTH - 2 * PAD) / (maxX - minX);
const HEIGHT = Math.ceil((maxY - minY) * scale + 2 * PAD);
const px = ([x, y]) => [(x - minX) * scale + PAD, (maxY - y) * scale + PAD];
const r1 = (n) => Math.round(n * 10) / 10;

function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  return Math.abs(a / 2);
}
function toPixels(geom) {
  const polys = polygonsOf(geom)
    .map((poly) => poly.map((ring) => ring.map(px)))
    .sort((a, b) => ringArea(b[0]) - ringArea(a[0]));
  return polys.filter((p, i) => i === 0 || ringArea(p[0]) >= MIN_RING_AREA);
}
function pathOf(polys) {
  return polys
    .map((poly) => poly.map((ring) => `M${ring.map(([x, y]) => `${r1(x)} ${r1(y)}`).join('L')}Z`).join(''))
    .join('');
}
function distToRings(p, rings) {
  let best = Infinity;
  for (const ring of rings)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, ay] = ring[j];
      const [bx, by] = ring[i];
      const dx = bx - ax;
      const dy = by - ay;
      const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy || 1)));
      best = Math.min(best, Math.hypot(p[0] - ax - t * dx, p[1] - ay - t * dy));
    }
  return best;
}
function inside(p, rings) {
  let inPoly = false;
  for (const ring of rings)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inPoly = !inPoly;
    }
  return inPoly;
}
/** The point inside a polygon that is farthest from its edge: where the army token sits. */
function labelPoint(rings) {
  const xs = rings[0].map((p) => p[0]);
  const ys = rings[0].map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  let best = [(x0 + x1) / 2, (y0 + y1) / 2];
  let bestD = -1;
  const step = Math.max(x1 - x0, y1 - y0) / 48;
  for (let x = x0; x <= x1; x += step)
    for (let y = y0; y <= y1; y += step) {
      if (!inside([x, y], rings)) continue;
      const d = distToRings([x, y], rings);
      if (d > bestD) {
        bestD = d;
        best = [x, y];
      }
    }
  return { x: r1(best[0]), y: r1(best[1]), room: r1(bestD) };
}

const out = { width: WIDTH, height: HEIGHT, territories: {}, regions: {} };
for (const f of terrGeo.features) {
  const polys = toPixels(f.geometry);
  out.territories[f.properties.terr] = { d: pathOf(polys), ...labelPoint(polys[0]) };
}
for (const f of regionGeo.features) {
  if (f.properties.region === 'outposts') continue;
  const polys = toPixels(f.geometry);
  out.regions[f.properties.region] = { d: pathOf(polys), ...labelPoint(polys[0]) };
}
// Walls: borders that cannot be crossed. Each gets the line of the border itself and evenly
// spaced points along it, where the board draws peaks or trees.
const MARK_EVERY = 11;
out.walls = WALLS.map((w) => {
  const key = [w.a, w.b].sort().join('-');
  const lines = [...arcOwners]
    .filter(([, owners]) => owners.size === 2 && [...owners].sort().join('-') === key)
    .map(([i]) => arcPoints(i).map(px));
  if (lines.length === 0) throw new Error(`Wall ${key} has no shared border to draw on`);
  const marks = [];
  for (const line of lines) {
    let carried = MARK_EVERY / 2;
    for (let i = 1; i < line.length; i++) {
      const [ax, ay] = line[i - 1];
      const [bx, by] = line[i];
      const len = Math.hypot(bx - ax, by - ay);
      for (; carried <= len; carried += MARK_EVERY) marks.push([r1(ax + ((bx - ax) * carried) / len), r1(ay + ((by - ay) * carried) / len)]);
      carried -= len;
    }
  }
  const longest = lines.reduce((a, b) => (b.length > a.length ? b : a));
  const mid = longest[Math.floor(longest.length / 2)];
  return {
    ...w,
    d: lines.map((line) => `M${line.map(([x, y]) => `${r1(x)} ${r1(y)}`).join('L')}`).join(''),
    marks,
    label: { x: r1(mid[0]), y: r1(mid[1]) },
  };
});
const file = join(root, 'packages/web/src/mapShapes.json');
writeFileSync(file, JSON.stringify(out));
console.log(`Wrote ${file} (${(JSON.stringify(out).length / 1024).toFixed(0)} KB, ${WIDTH}×${HEIGHT}).`);
console.log('Tightest token spots:', Object.entries(out.territories).sort((a, b) => a[1].room - b[1].room).slice(0, 8).map(([id, t]) => `${id} ${t.room}px`).join(', '));
