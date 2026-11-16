import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  MAPS,
  TERRITORIES,
  samrajyaTarget,
  selectMap,
  WILD_CARDS,
  applyAction,
  bestSet,
  calcReinforcements,
  createGame,
  isPlayable,
  currentPlayer,
  isConnected,
  isMonsoon,
  maxAttackDice,
  neighbors,
  randomPlacement,
  setValue,
  territoriesOf,
  territory,
  viewFor,
} from '@rajmandala/engine';
import type { Action, CardId, GameEvent, GameState, GameView, MapId, PlayerId, TerritoryId, VictoryMode } from '@rajmandala/engine';
import type { ChatLine } from '@rajmandala/server';
import Board from './Board';
import { MenuShell } from './Menu';
import { Rules } from './Rules';
import { isMuted, play, setMuted } from './sound';
import { describe } from './describe';
import { NEUTRAL_COLOR, PLAYER_COLORS, colorIndex } from './theme';

type DiceEvent = Extract<GameEvent, { type: 'diceRolled' }>;
interface Saved {
  game: GameState;
  names: Record<PlayerId, string>;
  /** Identifies this game, so a new game gets a fresh screen. */
  id?: string;
  /** The colour each player chose. */
  colors?: Record<PlayerId, number>;
  /** Place starting armies at random as soon as every capital is chosen. */
  autoPlace?: boolean;
}
interface RollAnim {
  rolls: DiceEvent[];
  /** Which roll is on screen, and whether its dice have settled. */
  i: number;
  settled: boolean;
  from: TerritoryId;
  to: TerritoryId;
  next: GameView;
  lines: string[];
  /** Whether this battle ended with the territory changing hands. */
  captured: boolean;
}

/** The latest picture of the game and what just happened, from the local engine or from the server. */
export interface GameUpdate {
  seq: number;
  view: GameView;
  events: GameEvent[];
}
const PIPS: Record<number, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

const SAVE_KEY = 'rajmandala-hotseat-v1';
/** Name and one-line description of each way to win. Read when shown, because the numbers depend on the map in use. */
export const VICTORY_TEXT: Record<VictoryMode, [string, string]> = {
  get samrajya(): [string, string] {
    return ['Samrajya', `Hold ${samrajyaTarget()} of ${TERRITORIES.length} territories at the end of your turn`];
  },
  digvijaya: ['Digvijaya', 'Eliminate every other player'],
  capitals: ['Capitals', 'Hold your own capital and two enemy capitals at the end of your turn'],
};
const SUIT_LABEL: Record<string, string> = { padati: 'Padati', ashva: 'Ashva', gaja: 'Gaja' };

function load(): Saved | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    const saved = raw ? (JSON.parse(raw) as Saved) : null;
    // A game saved on an older map cannot be continued.
    return saved && isPlayable(saved.game) ? saved : null;
  } catch {
    return null;
  }
}
function save(data: Saved | null): void {
  try {
    if (data) localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    else localStorage.removeItem(SAVE_KEY);
  } catch {
    /* storage unavailable: the game still works, it just will not survive a refresh */
  }
}

const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];
/** Looks up the colour a territory's owner plays in, given the colours the players chose. */
export const colorLookup = (colors?: Record<PlayerId, number>) => (owner: string) =>
  owner === 'neutral' ? NEUTRAL_COLOR : (PLAYER_COLORS[colorIndex(colors, owner)] ?? PLAYER_COLORS[0]);

/** A game on one shared screen: the rules run in this browser and every hand is visible to the screen. */
export function HotSeat({ onExit }: { onExit: () => void }) {
  const [saved, setSaved] = useState<Saved | null>(load);
  const [update, setUpdate] = useState<GameUpdate | null>(() => {
    const s = load();
    return s ? { seq: 0, view: viewFor(s.game, null, { revealAll: true }), events: [] } : null;
  });

  if (!saved || !update) {
    return (
      <NewGame
        onBack={onExit}
        onStart={(s) => {
          save(s);
          setSaved(s);
          setUpdate({ seq: 0, view: viewFor(s.game, null, { revealAll: true }), events: [] });
        }}
      />
    );
  }

  function send(player: PlayerId, action: Action): string | null {
    try {
      const r = applyAction(saved!.game, player, action);
      let next = r.state;
      let events = r.events;
      if (next.phase === 'setup-place' && saved!.autoPlace) {
        for (const id of next.turnOrder) {
          if (!next.players[id].alive) continue;
          const placed = applyAction(next, id, { type: 'setupPlace', placements: randomPlacement(next, id, next.players[id].setupArmies) });
          next = placed.state;
          events = [...events, ...placed.events];
        }
      }
      const s = { ...saved!, game: next };
      save(s);
      setSaved(s);
      setUpdate((u) => ({ seq: (u?.seq ?? 0) + 1, view: viewFor(next, null, { revealAll: true }), events }));
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'That move is not allowed';
    }
  }

  const quit = () => {
    save(null);
    setSaved(null);
    setUpdate(null);
  };
  return (
    <Game
      // One screen per game. The key must not change while a game is played, or the screen (and any
      // battle animation in progress) would be thrown away and rebuilt.
      key={saved.id ?? saved.game.turnOrder.join()}
      names={saved.names}
      colors={saved.colors}
      update={update}
      hotseat
      viewer={null}
      send={send}
      quit={{ label: 'Abandon game', confirm: 'Abandon this game and start a new one?', run: quit }}
      finished={
        <button className="primary" onClick={quit}>
          New game
        </button>
      }
    />
  );
}

