import type { MapData } from '../src';

/**
 * An experimental map of Mumbai and its suburbs, as game data only (no artwork).
 * 43 territories, the same as the map of India, so game length can be compared like for like.
 */
const REGIONS: [id: string, name: string, bonus: number, territories: [id: string, name: string, hill?: boolean][]][] = [
  ['south', 'South Mumbai', 3, [['COL', 'Colaba'], ['FOR', 'Fort'], ['MAR', 'Marine Lines'], ['MAL', 'Malabar Hill', true], ['BYC', 'Byculla'], ['MAZ', 'Mazgaon']]],
  ['central', 'Central Mumbai', 6, [['WOR', 'Worli'], ['LPR', 'Lower Parel'], ['PAR', 'Parel–Sewri'], ['DAD', 'Dadar'], ['MAH', 'Mahim'], ['DHA', 'Dharavi–Sion'], ['WAD', 'Wadala']]],
  ['western', 'Western Suburbs', 6, [['BAN', 'Bandra'], ['SAN', 'Santacruz'], ['VPJ', 'Juhu–Vile Parle'], ['AND', 'Andheri'], ['GOR', 'Goregaon'], ['MLD', 'Malad'], ['KAN', 'Kandivali'], ['BOR', 'Borivali'], ['DAH', 'Dahisar']]],
  ['eastern', 'Eastern Suburbs', 5, [['KUR', 'Kurla'], ['CHE', 'Chembur'], ['TRO', 'Trombay–Mankhurd'], ['GHA', 'Ghatkopar'], ['POW', 'Powai'], ['VIK', 'Vikhroli–Bhandup'], ['MUL', 'Mulund']]],
  ['thane', 'Thane and Kalyan', 5, [['THA', 'Thane'], ['MIR', 'Mira–Bhayandar'], ['VAS', 'Vasai–Virar'], ['KAL', 'Kalwa–Mumbra', true], ['BHI', 'Bhiwandi'], ['DOM', 'Dombivli'], ['KLY', 'Kalyan–Ulhasnagar']]],
  ['navi', 'Navi Mumbai', 3, [['AIR', 'Airoli'], ['VSH', 'Vashi'], ['NER', 'Nerul–Belapur'], ['PAN', 'Kharghar–Panvel'], ['URA', 'Uran–JNPT']]],
];
const OUTPOSTS: [string, string][] = [['ELE', 'Elephanta Island'], ['ALI', 'Alibaug']];

const edges = (s: string) => s.trim().split(/\s+/).map((e) => e.split('-') as [string, string]);

// Roads, causeways and bridges. Sanjay Gandhi National Park stands between Borivali and Thane, so they do not connect.
const LAND = edges(`
  COL-FOR FOR-MAR FOR-MAZ MAR-MAL MAR-BYC MAL-BYC BYC-MAZ
  MAL-WOR BYC-LPR MAZ-PAR
  WOR-LPR WOR-DAD LPR-PAR LPR-DAD PAR-DAD PAR-WAD DAD-MAH DAD-WAD MAH-DHA WAD-DHA
  WOR-BAN MAH-BAN DHA-BAN
  DHA-KUR DHA-CHE WAD-CHE
  BAN-SAN SAN-VPJ VPJ-AND AND-GOR GOR-MLD MLD-KAN KAN-BOR BOR-DAH
  SAN-KUR AND-GHA AND-POW GOR-POW
  DAH-MIR
  KUR-CHE KUR-GHA CHE-TRO CHE-GHA GHA-POW GHA-VIK POW-VIK VIK-MUL
  MUL-THA TRO-VSH MUL-AIR
  MIR-VAS MIR-THA THA-KAL THA-BHI VAS-BHI KAL-DOM DOM-KLY KLY-BHI
  KAL-AIR DOM-PAN
  AIR-VSH VSH-NER NER-PAN NER-URA PAN-URA
`);
// Ferries and the long sea bridge across the harbour. Closed in the Monsoon.
const SEA = edges('PAR-URA COL-ELE ELE-URA COL-ALI MAZ-ALI ALI-URA');

const SUITS = ['padati', 'ashva', 'gaja'] as const;
let n = 0;
const territory = (id: string, name: string, region: string | null, hill = false) => ({
  id,
  name,
  covers: name,
  region,
  mountain: hill,
  outpost: region === null,
  suit: SUITS[n++ % 3],
});

export const MUMBAI: MapData = {
  regions: REGIONS.map(([id, name, bonus]) => ({ id, name, bonus })),
  territories: [
    ...REGIONS.flatMap(([id, , , list]) => list.map(([tid, name, hill]) => territory(tid, name, id, hill))),
    ...OUTPOSTS.map(([tid, name]) => territory(tid, name, null)),
  ],
  land: LAND,
  sea: SEA,
};

/** The city proper only: the four regions on the peninsula, 29 territories, with one ferry kept so Colaba is not a dead end. */
export const MUMBAI_CITY: MapData = (() => {
  const keep = new Set(MUMBAI.territories.filter((t) => ['south', 'central', 'western', 'eastern'].includes(t.region ?? '')).map((t) => t.id));
  return {
    regions: MUMBAI.regions.filter((r) => ['south', 'central', 'western', 'eastern'].includes(r.id)),
    territories: MUMBAI.territories.filter((t) => keep.has(t.id)),
    land: MUMBAI.land.filter(([a, b]) => keep.has(a) && keep.has(b)),
    sea: [],
  };
})();
