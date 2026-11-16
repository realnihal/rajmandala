# Rajmandala

A multiplayer conquest game on the map of India, for 2 to 6 players. Deploy armies, attack neighbours with dice, and hold whole regions for bonus armies, online with friends or on one shared screen.

**Play it: <https://realnihal.github.io/rajmandala/>**

Create a room, share the invite link or the 6-character code, and start when everyone is ready.

There are two maps: **India**, the full game on 43 territories, and **Mumbai**, a quicker game on 32 territories across Greater Mumbai, Navi Mumbai and Mira–Bhayandar.

## How it is put together

| Part | Where | What it does |
|---|---|---|
| Game screen | [`packages/web/src`](packages/web/src) | React and SVG. Hosted on GitHub Pages. |
| Game server | [`packages/web/worker`](packages/web/worker) | A Cloudflare Worker with one Durable Object per room. |
| Room rules | [`packages/server`](packages/server) | Seats, invites, reconnects and the message protocol. |
| Game rules | [`packages/engine`](packages/engine) | The whole game as a pure, tested module, plus the map data. |
| Map builder | [`tools/map-build`](tools/map-build) | Turns district boundaries into India's 43 territory shapes, and municipal ward boundaries into Mumbai's 32. |

The design, rules and build plan are in [rajmandala-game-plan.md](rajmandala-game-plan.md).

## Run it locally

Needs Node.js 22.18 or later.

```bash
npm install
npm run dev --workspace @rajmandala/web
```

Open <http://localhost:5173>. The screen and the game server run together on that address. To try multiplayer alone, open a second tab with `?guest=2` before the `#`, for example `http://localhost:5173/?guest=2#/r/ROOMCODE`.

```bash
npm test               # rules and room tests
npm run typecheck
npm run test:browser   # plays the game in a browser (first: npx playwright install chromium)
```

## Deploying

- **Game screen:** every push to `main` builds it and publishes it to GitHub Pages ([workflow](.github/workflows/pages.yml)). The repository variable `API_BASE` holds the game server's address.
- **Game server:** from `packages/web`, run `npx cf deploy` (sign in first with `npx cf auth login`). To deploy it automatically on every push instead, add the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` ([workflow](.github/workflows/deploy-server.yml)). The sites allowed to use the server are listed in `ALLOWED_ORIGINS` in [`cloudflare.config.ts`](packages/web/cloudflare.config.ts).

## Licence

The code is released under the [MIT licence](LICENSE). The boundary data in `tools/map-build/data` keeps its own licences, below. The Mumbai data is share-alike, so the files derived from it, `packages/web/src/mumbaiShapes.json` and `packages/engine/src/mumbai.json`, are licensed under [Creative Commons Attribution-ShareAlike 2.5 India](http://creativecommons.org/licenses/by-sa/2.5/in/) rather than MIT.

## Credits

Mumbai's territories are built from ward boundaries for Greater Mumbai, Navi Mumbai and Mira–Bhayandar by the [DataMeet India community](https://github.com/datameet/Municipal_Spatial_Data), shared under [Creative Commons Attribution-ShareAlike 2.5 India](http://creativecommons.org/licenses/by-sa/2.5/in/). Navi Mumbai's wards are grouped into six nodes by latitude, so those node boundaries are approximate, and Elephanta Island is drawn by hand.

India's territory boundaries are built from the Census 2011 district map by the [DataMeet India community](https://github.com/datameet/maps/tree/master/Districts/Census_2011), shared under [Creative Commons Attribution 2.5 India](http://creativecommons.org/licenses/by/2.5/in/).
