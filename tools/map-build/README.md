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

## Mumbai

```bash
node tools/map-build/build-mumbai.mjs
```

Builds `packages/engine/src/mumbai.json` and `packages/web/src/mumbaiShapes.json`.

`data/mumbai/` holds ward boundaries from the DataMeet India community's
[Municipal Spatial Data](https://github.com/datameet/Municipal_Spatial_Data) repository
(`Mumbai/BMC_Wards.geojson`, `NMMC/NMC_ElectoralWards.geojson`, `Mira-Bhayandar/Mira-Bhayandar.geojson`),
shared under [Creative Commons Attribution-ShareAlike 2.5 India](http://creativecommons.org/licenses/by-sa/2.5/in/).
That licence is share-alike: the two files this build writes are derived from the data and carry the same licence.

## Hyderabad

```bash
node tools/map-build/build-hyderabad.mjs
```

Builds `packages/engine/src/hyderabad.json` and `packages/web/src/hyderabadShapes.json`.

`data/hyderabad/` holds `ghmc-wards.geojson` and `ghmc-zones.geojson` from the same DataMeet repository (`Hyderabad/`).
The boundaries were drawn in OpenStreetMap, so they are © OpenStreetMap contributors under the
[Open Database Licence](https://www.openstreetmap.org/copyright); the two files this build writes carry the same terms.

Three things in the map are not in the data and are set by hand in the script: the Secunderabad Cantonment
(an empty notch in the ward file, filled from a rough outline), the stretch of border the Musi follows, and Hussain Sagar.
