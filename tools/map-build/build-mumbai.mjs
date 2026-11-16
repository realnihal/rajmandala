/**
 * Builds the Mumbai quick-game map: a stylised diagram, not a survey.
 *
 *   node tools/map-build/build-mumbai.mjs
 *
 * No boundary data is used. The coastline is a hand-simplified outline and each
 * neighbourhood is the area nearest to its marker (a Voronoi cell) inside that
 * outline. Which neighbourhoods touch is read off the drawing, so the picture
 * and the game's connections always agree.
 *
 * Writes packages/engine/src/mumbai.json (the map as game data) and
 * packages/web/src/mumbaiShapes.json (the artwork).
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ---------------------------------------------------------------- the design

const REGIONS = [
  { id: 'south', name: 'South Mumbai', bonus: 3 },
  { id: 'central', name: 'Central Mumbai', bonus: 6 },
  { id: 'western', name: 'Western Suburbs', bonus: 6 },
  { id: 'eastern', name: 'Eastern Suburbs', bonus: 5 },
];

/** id, name, region, [longitude, latitude] of its marker, and whether it is hill country. */
const PLACES = [
  ['COL', 'Colaba', 'south', [72.815, 18.908]],
  ['FOR', 'Fort', 'south', [72.836, 18.932]],
  ['MAR', 'Marine Lines', 'south', [72.822, 18.945]],
  ['MAL', 'Malabar Hill', 'south', [72.803, 18.957]],
  ['BYC', 'Byculla', 'south', [72.830, 18.974]],
  ['MAZ', 'Mazgaon', 'south', [72.847, 18.962]],
  ['WOR', 'Worli', 'central', [72.815, 18.999]],
  ['LPR', 'Lower Parel', 'central', [72.830, 18.995]],
  ['PAR', 'Parel–Sewri', 'central', [72.850, 18.994]],
  ['DAD', 'Dadar', 'central', [72.838, 19.019]],
  ['MAH', 'Mahim', 'central', [72.842, 19.040]],
  ['DHA', 'Dharavi–Sion', 'central', [72.860, 19.040]],
  ['WAD', 'Wadala', 'central', [72.866, 19.016]],
  ['BAN', 'Bandra', 'western', [72.836, 19.060]],
  ['SAN', 'Santacruz', 'western', [72.842, 19.083]],
  ['VPJ', 'Juhu–Vile Parle', 'western', [72.834, 19.104]],
  ['AND', 'Andheri', 'western', [72.848, 19.127]],
  ['GOR', 'Goregaon', 'western', [72.850, 19.160]],
  ['MLD', 'Malad', 'western', [72.838, 19.187]],
  ['KAN', 'Kandivali', 'western', [72.846, 19.209]],
  ['BOR', 'Borivali', 'western', [72.850, 19.232]],
  ['DAH', 'Dahisar', 'western', [72.856, 19.256]],
  ['KUR', 'Kurla', 'eastern', [72.882, 19.070]],
  ['CHE', 'Chembur', 'eastern', [72.900, 19.050]],
  ['TRO', 'Trombay–Mankhurd', 'eastern', [72.932, 19.030]],
  ['GHA', 'Ghatkopar', 'eastern', [72.910, 19.086]],
  ['POW', 'Powai', 'eastern', [72.900, 19.122], true],
  ['VIK', 'Vikhroli–Bhandup', 'eastern', [72.936, 19.128]],
  ['MUL', 'Mulund', 'eastern', [72.955, 19.176]],
];

/** Sanjay Gandhi National Park: drawn as forest, belongs to nobody, and blocks the way through. */
const PARK = [[72.905, 19.180], [72.900, 19.215], [72.893, 19.245]];

/** Crossings over water. Like all sea routes, they close in the Monsoon. */
const SEA = [
  ['WOR', 'BAN'], // the Bandra–Worli Sea Link
  ['COL', 'TRO'], // the harbour ferry
];

