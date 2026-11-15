# Rajmandala — a multiplayer conquest game on the map of India

*Working title. "Rajmandala" is Kautilya's "circle of kings": every neighbour is a rival, every neighbour's neighbour a potential ally.*

A web-based, turn-based strategy game for 2–6 players in the territory-conquest genre: deploy armies, attack neighbours with dice, hold whole regions for bonus armies. The map, the card suits and the Monsoon, Mountain and Capital rules are this game's own.

Contents: [1. The map](#1-the-map) · [2. The rules](#2-the-rules) · [3. Architecture](#3-architecture) · [4. Rooms and invites](#4-rooms-and-invites) · [5. Connection stability](#5-multiplayer-connection-stability) · [6. Build plan](#6-build-plan) · [7. Risks and open decisions](#7-risks-and-open-decisions)

---

## 1. The map

> **Current map (supersedes the tables below where they differ).** The live map has **43 territories** and is defined by `packages/engine/src/map.json`. Two changes were adopted after bot simulations of several variants:
>
> - **Bengal is split.** North Bengal (Darjeeling, Jalpaiguri, Cooch Behar: the Siliguri corridor) is its own territory in the Northeast, and is the only land route into that region, from Bihar or Bengal. The Northeast now has 9 territories.
> - **Four borders cannot be crossed,** because a range or forest stands on them: Purvanchal–Chhattisgarh (Kaimur Hills), Awadh–Malwa (Chambal Ravines), Gujarat Plains–Desh (Satpura Range) and Chhattisgarh–Telangana (Dandakaranya Forest). They are drawn on the board and give the exposed Central Heartland some shelter.
>
> In 500 simulated games per table size, neither change lengthened games, the walls modestly helped the Central Heartland, and nothing tested removed the Northeast's advantage as a starting corner.

42 territories: 40 on the mainland in six regions, plus two island outposts. Territories follow state boundaries; the largest states are split along historical sub-regions and the smallest are merged, so that territories are of comparable size and every region has interesting borders.

### 1.1 Regions

| Region | Territories | Bonus armies / turn | Character |
|---|---|---|---|
| Himalayan North | 7 | 4 | Mountain defences in the back, an open southern front |
| Gangetic Plain | 6 | 5 | Rich but exposed on almost every side |
| Western Frontier | 5 | 3 | Small, cheap to take, sea link down the coast |
| Central Heartland | 6 | 7 | Every territory is a border; hardest to hold |
| Deccan South | 8 | 5 | Large, with a narrow northern front and two sea flanks |
| Northeast | 8 | 3 | One land gateway (Bengal); slow to conquer, easy to keep |
| Island Outposts | 2 | +1 each | Not a region; each island held gives +1 army |

### 1.2 Territories

`M` = mountain territory (see rule 2.6). `Card` = suit of that territory's card (rule 2.8).

**Himalayan North**

| ID | Territory | Covers | Card |
|---|---|---|---|
| LAD | Ladakh `M` | Ladakh | Gaja |
| JNK | Jammu & Kashmir `M` | Jammu & Kashmir | Ashva |
| HIM | Himachal `M` | Himachal Pradesh | Padati |
| PUN | Punjab | Punjab, Chandigarh | Ashva |
| HAR | Haryana | Haryana | Gaja |
| DEL | Delhi | NCT of Delhi | Gaja |
| UTK | Uttarakhand `M` | Uttarakhand | Padati |

**Gangetic Plain**

| ID | Territory | Covers | Card |
|---|---|---|---|
| BRJ | Braj–Doab | Western Uttar Pradesh incl. Rohilkhand, Agra | Ashva |
| AWD | Awadh | Central Uttar Pradesh incl. UP Bundelkhand | Gaja |
| PUR | Purvanchal | Eastern Uttar Pradesh | Padati |
| BIH | Bihar | Bihar | Gaja |
| JHA | Jharkhand | Jharkhand | Padati |
| BEN | Bengal | West Bengal | Ashva |

**Western Frontier**

| ID | Territory | Covers | Card |
|---|---|---|---|
| THR | Thar | Western and northern Rajasthan | Ashva |
| ARV | Aravalli | Eastern and southern Rajasthan | Gaja |
| KUT | Kutch–Saurashtra | Kutch and the Saurashtra peninsula, Diu | Padati |
| GUJ | Gujarat Plains | North, central and south Gujarat, Daman, Dadra & Nagar Haveli | Ashva |
| KON | Konkan & Goa | Mumbai, coastal Maharashtra, Goa | Padati |

**Central Heartland**

| ID | Territory | Covers | Card |
|---|---|---|---|
| MAL | Malwa | Western Madhya Pradesh incl. Gwalior–Chambal | Ashva |
| MHK | Mahakoshal | Eastern Madhya Pradesh incl. Bundelkhand, Baghelkhand | Gaja |
| CHH | Chhattisgarh | Chhattisgarh | Padati |
| ODI | Odisha | Odisha | Gaja |
| VID | Vidarbha | Eastern Maharashtra | Padati |
| DSH | Desh | Western and central Maharashtra plateau, Khandesh, Marathwada | Ashva |

**Deccan South**

| ID | Territory | Covers | Card |
|---|---|---|---|
| TEL | Telangana | Telangana | Gaja |
| CAP | Coastal Andhra | Coastal Andhra Pradesh | Padati |
| RAY | Rayalaseema | Southern interior Andhra Pradesh | Ashva |
| NKA | North Karnataka | Northern Karnataka | Ashva |
| MYS | Mysuru | Southern and coastal Karnataka | Gaja |
| KER | Kerala | Kerala | Padati |
| TON | Tondai Nadu | Northern Tamil Nadu, Puducherry | Gaja |
| PAN | Pandya Nadu | Southern and western Tamil Nadu | Padati |

**Northeast**

| ID | Territory | Covers | Card |
|---|---|---|---|
| SIK | Sikkim `M` | Sikkim | Padati |
| ASM | Assam | Assam | Gaja |
| ARU | Arunachal `M` | Arunachal Pradesh | Ashva |
| NAG | Nagaland | Nagaland | Padati |
| MAN | Manipur | Manipur | Ashva |
| MIZ | Mizoram | Mizoram | Gaja |
| TRI | Tripura | Tripura | Ashva |
| MEG | Meghalaya | Meghalaya | Gaja |

**Island Outposts**

| ID | Territory | Covers | Card |
|---|---|---|---|
| AND | Andaman & Nicobar | Andaman & Nicobar Islands | Ashva |
| LAK | Lakshadweep | Lakshadweep | Padati |

### 1.3 Connections

This is the authoritative adjacency list: 81 land borders and 6 sea routes, each listed once and valid in both directions. It is the source for `map.json` in the build.

```edges
# Himalayan North (internal)
LAD-JNK LAD-HIM JNK-HIM JNK-PUN HIM-PUN HIM-HAR HIM-UTK PUN-HAR HAR-DEL
# North <-> West / Gangetic
PUN-THR HAR-THR HAR-ARV HAR-BRJ DEL-BRJ UTK-BRJ
# Gangetic Plain (internal)
BRJ-AWD AWD-PUR PUR-BIH PUR-JHA BIH-JHA BIH-BEN JHA-BEN
# Gangetic <-> West / Central / Northeast
BRJ-ARV BRJ-MAL AWD-MAL AWD-MHK PUR-MHK PUR-CHH JHA-CHH JHA-ODI BEN-ODI BEN-SIK BEN-ASM
# Western Frontier (internal)
THR-ARV THR-KUT ARV-GUJ KUT-GUJ GUJ-KON
# West <-> Central / South
THR-GUJ ARV-MAL GUJ-MAL GUJ-DSH KON-DSH KON-NKA
# Central Heartland (internal)
MAL-MHK MAL-DSH MAL-VID MHK-VID MHK-CHH CHH-ODI CHH-VID VID-DSH
# Central <-> South
CHH-TEL ODI-CAP VID-TEL DSH-TEL DSH-NKA
# Deccan South (internal)
TEL-CAP TEL-RAY TEL-NKA CAP-RAY CAP-TON RAY-TON RAY-NKA RAY-MYS NKA-MYS MYS-KER MYS-TON MYS-PAN KER-PAN TON-PAN
# Northeast (internal)
ASM-ARU ASM-NAG ASM-MAN ASM-MIZ ASM-TRI ASM-MEG ARU-NAG NAG-MAN MAN-MIZ MIZ-TRI
```

```sea
# Sea routes (closed during Monsoon, rule 2.7)
KUT-KON KON-LAK KER-LAK AND-BEN AND-CAP AND-TON
```

### 1.4 Strategic shape

- **Gateways.** Bengal is the only door to the Northeast (through Sikkim and Assam). Sikkim and Meghalaya are dead ends.
- **The crossroads.** Braj–Doab, Malwa, Desh and Chhattisgarh each touch three regions; whoever holds them decides where the fighting happens.
- **Sea flanks.** Andaman lets a Bengal player land at Coastal Andhra or Tondai Nadu behind the Deccan front; Lakshadweep links Konkan to Kerala. Both vanish in the Monsoon.
- **Mountain wall.** Ladakh, J&K, Himachal and Uttarakhand make the North's rear cheap to garrison; its real frontier is Punjab–Haryana–Delhi.

### 1.5 Drawing the map

**Built.** `tools/map-build/build.mjs` assigns each of the 641 census-2011 districts to a territory, dissolves them into the 42 territory shapes and six region outlines, and checks the shapes against the adjacency list above. Two pairs of shapes touch only briefly and are deliberately not connected: Braj–Doab/Himachal (2 km) and Odisha/Telangana (42 km). The 2011 districts predate the 2014 transfer that gave Andhra Pradesh a border with Chhattisgarh, so Coastal Andhra and Chhattisgarh do not touch on this map and are not connected. Boundary data: DataMeet India community, CC BY 2.5 India; the attribution is shown under the board.

The table above is the game map; the artwork is build phase 1 (section 6). Territory shapes are produced by dissolving district boundaries into the 42 territories, so the split states (Uttar Pradesh, Rajasthan, Gujarat, Madhya Pradesh, Maharashtra, Andhra Pradesh, Karnataka, Tamil Nadu) get real internal borders rather than hand-drawn lines.

---

## 2. The rules

### 2.1 Goal

Default victory, **Samrajya**: at the end of your own turn, control **28 of the 42 territories**. Room options: **Digvijaya** (eliminate every other player) or **Capitals** (hold your own capital plus two enemy capitals at the end of your turn).

### 2.2 Setup

1. Players: 2–6. Turn order is random.
2. Territories are dealt out randomly and evenly; each gets 1 army. Leftover territories (4 players: 2, 5 players: 2) go to the players last in turn order.
3. Starting armies per player, including the ones already placed: 3 players 35 · 4 players 30 · 5 players 25 · 6 players 20. Each seat after the first gets 2 more armies than the seat before it, to offset the advantage of moving first (set from bot simulations: without it the first seat won 56% of two-player games). With 2 players, each gets 40 and 14 territories; the other 14 are neutral with 2 armies each and never attack.
4. Each player secretly chooses one of their territories as their **capital**; capitals are revealed together.
5. Players place remaining armies on their own territories, simultaneously and hidden, with a 90-second timer. Unplaced armies are spread automatically.

### 2.3 Turn structure

A turn has three phases, always in this order: **Reinforce → Attack → Fortify**.

### 2.4 Reinforce

Armies received at the start of your turn:

- **Territories:** territories held ÷ 3, rounded down, minimum 3.
- **Regions:** the bonus for every region you hold completely (table 1.1).
- **Outposts:** +1 for each island outpost you hold.
- **Capital:** +1 while you hold your own capital.
- **Cards:** optional trade-in (rule 2.8). With 5 or more cards you must trade.

All reinforcements must be placed before attacking.

### 2.5 Attack

Attacking is optional and may be repeated as often as you like.

1. Choose one of your territories with at least 2 armies and an adjacent enemy territory.
2. Attacker rolls 1–3 dice and must have more armies in the territory than dice rolled. Defender rolls 2 dice with 2 or more armies, otherwise 1.
3. Compare highest die to highest die, then second to second. The lower die loses one army; **ties go to the defender**.
4. If the defender reaches 0, the attacker moves in at least as many armies as dice rolled in the last roll, and may move more, leaving at least 1 behind.
5. **Blitz** repeats rolls automatically until the territory falls or the attacker has 1 army left or cancels.

Eliminating a player gives you all their cards; if that takes you to 5 or more, you trade immediately and place the armies at once.

### 2.6 Terrain and capitals

- **Mountains** (`M`: Ladakh, J&K, Himachal, Uttarakhand, Sikkim, Arunachal): an attack *into* a mountain territory uses at most 2 dice.
- **Capitals:** the defender of a capital held by its original owner re-rolls any 1s once. Capturing a capital from the player who chose it adds 3 armies to the force that moves in; the capital stops giving its former owner the +1. Taking a capital from anyone else gives no bonus.

### 2.7 Monsoon

Every fourth round (rounds 4, 8, 12, …) is a Monsoon round, shown on the round tracker one round ahead.

- Sea routes are closed for attack and fortify.
- Every attack uses at most 2 dice (mountain attacks at most 1).

### 2.8 Cards

If you captured at least one territory this turn, you draw one card at the end of the turn. The deck has 44 cards: one per territory, in three suits of 14 named after the arms of the classical army, plus 2 wild cards.

| Set of three | Armies |
|---|---|
| 3 × Padati (infantry) | 4 |
| 3 × Ashva (cavalry) | 6 |
| 3 × Gaja (elephant) | 8 |
| One of each | 10 |

- A **Ratha** (chariot, wild) stands in for any suit.
- +2 armies, placed on that territory, for each traded card whose territory you hold.
- Set values are fixed; they do not escalate. Traded cards go to a discard pile that is reshuffled when the deck runs out.

### 2.9 Fortify

Once per turn, move any number of armies from one of your territories to another that is connected to it through an unbroken chain of your own territories (sea routes count outside the Monsoon). Leave at least 1 army behind. Then the turn ends.

### 2.10 Online rules

- **Turn timer:** 90 seconds for Reinforce, 3 minutes for the whole turn by default; room hosts can pick 60 s blitz or 24-hour correspondence turns.
- **Timeout:** unplaced armies are spread automatically and the turn ends. Three timeouts in a row hands the seat to a bot.
- **Disconnect:** the seat always stays yours. The turn timer keeps running, with one automatic 60-second grace extension per player per game; you can rejoin at any point and take the seat back from a bot (details in section 5.6).
- **Surrender:** a surrendered player's territories stay on the board as neutral garrisons.
- **Alliances:** chat is allowed, deals are not enforced by the game.
- **Dice:** rolled on the server only; every roll is logged in the game history.

---

## 3. Architecture

**Principle:** one pure, deterministic rules engine shared by server, client and bots; the server is the only authority on game state and randomness.

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript everywhere | One rules engine, imported by all three consumers |
| Rules engine | Pure module: `applyAction(state, action, rng) → { state, events }` | Unit-testable, replayable, bot-simulable, no I/O |
| Client | React + Vite, map as inline SVG | 42 clickable paths need no canvas; SVG is crisp at any zoom and accessible |
| Realtime | WebSockets | Turn-based, low message rate |
| Game server | Cloudflare Workers + one Durable Object per game room | A room is exactly one single-threaded stateful object with attached sockets and durable storage; idle rooms cost nothing |
| Persistence | Room state and action log in the Durable Object's storage; users, lobby index and finished-game results in D1 | Live state next to the logic; relational data for queries |
| Auth | Guest name + signed session cookie first; OAuth later | No signup wall for a party game |
| Tests | Vitest for the engine, Playwright for two-browser game flows | |

**Repository layout**

```
packages/
  engine/     rules, map.json, validation, bots       (no dependencies)
  server/     Worker, GameRoom Durable Object, lobby
  web/        React client, SVG map, lobby and game UI
tools/
  map-build/  geodata -> territories.svg + map.json
  sim/        bot-vs-bot balance simulations
```

**Core data shapes**

```ts
type TerritoryId = 'LAD' | 'JNK' | /* … */ 'LAK';

interface GameState {
  phase: 'lobby' | 'setup' | 'reinforce' | 'attack' | 'fortify' | 'finished';
  round: number;                     // round % 4 === 0 -> Monsoon
  turn: PlayerId;
  players: Record<PlayerId, { cards: CardId[]; capital: TerritoryId; alive: boolean; isBot: boolean }>;
  territories: Record<TerritoryId, { owner: PlayerId | 'neutral'; armies: number }>;
  pendingReinforcements: number;
  conqueredThisTurn: boolean;
  fortified: boolean;
  deck: CardId[]; discard: CardId[];
  rngSeed: string;                   // server-only, stripped from client views
}

type Action =
  | { type: 'place';   territory: TerritoryId; armies: number }
  | { type: 'trade';   cards: [CardId, CardId, CardId] }
  | { type: 'attack';  from: TerritoryId; to: TerritoryId; dice: 1 | 2 | 3; blitz?: boolean }
  | { type: 'occupy';  armies: number }
  | { type: 'fortify'; from: TerritoryId; to: TerritoryId; armies: number }
  | { type: 'endPhase' };
```

**Protocol.** Client sends `Action`s; the room validates with the engine, applies, appends to the action log, and broadcasts the resulting events (`diceRolled`, `territoryCaptured`, `phaseChanged`, …) plus a per-player view of the state in which other players' cards, the deck order and the seed are hidden. Sequencing, reconnection and resync are specified in section 5.

---

## 4. Rooms and invites

A room is one game table: up to six seats, a set of options, a chat, and (once started) one game. Any user can create one and bring others in with a link or a code.

### 4.1 Identity

- A first-time visitor picks a display name and plays as a guest. The server issues a player ID and a signed session token in an HttpOnly cookie.
- A seat belongs to a player ID, not to a browser tab or a socket. Refreshing, closing the tab or losing signal never gives up the seat.
- Accounts (OAuth sign-in) come later and attach to the existing player ID, so guest history carries over.

### 4.2 Creating a room

The creator becomes host and chooses:

| Option | Values | Default |
|---|---|---|
| Room name | Free text, filtered | "<host>'s room" |
| Visibility | Private (link or code only) · Public (listed in the lobby) | Private |
| Seats | 2–6 | 4 |
| Victory mode | Samrajya · Digvijaya · Capitals | Samrajya |
| Turn timer | 60 s · 3 min · 24 h | 3 min |
| Fill empty seats with bots | Off · Easy · Medium · Hard | Off |
| Join approval | Open · Host approves each player | Open |

On creation the server generates a **6-character room code** from an alphabet without look-alike characters (no `0/O`, `1/I/L`), for example `KXT7QM`. The code is the room's address: the URL is `/r/KXT7QM`, and the code maps directly to that room's Durable Object. A unique index in D1 guards against the rare collision.

### 4.3 Inviting

- **Link:** a Copy button and, on phones, the system share sheet. Opening the link asks for a display name if needed and drops the visitor straight into the room.
- **Code:** a "Join with code" box on the home page, for reading a code out loud.
- **QR code:** shown in the room for people around the same table.
- **Public rooms:** listed in the lobby with name, seats taken, victory mode and timer.

What the link does depends on the room's state:

| Room state | Visitor holds a seat | Visitor is new |
|---|---|---|
| Lobby | Returns to their seat | Takes a free seat, or waits for host approval, or sees "room full" |
| Game in progress | Rejoins the game | Joins as spectator; may take over a bot seat if the host allows |
| Finished | Sees result and replay | Sees result and replay |

### 4.4 Inside the room (before the game)

- Each seat shows name, colour, ready state and connection status. Players pick a colour and press Ready.
- Host controls: change options, add or remove bots, approve or kick players, lock the room, transfer host, start the game. Starting needs at least two seats filled and every human ready.
- If the host leaves, the longest-present player becomes host. A lobby with no connected humans closes after 30 minutes.
- Chat is available in the room and continues into the game.
- After a game, **Rematch** returns everyone to the same room and code with the same options.

### 4.5 Room lifecycle

```
created → lobby → setup → playing → finished → (rematch → lobby) → archived
```

- The room's Durable Object owns all of it: seats, options, chat, game state, action log.
- Whenever seats or state change, the room updates one row in the D1 lobby index; the public lobby page reads only that index and never wakes rooms.
- Finished rooms are archived after 7 days: the result and action log move to D1 for replays and stats, and the room's storage is cleared.

### 4.6 Abuse limits

Room creation is rate-limited per player and per IP; names and chat pass a word filter; chat is rate-limited; a kicked player cannot rejoin that room; public rooms can be reported.

---

## 5. Multiplayer connection stability

**Goal:** no game is ever lost or corrupted by a bad connection, a closed laptop, a phone switching networks, or a server restart. A player who drops can always come back to exactly where the game is.

### 5.1 Principles

1. **The server is the only source of truth.** The client is a view; it holds nothing that cannot be re-fetched.
2. **Persist, then broadcast.** The room writes the new state and the action-log entry to durable storage before it tells anyone the action happened.
3. **Every action is idempotent.** Sending the same action twice has the same effect as sending it once.
4. **Every client can resync at any moment** from nothing more than its session cookie.
5. **A disconnect is normal, not an error.** The game keeps a sensible pace without the missing player and lets them back in.

### 5.2 Message sequencing

- The room keeps a counter `seq` that increases by one with every applied action. Every broadcast carries the `seq` it produced.
- Every client action carries a client-generated `actionId` (UUID) and the `seq` the client last saw.
- The room remembers recent `actionId`s per player. A repeated ID returns the original result and is not applied again.
- An action based on an out-of-date `seq` is rejected with `resync`, never guessed at.
- A client that sees a gap in `seq` stops applying events and asks for a resync.

### 5.3 Detecting a dead connection

- The client sends a ping every 20 seconds. No reply within 10 seconds means the socket is treated as dead and closed, which catches half-open connections that the browser still reports as open.
- The room marks a player **disconnected** after 30 seconds without a ping, and shows that to the other players.
- The client also reacts to the browser's `offline`, `online` and `visibilitychange` events, because phones silently kill sockets in background tabs.

### 5.4 Reconnecting

1. Retry automatically with exponential backoff and random jitter: about 0.5 s, 1 s, 2 s, 4 s, up to a ceiling of 15 s. Retry immediately when the browser comes back online or the tab becomes visible.
2. On connect, the client sends `hello { protocolVersion, lastSeq }`; the session cookie identifies the player and seat.
3. The room answers with the missed events if `lastSeq` is still in its recent log, otherwise with a full snapshot of that player's view.
4. Any action that was sent but not acknowledged before the drop is resent with the same `actionId`. Idempotency makes that safe whether or not the first copy arrived.

While waiting for an acknowledgement, the client locks the control that was used. Army placement is shown optimistically; dice results are never predicted, only shown when the server sends them.

### 5.5 Surviving server restarts and deploys

- Because of persist-then-broadcast, a room that is restarted or evicted from memory reloads its exact state from storage on the next message. Clients see a brief reconnect and a resync.
- Turn timers are stored as absolute deadlines and driven by Durable Object alarms, so they survive restarts. Clients draw the countdown from the server's deadline, corrected for clock offset, never from a local timer.
- Sockets use the Durable Object WebSocket hibernation mode, so a room waiting on a 24-hour turn holds connections without holding memory. Each socket carries its player ID as an attachment so the room can rebuild its connection table on wake.
- `hello` includes the client's protocol version. If the server has moved on, it replies `upgradeRequired` and the client reloads itself, then resyncs.
- Each game stores the `rulesVersion` it started with. A rules change applies to new games only; games in flight finish under the rules they began with.

### 5.6 When a player is gone

| Situation | What happens |
|---|---|
| Drops during someone else's turn | Nothing; they resync when back |
| Drops during their own turn | The turn timer keeps running. Once per game, each player gets an automatic 60-second grace extension if their timer would expire while they are disconnected |
| Timer expires | Unplaced armies are spread automatically, a pending occupation moves the minimum, the turn ends |
| Three expired turns in a row | A bot takes the seat. The player takes it back the moment they return |
| Drops during a Blitz attack | No effect: a Blitz is resolved on the server as one action |
| Same player on two tabs or devices | Both are connected to the same seat and see the same view; duplicate actions are absorbed by `actionId` |
| Everyone drops | The room hibernates with timers still set; bots and auto-play carry the game forward, or it waits in a 24-hour game |

### 5.7 Protecting the room

- Every incoming message is validated against a schema; malformed or oversized messages are dropped and repeated violations close the socket.
- Per-socket rate limits on actions and chat.
- Players only ever receive their own view: other hands, deck order and the RNG seed never leave the server.

### 5.8 What the player sees

- A small connection indicator; a "Reconnecting…" banner over a dimmed (not blank) map while offline.
- A status dot on every seat, and a short notice when a player drops, returns, or is replaced by a bot.
- After a resync, a one-line summary of what happened while away ("Asha captured Malwa and Desh").

### 5.9 Fallback transport

Some office and school networks block WebSockets. If three connection attempts fail outright, the client switches to HTTP: actions by POST, events by long-polling the same `seq`-based log. The sequencing design above makes this a transport swap with no change to game logic. It is built after launch only if connection metrics show a need.

### 5.10 Testing stability

- **Fault-injection harness** around the room: drop, duplicate, delay and reorder messages at random through whole bot games, then assert the final state equals a clean replay of the action log.
- **Restart test:** destroy and reload the room object at random points in a game; state and timers must be identical.
- **Browser tests** (Playwright): go offline mid-turn, mid-attack and mid-occupation; refresh; open a second tab; reconnect after the turn has passed.
- **Soak test:** a few hundred bot-filled rooms running at once for an hour, with scripted disconnects.
- **Live metrics:** reconnects per game, resync count, time to resync, action round-trip time, timeouts and bot takeovers. A rise in any of them is the early warning.

---

## 6. Build plan

**Status.** Built: phases 0–4; rooms, codes, invite links, seats, ready-up, host controls, rematch and chat from phase 5; turn timers, auto-play, bot takeover, surrender, room expiry and a room-creation limit from phase 6; computer players (phase 7); a first balance pass from bot simulations (phase 8); a phone layout, map zoom, sound, turn alerts and a rules page (phase 9); and deployment (phase 10). Not yet built: the public room list, join approval, QR codes, optional sign-in, replays, a guided tutorial, Hindi strings, and fault-injection tests against the real Durable Object (they run against the room logic today). Two deliberate differences from sections 4 and 5: a seat is owned by a secret key kept in the player's browser rather than a signed cookie, and the server sends each player a full snapshot on every change rather than only what changed.

Each phase ends with something playable or verifiable. Phases 1 and 2 can run in parallel; everything after depends on both.

| # | Phase | Steps | Done when |
|---|---|---|---|
| 0 | Scaffold | Monorepo with the three packages, TypeScript, lint, Vitest, CI | `engine` test runs in CI |
| 1 | Map | (a) Encode section 1 as `map.json`. (b) Validator: adjacency symmetric, graph connected, every territory in one region, card suits 14/14/14. (c) `map-build` tool: district boundaries → dissolve into 42 territories → simplify → `territories.svg` with one `<path id>` per territory, label anchor points and dashed sea-route lines. (d) Colour-blind-safe player palette, region tints | Map renders in a browser, hovering highlights a territory and its neighbours, validator passes |
| 2 | Rules engine | Setup and dealing → reinforcement calculation → placement → combat resolution → occupy → cards and trades → fortify with path check → mountains, capitals, Monsoon → elimination and the three victory modes → seeded RNG. A test per rule in section 2, plus a property test that random legal play never reaches an invalid state | Full game plays to a winner in a test from a fixed seed |
| 3 | Local hot-seat | Game screen: map, army counters, phase bar, dice tray, card hand, action log. Wire the UI straight to the engine in the browser | 2–6 people can finish a game on one screen |
| 4 | Multiplayer core | `GameRoom` Durable Object built on the section 5 foundations from day one: session cookie and player ID, `seq` and `actionId` on every message, persist-then-broadcast, `hello` and resync, per-player views, server-side dice. Client swaps the local engine for a socket with ping and auto-reconnect | Two browsers play a full game; refreshing a tab or restarting the room resumes it exactly |
| 5 | Rooms and invites | Everything in section 4: create room with options, room codes, invite link, join by code, QR code, seats, colours, ready-up, host controls and host hand-over, join approval, public lobby list from the D1 index, chat, rematch, lobby expiry, abuse limits | A stranger can join from a link or code on a phone and start a game; a full or locked room turns them away cleanly |
| 6 | Resilience | Rest of section 5: turn timers on alarms with absolute deadlines, grace extension, auto-play on timeout, bot takeover and hand-back, hibernation, multi-tab seats, protocol and rules versioning, message validation and rate limits, connection UI, spectators, surrender. Then the fault-injection harness, restart test, offline browser tests and soak test | Fault-injected bot games end in the same state as a clean replay; killing a tab, the network or the room mid-turn never stalls or corrupts a game |
| 7 | Bots | Heuristic bot in `engine`: reinforce the weakest border of the most nearly complete region, attack at favourable odds, fortify towards the front. Easy / medium / hard by aggression and look-ahead | A solo player can finish a game against 3 bots |
| 8 | Balance | `sim` tool: thousands of bot-vs-bot games; measure win rate by seat and by starting region, game length, how often each region bonus is held. Tune bonuses, the 28-territory threshold and Monsoon frequency | No seat or region wins more than a few points above its fair share |
| 9 | Polish | Dice and army-move animation, sound, mobile layout with pinch-zoom map, interactive tutorial, game replay from the action log, Hindi and English strings | Playtest group finishes a game on phones without help |
| 10 | Launch | Deploy, custom domain, error and usage monitoring, abuse reporting, privacy page, finished-game stats and a simple leaderboard | Public URL, first external games |

**Suggested order of work inside phase 2,** since it is the heart of the game: reinforcement maths → dice resolution → attack and occupy → turn and phase state machine → fortify → cards → special rules → victory. Each is a small, separately testable function.

**First milestone worth showing someone:** end of phase 3 — the real map and the real rules on one screen, no server.

---

## 7. Risks and open decisions

- **Stability has to be designed in, not added.** Sequencing, idempotent actions and persist-then-broadcast go into phase 4; retrofitting them after the lobby and UI exist means rewriting the protocol.

- **Map depiction.** Publishing a map of India whose external boundaries differ from the official Survey of India depiction can be an offence under Indian law. Build the artwork from boundary data that matches the official depiction, and check this before any public launch in India.
- **Boundary data licence.** District-level geodata comes under different licences depending on the source; confirm the chosen source allows commercial use and note the attribution.
- **Balance is a guess until simulated.** The region bonuses, the Northeast's single gateway and the 28-territory win threshold are starting values; phase 8 exists to correct them.
- **Game length.** Fixed card values and a territory-count win keep games near 45–60 minutes; if playtests run long, lower the threshold before touching card values.
- **Decisions to make before phase 5:** final name, guest-only or accounts, and whether correspondence (24-hour turn) games are in the first release, since they need notifications.
