import { useEffect, useRef } from 'react';
import { MAPS, REGIONS, TERRITORIES, activeMap, samrajyaTarget } from '@rajmandala/engine';

/** The rules of the game on one page, shown over the board. */
export function Rules({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  return (
    <dialog ref={ref} className="rules" onClose={onClose} onClick={(e) => e.target === ref.current && onClose()}>
      <div className="rulesbody">
        <header>
          <h1>How to play</h1>
          <button onClick={onClose} aria-label="Close">
            Close
          </button>
        </header>

        <h2>Goal</h2>
        <p>
          Conquer the map. The default win is to hold <b>{samrajyaTarget()} of the {TERRITORIES.length} territories</b> at the end of your own turn. A room can
          instead be set to eliminating everyone, or to holding your capital and two enemy capitals.
        </p>

        <h2>Setup</h2>
        <p>
          Territories are dealt out at random. Each player then chooses one of theirs as a <b>capital</b>, marked with a tower. A capital
          gives +1 army each turn and its defenders re-roll 1s.
        </p>

        <h2>Your turn</h2>
        <ol>
          <li>
            <b>Reinforce.</b> You receive armies: one for every three territories you hold (at least 3), plus region bonuses, +1 for each
            island outpost and +1 for your capital. Place them all on your own territories.
          </li>
          <li>
            <b>Attack</b> (optional, as often as you like). Pick one of your territories with 2 or more armies, then an enemy next to it.
            You roll up to 3 dice and must leave one army behind; the defender rolls up to 2. Highest dice are compared, then second
            highest; the lower die loses an army and <b>ties go to the defender</b>. Blitz keeps rolling until the fight is decided.
          </li>
          <li>
            <b>Fortify</b> (optional, once). Move armies between two of your territories that are connected through your own land.
          </li>
        </ol>

        <h2>Regions</h2>
        <p>Hold every territory inside a coloured boundary to earn its bonus each turn.</p>
        <ul className="cols">
          {REGIONS.map((r) => (
            <li key={r.id}>
              {r.name} <b>+{r.bonus}</b>
            </li>
          ))}
        </ul>

        <h2>Special rules</h2>
        <ul>
          <li>
            <b>Mountains</b> (peak symbol): attackers roll at most 2 dice into them.
          </li>
          <li>
            <b>Monsoon:</b> every fourth round, sea routes close and every attack rolls one die fewer. It is announced a round ahead.
          </li>
          <li>
            <b>Capturing a capital</b> from the player who founded it adds 3 armies to the force that moves in.
          </li>
          {activeMap() === 'india' ? (
            <>
              <li>
                <b>Ranges and forests</b> drawn along a border cannot be crossed: {(MAPS.india.data.walls ?? []).map((w) => w.name).join(', ')}.
              </li>
              <li>
                <b>The Siliguri corridor:</b> North Bengal is the only land route into the Northeast.
              </li>
            </>
          ) : (
            <li>
              <b>Sanjay Gandhi National Park</b> belongs to nobody and cannot be crossed, so Borivali and Mulund do not connect.
            </li>
          )}
          <li>
            <b>Sea routes</b> (dashed lines) connect the islands and some coasts as if they were neighbours.
          </li>
        </ul>

        <h2>Cards</h2>
        <p>
          Capture at least one territory in a turn to draw a card. At the start of a turn, trade a set of three for armies: three Padati
          give 4, three Ashva 6, three Gaja 8, one of each 10. A Ratha is wild. You get 2 extra armies on any traded territory you hold.
          With five or more cards you must trade.
        </p>

        <h2>Online play</h2>
        <p>
          If a turn timer is on and it runs out, your turn is finished for you. Miss three turns in a row and a computer player minds
          your seat until you return. You can surrender at any time; your territories become neutral.
        </p>
      </div>
    </dialog>
  );
}
