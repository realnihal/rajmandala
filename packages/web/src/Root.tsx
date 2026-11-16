import { useEffect, useState } from 'react';
import { HotSeat } from './App';
import { OnlineRoom } from './Online';
import { Brand, MenuShell } from './Menu';
import { Rules } from './Rules';
import { apiUrl, saveName, savedName } from './net';

const CODE = /^[A-Z0-9]{6}$/;

function useHash(): string {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

/** Guest slot from the page address (?guest=2): a second identity for trying multiplayer in one browser. */
export const guestSlot = () => new URLSearchParams(location.search).get('guest') ?? '';

export default function Root() {
  const hash = useHash();
  const home = () => {
    location.hash = '';
  };
  const room = hash.match(/^#\/r\/([A-Za-z0-9]{6})$/);
  if (room) return <OnlineRoom key={room[1].toUpperCase()} code={room[1].toUpperCase()} onExit={home} />;
  if (hash === '#/local') return <HotSeat onExit={home} />;
  return <Home />;
}

function Home() {
  const slot = guestSlot();
  const [name, setName] = useState(savedName(slot));
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [rules, setRules] = useState(false);
  const named = name.trim().length > 0;
  const joinCode = code.trim().toUpperCase();

  const remember = () => saveName(name.trim(), slot);

  async function create() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(apiUrl('/api/rooms'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      if (res.status === 429) return setError('You have created a lot of rooms recently. Please try again later.');
      if (!res.ok) throw new Error();
      const { code: made } = (await res.json()) as { code: string };
      remember();
      location.hash = `#/r/${made}`;
    } catch {
      setError('Could not create a room. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function join() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(apiUrl(`/api/rooms/${joinCode}`));
      if (res.status === 404) return setError(`There is no room with the code ${joinCode}.`);
      if (!res.ok) throw new Error();
      remember();
      location.hash = `#/r/${joinCode}`;
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <MenuShell className="home">
      <Brand />
      <ul className="points">
        <li>The real map of India, in 43 territories</li>
        <li>Online with friends, or on one screen</li>
        <li>Computer players fill empty seats</li>
      </ul>

      <section>
        <h2>Play online</h2>
        <label className="field">
          <span>Your name</span>
          <input value={name} maxLength={16} placeholder="e.g. Asha" onChange={(e) => setName(e.target.value)} />
        </label>
        <button className="primary big" disabled={!named || busy} onClick={create}>
          Create a room
        </button>
        <p className="or">or join a friend's room</p>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (named && CODE.test(joinCode)) void join();
          }}
        >
          <input
            className="code"
            value={code}
            maxLength={6}
            placeholder="ROOM CODE"
            aria-label="Room code"
            autoCapitalize="characters"
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <button disabled={!named || busy || !CODE.test(joinCode)}>Join</button>
        </form>
        {!named && <p className="hint">Enter your name to create or join a room.</p>}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>

      <section>
        <h2>Play on this screen</h2>
        <p className="hint">Everyone shares one device and takes turns.</p>
        <button
          onClick={() => {
            location.hash = '#/local';
          }}
        >
          Start a shared-screen game
        </button>
      </section>

      <button className="link" onClick={() => setRules(true)}>
        How to play
      </button>
      {rules && <Rules onClose={() => setRules(false)} />}
    </MenuShell>
  );
}
