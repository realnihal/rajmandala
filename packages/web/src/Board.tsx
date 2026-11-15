import { useEffect, useRef, useState } from 'react';
import { REGIONS, SEA_EDGES, TERRITORIES, isMonsoon } from '@rajmandala/engine';
import type { GameView, TerritoryId } from '@rajmandala/engine';
import shapes from './mapShapes.json';
import { OUTPOST_LINE, REGION_LINE, TOKEN_NUDGE } from './theme';

/** A battle being played out: the board zooms to it and shows each roll's losses. */
export interface Battle {
  from: TerritoryId;
  to: TerritoryId;
  roll: number;
  settled: boolean;
  attackerLost: number;
  defenderLost: number;
}

interface Props {
  game: GameView;
  armies: (id: TerritoryId) => number;
  colorOf: (owner: string) => { fill: string; text: string };
  nameOf: (owner: string) => string;
  clickable: Set<TerritoryId>;
  targets: Set<TerritoryId>;
  from?: TerritoryId;
  to?: TerritoryId;
  battle: Battle | null;
  /** An attack being lined up or followed through: the map stays close on these two territories. */
  focus: { from: TerritoryId; to: TerritoryId } | null;
  onPick: (id: TerritoryId, many: boolean) => void;
}

const SHAPES = shapes.territories as Record<string, { d: string; x: number; y: number; room: number }>;
const REGION_SHAPES = shapes.regions as Record<string, { d: string }>;
const { width: W, height: H } = shapes;
const FULL: Box = [0, 0, W, H];
const TOKEN_R = 11;
const LAND_CENTRE = { x: 430, y: 560 };
const TOWER = 'M-5 7 V-2 H-6.5 V-8 H-3.8 V-5.5 H-1.4 V-8 H1.4 V-5.5 H3.8 V-8 H6.5 V-2 H5 V7 Z';

type Box = [number, number, number, number];

function tokenAt(id: string) {
  const s = SHAPES[id];
  const n = TOKEN_NUDGE[id] ?? {};
  return { x: s.x + (n.dx ?? 0), y: s.y + (n.dy ?? 0) };
}

/** A sea route drawn as a curve that bows out into open water. */
function seaPath(a: string, b: string): string {
  const p = tokenAt(a);
  const q = tokenAt(b);
  const mx = (p.x + q.x) / 2;
  const my = (p.y + q.y) / 2;
  const ox = mx - LAND_CENTRE.x;
  const oy = my - LAND_CENTRE.y;
  const len = Math.hypot(ox, oy) || 1;
  const bow = Math.hypot(q.x - p.x, q.y - p.y) * 0.16;
  return `M${p.x} ${p.y}Q${mx + (ox / len) * bow} ${my + (oy / len) * bow} ${q.x} ${q.y}`;
}

/** The part of the board to show for a battle: both territories with room around them. */
function battleBox(from: string, to: string): Box {
  const p = tokenAt(from);
  const q = tokenAt(to);
  const w = Math.min(W, Math.max(300, Math.hypot(q.x - p.x, q.y - p.y) * 2.6));
  const h = (w * H) / W;
  const x = Math.max(0, Math.min(W - w, (p.x + q.x) / 2 - w / 2));
  const y = Math.max(0, Math.min(H - h, (p.y + q.y) / 2 - h / 2));
  return [x, y, w, h];
}

