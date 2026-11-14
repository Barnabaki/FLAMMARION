# Data sources

Provenance categories used in the UI: **SATELLITE** (orbital product), **IAU** (official nomenclature / cartography), **COMPUTED** (exact from ephemeris or geometry), **HISTORIC** (archived in-situ measurement), **MODELLED** (model-based estimate), **SIMULATED / EMULATED** (generated for this demo), **DEMO** (created solely for demonstration).

CRS for all spatial data: IAU 2000 Mars (a = 3 396 190 m, b = 3 376 200 m), planetocentric latitude, east-positive longitude 0–360°E.

## Used

| Dataset | Resolution | Tag | Source | Licence | Processing |
| --- | --- | --- | --- | --- | --- |
| Viking Orbiter MDIM 2.1 colour mosaic (`Mars_Viking_MDIM21_ClrMosaic_global_232m`) | 232 m/px, global, tile levels 0–7 | SATELLITE | NASA Mars Trek WMTS — https://trek.nasa.gov/mars/ | Public domain (NASA/JPL/USGS) | Streamed unmodified as equirectangular tiles |
| MRO CTX Jezero mosaic, preliminary (`Jezero_CTX_BlockAdj_dd`) | ~6 m/px, 75.15–78.87°E 15.91–19.45°N, levels 0–12 | SATELLITE | NASA Mars Trek WMTS | Public domain (NASA/JPL/MSSS/USGS) | Streamed unmodified |
| MRO CTX Jezero controlled orthomosaic (`JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0`) | 6 m/px, levels 0–13 | SATELLITE | NASA Mars Trek WMTS (USGS Astrogeology, Mars 2020 TRN basemap) | Public domain | Streamed unmodified |
| MRO HiRISE Jezero controlled orthomosaic (`JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd`) | 25 cm/px source, levels 0–17 (~0.32 m/px served) | SATELLITE | NASA Mars Trek WMTS (USGS Astrogeology) | Public domain (NASA/JPL/UArizona/USGS) | Streamed unmodified |
| Mars Chart quadrangles MC-01…MC-30 (1:5M) and quadrants (1:2M) | exact lat/lon limits | IAU | USGS Astrogeology — https://planetarynames.wr.usgs.gov/Page/MARS/target | Public domain | Encoded from the published chart limits in `src/lib/quadrangles.js`; drawn as rhumb lines |
| Gazetteer of Planetary Nomenclature: Jezero (18.4082°N, 77.6873°E), Nili Fossae, Hargraves, Koshoba, Toro, Arena Colles, Peridier | point coordinates | IAU | IAU WGPSN / USGS, retrieved through the Mars Trek nomenclature index on 2026-11-14 | Public domain | Copied to `src/lib/quadrangles.js`; Jezero diameter 47.52 km confirmed against the Gazetteer entry |
| Mars24 algorithm (Allison & McEwen 2000) | — | COMPUTED | https://www.giss.nasa.gov/tools/mars24/help/algorithm.html | Published algorithm | Implemented in `src/lib/marsTime.js`; unit-tested against the published 2000-01-06 reference values |
| Route distances | — | COMPUTED | Vincenty inverse geodesic on the Mars spheroid, `src/lib/mars.js` | — | Summed per segment |

## Modelled, simulated, emulated

| Data | Tag | How it is produced | File |
| --- | --- | --- | --- |
| Jezero diurnal weather (air/ground temperature, pressure, wind, humidity, τ, vortex rate) at Ls ≈ 45°, MY 36 | MODELLED | Hourly table shaped to the ranges published from MEDA: Rodriguez-Manfredi et al. 2023, *Nat. Geosci.* 16, 19–28 (https://doi.org/10.1038/s41561-022-01084-0); Newman et al. 2022, *Sci. Adv.* 8, eabn3783. **Not PDS records.** | `src/lib/weather.js`, `public/data/weather_sol.json` |
| Surface solar flux | MODELLED | Sun elevation (Mars24) × simple dust attenuation | `src/lib/weather.js` |
| Waypoint elevations, terrain class and quality | MODELLED | Approximate values / visual interpretation of the HiRISE mosaic; not sampled from a DEM | `src/lib/mission.js` |
| One-way light time (≈ 17 min 18 s) | MODELLED | Constant, approximate Earth–Mars distance for mid-May 2021 | generator |
| Proposed route, science stops | DEMO | Drawn by hand on the HiRISE mosaic along low-relief terrain | `public/data/route.geojson` |
| Vehicle speed, battery | EMULATED | Simple energy model (hotel load + drive energy + heater) | `src/lib/mission.js` |
| Telemetry noise, life support, comms, radiation, electric field, localization error | SIMULATED | Seeded AR(1) / Gaussian generator, seed 20210515 | `public/data/telemetry.ndjson` |
| Drone messages, dust devils, terrain updates | SIMULATED | `src/lib/sim.js`; format in `drone_message_schema.json` | `public/data/dustdevil_scenario.ndjson`, `examples/` |

## Named in the brief but not integrated

| Dataset | Status |
| --- | --- |
| Perseverance MEDA (PDS, atmos.nmsu.edu) | Not reachable from the build environment (TLS chain could not be verified). Weather is MODELLED instead. |
| Curiosity REMS (Gale) | Not loaded. Would be a supplementary reference only (Gale is ~3,760 km from Jezero). |
| MGS MOLA MEGDR / HRSC / HiRISE DTMs | No reachable tile or query service; terrain is the reference spheroid. |
| Murray Lab global CTX mosaic | No public tile endpoint; USGS CTX Jezero mosaics from Mars Trek are used instead. |
| CRISM / TES / OMEGA composition | Not integrated. |

### Swapping in real MEDA data

`public/data/weather_sol.json` — arrays of 24 hourly means indexed by LMST hour:

```json
{ "site": "…", "ls": 45, "marsYear": 36, "provenance": "HISTORIC",
  "hours": [0, 1, …, 23],
  "air_temp_c": […], "ground_temp_c": […], "wind_ms": […], "wind_dir_deg": […],
  "rh_pct": […], "vortex_per_h": […], "tau": 0.45 }
```

Module B reads the file and uses its `provenance` for the badges. The Module A environment block and the Module C weather badges are currently hard-wired to the built-in table / MODELLED and need the same switch; rerun `npm run generate` after changing `src/lib/weather.js` so the telemetry stream matches.