/** A simplified coastline, clockwise from the north-west. [longitude, latitude] */
const COAST = [
  [72.795, 19.266], [72.790, 19.232], [72.786, 19.192], [72.798, 19.162], [72.804, 19.140], [72.818, 19.112],
  [72.822, 19.086], [72.817, 19.058], [72.822, 19.044], [72.834, 19.041], [72.832, 19.028], [72.824, 19.016],
  [72.811, 19.002], [72.807, 18.986], [72.811, 18.974], [72.799, 18.961], [72.795, 18.946], [72.806, 18.951],
  [72.816, 18.953], [72.822, 18.940], [72.820, 18.925], [72.812, 18.915], [72.806, 18.895], [72.820, 18.900],
  [72.832, 18.915], [72.843, 18.935], [72.850, 18.960], [72.861, 18.990], [72.876, 19.008], [72.887, 19.021],
  [72.901, 19.004], [72.931, 18.999], [72.956, 19.020], [72.961, 19.046], [72.946, 19.070], [72.951, 19.100],
  [72.961, 19.140], [72.976, 19.170], [72.981, 19.191], [72.956, 19.202], [72.931, 19.236], [72.901, 19.262],
  [72.866, 19.272],
];

// --------------------------------------------------------------- the drawing

const WIDTH = 1000;
const PAD = 60;
const MID_LAT = 19.08;
const lons = COAST.map((p) => p[0]);
const lats = COAST.map((p) => p[1]);
const [west, east, south, north] = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)];
// Not to scale, on purpose. The real peninsula is too narrow to play on, so it is drawn about half
// as wide again, and the crowded southern end is given more than its share of the height.
const WIDEN = 1.45;
const SOUTH_OF = 19.05; // latitude below which the map is stretched
const SOUTH_SHARE = 0.52; // of the height
const squeeze = Math.cos((MID_LAT * Math.PI) / 180) * WIDEN;
const HEIGHT = 1141;
const tall = HEIGHT - 2 * PAD;
const scale = tall / (north - south);
const landWidth = (east - west) * squeeze * scale;
const left = (WIDTH - landWidth) / 2 + 40;
const down = (lat) =>
  lat >= SOUTH_OF
    ? ((north - lat) / (north - SOUTH_OF)) * (1 - SOUTH_SHARE) * tall
    : (1 - SOUTH_SHARE) * tall + ((SOUTH_OF - lat) / (SOUTH_OF - south)) * SOUTH_SHARE * tall;
const px = ([lon, lat]) => [left + (lon - west) * squeeze * scale, PAD + down(lat)];
const r1 = (n) => Math.round(n * 10) / 10;

const outline = COAST.map(px);
const sites = [
  ...PLACES.map(([id, , , at]) => ({ id, p: px(at) })),
  ...PARK.map((at, i) => ({ id: `PARK${i}`, p: px(at), park: true })),
];

/** Keeps the part of a polygon on the side of point `a` of the line midway between `a` and `b`. */
function clipToNearer(poly, a, b) {
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  const nx = b[0] - a[0];
  const ny = b[1] - a[1];
  const side = ([x, y]) => (x - mx) * nx + (y - my) * ny; // negative: nearer to a
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const sp = side(p);
    const sq = side(q);
    if (sp <= 0) out.push(p);
    if (sp < 0 !== sq < 0 && sp !== sq) {
      const t = sp / (sp - sq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}

const cells = new Map();
for (const s of sites) {
  let cell = outline;
  for (const o of sites) if (o !== s && cell.length) cell = clipToNearer(cell, s.p, o.p);
  if (cell.length < 3) throw new Error(`${s.id} has no room on the map`);
  cells.set(s.id, cell);
}

// Two cells touch where an edge of one runs along the line midway between their markers.
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const borders = new Map(); // "A|B" -> segments
for (const s of sites) {
  const cell = cells.get(s.id);
  for (let i = 0; i < cell.length; i++) {
    const a = cell[i];
    const b = cell[(i + 1) % cell.length];
    if (dist(a, b) < 0.5) continue;
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const own = dist(mid, s.p);
    const other = sites.find((o) => o !== s && Math.abs(dist(mid, o.p) - own) < 0.01);
    if (!other) continue; // coastline
    const key = [s.id, other.id].sort().join('|');
    if (!borders.has(key)) borders.set(key, []);
    if (s.id < other.id) borders.get(key).push([a, b]);
  }
}
const MIN_BORDER = 6; // px; anything shorter is a corner touching, not a border
const land = [];
for (const [key, segs] of borders) {
  const [a, b] = key.split('|');
  const length = segs.reduce((n, [p, q]) => n + dist(p, q), 0);
  if (a.startsWith('PARK') || b.startsWith('PARK') || length < MIN_BORDER) continue;
  land.push([a, b]);
}

// ----------------------------------------------------------------- game data

const SUITS = ['padati', 'ashva', 'gaja'];
const mapData = {
  regions: REGIONS,
  territories: PLACES.map(([id, name, region, , hill], i) => ({
    id,
    name,
    covers: name,
    region,
    mountain: hill === true,
    outpost: false,
    suit: SUITS[i % 3],
  })),
  land: land.sort((x, y) => x.join().localeCompare(y.join())),
  sea: SEA,
  walls: [],
  // Chosen by simulation: at 17 of 29 a game runs about a quarter to a third shorter than on India.
  samrajya: 17,
};
writeFileSync(join(root, 'packages/engine/src/mumbai.json'), JSON.stringify(mapData, null, 1));

// ------------------------------------------------------------------- artwork

const pathOf = (poly) => `M${poly.map(([x, y]) => `${r1(x)} ${r1(y)}`).join('L')}Z`;
function centre(poly) {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const f = poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
    a += f;
    cx += (poly[j][0] + poly[i][0]) * f;
    cy += (poly[j][1] + poly[i][1]) * f;
  }
  return [cx / (3 * a), cy / (3 * a)];
}
function roomAt(p, poly) {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j];
    const dx = poly[i][0] - ax;
    const dy = poly[i][1] - ay;
    const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(p[0] - ax - t * dx, p[1] - ay - t * dy));
  }
  return best;
}