/** Eases the SVG viewBox towards a target box, or jumps there when `glide` is false (the player's own panning). */
function useZoom(target: Box, glide: boolean): Box {
  const [box, setBox] = useState<Box>(target);
  const current = useRef<Box>(target);
  const glided = useRef(false);
  const key = target.join(',');
  useEffect(() => {
    const start = current.current;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const land = () => {
      current.current = target;
      setBox(target);
    };
    // Glide into a battle and back out of it; follow the player's fingers directly.
    const animate = glide || glided.current;
    glided.current = glide;
    if (still || !animate) return land();
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / 550);
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      const next = start.map((v, i) => v + (target[i] - v) * e) as Box;
      current.current = next;
      setBox(next);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    // If the tab is hidden, animation frames stop: make sure the view still arrives.
    const fallback = setTimeout(land, 700);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(fallback);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return box;
}

const MIN_VIEW = W / 6;

function clampView(v: Box): Box {
  const w = Math.min(W, Math.max(MIN_VIEW, v[2]));
  const h = (w * H) / W;
  return [Math.max(0, Math.min(W - w, v[0])), Math.max(0, Math.min(H - h, v[1])), w, h];
}

/** Zooms a view by `factor` (below 1 zooms in) keeping the board point (cx, cy) where it is on screen. */
function zoomAt(v: Box, factor: number, cx: number, cy: number): Box {
  const w = Math.min(W, Math.max(MIN_VIEW, v[2] * factor));
  const k = w / v[2];
  return clampView([cx - (cx - v[0]) * k, cy - (cy - v[1]) * k, w, (w * H) / W]);
}

/**
 * Lets the player move around the map: drag to pan, pinch or scroll to zoom.
 * A drag is told apart from a click by distance, so tapping a territory still works.
 */
function usePanZoom(ref: React.RefObject<SVGSVGElement | null>, view: Box, setView: (v: Box) => void, off: boolean): void {
  const latest = useRef(view);
  latest.current = view;
  useEffect(() => {
    const el = ref.current;
    if (!el || off) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let start: { view: Box; x: number; y: number; spread: number } | null = null;
    let dragged = false;

    /** Board units per screen pixel, and where a screen point falls on the board. */
    const scaleOf = (v: Box) => {
      const r = el.getBoundingClientRect();
      return Math.max(v[2] / r.width, v[3] / r.height);
    };
    const toBoard = (x: number, y: number, v: Box): [number, number] => {
      const r = el.getBoundingClientRect();
      const u = scaleOf(v);
      return [v[0] + (x - r.left - (r.width - v[2] / u) / 2) * u, v[1] + (y - r.top - (r.height - v[3] / u) / 2) * u];
    };
    const centre = () => {
      const ps = [...pointers.values()];
      return { x: ps.reduce((n, p) => n + p.x, 0) / ps.length, y: ps.reduce((n, p) => n + p.y, 0) / ps.length };
    };
    const spread = () => {
      const [a, b] = [...pointers.values()];
      return b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    };
    const begin = () => {
      start = pointers.size ? { view: latest.current, ...centre(), spread: spread() } : null;
    };

    const down = (e: PointerEvent) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) dragged = false;
      begin();
    };
    const move = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId) || !start) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const c = centre();
      if (!dragged && pointers.size === 1 && Math.hypot(c.x - start.x, c.y - start.y) < 8) return;
      dragged = true;
      const [bx, by] = toBoard(start.x, start.y, start.view);
      const factor = pointers.size > 1 && start.spread > 0 ? start.spread / spread() : 1;
      const zoomed = zoomAt(start.view, factor, bx, by);
      // Then slide so the point first touched stays under the fingers.
      const [nx, ny] = toBoard(c.x, c.y, zoomed);
      setView(clampView([zoomed[0] + bx - nx, zoomed[1] + by - ny, zoomed[2], zoomed[3]]));
    };
    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      begin();
    };
    const click = (e: MouseEvent) => {
      if (!dragged) return;
      dragged = false;
      e.stopPropagation();
      e.preventDefault();
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = latest.current;
      const [bx, by] = toBoard(e.clientX, e.clientY, v);
      setView(zoomAt(v, Math.exp(e.deltaY * 0.0015), bx, by));
    };

    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    el.addEventListener('click', click, true);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      el.removeEventListener('click', click, true);
      el.removeEventListener('wheel', wheel);
    };
  }, [ref, off, setView]);
}

/** Troop pieces in the owner's colour: a square is 10 armies, a triangle 5, a dot 1. */
function Pieces({ n, fill, y }: { n: number; fill: string; y: number }) {
  const tens = Math.min(5, Math.floor(n / 10));
  const fives = Math.floor((n % 10) / 5);
  const ones = n % 5;
  const kinds = [...Array(tens).fill(10), ...Array(fives).fill(5), ...Array(ones).fill(1)] as number[];
  const widths: Record<number, number> = { 10: 8, 5: 7.5, 1: 5 };
  const total = kinds.reduce((s, k) => s + widths[k], 0) + (kinds.length - 1) * 1.6;
  let x = -total / 2;
  return (
    <g className="pieces" fill={fill} transform={`translate(0 ${y})`}>
      {kinds.map((k, i) => {
        const cx = x + widths[k] / 2;
        x += widths[k] + 1.6;
        if (k === 10) return <rect key={i} x={cx - 4} y={-4} width="8" height="8" rx="1.5" />;
        if (k === 5) return <path key={i} d={`M${cx - 3.75} 3.5 L${cx} -4 L${cx + 3.75} 3.5 Z`} />;
        return <circle key={i} cx={cx} cy={1} r="2.5" />;
      })}
    </g>
  );
}

