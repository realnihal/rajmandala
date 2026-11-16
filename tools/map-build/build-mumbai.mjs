/**
 * Builds the Mumbai map from real municipal boundaries.
 *
 *   node tools/map-build/build-mumbai.mjs
 *
 * Greater Mumbai's 24 wards each become a territory, named after their main
 * neighbourhood. Navi Mumbai's 111 electoral wards are grouped into six nodes
 * by latitude (the data carries ward numbers only, so the node boundaries are
 * approximate). Mira–Bhayandar is one territory, and Elephanta Island is
 * drawn by hand as it is in none of the files.
 *
 * Writes packages/engine/src/mumbai.json (the map as game data) and
 * packages/web/src/mumbaiShapes.json (the artwork).
 *
 * Boundary data: DataMeet India community, github.com/datameet/Municipal_Spatial_Data
 * (Mumbai, NMMC, Mira-Bhayandar), Creative Commons Attribution-ShareAlike 2.5 India.
 * The shapes this script writes are derived from it and carry the same licence.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import mapshaper from 'mapshaper';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
mkdirSync(join(here, 'build'), { recursive: true });
process.chdir(here); // mapshaper command strings cannot contain paths with spaces

// ---------------------------------------------------------------- the design

const REGIONS = [
  { id: 'south', name: 'South Mumbai', bonus: 3 },
  { id: 'central', name: 'Central Mumbai', bonus: 4 },
  { id: 'western', name: 'Western Suburbs', bonus: 6 },
  { id: 'eastern', name: 'Eastern Suburbs', bonus: 5 },
  { id: 'navi', name: 'Navi Mumbai', bonus: 3 },
];

/** Greater Mumbai's wards: the ward's code in the data, then the territory it becomes. */
const WARDS = {
  A: ['COL', 'Colaba–Fort', 'south'],
  B: ['DON', 'Dongri', 'south'],
  C: ['KAL', 'Kalbadevi', 'south'],
  D: ['MAL', 'Malabar Hill', 'south'],
  E: ['BYC', 'Byculla', 'south'],
  'F/S': ['PAR', 'Parel–Sewri', 'central'],
  'F/N': ['MAT', 'Matunga–Sion', 'central'],
  'G/S': ['WOR', 'Worli', 'central'],
  'G/N': ['DAD', 'Dadar–Mahim', 'central'],
  'H/W': ['BAN', 'Bandra', 'western'],
  'H/E': ['SAN', 'Santacruz', 'western'],
  'K/W': ['JUH', 'Juhu–Versova', 'western'],
  'K/E': ['AND', 'Andheri', 'western'],
  'P/S': ['GOR', 'Goregaon', 'western'],
  'P/N': ['MLD', 'Malad', 'western'],
  'R/S': ['KAN', 'Kandivali', 'western'],
  'R/C': ['BOR', 'Borivali', 'western'],
  'R/N': ['DAH', 'Dahisar', 'western'],
  L: ['KUR', 'Kurla', 'eastern'],
  'M/E': ['TRO', 'Mankhurd–Trombay', 'eastern'],
  'M/W': ['CHE', 'Chembur', 'eastern'],
  N: ['GHA', 'Ghatkopar', 'eastern'],
  S: ['BHA', 'Bhandup–Powai', 'eastern'],
  T: ['MUL', 'Mulund', 'eastern'],
};
/** Navi Mumbai's nodes, north to south: a ward belongs to the first whose southern limit it lies above. */
const NAVI = [
  ['AIR', 'Airoli', 19.14],
  ['GHN', 'Ghansoli', 19.108],
  ['KOP', 'Kopar Khairane', 19.085],
  ['VSH', 'Vashi', 19.06],
  ['NER', 'Nerul', 19.027],
  ['BEL', 'Belapur', -90],
];
const OTHERS = [
  ['MIR', 'Mira–Bhayandar', 'western'],
  ['ELE', 'Elephanta Island', null],
];
/** Elephanta Island, drawn as a small island at its true position. [longitude, latitude] */
const ELEPHANTA = [72.9315, 18.9633];

