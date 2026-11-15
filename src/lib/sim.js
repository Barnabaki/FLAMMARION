// Intra-mission simulation core (pure JS, deterministic). Replays the stored telemetry stream tick by tick,
// overlays injected anomaly scenarios, composes the drone message, runs the decision engine and moves crew + drone.
// History (flown trajectories, detected obstacles, dust-devil tracks, statistics) is kept until reset().
import { offset, localEN, rng, LOC_SIGMA_M } from './mars.js';
import { createDecisionEngine, RULES } from './decision.js';
import { batterySoc } from './mission.js';

export const INJECTIONS = {
  dust_devil: { label: 'Dust devil', expect: 'HOLD' },
  obstacle: { label: 'Unmapped obstacle', expect: 'REROUTE' },
  loc_drift: { label: 'Localization drift', expect: 'REROUTE' },
  comms_drop: { label: 'Comms dropout', expect: 'HOLD' },
  hls_co2: { label: 'Suit CO₂ rise', expect: 'HOLD' },
  gust_front: { label: 'Gust front', expect: 'HOLD' },
  solar_s2: { label: 'Solar event S2', expect: 'HOLD' },
  solar_s3: { label: 'Solar event S3+', expect: 'ABORT' },
};
export const DRONE = { climb_m_per_tick: 4, detour_m: 14, dd_life_s: 200 };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const perp = (headingDeg, lateral) => { // lateral metres to the right of heading → east/north
  const h = (headingDeg * Math.PI) / 180; return { e: Math.cos(h) * lateral, n: -Math.sin(h) * lateral };
};
const fwd = (headingDeg, d) => { const h = (headingDeg * Math.PI) / 180; return { e: Math.sin(h) * d, n: Math.cos(h) * d }; };
const dist = (a, b) => { const d = localEN(a.lat, a.lon, b.lat, b.lon); return Math.hypot(d.e, d.n); };

