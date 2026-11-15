// Deterministic (seeded) generator for every data file the demo replays. Run: npm run generate
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { rng, LOC_SIGMA_M } from '../src/lib/mars.js';
import { marsTime } from '../src/lib/marsTime.js';
import { SOL_TABLE, REMS_TABLE, weatherAt } from '../src/lib/weather.js';
import { buildPlan, missionStartUtcMs, m2020Sol, SITE, WAYPOINTS, VEHICLE } from '../src/lib/mission.js';
import { DEM_INFO } from '../src/lib/dem.js';
import { RULES } from '../src/lib/decision.js';
import { createSim } from '../src/lib/sim.js';

const out = fileURLToPath(new URL('../public/data/', import.meta.url));
mkdirSync(out, { recursive: true });
const plan = buildPlan(), t0 = missionStartUtcMs(), dt = RULES.tickS;
const iso = (s) => new Date(t0 + s * 1000).toISOString();
const r1 = (x, n = 2) => +x.toFixed(n);

// 1 — Planned trajectory (GeoJSON) --------------------------------------------------------------
const route = {
  type: 'FeatureCollection', name: 'FLAMMARION proposed route — Jezero crater',
  crs_note: 'IAU 2000 Mars (IAU_2015:49900 / ESRI:104905 GCS_Mars_2000): a=3396190 m, b=3376200 m; planetocentric latitude, east-positive longitude (0–360°E). GeoJSON coordinate order [lon, lat, elevation_m]. NOT WGS 84.',
  properties: {
    label: 'Proposed route', demo_only: true,
    disclaimer: 'Demonstration route created for FLAMMARION. It is NOT a path travelled by NASA\'s Perseverance rover.',
    start_utc_simulated: iso(0), end_utc_simulated: iso(plan.duration), depart_lmst: '09:30', ls_deg: r1(marsTime(t0, SITE.lon).ls, 1), mars_year: 36, replay_epoch_m2020_sol: m2020Sol(t0),
    total_distance_m: r1(plan.total_m, 1), duration_s: Math.round(plan.duration), distance_method: 'Vincenty inverse geodesic on the Mars spheroid, summed per segment',
    elevation_provenance: `SATELLITE — bilinear sample of ${DEM_INFO.product} (${DEM_INFO.cell_m} m, ${DEM_INFO.lid}); datum: ${DEM_INFO.datum}`,
    total_climb_m: r1(plan.climb_m, 1), total_descent_m: r1(plan.descent_m, 1), max_slope_deg: r1(plan.max_slope_deg, 1), slope_baseline_m: 40,
    elevation_profile_10m: plan.profile.map((q) => r1(q.elev, 1)),
    vehicle_emulated: VEHICLE,
  },
  features: [
    { type: 'Feature', properties: { kind: 'route', label: 'Proposed route' }, geometry: { type: 'LineString', coordinates: WAYPOINTS.map((w) => [w.lon, w.lat, w.elev]) } },
    ...plan.legs.map((l) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [l.lon, l.lat, l.elev] }, properties: {
      kind: 'waypoint', id: l.id, name: l.name, note: l.note, elevation_m: l.elev, cumulative_distance_m: r1(l.cum_m, 1),
      segment_distance_m: l.seg ? r1(l.seg.distance_m, 1) : 0, segment_speed_ms: l.seg ? r1(l.seg.speed_ms, 3) : null, segment_drive_s: l.seg ? Math.round(l.seg.drive_s) : 0,
      terrain: l.terrain ?? null, terrain_quality: l.quality ?? null, stop_s: l.stop_s,
      arrive_met_s: Math.round(l.arrive_s), depart_met_s: Math.round(l.depart_s), arrive_utc_simulated: iso(l.arrive_s), arrive_lmst_h: r1(marsTime(t0 + l.arrive_s * 1000, SITE.lon).lmst, 3),
    } })),
  ],
};
writeFileSync(out + 'route.geojson', JSON.stringify(route, null, 1));
writeFileSync(out + 'weather_sol.json', JSON.stringify(SOL_TABLE));
writeFileSync(out + 'rems_gale_reference.json', JSON.stringify(REMS_TABLE));

