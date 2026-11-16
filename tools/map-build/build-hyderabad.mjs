/**
 * Builds the Hyderabad map from real municipal boundaries.
 *
 *   node tools/map-build/build-hyderabad.mjs
 *
 * Greater Hyderabad's municipal wards are grouped into 33 territories that
 * follow the corporation's circles, each named after its best-known
 * neighbourhood. Six wards are missing from the data; the ground they cover
 * is given to the nearest territory, as is the Osmania University campus,
 * which the data leaves as a hole.
 *
 * The Musi runs through the old city: the borders it follows there are river
 * crossings. Hussain Sagar is drawn at its true position as decoration.
 *
 * Writes packages/engine/src/hyderabad.json (the map as game data) and
 * packages/web/src/hyderabadShapes.json (the artwork).
 *
 * Boundary data: OpenStreetMap contributors (Open Database Licence), as collected by the
 * DataMeet India community, github.com/datameet/Municipal_Spatial_Data (Hyderabad).
 * The shapes this script writes are derived from it and carry the same terms.
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
  { id: 'old', name: 'Old City', bonus: 4 },
  { id: 'central', name: 'Central Hyderabad', bonus: 6 },
  { id: 'secunderabad', name: 'Secunderabad', bonus: 3 },
  { id: 'east', name: 'East', bonus: 3 },
  { id: 'cyberabad', name: 'Cyberabad', bonus: 5 },
  { id: 'northwest', name: 'Kukatpally', bonus: 4 },
];

/** Each territory: its code, its name, its region, and the numbers of the wards it is made of. */
const PLACES = [
  ['CHA', 'Charminar', 'old', [32, 33, 34, 35, 48, 49, 52]],
  ['FAL', 'Falaknuma', 'old', [46, 47, 53, 54, 55, 56]],
  ['CDG', 'Chandrayangutta', 'old', [42, 43, 44, 45]],
  ['SAN', 'Santoshnagar', 'old', [36, 37, 38, 39, 40, 41]],
  ['MLK', 'Malakpet', 'old', [24, 25, 26, 27, 28, 29, 30]],
  ['RAJ', 'Rajendranagar', 'old', [57, 58, 59, 60, 61]],
  ['ABD', 'Abids', 'central', [50, 51, 63, 64, 77, 78, 79]],
  ['GOL', 'Golconda', 'central', [62, 65, 66, 67, 68, 69]],
  ['MEH', 'Mehdipatnam', 'central', [70, 71, 72, 73, 74, 75, 76]],
  ['KHA', 'Khairatabad', 'central', [91, 97, 98]],
  ['AMB', 'Amberpet', 'central', [80, 81, 82, 83, 84]],
  ['MUS', 'Musheerabad', 'central', [85, 86, 87, 88, 89, 90]],
  ['SEC', 'Secunderabad', 'secunderabad', [142, 143, 144, 145, 146, 147]],
  ['BEG', 'Begumpet', 'secunderabad', [148, 149, 150]],
  ['MKJ', 'Malkajgiri', 'secunderabad', [136, 137, 138, 139, 140, 141]],
  ['ALW', 'Alwal', 'secunderabad', [134, 135]],
  ['CAN', 'Cantonment', 'secunderabad', [119, 133]],
  ['KAP', 'Kapra', 'east', [1, 2, 5, 6]],
  ['UPP', 'Uppal', 'east', [7, 8, 9, 10]],
  ['HAY', 'Hayathnagar', 'east', [12, 14]],
  ['LBN', 'LB Nagar', 'east', [15, 16, 17, 18]],
  ['DIL', 'Dilsukhnagar', 'east', [19, 20, 21, 22, 23]],
  ['BJH', 'Banjara & Jubilee Hills', 'cyberabad', [92, 93, 94, 95]],
  ['YOU', 'Yousufguda', 'cyberabad', [96, 99, 101, 102, 103]],
  ['MAD', 'HITEC City', 'cyberabad', [107]],
  ['GAC', 'Gachibowli', 'cyberabad', [104, 105]],
  ['MIY', 'Miyapur', 'cyberabad', [108, 109]],
  ['LIN', 'Lingampally', 'cyberabad', [106, 110]],
  ['PAT', 'Patancheru', 'cyberabad', [111, 112]],
  ['KUK', 'Kukatpally', 'northwest', [114, 121, 122, 123, 124]],
  ['MOO', 'Moosapet', 'northwest', [100, 115, 116, 117, 118]],
  ['BAL', 'Balanagar', 'northwest', [120]],
  ['JEE', 'Jeedimetla', 'northwest', [127, 128, 130, 131, 132]],
  ['GAJ', 'Gajularamaram', 'northwest', [125, 126, 129]],
];
/** The Musi: borders it follows through the old city. Attackers roll a die fewer across them, and they close in the Monsoon. */
const RIVERS = [
  ['FAL', 'GOL'],
  ['CHA', 'GOL'], // Purana Pul
  ['CHA', 'ABD'], // Naya Pul
  ['MLK', 'ABD'], // Chaderghat
  ['MLK', 'AMB'], // Moosarambagh
];
/**
 * Secunderabad Cantonment is not municipal land, so the ward file leaves it as an empty notch.
 * This outline is drawn generously around the notch; whatever of it no ward covers becomes the
 * Cantonment, together with the wards that lie inside or beyond it. [longitude, latitude]
 */
