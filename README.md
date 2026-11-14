# FLAMMARION

Interactive demo for exploring Mars, planning a crewed traverse in Jezero Crater, assessing GO / NO-GO before departure and monitoring the traverse in (simulated) real time. NASA hackathon project.

**Flow:** Module A *Area to Region* → Module B *Pre-mission* → Module C *Intra-mission*, in one persistent 3D scene.

```
Mars → MC-13 Syrtis Major → MC-13 NE → Jezero Crater → Pre-mission (GO) → Start Mission → Intra-mission
```

## Run

Requires Node ≥ 20 and internet access to `trek.nasa.gov` (imagery tiles are streamed live from NASA Mars Trek).

```bash
npm install
```

```bash
npm run dev
```

Open the printed URL (default http://localhost:5173). Other scripts:

| Command | Purpose |
| --- | --- |
| `npm run build` / `npm run preview` | Production build into `dist/` and local preview |
| `npm run generate` | Regenerate every file in `public/data/` and `examples/` (deterministic, seeded) |
| `npm test` | 11 checks: geodesy, Mars24 reference epoch, quadrangle geometry, 30 cm localization model, decision engine, all anomaly scenarios, drone-schema validation |

`npm install` copies Cesium's runtime assets to `public/cesiumStatic/` (git-ignored) via `scripts/copy-cesium.mjs`.

## What is in the demo

- **Module A** — realistic globe (Viking colour mosaic); click the planet for the 30 official Mars Chart quadrangles; select MC-13 → NE quadrant → Jezero; top-down HiRISE/CTX terrain map with the proposed route, waypoints, geodesic distance, elevation profile and seasonal environment. Breadcrumb is clickable at every level.
- **Module B** — forecast time-lapse along the route, predicted distance / time / battery, six explicit GO / NO-GO criteria with the driver named on NO-GO, a what-if dust event, and **Start Mission**.
- **Module C** — replay of the stored telemetry stream at 1×–240× with scrubbing; Screen 1 (bird's-eye, camera follows the crew, free orbit) and Screen 2 (first person); crew + scout drone with localization, comm links, clocks (LMST / LTST / UTC), navigation, milestones, terrain, E-field, life support, comms; decision engine (ABORT / HOLD / PROCEED / REROUTE) with log; eight injectable anomalies including the required dust-devil → alert to crew + habitat → HOLD.
- **Provenance** — every value carries a tag (SATELLITE, IAU, COMPUTED, MODELLED, SIMULATED, EMULATED, DEMO; HISTORIC is supported but unused, see below). Global *Data sources* panel in the top bar.

## Known gaps against the brief — read before demoing

1. **Weather is MODELLED, not HISTORIC.** The MEDA/REMS PDS archive could not be reached from the build environment, so the weather is a diurnal model fitted to published MEDA ranges and is tagged MODELLED everywhere. Drop real MEDA hourly means into `public/data/weather_sol.json` with `"provenance": "HISTORIC"` and the badges follow (schema in `DATA_SOURCES.md`).
2. **No MOLA terrain mesh.** No DEM tile service was reachable; the surface is the IAU reference spheroid with real orbital imagery draped on it. Waypoint elevations are approximate and tagged MODELLED.
3. **CTX source.** Jezero CTX comes from the USGS mosaics served by NASA Mars Trek, not from the Murray Lab global mosaic (no public tile endpoint).
4. **CRISM composition** is not integrated; terrain class/quality per leg is an interpretation of the HiRISE imagery (MODELLED).

Details and every other assumption: `ASSUMPTIONS.md`.

## Architecture

```
index.html
src/
  main.js          app shell: top bar, breadcrumb, stage switching, sources panel
  viewer.js        Cesium viewer on the Mars ellipsoid + NASA Trek imagery layers
  moduleA.js       globe → quadrangles → MC-13 → NE → Jezero terrain & route
  moduleB.js       pre-mission forecast, GO / NO-GO, Start Mission
  moduleC.js       intra-mission HUD, two screens, playback, anomaly injection
  routeLayer.js    route / waypoint / crew entities shared by all modules
  lib/             pure JS, no DOM — shared by browser, generator and tests
    mars.js        spheroid constants, Vincenty geodesic, seeded PRNG, 30 cm σ
    marsTime.js    Mars24 (MSD, MTC, LMST, LTST, Ls, Sun elevation)
    quadrangles.js MC-01…MC-30, quadrants, IAU features of MC-13 NE
    weather.js     Jezero diurnal climatology (MODELLED)
    mission.js     waypoints, vehicle model, nominal plan, GO criteria
    decision.js    flags, thresholds, priority, debounce / hold-off
    sim.js         tick-by-tick replay + anomaly scenarios + drone message
scripts/generate-data.mjs   seeded generator for public/data and examples
public/data/       route.geojson, telemetry.ndjson, weather_sol.json, dustdevil_scenario.*
drone_message_schema.json   proposed drone downlink format (+ examples/)
tests/all.test.mjs
```

One route object (`src/lib/mission.js` → `buildPlan()`) is passed A → B → C. One CRS everywhere: IAU 2000 Mars, planetocentric latitude, east-positive longitude 0–360°E.

### Tech stack rationale

- **CesiumJS 1.135** — the only mainstream web globe with a first-class non-Earth ellipsoid (`Ellipsoid.MARS`), tiled imagery LOD and smooth camera flights, which is what "one continuous zoom from globe to 25 cm/px" needs.
- **Vite, no UI framework** — the UI is a handful of panels updated at frame rate; plain DOM keeps the bundle and the moving parts small.
- **Pure-JS `lib/`** — the same code runs in the browser, in the data generator and in `node --test`, so the simulation shown is the simulation tested.
- **NDJSON stream + client clock** — storage-backed "real-time" replay with a configurable rate, deterministic scrubbing (state is re-derived by replaying from tick 0).

Cesium package note: `cesium@1.135.0` declares loose ranges that currently resolve to two incompatible copies of `@cesium/engine`; `package.json` pins `@cesium/widgets@14.3.0` via `overrides` to avoid that.
