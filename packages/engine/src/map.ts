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

export const TERRITORIES: readonly Territory[] = raw.territories as Territory[];
export const TERRITORY_IDS: readonly TerritoryId[] = TERRITORIES.map((t) => t.id);
export const LAND_EDGES = raw.land as [TerritoryId, TerritoryId][];
export const SEA_EDGES = raw.sea as [TerritoryId, TerritoryId][];

const byId = new Map(TERRITORIES.map((t) => [t.id, t]));

export const REGIONS: readonly Region[] = raw.regions.map((r) => ({
  ...r,
  territories: TERRITORIES.filter((t) => t.region === r.id).map((t) => t.id),
}));

export const OUTPOSTS: readonly TerritoryId[] = TERRITORIES.filter((t) => t.outpost).map((t) => t.id);

function buildAdjacency(edges: [TerritoryId, TerritoryId][]): Map<TerritoryId, TerritoryId[]> {
  const adj = new Map<TerritoryId, TerritoryId[]>(TERRITORY_IDS.map((id) => [id, []]));
  for (const [a, b] of edges) {
    adj.get(a)?.push(b);
    adj.get(b)?.push(a);
  }
  return adj;
}

const landAdj = buildAdjacency(LAND_EDGES);
const seaAdj = buildAdjacency(SEA_EDGES);

export function territory(id: TerritoryId): Territory {
  const t = byId.get(id);
  if (!t) throw new Error(`Unknown territory ${id}`);
  return t;
}

export function isTerritory(id: unknown): id is TerritoryId {
  return typeof id === 'string' && byId.has(id);
}

/** Neighbours of a territory. Sea routes are included only when `seaOpen` is true. */
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
  if (new Set(counts).size !== 1 || Object.keys(suits).length !== 3) {
    problems.push(`card suits are uneven: ${JSON.stringify(suits)}`);
  }
  return problems;
}
