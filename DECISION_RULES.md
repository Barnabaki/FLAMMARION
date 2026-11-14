# Decision rules

Source of truth: `src/lib/decision.js` (`RULES`) and `src/lib/mission.js` (`GO_CRITERIA`). All thresholds are **demo values** chosen to be physically plausible; they are not flight rules. Confirm with the team.

## Intra-mission decision engine

Evaluated on every 5 s frame. Output is exactly one of **ABORT > HOLD > REROUTE > PROCEED** (highest-priority active flag wins).

| Flag | Raised when | Action |
| --- | --- | --- |
| `dust_devil` Dust devil forming | Drone detection with confidence ≥ 0.60 **and** (range to crew ≤ 300 m **or** time-to-intercept ≤ 300 s) | HOLD |
| `solar_event` Solar flare / CME | Solar energetic protons > 10 MeV ≥ 10 pfu (NOAA S1) | HOLD |
| | ≥ 1000 pfu (NOAA S3) | ABORT |
| `loc_mismatch` Localization mismatch | \|cross-track deviation from the planned path\| > 2.0 m | REROUTE |
| `hls` Life support anomalous | Warning: suit ppO₂ < 22 kPa, ppCO₂ > 1.0 kPa, heart rate > 160 bpm, core temp < 36.0 or > 38.0 °C | HOLD |
| | Critical: ppO₂ < 18 kPa, ppCO₂ > 2.0 kPa, heart rate > 185 bpm, core temp < 35.0 or > 39.0 °C | ABORT |
| `comms` Comms below threshold | Crew ↔ habitat RSSI < −95 dBm | HOLD |
| | …continuously for > 300 s | ABORT |
| `terrain` Terrain update | New (not in HiRISE baseline) obstacle with traversability < 0.40, within ±5 m of the planned track and 0–150 m ahead | REROUTE |
| `weather` Anomalous weather | Gust ≥ 20 m/s or dust opacity τ ≥ 1.5 | HOLD |
| | Gust ≥ 30 m/s or τ ≥ 3.0 | ABORT |

**Debounce:** a flag is raised only after it is true on 2 consecutive frames (10 s).
**Hold-off (hysteresis):** a raised flag clears only after it has been false for 30 s.
**ABORT is latched:** once issued the mission ends ("return to habitat"); it does not revert.
**Behaviour:** HOLD → crew stationary; REROUTE → crew continues at 60 % speed on a corrected path (14 m lateral detour around an obstacle, or steering back to the planned track); PROCEED → nominal speed.
**Log:** every decision change is recorded with mission time, previous decision and all active flags with their trigger values (Decision log panel; `public/data/dustdevil_scenario_decisions.json`).
**Alerts:** any active flag shows an anomaly alert marked as delivered to crew and habitat; Mission Control on Earth is shown with the one-way light-time delay.

### Injectable scenarios (`src/lib/sim.js`)

| Button | Effect | Expected |
| --- | --- | --- |
| Dust devil ahead | Vortex spawns ~285 m from the crew and drifts across the path at 4.2 m/s for 170 s; E-field and opacity rise | HOLD → PROCEED |
| Unmapped obstacle | Boulder field 95 m ahead on the track | REROUTE → PROCEED |
| Localization drift | Cross-track bias grows 0.15 m/s to > 2 m, then is steered out | REROUTE → PROCEED |
| Comms dropout | RSSI −104 dBm for 120 s | HOLD → PROCEED |
| Suit CO₂ rise | ppCO₂ peaks ≈ 1.4 kPa over 180 s | HOLD → PROCEED |
| Gust front / dust | Gust 24 m/s, τ +1.25 for 200 s | HOLD → PROCEED |
| Solar event (S2) | Proton flux to ≈ 150 pfu for 10 min | HOLD → PROCEED |
| Solar event (S3+) | Proton flux > 1000 pfu | HOLD → ABORT |

## Pre-mission GO / NO-GO

GO requires **all** criteria to hold over the entire planned mission window; on NO-GO the failing criteria are named.

| Criterion | Limit | Tag |
| --- | --- | --- |
| Minimum air temperature | ≥ −70 °C | weather file provenance |
| Maximum sustained wind | ≤ 15 m/s | weather file provenance |
| Dust optical depth τ | ≤ 1.0 | weather file provenance |
| Peak convective-vortex rate | ≤ 2.0 per hour | weather file provenance |
| Minimum Sun elevation | ≥ 10° | COMPUTED |
| Battery reserve at arrival | ≥ 30 % | EMULATED |
