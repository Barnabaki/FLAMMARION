# Data sources

Provenance categories used in the UI: **SATELLITE** (orbital product), **IAU** (official nomenclature / cartography), **COMPUTED** (exact from ephemeris or geometry), **HISTORIC** (archived in-situ measurement), **MODELLED** (model-based estimate), **SIMULATED / EMULATED** (generated for this demo), **DEMO** (created solely for demonstration).

CRS for all spatial data: IAU 2000 Mars (a = 3 396 190 m, b = 3 376 200 m), planetocentric latitude, east-positive longitude 0–360°E.

## Used

| Dataset | Resolution | Tag | Source | Licence | Processing |
| --- | --- | --- | --- | --- | --- |
| Viking Orbiter MDIM 2.1 colour mosaic (`Mars_Viking_MDIM21_ClrMosaic_global_232m`) | 232 m/px, global, tile levels 0–7 | SATELLITE | NASA Mars Trek WMTS — https://trek.nasa.gov/mars/ | Public domain (NASA/JPL/USGS) | Streamed unmodified as equirectangular tiles |
| MGS MOLA colour shaded relief (`Mars_MGS_MOLA_ClrShade_merge_global_463m`) | 463 m/px, global, tile levels 0–7 | SATELLITE | NASA Mars Trek WMTS | Public domain (NASA) | Streamed unmodified; shown in Terrain mode |
| MRO CTX Jezero mosaic, preliminary (`Jezero_CTX_BlockAdj_dd`) | ~6 m/px, 75.15–78.87°E 15.91–19.45°N, levels 0–12 | SATELLITE | NASA Mars Trek WMTS | Public domain (NASA/JPL/MSSS/USGS) | Streamed unmodified |
| MRO CTX Jezero controlled orthomosaic (`JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0`) | 6 m/px, levels 0–13 | SATELLITE | NASA Mars Trek WMTS (USGS Astrogeology, Mars 2020 TRN basemap) | Public domain | Streamed unmodified |
| MRO HiRISE Jezero controlled orthomosaic (`JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd`) | 25 cm/px source, levels 0–17 (~0.32 m/px served) | SATELLITE | NASA Mars Trek WMTS (USGS Astrogeology) | Public domain (NASA/JPL/UArizona/USGS) | Streamed unmodified |
| Mars Chart quadrangles MC-01…MC-30 (1:5M) and quadrants (1:2M) | exact lat/lon limits | IAU | USGS Astrogeology — https://planetarynames.wr.usgs.gov/Page/MARS/target | Public domain | Encoded from the published chart limits in `src/lib/quadrangles.js`; drawn as rhumb lines |
| Gazetteer of Planetary Nomenclature: Jezero (18.4082°N, 77.6873°E), Nili Fossae, Hargraves, Koshoba, Toro, Arena Colles, Peridier | point coordinates | IAU | IAU WGPSN / USGS, retrieved through the Mars Trek nomenclature index on 2026-11-14 | Public domain | Copied to `src/lib/quadrangles.js`; Jezero diameter 47.52 km confirmed against the Gazetteer entry |
| Mars24 algorithm (Allison & McEwen 2000) | — | COMPUTED | https://www.giss.nasa.gov/tools/mars24/help/algorithm.html | Published algorithm | Implemented in `src/lib/marsTime.js`; unit-tested against the published 2000-01-06 reference values |
| Route distances | — | COMPUTED | Vincenty inverse geodesic on the Mars spheroid, `src/lib/mars.js` | — | Summed per segment |

## From the team's data pull (`data/source/`)

