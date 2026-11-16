import type { ReactNode } from 'react';
import { MAPS } from '@rajmandala/engine';
import shapes from './mapShapes.json';
import { PLAYER_COLORS, REGION_LINE } from './theme';

const SHAPES = shapes.territories as Record<string, { d: string }>;
const REGION_SHAPES = shapes.regions as Record<string, { d: string }>;
// Always the map of India, whichever map a game is being set up on.
const TERRITORIES = MAPS.india.data.territories;
const REGIONS = MAPS.india.data.regions;

/** The map as decoration: every territory in one of the six player colours, as if a game were under way. */
function MapArt() {
  return (
    <svg className="mapart" viewBox={`0 0 ${shapes.width} ${shapes.height}`} aria-hidden="true">
      <defs>
        <filter id="artGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="6" stdDeviation="14" floodColor="#04161d" floodOpacity="0.55" />
        </filter>
      </defs>
      <g filter="url(#artGlow)">
        {TERRITORIES.map((t) => (
          <path key={t.id} d={SHAPES[t.id].d} fill="#f6efe0" />
        ))}
      </g>
      {TERRITORIES.map((t, i) => (
        <path key={t.id} d={SHAPES[t.id].d} fill={PLAYER_COLORS[(i * 5 + 2) % 6].fill} fillOpacity="0.62" stroke="#f6efe0" strokeWidth="1.6" />
      ))}
      {REGIONS.map((r) => (
        <path key={r.id} d={REGION_SHAPES[r.id].d} fill="none" stroke={REGION_LINE[r.id]} strokeWidth="2.5" strokeOpacity="0.9" />
      ))}
    </svg>
  );
}

/** The frame every menu shares: the map as a backdrop, and the content in a column over it. */
export function MenuShell({ className = '', children }: { className?: string; children: ReactNode }) {
  return (
    <div className="menu">
      <MapArt />
      <main className={`newgame ${className}`}>{children}</main>
    </div>
  );
}

/** The game's name, as it appears at the top of the home screen. */
export function Brand({ small = false }: { small?: boolean }) {
  return (
    <header className={`brand ${small ? 'small' : ''}`}>
      <p className="eyebrow">A game of conquest · 2 to 6 players</p>
      <h1>Rajmandala</h1>
      <p className="tagline">The circle of kings. Every neighbour is a rival.</p>
    </header>
  );
}
