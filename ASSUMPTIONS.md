# Assumptions

## A. Open issues from the brief — defaults applied

1. **Missing decision actions.** HLS anomalous range → ABORT if critical, HOLD if warning-level; comms below threshold → HOLD, ABORT if lost > 300 s (configurable in `RULES.comms.abortAfterS`); terrain update / new obstacle in path → REROUTE; anomalous weather → HOLD, ABORT at the severe level. Numeric thresholds are in `DECISION_RULES.md`. **Confirm with the team.**
2. **Truncated Murray Lab sentence.** Intended as: use the CTX mosaic as the surface imagery layer of the intra-mission 3D view. The Murray Lab mosaic has no public tile endpoint, so the USGS CTX Jezero mosaics served by NASA Mars Trek are used (same instrument, controlled to the HiRISE base).
3. **"3 types of data" but four listed.** All four (telemetry, drone, localization, planned route) are treated as required inputs.
4. **Route not defined.** One proposed route is generated inside Jezero, from the Octavia E. Butler landing site to the base of the western delta front, labelled "Proposed route" and used by A, B and C.
5. **30 cm localization accuracy.** Treated as the 95 % horizontal error radius → σ = 0.30 / √(−2 ln 0.05) = 0.1226 m per axis (`LOC_R95_M` in `src/lib/mars.js`). A test checks that 95 % of generated errors fall within 30 cm.
6. **Electric field.** Fully SIMULATED (≈ 60 V/m background, rising to several kV/m near a dust devil) and labelled as such.
7. **Mission timing.** Simulated epoch = Perseverance sol 84, 2021-05-15, Ls ≈ 45°, Mars Year 36, departure 09:30 LMST (21:35:11 UTC). The clock is a replay epoch and is labelled as not current.
8. **"Gusev scenarios".** Not used; everything is for Jezero.
9. **Curiosity weather is from Gale.** REMS would only be a supplementary reference; it is not loaded in this build.
10. **Folder `UI IMAGES INSPRIRATION`.** The folder was deleted from the repository in commit `d65fe0a`; its images were read from git history (`a60d44f`) for the design pass. It was not restored.

## B. Deviations from the brief (things the brief asked for that this build does not do)

1. **Weather is MODELLED, not HISTORIC.** The PDS node hosting MEDA/REMS could not be reached with a verifiable TLS chain from the build environment. The diurnal cycle is a model shaped to published MEDA ranges; no value is tagged HISTORIC. The brief's "−83 °C to −7.6 °C" range is reflected in the model (air minimum −83 °C, ground maximum −8 °C).
2. **No MOLA elevation mesh; elevations are approximate.** No DEM tile/query service was reachable. The 3D views are real imagery on the reference spheroid (flat at local scale). Waypoint elevations (−2569 m … −2550 m) are approximate and tagged MODELLED; slopes derived from them are indicative only.
3. **CRISM composition baseline not integrated.** Terrain class and "terrain quality" per leg are an interpretation of the HiRISE mosaic, tagged MODELLED.
4. **Earth-link schedule is simulated**, not derived from real orbiter passes; one-way light time is a constant approximation.
5. **Dust-devil statistics are not derived from Spirit data.** The scenario is a single scripted vortex with plausible size and speed; the pre-mission vortex rate follows published MEDA encounter rates.

## C. Further assumptions

- **Jezero coordinates.** The IAU Gazetteer centre is 18.41°N, 77.69°E (the brief expected ≈ 77.5°E). The Gazetteer value is used.
- **Quadrangle boundaries** are the published lat/lon limits of the MC charts, drawn as parallels and meridians. The inspiration mock-up shows irregular outlines; those would not be the official boundaries.
- **Demo scope.** Only MC-13 → MC-13 NE → Jezero is selectable; other quadrangles and quadrants highlight on hover and show a scope notice on click. Only the seven IAU features returned by the Mars Trek nomenclature index for MC-13 NE are labelled.
- **Planetocentric vs planetographic.** Coordinates are planetocentric; geodesic distances treat them as geodetic on the spheroid. Over the 2.6 km route the difference is below 0.01 %.
- **Route.** 8 waypoints, 2 600 m, 1 h 38 min including six 8-minute science stops. Waypoints other than the landing site carry descriptive names, not official ones. The landing site doubles as the notional habitat.
- **Vehicle (EMULATED).** 1.0 m/s base speed derated by terrain quality; 24 kWh battery, 1.1 kW hotel load, 1.25 kWh/km drive energy, heater load proportional to cold below −20 °C.
- **GO / NO-GO.** Six criteria, all must pass over the whole mission window; thresholds are demo values. A what-if toggle (τ = 1.4) demonstrates NO-GO and blocks Start Mission.
- **Decision engine.** 5 s frames, 2-frame debounce, 30 s clear hold-off, ABORT latched. During REROUTE the crew keeps moving at 60 % speed.
- **Drone.** Leads by 100–150 m along the planned track (shrinking to zero at the destination), 12 m AGL, 60 m scan radius, same localization model as the crew. Message rate in the demo stream is one per 5 s tick.
- **Localization** is noise around the true position on the planned (or rerouted) track, per the brief; it is drawn on MRO imagery rather than "Mars Global Surveyor data" because no MGS product is loaded.
- **Alerts to Earth.** Mission Control is shown as notified after the one-way light time; no acknowledgement loop is modelled.
- **Scrubbing** replays the simulation from tick 0 including injected anomalies, so the state at a given time is reproducible.
- **Typography.** `"Helvetica Neue", Helvetica, Arial, sans-serif`; no web font is bundled.
- **Attribution** is shown in the footer and the Data sources panel; Cesium's default credit box is hidden.