/** Roads and bridges that join territories whose shapes do not share a border. */
const BRIDGES = [
  ['TRO', 'VSH'], // Vashi Bridge
  ['MUL', 'AIR'], // Airoli Bridge
];
/** Crossings over open water. Like all sea routes, they close in the Monsoon. */
const SEA = [
  ['WOR', 'BAN'], // the Bandra–Worli Sea Link
  ['PAR', 'BEL'], // Atal Setu, the harbour bridge from Sewri
  ['COL', 'ELE'], // the Gateway of India ferry
  ['ELE', 'BEL'], // the Belapur ferry
];
/** Sanjay Gandhi National Park lies along these borders; armies cannot cross it. */
const PARK_WALLS = [
  ['BOR', 'MUL'],
  ['KAN', 'MUL'],
  ['MLD', 'MUL'],
  ['GOR', 'MUL'],
];
const PARK_NAME = 'Sanjay Gandhi National Park';
/** Territories needed to win. Set by simulation so the game is quicker than on India. */
const SAMRAJYA = 20;

// ------------------------------------------------- 1. label every shape, merge

const read = (f) => JSON.parse(readFileSync(join(here, 'data/mumbai', f), 'utf8'));
function centreLat(geom) {
  const ring = geom.type === 'Polygon' ? geom.coordinates[0] : geom.coordinates[0][0];
  return ring.reduce((n, p) => n + p[1], 0) / ring.length;
}
const labelled = [];
for (const f of read('BMC_Wards.geojson').features) {
  const ward = WARDS[f.properties.name];
  if (!ward) throw new Error(`No territory for ward "${f.properties.name}"`);
  labelled.push({ type: 'Feature', properties: { terr: ward[0] }, geometry: f.geometry });
}
for (const f of read('NMC_ElectoralWards.geojson').features) {
  const node = NAVI.find(([, , southLimit]) => centreLat(f.geometry) >= southLimit);
  labelled.push({ type: 'Feature', properties: { terr: node[0] }, geometry: f.geometry });
}
for (const f of read('Mira-Bhayandar.geojson').features) labelled.push({ type: 'Feature', properties: { terr: 'MIR' }, geometry: f.geometry });
{
  const [lon, lat] = ELEPHANTA;
  const ring = Array.from({ length: 13 }, (_, i) => {
    const a = (i / 12) * 2 * Math.PI;
    return [lon + 0.0085 * Math.cos(a) * (1 + 0.25 * Math.sin(3 * a)), lat + 0.0075 * Math.sin(a) * (1 + 0.2 * Math.cos(2 * a))];
  });
  ring[12] = ring[0];
  labelled.push({ type: 'Feature', properties: { terr: 'ELE' }, geometry: { type: 'Polygon', coordinates: [ring] } });
}
writeFileSync(join(here, 'build/mumbai-labelled.geojson'), JSON.stringify({ type: 'FeatureCollection', features: labelled }));

await mapshaper.runCommands(
  [
    '-i build/mumbai-labelled.geojson',
    '-proj +proj=utm +zone=43 +datum=WGS84',
    '-clean',
    '-dissolve terr',
    '-simplify dp interval=55 keep-shapes',
    '-clean',
    '-o build/mumbai.topojson format=topojson no-quantization',
    '-o build/mumbai.geojson format=geojson',
  ].join(' '),
);

// ------------------------------------------------------- 2. who borders whom