const art = { width: WIDTH, height: HEIGHT, territories: {}, regions: {}, walls: [], park: '' };
for (const [id] of PLACES) {
  const cell = cells.get(id);
  const [x, y] = centre(cell);
  art.territories[id] = { d: pathOf(cell), x: r1(x), y: r1(y), room: r1(roomAt([x, y], cell)) };
}
art.park = PARK.map((_, i) => pathOf(cells.get(`PARK${i}`))).join('');
const parkAt = PARK.map(px);
art.parkLabel = { x: r1(parkAt.reduce((n, p) => n + p[0], 0) / parkAt.length), y: r1(parkAt.reduce((n, p) => n + p[1], 0) / parkAt.length) };
const regionOf = Object.fromEntries(PLACES.map(([id, , region]) => [id, region]));
for (const r of REGIONS) {
  const members = PLACES.filter(([, , region]) => region === r.id).map(([id]) => id);
  // The region's edge: every stretch of a member's outline that does not face another member.
  let line = '';
  for (const id of members) {
    const cell = cells.get(id);
    for (let i = 0; i < cell.length; i++) {
      const a = cell[i];
      const b = cell[(i + 1) % cell.length];
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const own = dist(mid, sites.find((s) => s.id === id).p);
      const facing = sites.find((o) => o.id !== id && Math.abs(dist(mid, o.p) - own) < 0.01);
      if (facing && regionOf[facing.id] === r.id) continue;
      line += `M${r1(a[0])} ${r1(a[1])}L${r1(b[0])} ${r1(b[1])}`;
    }
  }
  const pts = members.map((id) => [art.territories[id].x, art.territories[id].y]);
  art.regions[r.id] = {
    d: members.map((id) => pathOf(cells.get(id))).join(''),
    line,
    x: r1(pts.reduce((n, p) => n + p[0], 0) / pts.length),
    y: r1(pts.reduce((n, p) => n + p[1], 0) / pts.length),
  };
}
writeFileSync(join(root, 'packages/web/src/mumbaiShapes.json'), JSON.stringify(art));

// -------------------------------------------------------------------- report

const neighbours = Object.fromEntries(PLACES.map(([id]) => [id, []]));
for (const [a, b] of [...land, ...SEA]) {
  neighbours[a].push(b);
  neighbours[b].push(a);
}
console.log(`Mumbai: ${PLACES.length} neighbourhoods, ${land.length} borders, ${SEA.length} sea routes.`);
for (const [id, name] of PLACES) console.log(`  ${name.padEnd(18)} ${neighbours[id].join(' ')}`);
const tight = Object.entries(art.territories).sort((a, b) => a[1].room - b[1].room).slice(0, 6);
console.log('Tightest token spots:', tight.map(([id, t]) => `${id} ${t.room}px`).join(', '));
