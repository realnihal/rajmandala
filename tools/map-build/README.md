# map-build

Builds the board artwork (`packages/web/src/mapShapes.json`) from district boundaries.

```bash
node tools/map-build/build.mjs
```

The build fails if the shapes and the game's adjacency list (`packages/engine/src/map.json`) disagree.

## Data

`data/2011_Dist.*` — Districts of India, Census 2011, from the
[DataMeet India community](http://datameet.org/) maps repository
(<https://github.com/datameet/maps/tree/master/Districts/Census_2011>),
shared under [Creative Commons Attribution 2.5 India](http://creativecommons.org/licenses/by/2.5/in/).
Any published build of the game must carry this attribution.