export default function Board(props: Props) {
  const { game, armies, colorOf, nameOf, clickable, targets, from, to, battle, focus, onPick } = props;
  const monsoon = isMonsoon(game);
  const [view, setView] = useState<Box>(FULL);
  const svg = useRef<SVGSVGElement>(null);
  // Close on the fight from the moment a target is chosen until the player leaves it.
  const close = battle ?? focus;
  const box = useZoom(close ? battleBox(close.from, close.to) : view, close !== null);
  usePanZoom(svg, view, setView, close !== null);
  const zoomed = view[2] < W - 1;
  const step = (factor: number) => setView(zoomAt(view, factor, view[0] + view[2] / 2, view[1] + view[3] / 2));
  const capitalOf = new Map(Object.values(game.players).flatMap((p) => (p.capital ? [[p.capital, p.id] as const] : [])));
  const choosing = clickable.size > 0;
  const owner = (id: string) => game.territories[id].owner;
  const holderOf = (ids: string[]) => (ids.every((t) => owner(t) === owner(ids[0])) && owner(ids[0]) !== 'neutral' ? owner(ids[0]) : null);

  const pickProps = (id: string) =>
    clickable.has(id)
      ? {
          onClick: (e: React.MouseEvent) => onPick(id, e.shiftKey),
          onKeyDown: (e: React.KeyboardEvent) => (e.key === 'Enter' || e.key === ' ') && onPick(id, e.shiftKey),
        }
      : {};
  const lossAt = (id: string) =>
    battle?.settled ? (id === battle.from ? battle.attackerLost : id === battle.to ? battle.defenderLost : 0) : 0;

  return (
    <div className="boardwrap">
      <div className="zoom" role="group" aria-label="Map zoom" hidden={close !== null}>
        <button onClick={() => step(0.7)} disabled={view[2] <= MIN_VIEW + 1} aria-label="Zoom in">
          +
        </button>
        <button onClick={() => step(1 / 0.7)} disabled={!zoomed} aria-label="Zoom out">
          −
        </button>
        {zoomed && (
          <button onClick={() => setView(FULL)} aria-label="Show the whole map">
            ⤢
          </button>
        )}
      </div>
    <svg
      ref={svg}
      className={`board ${monsoon ? 'monsoon' : ''} ${close ? 'fighting' : ''} ${zoomed && !close ? 'zoomed' : ''}`}
      viewBox={box.map((v) => Math.round(v * 10) / 10).join(' ')}
      role="group"
      aria-label="Map of India"
    >
      <defs>
        <radialGradient id="sea" cx="45%" cy="45%" r="75%">
          <stop offset="0" stopColor="#e3eff3" />
          <stop offset="1" stopColor="#bfd8e2" />
        </radialGradient>
        <pattern id="rain" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(20)">
          <line x1="7" y1="0" x2="7" y2="7" stroke="#20506e" strokeOpacity="0.25" strokeWidth="1.2" />
        </pattern>
        <filter id="landShadow" x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow dx="0" dy="2" stdDeviation="4" floodColor="#1c3d4d" floodOpacity="0.3" />
        </filter>
        {REGIONS.map((r) => (
          <clipPath key={r.id} id={`clip-${r.id}`}>
            <path d={REGION_SHAPES[r.id].d} />
          </clipPath>
        ))}
      </defs>

      <rect width={W} height={H} fill="url(#sea)" />

      {/* A white base under the land gives the whole country one soft shadow. */}
      <g filter="url(#landShadow)">
        {TERRITORIES.map((t) => (
          <path key={t.id} d={SHAPES[t.id].d} fill="#ffffff" />
        ))}
      </g>

      {/* Land is always the colour of the player who holds it. */}
      <g className="land">
        {TERRITORIES.map((t) => {
          const cls = ['shape', clickable.has(t.id) ? 'clickable' : '', choosing && !clickable.has(t.id) && t.id !== from ? 'dim' : ''].join(' ');
          return (
            <path key={t.id} className={cls} d={SHAPES[t.id].d} fill={colorOf(owner(t.id)).fill} {...pickProps(t.id)}>
              <title>{`${t.name} — ${t.covers}${t.mountain ? ' (mountain)' : ''}`}</title>
            </path>
          );
        })}
      </g>

      {/* One coloured line per region, clipped to its own side of the border. */}
      <g className="regions">
        {REGIONS.map((r) => (
          <path key={r.id} d={REGION_SHAPES[r.id].d} clipPath={`url(#clip-${r.id})`} stroke={REGION_LINE[r.id]} />
        ))}
      </g>

      <g className="searoutes">
        {SEA_EDGES.map(([a, b]) => (
          <path key={a + b} d={seaPath(a, b)} className={monsoon ? 'closed' : ''} />
        ))}
      </g>

      <g className="marks">
        {!battle && [...targets].map((id) => <path key={id} d={SHAPES[id].d} className="mark target" />)}
        {from && <path d={SHAPES[from].d} className="mark chosen" />}
        {to && <path d={SHAPES[to].d} className="mark chosen" />}
        {from && to && (
          <line
            x1={tokenAt(from).x}
            y1={tokenAt(from).y}
            x2={tokenAt(to).x}
            y2={tokenAt(to).y}
            className={battle ? 'arrow charge' : 'arrow'}
          />
        )}
      </g>

      {monsoon && <rect width={W} height={H} fill="url(#rain)" pointerEvents="none" />}

      <g className="chart" transform={`translate(${W - 430} ${H - 232})`}>
        <rect width="236" height="218" rx="8" />
        <text className="charttitle" x="16" y="26">
          REGION BONUS · armies each turn
        </text>
        {[...REGIONS.map((r) => ({ id: r.id, name: r.name, bonus: r.bonus, line: REGION_LINE[r.id], holder: holderOf(r.territories) })),
          { id: 'outposts', name: 'Each island outpost', bonus: 1, line: OUTPOST_LINE, holder: null }].map((r, i) => (
          <g key={r.id} transform={`translate(16 ${42 + i * 24})`}>
            <line x1="0" y1="8" x2="20" y2="8" stroke={r.line} strokeWidth="5" strokeLinecap="round" />
            <text x="30" y="13">{r.name}</text>
            <text x="186" y="13" className="bonus">
              +{r.bonus}
            </text>
            {r.holder && (
              <circle cx="204" cy="8" r="6.5" fill={colorOf(r.holder).fill} stroke="#fff" strokeWidth="1.5">
                <title>{`Held by ${nameOf(r.holder)}`}</title>
              </circle>
            )}
          </g>
        ))}
      </g>

      <g className="tokens">
        {TERRITORIES.map((t) => {
          const { x, y } = tokenAt(t.id);
          const color = colorOf(owner(t.id));
          const canClick = clickable.has(t.id);
          const nudge = TOKEN_NUDGE[t.id] ?? {};
          const capital = capitalOf.get(t.id);
          const lost = lossAt(t.id);
          const inBattle = battle && (t.id === battle.from || t.id === battle.to);
          const cls = ['token', canClick ? 'clickable' : '', (choosing && !canClick && t.id !== from) || (battle && !inBattle) ? 'dim' : ''].join(' ');
          return (
            <g
              key={t.id}
              className={cls}
              transform={`translate(${x} ${y})`}
              tabIndex={canClick ? 0 : undefined}
              role={canClick ? 'button' : undefined}
              aria-label={`${t.name}: ${armies(t.id)} armies, ${nameOf(owner(t.id))}`}
              {...pickProps(t.id)}
            >
              {t.outpost && <circle className="zone" r={TOKEN_R + 13} />}
              <text className="tag" x={nudge.labelDx ?? 0} y={nudge.labelDy ?? TOKEN_R + 25}>
                {t.name}
              </text>
              {/* Re-keyed on every settled roll so the hit animation plays again. */}
              <g key={lost ? `hit-${battle!.roll}` : 'calm'} className={lost ? 'unit hit' : 'unit'}>
                <circle className="disc" r={TOKEN_R} fill={color.fill} />
                <text className="count" fill={color.text} dy="0.36em">
                  {armies(t.id)}
                </text>
                <Pieces n={armies(t.id)} fill={color.fill} y={TOKEN_R + 8} />
              </g>
              {t.mountain && <path className="mountain" d="M -7 5 L -1.5 -5 L 1 -1 L 3 -4 L 8 5 Z" transform={`translate(${TOKEN_R + 3} ${-TOKEN_R + 3})`} />}
              {capital && (
                <g className="tower" transform={`translate(${-TOKEN_R - 6} ${-TOKEN_R}) scale(1.4)`}>
                  <title>{`${nameOf(capital)}'s capital`}</title>
                  <path d={TOWER} fill={colorOf(capital).fill} />
                  <rect x="-1.6" y="1.5" width="3.2" height="5.5" rx="1.4" fill="#fff" />
                </g>
              )}
              {lost > 0 && (
                <text key={`loss-${battle!.roll}`} className="loss" y={-TOKEN_R - 6}>
                  −{lost}
                </text>
              )}
            </g>
          );
        })}
      </g>

      {battle && !battle.settled && (
        <g className="clash" transform={`translate(${tokenAt(battle.to).x} ${tokenAt(battle.to).y})`}>
          <path d="M0 -26 L6 -9 L24 -13 L12 0 L24 13 L6 9 L0 26 L-6 9 L-24 13 L-12 0 L-24 -13 L-6 -9 Z" />
        </g>
      )}
    </svg>
    </div>
  );
}