// ------------------------------------------------------------- new game

function NewGame({ onStart, onBack }: { onStart: (s: Saved) => void; onBack: () => void }) {
  const [count, setCount] = useState(3);
  const [names, setNames] = useState(['Asha', 'Bilal', 'Chitra', 'Dev', 'Esha', 'Farhan']);
  const [victory, setVictory] = useState<VictoryMode>('samrajya');
  const [quick, setQuick] = useState(true);
  const [colors, setColors] = useState([0, 1, 2, 3, 4, 5]);
  const [map, setMap] = useState<MapId>('india');
  selectMap(map); // so the numbers shown below are for the chosen map

  /** Moves a player on to the next colour nobody else at the table is using. */
  function nextColor(i: number) {
    const taken = new Set(colors.slice(0, count).filter((_, j) => j !== i));
    let c = colors[i];
    do c = (c + 1) % PLAYER_COLORS.length;
    while (taken.has(c));
    setColors(colors.map((x, j) => (j === i ? c : x)));
  }

  function start() {
    const ids = Array.from({ length: count }, (_, i) => `p${i + 1}`);
    const nameMap = Object.fromEntries(ids.map((id, i) => [id, names[i].trim() || `Player ${i + 1}`]));
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    const game = createGame({ players: ids, seed, victory, map }).state;
    const colorMap = Object.fromEntries(ids.map((id, i) => [id, colors[i]]));
    onStart({ id: crypto.randomUUID(), game, names: nameMap, colors: colorMap, autoPlace: quick });
  }

  return (
    <MenuShell>
      <button className="link" onClick={onBack}>
        ← Back
      </button>
      <h1>Play on this screen</h1>
      <p className="lede">2 to 6 players take turns on one device.</p>

      <section>
        <h2>Map</h2>
        <MapChoice value={map} onChange={setMap} />
      </section>

      <section>
        <h2>Players</h2>
        <div className="seg" role="group" aria-label="Number of players">
          {[2, 3, 4, 5, 6].map((n) => (
            <button key={n} className={n === count ? 'on' : ''} onClick={() => setCount(n)}>
              {n}
            </button>
          ))}
        </div>
        <div className="names">
          {names.slice(0, count).map((n, i) => (
            <label key={i}>
              <button
                type="button"
                className="swatch"
                style={{ background: PLAYER_COLORS[colors[i]].fill }}
                aria-label={`Player ${i + 1} colour: ${PLAYER_COLORS[colors[i]].name}. Change`}
                title="Change colour"
                onClick={() => nextColor(i)}
              />
              <input
                value={n}
                maxLength={16}
                aria-label={`Player ${i + 1} name`}
                onChange={(e) => setNames(names.map((x, j) => (j === i ? e.target.value : x)))}
              />
            </label>
          ))}
        </div>
        <p className="hint">Click a colour to change it.</p>
        {count === 2 && <p className="hint">With two players, a third of the map starts as neutral garrisons.</p>}
      </section>

      <section>
        <h2>How to win</h2>
        {(Object.keys(VICTORY_TEXT) as VictoryMode[]).map((m) => (
          <label key={m} className="radio">
            <input type="radio" name="victory" checked={victory === m} onChange={() => setVictory(m)} />
            <span>
              <b>{VICTORY_TEXT[m][0]}</b> — {VICTORY_TEXT[m][1]}
            </span>
          </label>
        ))}
      </section>

      <section>
        <h2>Setup</h2>
        <p className="hint">Each player takes a turn to choose a capital. The game begins once all capitals are chosen.</p>
        <label className="radio">
          <input type="checkbox" checked={quick} onChange={(e) => setQuick(e.target.checked)} />
          <span>
            <b>Quick setup</b> — once every capital is chosen, place starting armies at random and begin
          </span>
        </label>
      </section>

      <button className="primary big" onClick={start}>
        Start game
      </button>
    </MenuShell>
  );
}

// ----------------------------------------------------------------- game