export function createSim({ plan, stream, startUtcMs }) {
  const dt = RULES.tickS, track = plan.track;
  let S;
  const injections = []; // { type, tick } — kept across seeks so a replay is identical
  function reset() {
    S = { tick: 0, t: 0, s: 0, wp: 0, stopLeft: 0, engine: createDecisionEngine(), alerts: [], done: null, inj: [], frame: null,
      lateral: 0, droneLateral: 0, bias: 0, droneAlt: stream[0].drone.alt_agl_m, droneState: 'FLYING',
      trail: [], droneTrail: [], obstacles: [], dustDevils: [], prevCrew: null, prevDrone: null,
      stats: { crew_m: 0, drone_m: 0, landed_s: 0, hold_s: 0, reroute_s: 0, stop_s: 0, moving_s: 0, n: 0, max_efield_vm: 0, max_gust_ms: 0,
        env: {}, battery_start_pct: 100, min_hr: Infinity, max_hr: 0 } };
    step(true);
  }
  function inject(type, tick = S.tick + 1) { injections.push({ type, tick }); injections.sort((a, b) => a.tick - b.tick); }

  function step(first = false) {
    if (!first) { if (S.done || S.tick >= stream.length - 1) { S.done ||= 'STREAM_END'; return S; } S.tick++; S.t = S.tick * dt; }
    const rec = stream[S.tick], t = S.t;
    for (const j of injections) if (j.tick === S.tick) S.inj.push({ type: j.type, t0: t, tick: j.tick, st: {} });
    const here = track.at(S.s);
    const env = { ...rec.env }, hls = { ...rec.hls }, comms = { ...rec.comms }, rad = { ...rec.rad };
    let efield = rec.efield_vm, dustDevils = [], terrainUpdates = [], targetLateral = 0, droneTargetLateral = 0;
    const lead = Math.min(rec.drone.lead_m, Math.max(0, track.total - S.s)), droneS = S.s + lead;
    const dronePath = track.at(droneS);

    for (const j of S.inj) {
      const a = t - j.t0, st = j.st;
      if (j.type === 'dust_devil' && a <= DRONE.dd_life_s) {
        // Convective vortex advected by the ambient wind with a wandering (Ornstein–Uhlenbeck) heading and speed.
        const toDir = (rec.env.wind_dir_deg + 180) % 360;
        if (!st.pos) {
          st.r = rng(7919 + j.tick); st.v0 = Math.max(2.2, rec.env.wind_ms) * (0.9 + 0.3 * st.r.u()); st.dh = 18 * st.r.gauss(); st.ds = 0;
          const cross = track.at(S.s + 110), up = fwd(toDir, -st.v0 * 55), side = perp(toDir, 25 * st.r.gauss());
          st.pos = offset(cross.lat, cross.lon, up.e + side.e, up.n + side.n);
          st.rec = { id: `DD-${Math.round(j.t0)}`, t0: j.t0, t_end: null, min_range_m: Infinity, path: [], peak_tangential_ms: 0 }; S.dustDevils.push(st.rec);
        } else {
          st.dh = 0.86 * st.dh + 11 * st.r.gauss(); st.ds = 0.9 * st.ds + 0.07 * st.r.gauss();
          const v = fwd(toDir + st.dh, st.v0 * clamp(1 + st.ds, 0.55, 1.6)); st.vel = v;
          st.pos = offset(st.pos.lat, st.pos.lon, v.e * dt, v.n * dt);
        }
        const vel = st.vel || fwd(toDir + st.dh, st.v0);
        const en = localEN(here.lat, here.lon, st.pos.lat, st.pos.lon), range = Math.hypot(en.e, en.n);
        const vv = vel.e * vel.e + vel.n * vel.n, tca = clamp(-(en.e * vel.e + en.n * vel.n) / vv, 0, 1e4);
        const miss = Math.hypot(en.e + vel.e * tca, en.n + vel.n * tca);
        const life = clamp(a / 15, 0.35, 1) * (a < DRONE.dd_life_s - 25 ? 1 : clamp((DRONE.dd_life_s - a) / 25, 0, 1));
        const wob = Math.sin(a / 17 + st.dh / 40);
        const d = { id: st.rec.id, lat: st.pos.lat, lon: st.pos.lon, diameter_m: 30 + 8 * wob, height_m: 360 + 70 * Math.sin(a / 23), pressure_drop_pa: 2.6 * life,
          tangential_speed_ms: 14 * life, velocity_east_ms: vel.e, velocity_north_ms: vel.n, confidence: clamp(0.35 + a / 25, 0, 0.96) * (a < DRONE.dd_life_s - 25 ? 1 : life),
          range_to_crew_m: range, miss_distance_m: miss, time_to_intercept_s: miss < 150 && tca > 0 ? tca : null };
        dustDevils.push(d);
        st.rec.path.push([st.pos.lat, st.pos.lon]); st.rec.min_range_m = Math.min(st.rec.min_range_m, range); st.rec.t_end = t; st.rec.peak_tangential_ms = Math.max(st.rec.peak_tangential_ms, d.tangential_speed_ms);
        efield += 5200 * life * Math.exp(-range / 90); env.tau += 0.25 * life * Math.exp(-range / 150);
        env.wind_gust_ms = Math.max(env.wind_gust_ms, env.wind_ms + 9 * life * Math.exp(-range / 120));
      }
      if (j.type === 'obstacle') {
        if (!st.o) { // discovered inside the drone's scan footprint, ahead of the drone
          const s = Math.min(track.total - 5, droneS + 40), p = track.at(s);
          st.o = { id: `OBS-${Math.round(j.t0)}`, lat: p.lat, lon: p.lon, s, t_detected: t, type: 'boulder_field', size_m: 3.6, height_m: 0.7, slope_deg: 19, traversability: 0.15,
            detected_ahead_m: s - S.s, rerouted: false };
          S.obstacles.push(st.o);
        }
        const ahead = st.o.s - S.s;
        if (ahead > -25) {
          terrainUpdates.push({ id: st.o.id, lat: st.o.lat, lon: st.o.lon, type: st.o.type, size_m: st.o.size_m, height_m: st.o.height_m, slope_deg: st.o.slope_deg,
            traversability: st.o.traversability, is_new: true, baseline: 'HiRISE 25 cm orthomosaic', confidence: 0.9, along_track_ahead_m: ahead, cross_track_m: 0 });
          if (st.o.rerouted || S.engine.decision === 'REROUTE') { st.o.rerouted = true; if (ahead < 70) targetLateral = DRONE.detour_m; }
        }
        if (Math.abs(st.o.s - droneS) < 45 && st.o.s > droneS - 45) droneTargetLateral = DRONE.detour_m;
      }
      if (j.type === 'loc_drift') {
        if (!st.fix && Math.abs(S.bias) < 3.4) S.bias += 0.75; // ≈ 0.15 m/s
        if (S.engine.decision === 'REROUTE' && Math.abs(S.bias) > 2) st.fix = true;
        if (st.fix) S.bias = Math.max(0, S.bias - 1.0);
      }
      if (j.type === 'comms_drop' && a <= 120) comms.local_rssi_dbm = -104 + (rec.comms.local_rssi_dbm % 1);
      if (j.type === 'hls_co2' && a <= 180) hls.co2_kpa = rec.hls.co2_kpa + 1.05 * Math.sin((Math.PI * clamp(a, 0, 180)) / 180) ** 0.5;
      if (j.type === 'gust_front' && a <= 200) { env.wind_gust_ms = 24 + 2 * Math.sin(a / 9); env.tau += 1.25; efield += 900; }
      if (j.type === 'solar_s2' && a <= 600) rad.sep_flux_pfu = 140 * Math.sin((Math.PI * a) / 600) + 12;
      if (j.type === 'solar_s3') rad.sep_flux_pfu = a < 60 ? 12 + a * 25 : 1500 + 300 * Math.sin(a / 40);
    }
    S.lateral += clamp(targetLateral - S.lateral, -1.5, 1.5);
    S.droneLateral += clamp(droneTargetLateral - S.droneLateral, -3, 3);

    // Drone flight state: lands and rests in low power while the crew works at a waypoint, takes off for the next leg.
    const rest = S.stopLeft > 0 || S.done === 'COMPLETE' || S.s >= track.total - 1e-6;
    if (rest) { S.droneAlt = Math.max(0, S.droneAlt - DRONE.climb_m_per_tick); S.droneState = S.droneAlt > 0 ? 'LANDING' : 'LANDED'; }
    else if (S.droneAlt < rec.drone.alt_agl_m - 0.01) { S.droneAlt = Math.min(rec.drone.alt_agl_m, S.droneAlt + DRONE.climb_m_per_tick); S.droneState = S.droneAlt < rec.drone.alt_agl_m ? 'TAKEOFF' : 'FLYING'; }
    else { S.droneAlt = rec.drone.alt_agl_m; S.droneState = 'FLYING'; }

    // Localization: estimate = truth on the (re)planned track + Gaussian noise (σ per axis; 30 cm = 95 % radius).
    const lat = perp(here.heading, S.lateral + S.bias), dl = perp(dronePath.heading, S.droneLateral);
    const crewTrue = offset(here.lat, here.lon, lat.e, lat.n), droneTrue = offset(dronePath.lat, dronePath.lon, dl.e, dl.n);
    const crewEst = offset(crewTrue.lat, crewTrue.lon, rec.loc.crew[0], rec.loc.crew[1]);
    const droneEst = offset(droneTrue.lat, droneTrue.lon, rec.loc.drone[0], rec.loc.drone[1]);
    const nrm = perp(here.heading, 1);
    const loc = { crew: crewEst, drone: droneEst, crew_true: crewTrue, drone_true: droneTrue, crew_err_m: Math.hypot(...rec.loc.crew), drone_err_m: Math.hypot(...rec.loc.drone),
      sigma_m: LOC_SIGMA_M, cross_track_m: S.bias + rec.loc.crew[0] * nrm.e + rec.loc.crew[1] * nrm.n };
    // Flown / driven history: actual positions, never snapped back onto the planned line.
    const crewStep = S.prevCrew ? dist(S.prevCrew, crewTrue) : 0, droneStep = S.prevDrone ? dist(S.prevDrone, droneTrue) : 0;
    if (!S.prevCrew || crewStep > 0.2) { S.trail.push([crewTrue.lat, crewTrue.lon]); S.stats.crew_m += crewStep; S.prevCrew = crewTrue; }
    if (!S.prevDrone || droneStep > 0.2) { S.droneTrail.push([droneTrue.lat, droneTrue.lon]); S.stats.drone_m += droneStep; S.prevDrone = droneTrue; }

    const droneMsg = {
      schema: 'flammarion.drone/1.1', msg_id: S.tick, timestamp_utc: new Date(startUtcMs + t * 1000).toISOString(), mission_elapsed_s: t,
      provenance: 'SIMULATED',
      pose: { lat: droneEst.lat, lon: droneEst.lon, alt_agl_m: S.droneAlt, heading_deg: dronePath.heading, ground_speed_ms: droneStep / dt, flight_state: S.droneState,
        position_sigma_m: LOC_SIGMA_M, lead_distance_m: lead },
      scan_footprint: { shape: 'circle', centre_lat: droneEst.lat, centre_lon: droneEst.lon, radius_m: rec.drone.footprint_radius_m, gsd_cm: rec.drone.gsd_cm },
      atmosphere: { dust_opacity_tau: env.tau, tau_sigma: 0.05 },
      dust_devils: dustDevils, terrain_updates: terrainUpdates,
      link: { rssi_dbm: rec.drone.rssi_dbm, latency_ms: rec.drone.latency_ms },
    };
    const frame = { env, hls, comms, rad, efield_vm: efield, loc, drone: droneMsg };
    const prev = S.engine.decision;
    const res = S.engine.step(t, frame);
    if (res.changed) {
      const flags = Object.entries(res.active).map(([k, v]) => `${k}: ${v.detail}`).join('; ');
      S.alerts.push({ t, decision: res.decision, from: prev, flags: Object.keys(res.active), text: flags || 'all flags clear',
        delivered: { crew: true, habitat: true, mcc_earth_eta_s: comms.earth_owlt_s } });
    }
    // Motion
    const L = plan.legs, st = S.stats;
    let moving = false, status = 'Driving', speed = 0;
    if (res.decision === 'ABORT') { S.done = 'ABORTED'; status = 'ABORT: return to habitat'; }
    else if (S.s >= track.total - 1e-6) { if (S.droneAlt <= 0) { S.done = 'COMPLETE'; status = 'Arrived: mission complete'; } else { status = 'Arrived: drone landing'; st.stop_s += dt; } }
    else if (res.decision === 'HOLD') { status = 'HOLD: stationary'; st.hold_s += dt; }
    else if (S.stopLeft > 0) { S.stopLeft -= dt; status = `Measurements at ${L[S.wp].id}`; st.stop_s += dt; }
    else {
      moving = true; if (res.decision === 'REROUTE') { status = 'Rerouting'; st.reroute_s += dt; }
      const next = L[S.wp + 1];
      speed = next.seg.speed_ms * (res.decision === 'REROUTE' ? 0.6 : 1);
      S.s = Math.min(next.cum_m, S.s + speed * dt); st.moving_s += dt;
      if (S.s >= next.cum_m - 1e-6) { S.wp++; S.stopLeft = L[S.wp].stop_s; }
    }
    if (S.droneState === 'LANDED' && !S.done) st.landed_s += dt;
    st.n++; st.max_efield_vm = Math.max(st.max_efield_vm, efield); st.max_gust_ms = Math.max(st.max_gust_ms, env.wind_gust_ms);
    st.min_hr = Math.min(st.min_hr, hls.hr_bpm); st.max_hr = Math.max(st.max_hr, hls.hr_bpm);
    for (const k of ['air_temp_c', 'ground_temp_c', 'pressure_pa', 'wind_ms', 'tau']) { const e = (st.env[k] ||= { min: Infinity, max: -Infinity, sum: 0 }); e.min = Math.min(e.min, env[k]); e.max = Math.max(e.max, env[k]); e.sum += env[k]; }
    S.moving = moving; S.status = status; S.frame = frame; S.active = res.active; S.decision = res.decision;
    S.battery_pct = batterySoc(t, S.s, env.air_temp_c); S.here = here; S.lead = lead; S.elev_m = plan.elevAtS(S.s); S.slope_deg = plan.slopeAtS(S.s);
    S.speed_ms = speed;
    S.utcMs = startUtcMs + t * 1000;
    return S;
  }
  function seek(tick) { reset(); while (S.tick < tick && !S.done) step(); return S; }
  reset();
  return { step, seek, inject, reset: () => { injections.length = 0; reset(); }, get state() { return S; }, injections, dt };
}