const topo = JSON.parse(readFileSync(join(here, 'build/mumbai.topojson'), 'utf8'));
const layer = Object.values(topo.objects)[0];
const arcOwners = new Map();
for (const g of layer.geometries) {
  for (const a of JSON.stringify(g.arcs).match(/-?\d+/g).map(Number)) {
    const i = a < 0 ? ~a : a;
    if (!arcOwners.has(i)) arcOwners.set(i, new Set());
    arcOwners.get(i).add(g.properties.terr);
  }
}
const arcPoints = (i) => topo.arcs[i];
const pairKey = (a, b) => [a, b].sort().join('-');
const sharedKm = new Map();
for (const [i, owners] of arcOwners) {
  if (owners.size !== 2) continue;
  const pts = arcPoints(i);
  let len = 0;
  for (let j = 1; j < pts.length; j++) len += Math.hypot(pts[j][0] - pts[j - 1][0], pts[j][1] - pts[j - 1][1]);
  const key = pairKey(...owners);
  sharedKm.set(key, (sharedKm.get(key) ?? 0) + len / 1000);
}
const walls = new Set(PARK_WALLS.map(([a, b]) => pairKey(a, b)));
const MIN_BORDER_KM = 0.25; // shorter than this is two corners meeting, not a border
const land = [...sharedKm].filter(([key, km]) => km >= MIN_BORDER_KM && !walls.has(key)).map(([key]) => key.split('-'));
for (const key of walls) if (!sharedKm.has(key)) console.log(`note: the park wall ${key} is not needed; those shapes do not touch`);

// ------------------------------------------------------------ 3. game data

const places = [
  ...Object.values(WARDS).map(([id, name, region]) => ({ id, name, region })),
  ...NAVI.map(([id, name]) => ({ id, name, region: 'navi' })),
  ...OTHERS.map(([id, name, region]) => ({ id, name, region })),
];
const SUITS = ['padati', 'ashva', 'gaja'];
const mapData = {
  regions: REGIONS,
  territories: places.map((p, i) => ({ ...p, covers: p.name, mountain: false, outpost: p.region === null, suit: SUITS[i % 3] })),
  land: land.sort((x, y) => x.join().localeCompare(y.join())),
  bridges: BRIDGES,
  sea: SEA,
  walls: PARK_WALLS.filter(([a, b]) => sharedKm.has(pairKey(a, b))).map(([a, b]) => ({ a, b, name: PARK_NAME, kind: 'forest' })),
  samrajya: SAMRAJYA,
};
writeFileSync(join(root, 'packages/engine/src/mumbai.json'), JSON.stringify(mapData, null, 1));

// -------------------------------------------------------------- 4. artwork

const HEIGHT = 1141;
const PAD = 46;
const geo = JSON.parse(readFileSync(join(here, 'build/mumbai.geojson'), 'utf8'));
const polygonsOf = (geom) => (geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates);
let [minX, maxX, minY, maxY] = [Infinity, -Infinity, Infinity, -Infinity];
for (const f of geo.features)
  for (const poly of polygonsOf(f.geometry))
    for (const [x, y] of poly[0]) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
const scale = (HEIGHT - 2 * PAD) / (maxY - minY);
const SEA_WEST = 150; // open water left of the land, for lettering and the compass
const WIDTH = Math.ceil((maxX - minX) * scale + SEA_WEST + 2 * PAD);
const px = ([x, y]) => [(x - minX) * scale + PAD + SEA_WEST, (maxY - y) * scale + PAD];
const r1 = (n) => Math.round(n * 10) / 10;

function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  return Math.abs(a / 2);
}
const toPixels = (geom) =>
  polygonsOf(geom)
    .map((poly) => poly.map((ring) => ring.map(px)))
    .sort((a, b) => ringArea(b[0]) - ringArea(a[0]))
    .filter((p, i) => i === 0 || ringArea(p[0]) >= 12);
const pathOf = (polys) => polys.map((poly) => poly.map((ring) => `M${ring.map(([x, y]) => `${r1(x)} ${r1(y)}`).join('L')}Z`).join('')).join('');
function distToRings(p, rings) {
  let best = Infinity;
  for (const ring of rings)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, ay] = ring[j];
      const dx = ring[i][0] - ax;
      const dy = ring[i][1] - ay;
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
/** The point inside a shape farthest from its edge: where the army token sits. */
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