const CANTONMENT_COVER = [
  [78.5308, 17.5338], [78.5453, 17.5338], [78.5482, 17.499], [78.5438, 17.4838], [78.5279, 17.4414],
  [78.445, 17.4414], [78.445, 17.4747], [78.468, 17.502], [78.5047, 17.4883], [78.5192, 17.502], [78.5264, 17.5293], [78.5308, 17.5338],
];
/** The northern, detached part of the Neredmet ward lies beyond the Cantonment and goes with it. */
/** Borders too short to count by the rule below that are real all the same. */
const CORNERS = [['ALW', 'JEE']];
const DETACHED = { ward: 136, northOf: 17.495, to: 'CAN' };
const RIVER_NAME = 'Musi';
/** Lakes drawn on the board: name, centre [longitude, latitude], half-width and half-height in degrees. */
const LAKES = [['Hussain Sagar', [78.4738, 17.4239], 0.0105, 0.0085]];
const PARK_WALLS = [];
const PARK_NAME = '';
/** Territories needed to win. Set by simulation. */
const SAMRAJYA = 21;

// ------------------------------------------------- 1. label every shape, merge

const read = (f) => JSON.parse(readFileSync(join(here, f), 'utf8'));
const centre = (geom) => {
  const ring = geom.type === 'Polygon' ? geom.coordinates[0] : geom.coordinates[0][0];
  return [ring.reduce((n, p) => n + p[0], 0) / ring.length, ring.reduce((n, p) => n + p[1], 0) / ring.length];
};
const wardOf = new Map(PLACES.flatMap(([id, , , wards]) => wards.map((w) => [w, id])));
const labelled = [];
const centres = [];
for (const f of read('data/hyderabad/ghmc-wards.geojson').features) {
  const terr = wardOf.get(Number(f.properties.name.match(/\d+/)[0]));
  if (!terr) throw new Error(`No territory for "${f.properties.name}"`);
  const ward = Number(f.properties.name.match(/\d+/)[0]);
  const parts = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const part of parts) {
    const geometry = { type: 'Polygon', coordinates: part };
    const beyond = ward === DETACHED.ward && centre(geometry)[1] > DETACHED.northOf;
    labelled.push({ type: 'Feature', properties: { terr: beyond ? DETACHED.to : terr }, geometry });
  }
  centres.push([terr, centre(f.geometry)]);
}
// The city's outline with its holes filled, less the wards, leaves the ground the ward file misses.
await mapshaper.runCommands('-i data/hyderabad/ghmc-zones.geojson -dissolve -o build/hyd-area.geojson');
{
  const area = read('build/hyd-area.geojson');
  const g = (area.features ? area.features[0].geometry : area.geometries[0]);
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  const outline = { type: 'FeatureCollection', features: polys.map((p) => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [p[0]] } })) };
  writeFileSync(join(here, 'build/hyd-outline.geojson'), JSON.stringify(outline));
}
await mapshaper.runCommands(
  '-i build/hyd-outline.geojson -dissolve -erase data/hyderabad/ghmc-wards.geojson -explode -each km2=this.area/1e6 -filter km2>0.3 -o build/hyd-gaps.geojson',
);
for (const f of read('build/hyd-gaps.geojson').features) {
  const [x, y] = centre(f.geometry);
  const [terr] = centres.reduce((best, c) => (Math.hypot(c[1][0] - x, c[1][1] - y) < Math.hypot(best[1][0] - x, best[1][1] - y) ? c : best));
  console.log(`gap of ${f.properties.km2.toFixed(1)} km² at ${x.toFixed(3)}, ${y.toFixed(3)} goes to ${terr}`);
  labelled.push({ type: 'Feature', properties: { terr }, geometry: f.geometry });
}
const writeLabelled = () => writeFileSync(join(here, 'build/hyderabad-labelled.geojson'), JSON.stringify({ type: 'FeatureCollection', features: labelled }));
writeLabelled();
writeFileSync(
  join(here, 'build/hyd-cover.geojson'),
  JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [CANTONMENT_COVER] } }] }),
);
await mapshaper.runCommands('-i build/hyd-cover.geojson -erase build/hyderabad-labelled.geojson -explode -each km2=this.area/1e6 -filter km2>0.3 -o build/hyd-cantonment.geojson');
for (const f of read('build/hyd-cantonment.geojson').features) {
  console.log(`Cantonment: ${f.properties.km2.toFixed(1)} km² of open ground`);
  labelled.push({ type: 'Feature', properties: { terr: 'CAN' }, geometry: f.geometry });
}
writeLabelled();

await mapshaper.runCommands(
  [
    '-i build/hyderabad-labelled.geojson',
    '-proj +proj=utm +zone=44 +datum=WGS84',
    '-clean gap-fill-area=0.4km2',
    '-dissolve terr',
    '-simplify dp interval=45 keep-shapes',
    '-clean gap-fill-area=0.4km2',
    '-filter-islands min-area=0.5km2',
    '-o build/hyderabad.topojson format=topojson no-quantization',
    '-o build/hyderabad.geojson format=geojson',
  ].join(' '),
);