/** Plain-data mission summary for the post-mission report. */
export function missionReport(S, plan) {
  const st = S.stats, mean = (k) => st.env[k].sum / st.n;
  return {
    outcome: S.done, duration_s: S.t, planned_duration_s: plan.duration, planned_m: plan.total_m, crew_m: st.crew_m, drone_m: st.drone_m, progress_m: S.s,
    moving_s: st.moving_s, stop_s: st.stop_s, landed_s: st.landed_s, hold_s: st.hold_s, reroute_s: st.reroute_s,
    obstacles: S.obstacles.map((o) => ({ ...o })), dust_devils: S.dustDevils.map((d) => ({ id: d.id, t0: d.t0, duration_s: d.t_end - d.t0, min_range_m: d.min_range_m, peak_tangential_ms: d.peak_tangential_ms })),
    decisions: S.engine.log.map((l) => ({ ...l })),
    env: Object.fromEntries(Object.keys(st.env).map((k) => [k, { min: st.env[k].min, max: st.env[k].max, mean: mean(k) }])), max_efield_vm: st.max_efield_vm, max_gust_ms: st.max_gust_ms,
    battery_start_pct: st.battery_start_pct, battery_end_pct: S.battery_pct, battery_used_pct: st.battery_start_pct - S.battery_pct,
    battery_per_km_pct: S.s > 0 ? (st.battery_start_pct - S.battery_pct) / (S.s / 1000) : 0,
  };
}