export interface GameProps {
  names: Record<PlayerId, string>;
  update: GameUpdate;
  /** True when everyone shares this screen: whoever must act uses the controls. */
  hotseat?: boolean;
  /** The seat this screen controls in an online game; null for a spectator. */
  viewer: PlayerId | null;
  /** Submits an action. Returns an error message if it was refused on the spot. */
  send: (player: PlayerId, action: Action) => string | null;
  /** An error that arrived later, from the server. */
  serverError?: string;
  quit: { label: string; confirm: string; run: () => void };
  /** Shown in the result panel when the game is over. */
  finished: ReactNode;
  /** Extra content at the top of the side panel, such as connection status. */
  banner?: ReactNode;
  /** The colour each player chose. */
  colors?: Record<PlayerId, number>;
  /** When the current turn is played automatically, on this device's clock; null if untimed. */
  deadline?: number | null;
  chat?: ChatLine[];
  onChat?: (text: string) => void;
  /** Offered while this screen's player is still in an online game. */
  onSurrender?: () => void;
  /** The attack another player is lining up, so this screen can follow it. */
  aim?: { from: TerritoryId; to: TerritoryId } | null;
  /** Tells the other players which attack this screen's player is lining up, or null when they back out. */
  onAim?: (aim: { from: TerritoryId; to: TerritoryId } | null) => void;
}