const art = { width: WIDTH, height: HEIGHT, territories: {}, regions: {}, walls: [] };
const pixels = {};
for (const f of geo.features) {
  const polys = toPixels(f.geometry);
  pixels[f.properties.terr] = polys;
  art.territories[f.properties.terr] = { d: pathOf(polys), ...labelPoint(polys[0]) };
}
const regionOf = Object.fromEntries(places.map((p) => [p.id, p.region]));
for (const r of REGIONS) {
  const members = places.filter((p) => p.region === r.id).map((p) => p.id);
  // The region's edge: every stretch of border that does not separate two of its own members.
  let line = '';
  for (const [i, owners] of arcOwners) {
    const mine = [...owners].filter((t) => regionOf[t] === r.id);
    if (mine.length === 0 || (owners.size === 2 && mine.length === 2)) continue;
    line += `M${arcPoints(i).map((p) => px(p)).map(([x, y]) => `${r1(x)} ${r1(y)}`).join('L')}`;
  }
  const pts = members.map((id) => art.territories[id]);
  art.regions[r.id] = {
    d: members.map((id) => pathOf(pixels[id])).join(''),
    line,
    x: r1(pts.reduce((n, p) => n + p.x, 0) / pts.length),
    y: r1(pts.reduce((n, p) => n + p.y, 0) / pts.length),
  };
}
// Park walls: the border itself, and evenly spaced points along it for the trees.
const MARK_EVERY = 12;
for (const w of mapData.walls) {
  const key = pairKey(w.a, w.b);
  const lines = [...arcOwners].filter(([, o]) => o.size === 2 && pairKey(...o) === key).map(([i]) => arcPoints(i).map(px));
  const marks = [];
  for (const lineOf of lines) {
    let carried = MARK_EVERY / 2;
    for (let i = 1; i < lineOf.length; i++) {
      const [ax, ay] = lineOf[i - 1];
      const [bx, by] = lineOf[i];
      const len = Math.hypot(bx - ax, by - ay);
      for (; carried <= len; carried += MARK_EVERY) marks.push([r1(ax + ((bx - ax) * carried) / len), r1(ay + ((by - ay) * carried) / len)]);
      carried -= len;
    }
  }
  const longest = lines.reduce((a, b) => (b.length > a.length ? b : a));
  const mid = longest[Math.floor(longest.length / 2)];
  art.walls.push({ ...w, d: lines.map((l) => `M${l.map(([x, y]) => `${r1(x)} ${r1(y)}`).join('L')}`).join(''), marks, label: { x: r1(mid[0]), y: r1(mid[1]) } });
}
writeFileSync(join(root, 'packages/web/src/mumbaiShapes.json'), JSON.stringify(art));

// ------------------------------------------------------------------ report

const neighbours = Object.fromEntries(places.map((p) => [p.id, []]));
for (const [a, b] of [...land, ...BRIDGES, ...SEA]) {
  neighbours[a].push(b);
  neighbours[b].push(a);
}
console.log(`Mumbai: ${places.length} territories, ${land.length} borders, ${BRIDGES.length} bridges, ${SEA.length} sea routes, ${mapData.walls.length} park walls. Canvas ${WIDTH}×${HEIGHT}.`);
for (const p of places) console.log(`  ${p.name.padEnd(18)} ${neighbours[p.id].join(' ')}`);
console.log('Short borders:', [...sharedKm].filter(([, km]) => km < 1).map(([k, km]) => `${k} ${km.toFixed(2)}km`).join(', ') || 'none');
console.log('Tightest token spots:', Object.entries(art.territories).sort((a, b) => a[1].room - b[1].room).slice(0, 8).map(([id, t]) => `${id} ${t.room}px`).join(', '));
