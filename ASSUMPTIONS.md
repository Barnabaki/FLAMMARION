# Assumptions

## A. Open issues from the brief — defaults applied

1. **Missing decision actions.** HLS anomalous range → ABORT if critical, HOLD if warning-level; comms below threshold → HOLD, ABORT if lost > 300 s (configurable in `RULES.comms.abortAfterS`); terrain update / new obstacle in path → REROUTE; anomalous weather → HOLD, ABORT at the severe level. Numeric thresholds are in `DECISION_RULES.md`. **Confirm with the team.**
2. **Truncated Murray Lab sentence.** Intended as: use the CTX mosaic as the surface imagery layer of the intra-mission 3D view. The Murray Lab mosaic has no public tile endpoint, so the USGS CTX Jezero mosaics served by NASA Mars Trek are used (same instrument, controlled to the HiRISE base).
3. **"3 types of data" but four listed.** All four (telemetry, drone, localization, planned route) are treated as required inputs.
4. **Route not defined.** One proposed route is generated inside Jezero, from the Octavia E. Butler landing site to the base of the western delta front, labelled "Proposed route" and used by A, B and C.
5. **30 cm localization accuracy.** Treated as the 95 % horizontal error radius → σ = 0.30 / √(−2 ln 0.05) = 0.1226 m per axis (`LOC_R95_M` in `src/lib/mars.js`). A test checks that 95 % of generated errors fall within 30 cm.
6. **Electric field.** Fully SIMULATED (≈ 60 V/m background, rising to several kV/m near a dust devil) and labelled as such.
7. **Mission timing.** Simulated epoch = Perseverance sol 47, 2021-04-07, Ls ≈ 28°, Mars Year 36, departure 09:30 LMST (21:10:27 UTC) — the middle of the MEDA sols (44–51) the weather comes from. The clock is a replay epoch and is labelled as not current.
8. **"Gusev scenarios".** Not used; everything is for Jezero.
9. **Curiosity weather is from Gale.** REMS (MSL sols 50–54) is shown in Pre-mission as a labelled reference for the same local hour. It is a different site and season and is not used in any decision.
10. **Folder `UI IMAGES INSPRIRATION`.** The folder was deleted from the repository in commit `d65fe0a`; its images were read from git history (`a60d44f`) for the design pass. It was not restored.

## B. Deviations from the brief (things the brief asked for that this build does not do)

1. **Not every weather channel is HISTORIC.** Air/ground temperature, pressure, wind speed and UV are MEDA measurements. Wind direction, humidity, dust opacity τ, vortex rate and total solar flux were not in the data pull and are MODELLED. Two GO / NO-GO criteria (τ, vortex rate) therefore rest on modelled values.
2. **Terrain mesh is the CTX DEM, not MOLA MEGDR, and covers Jezero only.** The pull contained the MOLA colour image but not its numeric grid. Outside the DEM the surface is the reference spheroid; the DEM edge is tapered to height 0 over 0.6° to avoid a cliff, which creates a false gentle slope around the crater at regional scale.
3. **CTX imagery is not from the Murray Lab mosaic** (not supplied).
4. **CRISM composition baseline not integrated.** Terrain class and quality per leg are an interpretation of the HiRISE mosaic, tagged MODELLED.
5. **Earth-link schedule is simulated**; the one-way light time is a constant placeholder.
6. **Dust-devil statistics are not derived from Spirit data.** The scenario is a single scripted vortex.

## C. Further assumptions