| Dataset | Resolution | Tag | Source | Files | Processing |
| --- | --- | --- | --- | --- | --- |
| Perseverance MEDA calibrated/derived records (CAL_ATS, CAL_TIRS, DER_PS, DER_WS, CAL_RDS), sols 44–51 | 1–2 Hz source → hourly means per LTST hour | HISTORIC | NASA PDS Atmospheres, `urn:nasa:pds:mars2020_meda` (file list in `data/source/SOURCES.json`) | `data/source/weather/weather_historic.json` | `scripts/pull/build_weather.py` (hourly means per sol); `scripts/build_app_assets.py` averages the 8 sols per hour → `src/lib/weatherTable.js`. Air temp = mean of ATS mast sensors 1–3 (~1.45 m); UV = RDS_TOP_3 (250–400 nm). |
| Curiosity REMS MODRDR, MSL sols 50–54, **Gale crater** | hourly means per LTST hour | HISTORIC | NASA PDS Atmospheres, `MSLREM_1001` | same file | `scripts/pull/rems.py`; shown as reference only, never used in decisions |
| Mars 2020 CTX DEM mosaic `M20_JezeroCrater_CTXDEM_20m.tif` | 20 m | SATELLITE | JPL/USGS, `urn:nasa:pds:mars2020_ctx_basemap_2021:data:m20_ctxdem_mosaic` | `data/source/dem/jezero_dem_clipped_{fullcrater,requested}.tif`, 512² grids, heightmaps, hillshade, `dem_report.json` | `scripts/pull/build_dem.py` (clip, cross-check vs HRSC–MOLA 200 m: landing site −2567.1 m vs −2573 m). `build_app_assets.py` → 40 m terrain grid `public/data/terrain/jezero_dem_40m.png` (RGB-encoded, 0.1 m steps) and a native 20 m crop around the route `src/lib/demRoute.js`. |
| MGS MOLA MEGDR `megt44n000hb` colour-coded elevation image | 128 px/deg, 0–90°E 0–44°N | SATELLITE | PDS Geosciences Node, Orbital Data Explorer | `data/source/mola/` | Archived only. The app's Terrain mode streams the equivalent global product from Mars Trek (below), which covers all 30 regions. |
| IAU nomenclature per Mars Chart region (1,653 named features) | point coordinates | IAU | NASA Mars Trek nomenclature index (IAU/USGS Gazetteer), retrieved 2026-11-15 | `data/source/nomenclature/trek_nomenclature_by_quadrangle.json` | `scripts/build_features.py` → `src/lib/features.js`. Albedo features and unofficial names are dropped. The display rank (which few are shown first) is an editorial choice. |

Vertical datum: DEM elevations are relative to the MOLA areoid. The 3D scene uses them as heights above the reference spheroid — a constant-offset simplification that does not affect slopes or relative heights.

## Modelled, simulated, emulated

| Data | Tag | How it is produced | File |
| --- | --- | --- | --- |
| Wind direction, relative humidity, dust optical depth τ, convective-vortex rate | MODELLED | Hourly tables shaped to ranges published from MEDA (Rodriguez-Manfredi et al. 2023, *Nat. Geosci.* 16, 19–28, https://doi.org/10.1038/s41561-022-01084-0; Newman et al. 2022, *Sci. Adv.* 8, eabn3783). Not in the data pull. | `src/lib/weather.js` |
| Total surface solar flux | MODELLED | Sun elevation (Mars24) × simple dust attenuation | `src/lib/weather.js` |
| Wind gust | SIMULATED | 1.45 × MEDA hourly wind + seeded noise | `public/data/telemetry.ndjson` |
| Terrain class and quality per leg | MODELLED | Visual interpretation of the HiRISE mosaic | `src/lib/mission.js` |
| One-way light time (≈ 17 min 18 s) | MODELLED | Constant placeholder; not recomputed for the 2021-04-07 replay epoch | generator |
| Proposed route, science stops | DEMO | Drawn by hand on the HiRISE mosaic along low-relief terrain | `public/data/route.geojson` |
| Vehicle speed, battery | EMULATED | Simple energy model (hotel load + drive energy + heater) | `src/lib/mission.js` |
| Life support, comms, radiation, electric field, localization error | SIMULATED | Seeded AR(1) / Gaussian generator, seed 20210515 | `public/data/telemetry.ndjson` |
| Drone messages, dust devils, terrain updates | SIMULATED | `src/lib/sim.js`; format in `drone_message_schema.json` | `public/data/dustdevil_scenario.ndjson`, `examples/` |

## Named in the brief but not integrated

| Dataset | Status |
| --- | --- |
| Numeric MGS MOLA MEGDR grid (`megt44n000hb.img`) | Not in the pull (only the colour image). Terrain outside Jezero is the reference spheroid. |
| Murray Lab global CTX mosaic (`MurrayLab_GlobalCTXMosaic_V01_E-076_N16`) | Not supplied. USGS CTX Jezero mosaics from Mars Trek are used instead. In Murray Lab tile names `E-076` appears to mean 76°W; Jezero is at 77.5°E, which would be tile `E076_N16` — verify before pulling it. |
| MEDA dust opacity, humidity, wind direction | Not in the pull; modelled. |
| CRISM / TES / OMEGA composition | Not integrated. |
| Spirit dust-devil statistics | Not integrated; the scenario is one scripted vortex. |
