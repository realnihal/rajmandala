import raw from './map.json';

export type TerritoryId = string;
export type RegionId = string;
export type Suit = 'padati' | 'ashva' | 'gaja';

export interface Territory {
  id: TerritoryId;
  name: string;
  covers: string;
  region: RegionId | null;
  mountain: boolean;
  outpost: boolean;
  suit: Suit;
}

export interface Region {
  id: RegionId;
  name: string;
  bonus: number;
  territories: TerritoryId[];
}

/** The map as data. `rivers` are land borders that are harder to cross (see neighbors and isRiver). */
export interface MapData {
  regions: { id: RegionId; name: string; bonus: number }[];
  territories: Territory[];
  land: [TerritoryId, TerritoryId][];
  sea: [TerritoryId, TerritoryId][];
  rivers?: [TerritoryId, TerritoryId][];
  /** Borders that cannot be crossed: a mountain range or forest stands in the way. They are not in `land`. */
  walls?: { a: TerritoryId; b: TerritoryId; name: string; kind: 'range' | 'forest' }[];
}

export const BASE_MAP = raw as unknown as MapData;

export let TERRITORIES: readonly Territory[] = [];
export let TERRITORY_IDS: readonly TerritoryId[] = [];
export let LAND_EDGES: [TerritoryId, TerritoryId][] = [];
export let SEA_EDGES: [TerritoryId, TerritoryId][] = [];
export let RIVER_EDGES: [TerritoryId, TerritoryId][] = [];
export let REGIONS: readonly Region[] = [];
export let OUTPOSTS: readonly TerritoryId[] = [];

let byId = new Map<TerritoryId, Territory>();
let landAdj = new Map<TerritoryId, TerritoryId[]>();
let seaAdj = new Map<TerritoryId, TerritoryId[]>();
let rivers = new Set<string>();

const edgeKey = (a: TerritoryId, b: TerritoryId) => (a < b ? `${a}-${b}` : `${b}-${a}`);

function buildAdjacency(edges: [TerritoryId, TerritoryId][]): Map<TerritoryId, TerritoryId[]> {
  const adj = new Map<TerritoryId, TerritoryId[]>(TERRITORY_IDS.map((id) => [id, []]));
  for (const [a, b] of edges) {
    adj.get(a)?.push(b);
    adj.get(b)?.push(a);
  }
  return adj;
}

/**
 * Replaces the map in use. The game always runs on BASE_MAP; this exists so
 * simulations can try out variants of the map before one is adopted.
 */
export function loadMap(data: MapData): void {
  TERRITORIES = data.territories;
  TERRITORY_IDS = TERRITORIES.map((t) => t.id);
  LAND_EDGES = data.land;
  SEA_EDGES = data.sea;
  RIVER_EDGES = data.rivers ?? [];
  byId = new Map(TERRITORIES.map((t) => [t.id, t]));
  REGIONS = data.regions.map((r) => ({ ...r, territories: TERRITORIES.filter((t) => t.region === r.id).map((t) => t.id) }));
  OUTPOSTS = TERRITORIES.filter((t) => t.outpost).map((t) => t.id);
  rivers = new Set(RIVER_EDGES.map(([a, b]) => edgeKey(a, b)));
  // A river crossing is a land border that closes with the sea routes, so it is kept apart from open land.
  landAdj = buildAdjacency(LAND_EDGES.filter(([a, b]) => !rivers.has(edgeKey(a, b))));
  seaAdj = buildAdjacency([...SEA_EDGES, ...RIVER_EDGES]);
}
loadMap(BASE_MAP);

/** True when the border between two territories is a river crossing: attackers roll one die fewer, and it closes in the Monsoon. */
export function isRiver(a: TerritoryId, b: TerritoryId): boolean {
  return rivers.has(edgeKey(a, b));
}

export function territory(id: TerritoryId): Territory {
  const t = byId.get(id);
  if (!t) throw new Error(`Unknown territory ${id}`);
  return t;
}

export function isTerritory(id: unknown): id is TerritoryId {
  return typeof id === 'string' && byId.has(id);
}

/** Neighbours of a territory. Sea routes and river crossings are included only when `seaOpen` is true. */
export function neighbors(id: TerritoryId, seaOpen: boolean): TerritoryId[] {
  const land = landAdj.get(id) ?? [];
  return seaOpen ? [...land, ...(seaAdj.get(id) ?? [])] : land;
}

export function isAdjacent(a: TerritoryId, b: TerritoryId, seaOpen: boolean): boolean {
  return neighbors(a, seaOpen).includes(b);
}

/** Returns a list of problems with the map data; empty when the map is sound. */
export function validateMap(): string[] {
  const problems: string[] = [];
  if (byId.size !== TERRITORIES.length) problems.push('duplicate territory ids');

  const seen = new Set<string>();
  for (const [a, b] of [...LAND_EDGES, ...SEA_EDGES]) {
    if (!byId.has(a) || !byId.has(b)) problems.push(`edge ${a}-${b} names an unknown territory`);
    if (a === b) problems.push(`edge ${a}-${b} is a self-loop`);
    const key = [a, b].sort().join('-');
    if (seen.has(key)) problems.push(`edge ${key} is listed twice`);
    seen.add(key);
  }

  const reached = new Set<TerritoryId>([TERRITORY_IDS[0]]);
  const stack = [TERRITORY_IDS[0]];
  while (stack.length) {
    for (const n of neighbors(stack.pop()!, true)) {
      if (!reached.has(n)) {
        reached.add(n);
        stack.push(n);
      }
    }
  }
  if (reached.size !== TERRITORIES.length) problems.push('map is not fully connected');

  for (const t of TERRITORIES) {
    if (t.outpost ? t.region !== null : !REGIONS.some((r) => r.id === t.region)) {
      problems.push(`${t.id} has an invalid region`);
    }
  }
  for (const r of REGIONS) {
    if (r.territories.length === 0) problems.push(`region ${r.id} is empty`);
    if (r.bonus <= 0) problems.push(`region ${r.id} has no bonus`);
  }

  const suits: Record<string, number> = {};
  for (const t of TERRITORIES) suits[t.suit] = (suits[t.suit] ?? 0) + 1;
  const counts = ['padati', 'ashva', 'gaja'].map((s) => suits[s] ?? 0);
  // As even as the number of territories allows.
  if (Math.max(...counts) - Math.min(...counts) > 1 || Object.keys(suits).length !== 3) {
    problems.push(`card suits are uneven: ${JSON.stringify(suits)}`);
  }
  return problems;
}
