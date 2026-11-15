import { useEffect, useMemo, useRef, useState } from 'react';
import type { Action, PlayerId, VictoryMode } from '@rajmandala/engine';
import { TURN_SECONDS } from '@rajmandala/server';
import type { RoomOptions, ServerMsg } from '@rajmandala/server';
import { Game, VICTORY_TEXT, colorOf } from './App';
import type { GameUpdate } from './App';
import { guestSlot } from './Root';
import { apiUrl, identityKey, openRoom, saveName, savedName } from './net';
import type { NetStatus, RoomSocket } from './net';

type State = Extract<ServerMsg, { t: 'state' }>;

export function OnlineRoom({ code, onExit }: { code: string; onExit: () => void }) {
  const slot = guestSlot();
  const [name, setName] = useState(savedName(slot));
  const [entered, setEntered] = useState(name.trim().length > 0);
  const [status, setStatus] = useState<NetStatus>('connecting');
  const [state, setState] = useState<State | null>(null);
  const [problem, setProblem] = useState<{ text: string; n: number } | null>(null);
  const [missing, setMissing] = useState(false);
  const [games, setGames] = useState(0);
  const sock = useRef<RoomSocket | null>(null);
  const wasLobby = useRef(true);
  /** Server clock minus this device's clock, so deadlines count down correctly here. */
  const skew = useRef(0);

  useEffect(() => {
    if (!entered) return;
    let live = true;
    void fetch(apiUrl(`/api/rooms/${code}`)).then((res) => {
      if (!live) return;
      if (res.status === 404) return setMissing(true);
      sock.current = openRoom(
        code,
        { key: identityKey(slot), name: name.trim() },
        (msg) => {
          if (msg.t === 'error') {
            if (msg.code === 'upgrade-required') return location.reload();
            return setProblem((p) => ({ text: msg.message, n: (p?.n ?? 0) + 1 }));
          }
          // A fresh game gets a fresh screen, including after a rematch.
          if (msg.room.status !== 'lobby' && wasLobby.current) setGames((g) => g + 1);
          wasLobby.current = msg.room.status === 'lobby';
          skew.current = msg.now - Date.now();
          setProblem(null);
          setState(msg);
        },
        setStatus,
      );
    });
    return () => {
      live = false;
      sock.current?.close();
      sock.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, entered]);

  const update = useMemo<GameUpdate | null>(
    () => (state?.game ? { seq: state.seq, view: state.game, events: state.events } : null),
    [state],
  );

  if (!entered) {
    return (
      <main className="newgame home">
        <h1>Join room {code}</h1>
        <section>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              saveName(name.trim(), slot);
              setEntered(true);
            }}
          >
            <label className="field">
              <span>Your name</span>
              <input value={name} maxLength={16} autoFocus onChange={(e) => setName(e.target.value)} />
            </label>
            <button className="primary big" disabled={!name.trim()}>
              Join
            </button>
          </form>
        </section>
      </main>
    );
  }
  if (missing) {
    return (
      <main className="newgame home">
        <h1>Room not found</h1>
        <p className="lede">There is no room with the code {code}. It may have been mistyped.</p>
        <button onClick={onExit}>Back to start</button>
      </main>
    );
  }
  if (!state) {
    return (
      <main className="newgame home">
        <h1>Room {code}</h1>
        <p className="lede">{status === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'}</p>
        <button onClick={onExit}>Cancel</button>
      </main>
    );
  }

  const send = sock.current!;
  const { room, you } = state;
  const isHost = you !== null && you === room.hostId;
  const names = Object.fromEntries(room.members.map((m) => [m.id, m.bot ? `${m.name} (bot)` : m.name])) as Record<PlayerId, string>;
  const offline = room.members.filter((m) => !m.online && !m.bot).map((m) => m.name);
  const link = (
    <p className={`net ${status}`} role="status">
      <span className="lamp" />
      {status === 'open' ? `Room ${room.code}` : 'Reconnecting…'}
      {status === 'open' && you === null && ' · watching'}
      {status === 'open' && offline.length > 0 && <span className="hint"> · offline: {offline.join(', ')}</span>}
    </p>
  );

  if (room.status === 'lobby' || !update) {
    return <Lobby state={state} isHost={isHost} banner={link} problem={problem?.text} send={send} onExit={onExit} />;
  }

  return (
    <Game
      key={games}
      names={names}
      update={update}
      viewer={you}
      send={(_player: PlayerId, action: Action) => {
        send.action(action);
        return null;
      }}
      serverError={problem ? problem.text : undefined}
      banner={link}
      deadline={state.deadline === null ? null : state.deadline - skew.current}
      chat={state.chat}
      onChat={(text) => send.send({ t: 'chat', text })}
      onSurrender={() => send.action({ type: 'surrender' })}
      quit={{ label: 'Leave room', confirm: 'Leave this room? Your seat is kept and you can come back with the same link.', run: onExit }}
      finished={
        <div className="row">
          {isHost ? (
            <button className="primary" onClick={() => send.send({ t: 'rematch' })}>
              Rematch
            </button>
          ) : (
            <span className="hint">The host can start a rematch.</span>
          )}
          <button onClick={onExit}>Leave room</button>
        </div>
      }
    />
  );
}