function formatLeft(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function Game(props: GameProps) {
  const { names, update, hotseat = false, viewer, send, serverError, quit, finished, banner, deadline = null, chat, onChat, onSurrender, aim = null, onAim, colors } = props;
  const colorOf = colorLookup(colors);
  selectMap(update.view.map ?? 'india');
  const [game, setGame] = useState(update.view);
  const [log, setLog] = useState<string[]>([]);
  const [sel, setSel] = useState<{ from?: TerritoryId; to?: TerritoryId }>({});
  const [draft, setDraft] = useState<Record<TerritoryId, number>>({});
  const [rolls, setRolls] = useState<DiceEvent[]>([]);
  const [amount, setAmount] = useState(1);
  const [picked, setPicked] = useState<CardId[]>([]);
  const [showCards, setShowCards] = useState(!hotseat);
  const [error, setError] = useState('');
  const [anim, setAnim] = useState<RollAnim | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [quiet, setQuiet] = useState(isMuted);
  const [say, setSay] = useState('');
  const [clock, setClock] = useState(Date.now);
  const lastSeq = useRef(update.seq);

  const name = (id: string) => (id === 'neutral' ? 'the neutral garrison' : (names[id] ?? id));
  const players = game.turnOrder.map((id) => game.players[id]);
  const phase = game.phase;
  const inSetup = phase === 'setup-capital' || phase === 'setup-place';
  const pending = (p: (typeof players)[number]) => p.alive && (phase === 'setup-capital' ? !p.capitalChosen : !p.setupSubmitted);
  // Who must act now. During setup everyone online chooses at once; on a shared screen they take turns.
  const actor: PlayerId | null =
    phase === 'finished'
      ? null
      : inSetup
        ? hotseat
          ? (players.find(pending)?.id ?? null)
          : viewer && pending(game.players[viewer])
            ? viewer
            : null
        : currentPlayer(game);
  const canAct = actor !== null && (hotseat || actor === viewer) && !anim;
  const handOwner = hotseat ? actor : viewer;
  const me = handOwner ? game.players[handOwner] : null;
  const hand = me?.cards ?? [];
  const lead = phase === 'finished' ? game.winner : (actor ?? viewer);
  const monsoon = isMonsoon(game);
  const armiesAt = (t: TerritoryId) => game.territories[t].armies;
  const mine = (t: TerritoryId) => actor !== null && game.territories[t].owner === actor;

  useEffect(() => {
    setSel({});
    setPicked([]);
    setError('');
    if (phase === 'occupy' && game.pendingOccupy) setAmount(armiesAt(game.pendingOccupy.from) - 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actor, phase]);
  useEffect(() => {
    setShowCards(!hotseat);
    setDraft({});
    setRolls([]);
  }, [actor, hotseat]);
  useEffect(() => setError(serverError ?? ''), [serverError]);

  // Tell the player it is their turn even if they are looking at another tab.
  const myTurn = !hotseat && actor !== null && actor === viewer;
  useEffect(() => {
    if (myTurn) play('turn');
    document.title = myTurn ? '● Your turn — Rajmandala' : 'Rajmandala';
    return () => {
      document.title = 'Rajmandala';
    };
  }, [myTurn]);
  useEffect(() => {
    if (deadline === null) return;
    setClock(Date.now());
    const id = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(id);
  }, [deadline]);
  const left = deadline !== null && phase !== 'finished' ? deadline - clock : null;

  // Let the others watch this player line up an attack, and stop when they back out or the phase ends.
  const aiming = myTurn && phase === 'attack' && sel.from && sel.to ? `${sel.from}>${sel.to}` : '';
  useEffect(() => {
    onAim?.(aiming ? { from: sel.from!, to: sel.to! } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiming]);
  // What a watcher follows: the attack someone else is lining up, while it still makes sense on the board.
  const watched =
    !canAct && !myTurn && aim && phase === 'attack' && actor !== null && game.territories[aim.from]?.owner === actor && game.territories[aim.to]?.owner !== actor
      ? aim
      : null;

  function commit(next: GameView, lines: string[]) {
    setGame(next);
    if (lines.length) setLog((prev) => [...[...lines].reverse(), ...prev].slice(0, 200));
  }

  // A new update arrived. Battles are played out before the board catches up.
  useEffect(() => {
    if (update.seq === lastSeq.current) return;
    lastSeq.current = update.seq;
    const lines = update.events.map((e) => describe(e, name)).filter((x): x is string => x !== null);
    const dice = update.events.filter((e): e is DiceEvent => e.type === 'diceRolled');
    const carried = anim ? anim.lines : [];
    if (dice.length) {
      if (carried.length) setLog((prev) => [...[...carried].reverse(), ...prev].slice(0, 200));
      const captured = update.events.some((e) => e.type === 'territoryCaptured');
      setAnim({ rolls: dice, i: 0, settled: false, from: dice[0].from, to: dice[0].to, next: update.view, lines, captured });
    } else {
      setAnim(null);
      commit(update.view, [...carried, ...lines]);
    }
    if (update.events.some((e) => e.type === 'gameWon')) play('win');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [update]);

  function act(action: Action): boolean {
    if (!actor) return false;
    const refused = send(actor, action);
    setError(refused ?? '');
    return refused === null;
  }

  function finishRoll(a: RollAnim) {
    setAnim(null);
    setRolls(a.rolls);
    commit(a.next, a.lines);
    if (a.captured) play('capture');
    if (a.next.phase === 'attack' && a.next.territories[a.from].armies < 2) setSel({});
  }

  // One roll at a time: the dice tumble, settle, and the armies on the board change.
  useEffect(() => {
    if (!anim) return;
    const blitz = anim.rolls.length > 1;
    const wait = anim.settled ? (blitz ? 700 : 1100) : blitz ? 800 : 1400;
    const id = setTimeout(() => {
      if (!anim.settled) {
        play('dice');
        setAnim({ ...anim, settled: true });
      }
      else if (anim.i < anim.rolls.length - 1) setAnim({ ...anim, i: anim.i + 1, settled: false });
      else finishRoll(anim);
    }, wait);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anim]);

  const seen = anim ? anim.rolls.slice(0, anim.i + (anim.settled ? 1 : 0)) : [];
  const armiesShown = (t: TerritoryId) =>
    armiesAt(t) -
    (anim && t === anim.from ? seen.reduce((n, r) => n + r.attackerLost, 0) : 0) -
    (anim && t === anim.to ? seen.reduce((n, r) => n + r.defenderLost, 0) : 0);

  // ---- what can be clicked on the map right now
  const forcedTrade = canAct && phase === 'attack' && hand.length >= 5;
  const placing = (phase === 'reinforce' || phase === 'attack') && game.pendingReinforcements > 0 && !forcedTrade;
  const draftTotal = Object.values(draft).reduce((a, b) => a + b, 0);
  const setupLeft = (me?.setupArmies ?? 0) - draftTotal;
  const own = canAct ? territoriesOf(game, actor!) : [];
  let clickable = new Set<TerritoryId>();
  let targets = new Set<TerritoryId>();
  if (!canAct) {
    // Not this screen's move: nothing on the map responds.
  } else if (phase === 'setup-capital' || phase === 'setup-place' || placing) {
    clickable = new Set(own);
  } else if (phase === 'attack' && !forcedTrade) {
    const foes = (t: TerritoryId) => neighbors(t, !monsoon).filter((n) => !mine(n));
    clickable = new Set(own.filter((t) => armiesAt(t) >= 2 && foes(t).length > 0));
    if (sel.from) targets = new Set(foes(sel.from));
    targets.forEach((t) => clickable.add(t));
  } else if (phase === 'fortify') {
    clickable = new Set(own.filter((t) => armiesAt(t) > 1));
    if (sel.from) targets = new Set(own.filter((t) => t !== sel.from && isConnected(game, actor!, sel.from!, t)));
    targets.forEach((t) => clickable.add(t));
  }

  function onPick(t: TerritoryId, many: boolean) {
    if (phase === 'setup-capital') return void act({ type: 'chooseCapital', territory: t });
    if (phase === 'setup-place') {
      const n = Math.min(many ? 5 : 1, setupLeft);
      if (n > 0) setDraft({ ...draft, [t]: (draft[t] ?? 0) + n });
      return;
    }
    if (placing) {
      act({ type: 'place', territory: t, armies: Math.min(many ? 5 : 1, game.pendingReinforcements) });
      return setSel({ from: t });
    }
    if (sel.from && targets.has(t)) {
      if (phase === 'fortify') setAmount(armiesAt(sel.from) - 1);
      return setSel({ from: sel.from, to: t });
    }
    setSel(t === sel.from ? {} : { from: t });
  }

  function attack(dice: number, blitz: boolean) {
    const { from, to } = sel;
    if (!from || !to) return;
    act({ type: 'attack', from, to, dice, blitz });
  }

  // ---- the panel for the current phase
  function controls() {
    if (phase === 'finished') return null;
    if (anim) {
      return (
        <>
          <p>
            <b>{territory(anim.from).name}</b> attacks <b>{territory(anim.to).name}</b>
            {anim.rolls.length > 1 && ` — roll ${anim.i + 1} of ${anim.rolls.length}`}
          </p>
          <button onClick={() => finishRoll(anim)}>Skip</button>
        </>
      );
    }
    if (!canAct) {
      if (inSetup) {
        const waiting = players.filter(pending).map((p) => name(p.id));
        return <p>Waiting for {waiting.join(', ') || 'the game to begin'} to {phase === 'setup-capital' ? 'choose a capital' : 'place armies'}.</p>;
      }
      if (watched) {
        return (
          <p>
            {name(actor!)} is lining up an attack: <b>{territory(watched.from).name}</b> on <b>{territory(watched.to).name}</b>.
          </p>
        );
      }
      return <p>{viewer ? `Waiting for ${name(actor!)} to play.` : `${name(actor!)} is playing.`}</p>;
    }
    if (phase === 'setup-capital') {
      const alive = players.filter((p) => p.alive);
      return (
        <>
          <p className="hint">
            {hotseat
              ? `Capital ${alive.filter((p) => p.capitalChosen).length + 1} of ${alive.length}`
              : 'Everyone chooses at the same time. Capitals are revealed together.'}
          </p>
          <p>
            <b>{name(actor!)}</b>, choose your capital: click one of your territories. It gives +1 army each turn and its
            defenders re-roll 1s.
          </p>
          <button onClick={() => onPick(pick(own), false)}>Choose at random</button>
        </>
      );
    }
    if (phase === 'setup-place') {
      return (
        <>
          <p>
            Place your starting armies: <b>{setupLeft}</b> left. Click a territory to add 1, Shift-click to add 5.
          </p>
          <div className="row">
            <button disabled={setupLeft === 0} onClick={() => setDraft(randomPlacement(game, actor!, setupLeft, Math.random, draft))}>
              Spread the rest
            </button>
            <button disabled={draftTotal === 0} onClick={() => setDraft({})}>
              Reset
            </button>
            <button className="primary" disabled={setupLeft !== 0} onClick={() => act({ type: 'setupPlace', placements: draft })}>
              Confirm
            </button>
          </div>
        </>
      );
    }
    if (forcedTrade) {
      return (
        <>
          <p>You hold {hand.length} cards and must trade a set before you continue.</p>
          {tradeOffer}
        </>
      );
    }
    if (placing) {
      const b = calcReinforcements(game, actor!);
      return (
        <>
          <p>
            Place armies: <b>{game.pendingReinforcements}</b> left. Click a territory to add 1, Shift-click to add 5.
          </p>
          {phase === 'reinforce' && (
            <p className="hint">
              This turn: {b.territories} for territories
              {b.regions > 0 && `, ${b.regions} for regions`}
              {b.outposts > 0 && `, ${b.outposts} for outposts`}
              {b.capital > 0 && ', 1 for your capital'}.
            </p>
          )}
          {tradeOffer}
          {sel.from && mine(sel.from) && (
            <button onClick={() => act({ type: 'place', territory: sel.from!, armies: game.pendingReinforcements })}>
              Place all {game.pendingReinforcements} on {territory(sel.from).name}
            </button>
          )}
        </>
      );
    }
    if (phase === 'reinforce') {
      return (
        <>
          <p>All armies placed. Trade cards if you wish, then attack.</p>
          {tradeOffer}
          <button className="primary" onClick={() => act({ type: 'endPhase' })}>
            Go to attack
          </button>
        </>
      );
    }
    if (phase === 'attack') {
      const { from, to } = sel;
      const max = from && to ? Math.min(maxAttackDice(game, to), armiesAt(from) - 1) : 0;
      return (
        <>
          {!from && <p>Click one of your territories with 2 or more armies, then an enemy next to it.</p>}
          {from && !to && <p>Attacking from {territory(from).name}. Now click a highlighted enemy territory.</p>}
          {from && to && (
            <>
              <p>
                <b>{territory(from).name}</b> ({armiesAt(from)}) attacks <b>{territory(to).name}</b> ({armiesAt(to)}),
                held by {name(game.territories[to].owner)}.
                {maxAttackDice(game, to) < 3 && (
                  <span className="hint">
                    {' '}
                    At most {maxAttackDice(game, to)} {maxAttackDice(game, to) === 1 ? 'die' : 'dice'}
                    {territory(to).mountain ? ' into mountains' : ''}
                    {monsoon ? ' in the Monsoon' : ''}.
                  </span>
                )}
              </p>
              <div className="row">
                {[1, 2, 3]
                  .filter((d) => d <= max)
                  .map((d) => (
                    <button key={d} onClick={() => attack(d, false)}>
                      Roll {d}
                    </button>
                  ))}
                <button className="primary" disabled={max < 1} onClick={() => attack(max, true)}>
                  Blitz
                </button>
              </div>
              <p className="hint">Roll one round at a time, or Blitz to keep rolling until it is decided.</p>
              <button onClick={() => setSel({})}>Leave this attack</button>
            </>
          )}
          <button onClick={() => act({ type: 'endPhase' })}>End attacks</button>
        </>
      );
    }
    if (phase === 'occupy' && game.pendingOccupy) {
      const o = game.pendingOccupy;
      const max = armiesAt(o.from) - 1;
      const n = Math.max(o.min, Math.min(max, amount));
      return (
        <>
          <p>
            You took <b>{territory(o.to).name}</b>. Move armies in from {territory(o.from).name}: <b>{n}</b>
            {o.capitalBonus > 0 && ` (+${o.capitalBonus} for the capital)`}
          </p>
          <input type="range" min={o.min} max={max} value={n} aria-label="Armies to move in" onChange={(e) => setAmount(+e.target.value)} />
          <div className="row">
            {o.min < n && <button onClick={() => act({ type: 'occupy', armies: o.min })}>Move {o.min}</button>}
            <button className="primary" onClick={() => act({ type: 'occupy', armies: n })}>
              Move {n}
            </button>
          </div>
        </>
      );
    }
    // fortify
    const { from, to } = sel;
    const max = from ? armiesAt(from) - 1 : 0;
    const n = Math.max(1, Math.min(max, amount));
    return (
      <>
        {!from && <p>Optional: move armies once between two of your connected territories. Click the one to move from.</p>}
        {from && !to && <p>Moving from {territory(from).name}. Click a highlighted territory to move to.</p>}
        {from && to && (
          <>
            <p>
              Move <b>{n}</b> from {territory(from).name} to {territory(to).name}.
            </p>
            <input type="range" min={1} max={max} value={n} aria-label="Armies to move" onChange={(e) => setAmount(+e.target.value)} />
            <button className="primary" onClick={() => act({ type: 'fortify', from, to, armies: n })}>
              Move and end turn
            </button>
          </>
        )}
        <button onClick={() => act({ type: 'endPhase' })}>End turn without moving</button>
      </>
    );
  }

  const canTrade = !anim && (phase === 'reinforce' || forcedTrade);
  const tradeValue = picked.length === 3 ? setValue(picked) : null;
  const best = bestSet(hand);
  // The best set is picked out for the player whenever their hand or their chance to trade changes.
  const handKey = hand.join();
  useEffect(() => {
    if (canTrade && best) setPicked(best);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handKey, canTrade]);
  const tradeOffer =
    canTrade && best ? (
      <button
        onClick={() => {
          if (act({ type: 'trade', cards: best })) setPicked([]);
        }}
      >
        Trade your best set for {setValue(best)} armies
      </button>
    ) : null;
  const shownRoll = anim ? anim.rolls[anim.i] : rolls[rolls.length - 1];
  const tumbling = anim !== null && !anim.settled;
  const tally = anim ? seen : rolls;
  const steps = ['reinforce', 'attack', 'fortify'];
  const stepNow = phase === 'occupy' ? 'attack' : phase;

  return (
    <div className="game">
      <div className="mapwrap">
        <Board
          game={game}
          armies={(t) => armiesShown(t) + (phase === 'setup-place' && canAct && mine(t) ? (draft[t] ?? 0) : 0)}
          colorOf={colorOf}
          nameOf={name}
          clickable={phase === 'finished' || anim ? new Set() : clickable}
          targets={targets}
          from={anim ? anim.from : phase === 'occupy' ? game.pendingOccupy?.from : (watched?.from ?? sel.from)}
          to={anim ? anim.to : phase === 'occupy' ? game.pendingOccupy?.to : (watched?.to ?? sel.to)}
          focus={
            canAct && phase === 'attack' && sel.from && sel.to
              ? { from: sel.from, to: sel.to }
              : phase === 'occupy' && game.pendingOccupy && !anim
                ? { from: game.pendingOccupy.from, to: game.pendingOccupy.to }
                : watched
          }
          battle={
            anim
              ? {
                  from: anim.from,
                  to: anim.to,
                  roll: anim.i,
                  settled: anim.settled,
                  attackerLost: anim.rolls[anim.i].attackerLost,
                  defenderLost: anim.rolls[anim.i].defenderLost,
                }
              : null
          }
          onPick={onPick}
        />
        <div className="legend">
          <button className="chipbtn" onClick={() => setRulesOpen(true)}>
            How to play
          </button>
          <button
            className="chipbtn"
            aria-pressed={!quiet}
            onClick={() => {
              setMuted(!quiet);
              setQuiet(!quiet);
            }}
          >
            Sound {quiet ? 'off' : 'on'}
          </button>
          <span className="chip">
            Troops: <b>■</b> 10 <b>▲</b> 5 <b>●</b> 1
          </span>
          <span className="chip">Tower: a capital, in its founder's colour</span>
          <span className="chip">Peak: mountain, attackers roll one die fewer</span>
          <span className="chip">┄ sea route</span>
          <span className="credit">
            {(game.map ?? 'india') === 'india' ? (
              <>
                Boundaries: <a href="https://github.com/datameet/maps">DataMeet India community</a>, CC BY 2.5 IN
              </>
            ) : (
              <>
                Boundaries: <a href="https://github.com/datameet/Municipal_Spatial_Data">DataMeet India community</a>, CC BY-SA 2.5 IN
              </>
            )}
          </span>
        </div>
      </div>

      <aside className="side">
        {banner}
        <header className="turn" style={{ borderColor: colorOf(lead ?? 'neutral').fill }}>
          <div className="who">
            <span className="dot big" style={{ background: colorOf(lead ?? 'neutral').fill }} />
            <h1>
              {phase === 'finished'
                ? `${name(game.winner!)} wins`
                : actor === null
                  ? 'Choosing capitals'
                  : !hotseat && actor === viewer
                    ? 'Your turn'
                    : name(actor)}
            </h1>
          </div>
          <div className="meta">
            {inSetup ? 'Setup' : `Round ${game.round}`}
            {monsoon && <span className="badge monsoon">Monsoon</span>}
            {!inSetup && !monsoon && (game.round + 1) % 4 === 0 && <span className="badge">Monsoon next round</span>}
            {left !== null && (
              <span className={`badge timer ${left < 15_000 ? 'low' : ''}`} title="Time left before this turn is played automatically">
                {formatLeft(left)}
              </span>
            )}
          </div>
          {!inSetup && phase !== 'finished' && (
            <ol className="steps">
              {steps.map((s) => (
                <li key={s} className={s === stepNow ? 'now' : ''}>
                  {s}
                </li>
              ))}
            </ol>
          )}
        </header>

        {phase === 'finished' ? (
          <section className="panel">
            <p>
              {VICTORY_TEXT[game.victory][0]} victory after {game.round} rounds.
            </p>
            {finished}
          </section>
        ) : (
          <section className="panel controls">
            {controls()}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </section>
        )}

        {shownRoll && (
          <section className="panel dice">
            <div className="dicerow">
              <span className="lbl">Attack</span>
              {shownRoll.attack.map((d, i) => (
                <Die key={i} value={d} rolling={tumbling} lost={i < shownRoll.defence.length && d <= shownRoll.defence[i]} />
              ))}
            </div>
            <div className="dicerow">
              <span className="lbl">Defence</span>
              {shownRoll.defence.map((d, i) => (
                <Die key={i} value={d} rolling={tumbling} defence lost={i < shownRoll.attack.length && shownRoll.attack[i] > d} />
              ))}
              {!tumbling && shownRoll.rerolled && <span className="hint">capital re-roll</span>}
            </div>
            <p className="hint" aria-live="polite">
              {tumbling && tally.length === 0
                ? 'Rolling…'
                : `${tally.length > 1 || (anim && anim.rolls.length > 1) ? `After ${tally.length} ${tally.length === 1 ? 'roll' : 'rolls'}: ` : ''}attacker lost ${tally.reduce((n, r) => n + r.attackerLost, 0)}, defender lost ${tally.reduce((n, r) => n + r.defenderLost, 0)}.`}
            </p>
          </section>
        )}

        {!inSetup && phase !== 'finished' && me && (
          <section className="panel">
            <div className="row between">
              <h2>
                {hotseat ? `${name(me.id)}'s cards` : 'Your cards'} ({hand.length})
              </h2>
              <button className="link" onClick={() => setShowCards(!showCards)}>
                {showCards ? 'Hide' : 'Show'}
              </button>
            </div>
            {showCards && hand.length === 0 && <p className="hint">No cards yet. Capture a territory to draw one at the end of your turn.</p>}
            {showCards && hand.length > 0 && (
              <>
                <div className="cards">
                  {hand.map((c) => {
                    const wild = WILD_CARDS.includes(c);
                    const on = picked.includes(c);
                    return (
                      <button
                        key={c}
                        className={`card ${wild ? 'ratha' : territory(c).suit} ${on ? 'on' : ''}`}
                        aria-pressed={on}
                        disabled={!canTrade}
                        onClick={() => setPicked(on ? picked.filter((x) => x !== c) : picked.length < 3 ? [...picked, c] : picked)}
                      >
                        <b>{wild ? 'Ratha' : SUIT_LABEL[territory(c).suit]}</b>
                        <span>{wild ? 'wild' : territory(c).name}</span>
                      </button>
                    );
                  })}
                </div>
                {canTrade ? (
                  <div className="row">
                    <button disabled={!best} onClick={() => best && setPicked(best)}>
                      Pick best set
                    </button>
                    <button
                      className="primary"
                      disabled={tradeValue === null}
                      onClick={() => {
                        if (act({ type: 'trade', cards: picked as [CardId, CardId, CardId] })) setPicked([]);
                      }}
                    >
                      {tradeValue !== null ? `Trade for ${tradeValue}` : picked.length === 3 ? 'Not a set' : 'Trade'}
                    </button>
                  </div>
                ) : (
                  <p className="hint">Cards are traded at the start of your turn.</p>
                )}
              </>
            )}
          </section>
        )}

        <section className="panel">
          <h2>{VICTORY_TEXT[game.victory][0]}</h2>
          <p className="hint">{VICTORY_TEXT[game.victory][1]}.</p>
          <table className="players">
            <thead>
              <tr>
                <th>Player</th>
                <th title="Territories">Terr.</th>
                <th>Armies</th>
                <th>Cards</th>
              </tr>
            </thead>
            <tbody>
              {players.map((p) => {
                const held = territoriesOf(game, p.id);
                return (
                  <tr key={p.id} className={`${p.alive ? '' : 'out'} ${p.id === actor ? 'active' : ''}`}>
                    <td>
                      <span className="dot" style={{ background: colorOf(p.id).fill }} />
                      {name(p.id)}
                      {p.capital && !inSetup && game.territories[p.capital].owner === p.id && <span title="Holds own capital"> ♜</span>}
                    </td>
                    <td>{held.length}</td>
                    <td>{held.reduce((n, t) => n + armiesAt(t), 0)}</td>
                    <td>{p.cardCount}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        {chat && onChat && (
          <section className="panel chat">
            <h2>Chat</h2>
            <ul>
              {chat.slice(-12).map((c) => (
                <li key={c.at + c.from}>
                  <b style={{ color: colorOf(c.from).fill }}>{c.name}</b> {c.text}
                </li>
              ))}
            </ul>
            {viewer && (
              <form
                className="row"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!say.trim()) return;
                  onChat(say);
                  setSay('');
                }}
              >
                <input value={say} maxLength={200} placeholder="Say something" aria-label="Chat message" onChange={(e) => setSay(e.target.value)} />
                <button disabled={!say.trim()}>Send</button>
              </form>
            )}
          </section>
        )}

        <section className="panel log">
          <h2>Log</h2>
          {log.length === 0 && <p className="hint">Nothing yet.</p>}
          <ul>
            {log.slice(0, 40).map((l, i) => (
              <li key={log.length - i}>{l}</li>
            ))}
          </ul>
        </section>

        {onSurrender && phase !== 'finished' && viewer && game.players[viewer]?.alive && (
          <button
            className="link quit"
            onClick={() => {
              if (window.confirm('Surrender? Your territories become neutral and you are out of this game.')) onSurrender();
            }}
          >
            Surrender
          </button>
        )}
        {rulesOpen && <Rules onClose={() => setRulesOpen(false)} />}
        <button
          className="link quit"
          onClick={() => {
            if (phase === 'finished' || window.confirm(quit.confirm)) quit.run();
          }}
        >
          {quit.label}
        </button>
      </aside>
    </div>
  );
}

// ----------------------------------------------------------------- dice

/** A die drawn with pips. While rolling it tumbles through random faces, then settles on its value. */
function Die({ value, rolling, defence, lost }: { value: number; rolling: boolean; defence?: boolean; lost: boolean }) {
  const [face, setFace] = useState(value);
  useEffect(() => {
    if (!rolling) return setFace(value);
    const id = setInterval(() => setFace(1 + Math.floor(Math.random() * 6)), 90);
    return () => clearInterval(id);
  }, [rolling, value]);
  const cls = ['die', defence ? 'def' : '', rolling ? 'rolling' : lost ? 'lost' : 'won'].join(' ');
  return (
    <span className={cls} role="img" aria-label={rolling ? 'rolling' : `${value}${lost ? ', lost' : ''}`}>
      {Array.from({ length: 9 }, (_, i) => (
        <i key={i} className={PIPS[face].includes(i) ? 'pip' : ''} />
      ))}
    </span>
  );
}

/** Picks the map for a new game. */
export function MapChoice({ value, onChange, disabled }: { value: MapId; onChange: (map: MapId) => void; disabled?: boolean }) {
  return (
    <div className="mapchoice" role="radiogroup" aria-label="Map">
      {(Object.keys(MAPS) as MapId[]).map((id) => (
        <button key={id} type="button" role="radio" aria-checked={value === id} className={value === id ? 'on' : ''} disabled={disabled} onClick={() => onChange(id)}>
          <b>{MAPS[id].name}</b>
          <span>{MAPS[id].blurb}</span>
        </button>
      ))}
    </div>
  );
}