// ------------------------------------------------------- 2. who borders whom

const topo = JSON.parse(readFileSync(join(here, 'build/hyderabad.topojson'), 'utf8'));
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
const corners = new Set(CORNERS.map(([a, b]) => pairKey(a, b)));
const land = [...sharedKm].filter(([key, km]) => (km >= MIN_BORDER_KM || corners.has(key)) && !walls.has(key)).map(([key]) => key.split('-'));
for (const key of walls) if (!sharedKm.has(key)) console.log(`note: the park wall ${key} is not needed; those shapes do not touch`);

// ------------------------------------------------------------ 3. game data

const places = PLACES.map(([id, name, region]) => ({ id, name, region }));
for (const [a, b] of RIVERS) if (!land.some((e) => pairKey(...e) === pairKey(a, b))) throw new Error(`The river crossing ${a}-${b} is not a border`);
const SUITS = ['padati', 'ashva', 'gaja'];
const mapData = {
  regions: REGIONS,
  territories: places.map((p, i) => ({ ...p, covers: p.name, mountain: false, outpost: false, suit: SUITS[i % 3] })),
  land: land.sort((x, y) => x.join().localeCompare(y.join())),
  sea: [],
  rivers: RIVERS,
  walls: [],
  samrajya: SAMRAJYA,
};
writeFileSync(join(root, 'packages/engine/src/hyderabad.json'), JSON.stringify(mapData, null, 1));

// -------------------------------------------------------------- 4. artwork

const HEIGHT = 980;
const PAD = 46;
const geo = JSON.parse(readFileSync(join(here, 'build/hyderabad.geojson'), 'utf8'));
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
const SEA_WEST = 0;
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
// The river: the borders it follows, as one line each.
const riverKeys = new Set(RIVERS.map(([a, b]) => pairKey(a, b)));
art.rivers = [...arcOwners]
  .filter(([, o]) => o.size === 2 && riverKeys.has(pairKey(...o)))
  .map(([i, o]) => ({ pair: pairKey(...o), d: `M${arcPoints(i).map(px).map(([x, y]) => `${r1(x)} ${r1(y)}`).join('L')}` }));
art.riverName = RIVER_NAME;
// Lakes, placed by projecting their true position the same way as the land.
await mapshaper.runCommands(
  `-i build/hyd-lakes.geojson -proj +proj=utm +zone=44 +datum=WGS84 -o build/hyd-lakes-utm.geojson`.replace(
    '-i',
    (writeFileSync(
      join(here, 'build/hyd-lakes.geojson'),
      JSON.stringify({
        type: 'FeatureCollection',
        features: LAKES.map(([name, [lon, lat], rx, ry]) => {
          const ring = Array.from({ length: 25 }, (_, i) => {
            const a = (i / 24) * 2 * Math.PI;
            const wobble = 1 + 0.14 * Math.sin(3 * a + 1) + 0.08 * Math.cos(5 * a);
            return [lon + rx * Math.cos(a) * wobble, lat + ry * Math.sin(a) * wobble];
          });
          ring[24] = ring[0];
          return { type: 'Feature', properties: { name }, geometry: { type: 'Polygon', coordinates: [ring] } };
        }),
      }),
    ),
    '-i'),
  ),
);
art.lakes = read('build/hyd-lakes-utm.geojson').features.map((f) => {
  const ring = f.geometry.coordinates[0].map(px);
  return {
    name: f.properties.name,
    d: `M${ring.map(([x, y]) => `${r1(x)} ${r1(y)}`).join('L')}Z`,
    x: r1(ring.reduce((n, p) => n + p[0], 0) / ring.length),
    y: r1(ring.reduce((n, p) => n + p[1], 0) / ring.length),
  };
});
writeFileSync(join(root, 'packages/web/src/hyderabadShapes.json'), JSON.stringify(art));

// ------------------------------------------------------------------ report

const neighbours = Object.fromEntries(places.map((p) => [p.id, []]));
for (const [a, b] of land) {
  neighbours[a].push(b);
  neighbours[b].push(a);
}
console.log(`Hyderabad: ${places.length} territories, ${land.length} borders, ${RIVERS.length} river crossings. Canvas ${WIDTH}×${HEIGHT}.`);
for (const p of places) console.log(`  ${p.name.padEnd(24)} ${p.id}  ${neighbours[p.id].join(' ')}`);
for (const f of geo.features) if (f.geometry.type === 'MultiPolygon') console.log(`note: ${f.properties.terr} is in ${f.geometry.coordinates.length} pieces`);
console.log('Short borders:', [...sharedKm].filter(([, km]) => km < 1).map(([k, km]) => `${k} ${km.toFixed(2)}km`).join(', ') || 'none');
console.log('Tightest token spots:', Object.entries(art.territories).sort((a, b) => a[1].room - b[1].room).slice(0, 8).map(([id, t]) => `${id} ${t.room}px`).join(', '));