function Lobby(props: { state: State; isHost: boolean; banner: React.ReactNode; problem?: string; send: RoomSocket; onExit: () => void }) {
  const { state, isHost, banner, problem, send, onExit } = props;
  const { room, you } = state;
  const [copied, setCopied] = useState(false);
  const me = room.members.find((m) => m.id === you);
  const invite = `${location.origin}${location.pathname}#/r/${room.code}`;
  const others = room.members.filter((m) => m.id !== room.hostId);
  const canStart = room.members.length >= 2 && others.every((m) => m.ready || m.bot);
  const timerText = (s: number) => (s === 0 ? 'Off' : s === 86400 ? '1 day' : `${s / 60} min`);
  const setOptions = (patch: Partial<RoomOptions>) => send.send({ t: 'options', options: { ...room.options, ...patch } });

  async function copy() {
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ title: 'Rajmandala', url: invite });
      else await navigator.clipboard.writeText(invite);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* the link is shown on screen to copy by hand */
    }
  }

  return (
    <main className="newgame lobby">
      {banner}
      <h1>Room {room.code}</h1>
      <p className="lede">Share the link or the code. The game starts when the host is ready.</p>

      <section>
        <h2>Invite</h2>
        <div className="invite">
          <output className="bigcode" aria-label="Room code">
            {room.code}
          </output>
          <div>
            <input readOnly value={invite} aria-label="Invite link" onFocus={(e) => e.target.select()} />
            <button onClick={copy}>{copied ? 'Copied' : 'Copy invite link'}</button>
          </div>
        </div>
      </section>

      <section>
        <h2>
          Players ({room.members.length} of {room.options.seats})
        </h2>
        <ul className="seats">
          {room.members.map((m) => (
            <li key={m.id} className={m.online ? '' : 'away'}>
              <span className="dot" style={{ background: colorOf(m.id).fill }} />
              <span className="who">
                {m.name}
                {m.id === you && ' (you)'}
              </span>
              {m.bot ? (
                <span className="badge">Computer</span>
              ) : m.id === room.hostId ? (
                <span className="badge">Host</span>
              ) : (
                <span className={`badge ${m.ready ? 'ok' : ''}`}>{m.ready ? 'Ready' : 'Not ready'}</span>
              )}
              {!m.online && !m.bot && <span className="badge">Offline</span>}
              {isHost && m.id !== you && (
                <button className="link" onClick={() => send.send({ t: 'kick', id: m.id })}>
                  Remove
                </button>
              )}
            </li>
          ))}
          {Array.from({ length: room.options.seats - room.members.length }, (_, i) => (
            <li key={`empty-${i}`} className="empty">
              Open seat
            </li>
          ))}
        </ul>
        {isHost && room.members.length < room.options.seats && (
          <button onClick={() => send.send({ t: 'addBot' })}>Add a computer player</button>
        )}
        {you === null && <p className="hint">The table is full, so you are watching. You will see the game when it starts.</p>}
      </section>

      <section>
        <h2>Game options</h2>
        {isHost ? (
          <>
            <div className="row">
              <span>Seats</span>
              <div className="seg" role="group" aria-label="Seats">
                {[2, 3, 4, 5, 6].map((n) => (
                  <button key={n} className={n === room.options.seats ? 'on' : ''} disabled={n < room.members.length} onClick={() => setOptions({ seats: n })}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <div className="row">
              <span>Turn timer</span>
              <div className="seg" role="group" aria-label="Turn timer">
                {TURN_SECONDS.map((s) => (
                  <button key={s} className={s === room.options.turnSeconds ? 'on' : ''} onClick={() => setOptions({ turnSeconds: s })}>
                    {timerText(s)}
                  </button>
                ))}
              </div>
            </div>
            <p className="hint">When time runs out the turn is finished automatically. After three missed turns a computer player minds the seat.</p>
            {(Object.keys(VICTORY_TEXT) as VictoryMode[]).map((v) => (
              <label key={v} className="radio">
                <input type="radio" name="victory" checked={room.options.victory === v} onChange={() => setOptions({ victory: v })} />
                <span>
                  <b>{VICTORY_TEXT[v][0]}</b> — {VICTORY_TEXT[v][1]}
                </span>
              </label>
            ))}
            <label className="radio">
              <input type="checkbox" checked={room.options.autoPlace} onChange={(e) => setOptions({ autoPlace: e.target.checked })} />
              <span>
                <b>Quick setup</b> — place starting armies at random once every capital is chosen
              </span>
            </label>
          </>
        ) : (
          <p>
            <b>{VICTORY_TEXT[room.options.victory][0]}</b> — {VICTORY_TEXT[room.options.victory][1]}.{' '}
            {room.options.autoPlace ? 'Starting armies are placed at random.' : 'Players place their own starting armies.'} Turn timer: {timerText(room.options.turnSeconds).toLowerCase()}.
          </p>
        )}
      </section>

      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
      {isHost && (
        <button className="primary big" disabled={!canStart} onClick={() => send.send({ t: 'start' })}>
          {room.members.length < 2 ? 'Waiting for another player' : canStart ? 'Start game' : 'Waiting for everyone to be ready'}
        </button>
      )}
      {me && !isHost && (
        <button className="primary big" onClick={() => send.send({ t: 'ready', ready: !me.ready })}>
          {me.ready ? 'Not ready after all' : "I'm ready"}
        </button>
      )}
      <button
        className="link quit"
        onClick={() => {
          if (me) send.send({ t: 'leave' });
          onExit();
        }}
      >
        Leave room
      </button>
    </main>
  );
}