- **Jezero coordinates.** The IAU Gazetteer centre is 18.41°N, 77.69°E (the brief expected ≈ 77.5°E). The Gazetteer value is used.
- **Quadrangle boundaries** are the published lat/lon limits of the MC charts, drawn as parallels and meridians. The inspiration mock-up shows irregular outlines; those would not be the official boundaries.
- **Demo scope.** Only MC-13 → MC-13 NE → Jezero is selectable; other quadrangles and quadrants highlight on hover and show a scope notice on click. Only the seven IAU features returned by the Mars Trek nomenclature index for MC-13 NE are labelled.
- **Planetocentric vs planetographic.** Coordinates are planetocentric; geodesic distances treat them as geodetic on the spheroid. Over the 2.6 km route the difference is below 0.01 %.
- **Weather replay.** MEDA values are the mean over sols 44–51 of each sol's hourly mean, per local-true-solar-time hour, placed at the bin centre and linearly interpolated. No noise is added to HISTORIC channels. Night-time wind bins hold only 1–3 sols.
- **Elevation.** Waypoint elevations and the profile are bilinear samples of the 20 m CTX DEM (−2570.9 m … −2542.9 m along the route, +42 m / −18 m, steepest slope 6.3° over a 40 m baseline). DEM elevations (MOLA areoid) are used directly as heights above the spheroid in the 3D scene.
- **Route.** 8 waypoints, 2 600 m, 1 h 38 min including six 8-minute science stops. Waypoints other than the landing site carry descriptive names, not official ones. The landing site doubles as the notional habitat.
- **Vehicle (EMULATED).** 1.0 m/s base speed derated by terrain quality; 24 kWh battery, 1.1 kW hotel load, 1.25 kWh/km drive energy, heater load proportional to cold below −20 °C.
- **GO / NO-GO.** Six criteria, all must pass over the whole mission window; thresholds are demo values. A what-if toggle (τ = 1.4) demonstrates NO-GO and blocks Start Mission.
- **Decision engine.** 5 s frames, 2-frame debounce, 30 s clear hold-off, ABORT latched. During REROUTE the crew keeps moving at 60 % speed.
- **Drone.** Leads by 100–150 m along the planned track (shrinking to zero at the destination), 12 m AGL, 60 m scan radius, same localization model as the crew. Message rate in the demo stream is one per 5 s tick.
- **Localization** is noise around the true position on the planned (or rerouted) track, per the brief; it is drawn on MRO imagery and the CTX DEM. The only MGS product loaded is the MOLA colour image on MC-13.
- **Alerts to Earth.** Mission Control is shown as notified after the one-way light time; no acknowledgement loop is modelled.
- **Scrubbing** replays the simulation from tick 0 including injected anomalies, so the state at a given time is reproducible.
- **Typography.** `"Helvetica Neue", Helvetica, Arial, sans-serif`; no web font is bundled.
- **Attribution** is shown in the footer and the Data sources panel; Cesium's default credit box is hidden.

## D. Interface redesign (Liquid Glass) — decisions

- **Provenance without badges.** Pill tags are gone. Every value is an inline citation: on hover it underlines and shows its category as plain text (HISTORIC, MODELLED, SIMULATED …); on click it opens Data sources at its entry. The category is therefore visible on hover rather than permanently; sentences in the panels still state when weather is archived or the clock is a replay.
- **"Isidis Basin".** The IAU name is Isidis Planitia; that is what is shown.
- **Notable features** are the top-ranked IAU features of each region. The ranking (feature type plus a list of well-known names) is an editorial choice; names and coordinates are IAU data. For MC-13 the four features named in the design brief are pinned first.
- **Every region is explorable** down to its feature list. Only Jezero Crater leads into a mission; other features zoom in and say so. The two polar charts have no quadrant view.
- **Satellite / Terrain.** Terrain shows the global MOLA colour shaded relief from Mars Trek at 60 % of the detailed imagery near Jezero.
- **Limb haze.** A thin dusty-orange atmosphere rim is drawn with Cesium's sky atmosphere; it is cosmetic.
- **Mission select.** One mission (Jezero Crater); "Add Mission" is deliberately disabled.
- **Drone at waypoints.** Measurement stops are 4 min (were 8). While the crew works at a waypoint the scout drone lands ahead of them and rests in low power, then takes off for the next leg. The mission is complete once the drone has landed at the destination.
- **Obstacle discovery.** An injected obstacle appears inside the drone's scan footprint, ~40 m beyond the drone (≈ 165 m ahead of the crew); the re-route starts once it is within 150 m. Both crew and drone divert by 14 m. The driven and flown tracks keep the detour and obstacle markers stay until Restart.
- **Dust devil model.** The vortex is advected by the ambient wind (speed and direction from the weather channels) with a wandering heading and speed (first-order autoregressive noise, seeded so a replay is identical), lives 200 s, and fades in and out. It is spawned upwind of a point 110 m ahead of the crew so that it threatens the route. It is a plausible motion model, not one fitted to Martian vortex statistics.
- **First-person view** is the scout drone's camera (pitched 14° down). Its side panels show only altitude, ground speed, heading/pitch, battery, next-waypoint distance and status, and retract to edge straps after ~2.5 s (8 s after any interaction).
- **Colour-coded telemetry.** Values with a defined limit are green when nominal, amber at caution, red at critical; values without a limit stay white.
- **Report.** "Flown by drone" is the drone's actual track length (it leads the crew and hovers back at the end, so it differs from the route length); "Driven by crew" includes detours. Battery is the emulated rover battery — the drone has no separate battery model.