// 2 — Telemetry stream (NDJSON, one record per 5 s tick) -----------------------------------------
const R = rng(20210515), ar = (state, k, phi, sig) => (state[k] = phi * (state[k] || 0) + sig * R.gauss());
const n = Math.ceil((plan.duration + 90 * 60) / dt), st = {}, stream = [];
for (let i = 0; i <= n; i++) {
  const t = i * dt, mt = marsTime(t0 + t * 1000, SITE.lon, SITE.lat), w = weatherAt(SOL_TABLE, mt.ltst, mt.sunElevDeg);
  const nom = plan.nominalAt(t), dHab = Math.max(40, nom.s * 0.8);
  stream.push({
    tick: i, t, utc: iso(t),
    // HISTORIC channels are the MEDA hourly means interpolated in local true solar time — no noise is added to them.
    env: { air_temp_c: r1(w.air_temp_c), ground_temp_c: r1(w.ground_temp_c), pressure_pa: r1(w.pressure_pa, 1), wind_ms: r1(w.wind_ms), uv_wm2: r1(w.uv_wm2, 3),
      wind_gust_ms: r1(w.wind_ms * 1.45 + Math.abs(ar(st, 'gust', 0.6, 0.6))), wind_dir_deg: Math.round((w.wind_dir_deg + ar(st, 'wd', 0.9, 4) + 360) % 360),
      rh_pct: r1(Math.max(0, w.rh_pct)), tau: r1(w.tau + ar(st, 'tau', 0.995, 0.002), 3), solar_flux_wm2: Math.round(w.solar_flux_wm2), sun_elev_deg: r1(mt.sunElevDeg, 1) },
    hls: { o2_kpa: r1(29.6 + ar(st, 'o2', 0.9, 0.06)), co2_kpa: r1(0.34 + (nom.moving ? 0.06 : 0) + ar(st, 'co2', 0.9, 0.015), 3), hr_bpm: Math.round((nom.moving ? 104 : 88) + ar(st, 'hr', 0.92, 2.2)),
      core_temp_c: r1(37.1 + ar(st, 'ct', 0.98, 0.02)), suit_pressure_kpa: r1(29.6 + ar(st, 'sp', 0.9, 0.03)) },
    comms: { local_rssi_dbm: r1(-58 - 17 * Math.log10(dHab / 40) + ar(st, 'rssi', 0.8, 0.9), 1), relay_pass: (t > 1500 && t < 2400) || (t > 6600 && t < 7500), earth_dte: true, earth_owlt_s: 1038 },
    rad: { dose_usv_h: r1(27 + ar(st, 'dose', 0.9, 0.6), 1), sep_flux_pfu: r1(Math.max(0.05, 0.3 + ar(st, 'sep', 0.9, 0.03))) },
    efield_vm: Math.round(60 + ar(st, 'ef', 0.9, 6) + 25 * w.vortex_per_h),
    loc: { crew: [r1(LOC_SIGMA_M * R.gauss(), 4), r1(LOC_SIGMA_M * R.gauss(), 4)], drone: [r1(LOC_SIGMA_M * R.gauss(), 4), r1(LOC_SIGMA_M * R.gauss(), 4)] },
    drone: { lead_m: r1(125 + 22 * Math.sin(t / 190) + ar(st, 'lead', 0.8, 1.2), 1), alt_agl_m: r1(12 + ar(st, 'alt', 0.9, 0.25), 1), ground_speed_ms: r1(0.9 + Math.abs(ar(st, 'gs', 0.8, 0.1))),
      footprint_radius_m: 60, gsd_cm: 2.0, rssi_dbm: r1(-55 + ar(st, 'dr', 0.8, 0.8), 1), latency_ms: Math.round(40 + Math.abs(ar(st, 'lat', 0.7, 6))) },
  });
}
const header = { _meta: true, schema: 'flammarion.telemetry/1.0', tick_s: dt, start_utc_simulated: iso(0), seed: 20210515,
  provenance: { env: { ...SOL_TABLE.provenance, wind_gust_ms: 'SIMULATED', sun_elev_deg: 'COMPUTED', note: `HISTORIC = MEDA hourly means, sols ${SOL_TABLE.sols[0]}–${SOL_TABLE.sols.at(-1)}, replayed by LTST` }, hls: 'SIMULATED', comms: 'SIMULATED', rad: 'SIMULATED', efield_vm: 'SIMULATED', loc: 'SIMULATED (Gaussian, σ=' + LOC_SIGMA_M.toFixed(4) + ' m/axis)', drone: 'SIMULATED' } };
writeFileSync(out + 'telemetry.ndjson', [header, ...stream].map((x) => JSON.stringify(x)).join('\n') + '\n');

// 3 — Dust-devil anomaly scenario: run the real sim headless, inject at T+20 min, dump drone messages + decisions.
const sim = createSim({ plan, stream, startUtcMs: t0 });
sim.inject('dust_devil', 240);
const lines = []; let example = null, nominal = null;
while (sim.state.tick < 320) {
  const S = sim.step();
  if (S.tick === 200) nominal = S.frame.drone;
  if (S.tick >= 236) lines.push({ tick: S.tick, t: S.t, decision: S.decision, flags: Object.keys(S.active), status: S.status, efield_vm: Math.round(S.frame.efield_vm), drone: S.frame.drone });
  if (!example && S.frame.drone.dust_devils.length && S.decision === 'HOLD') example = S.frame.drone;
}
writeFileSync(out + 'dustdevil_scenario.ndjson', lines.map((x) => JSON.stringify(x)).join('\n') + '\n');
writeFileSync(out + 'dustdevil_scenario_decisions.json', JSON.stringify({ injected_at_tick: 240, decision_log: sim.state.engine.log, alerts: sim.state.alerts }, null, 1));
mkdirSync(fileURLToPath(new URL('../examples/', import.meta.url)), { recursive: true });
writeFileSync(fileURLToPath(new URL('../examples/drone_message_nominal.json', import.meta.url)), JSON.stringify(nominal, null, 2));
writeFileSync(fileURLToPath(new URL('../examples/drone_message_dust_devil.json', import.meta.url)), JSON.stringify(example, null, 2));
console.log(`route ${plan.total_m.toFixed(1)} m, ${Math.round(plan.duration / 60)} min, ${stream.length} telemetry records, scenario log:`, sim.state.engine.log.map((l) => `${l.t}s ${l.from}→${l.to}`).join(', '));
