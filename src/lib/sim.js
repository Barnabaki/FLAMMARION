// Intra-mission simulation core (pure JS, deterministic). Replays the stored telemetry stream tick by tick,
// overlays injected anomaly scenarios, composes the drone message, runs the decision engine and moves the crew.
import { offset, localEN, LOC_SIGMA_M } from './mars.js';
import { createDecisionEngine, RULES } from './decision.js';
import { batterySoc } from './mission.js';

export const INJECTIONS = {
  dust_devil: { label: 'Dust devil ahead', expect: 'HOLD' },
  obstacle: { label: 'Unmapped obstacle', expect: 'REROUTE' },
  loc_drift: { label: 'Localization drift', expect: 'REROUTE' },
  comms_drop: { label: 'Comms dropout', expect: 'HOLD' },
  hls_co2: { label: 'Suit CO₂ rise', expect: 'HOLD' },
  gust_front: { label: 'Gust front / dust', expect: 'HOLD' },
  solar_s2: { label: 'Solar event (S2)', expect: 'HOLD' },
  solar_s3: { label: 'Solar event (S3+)', expect: 'ABORT' },
};
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const perp = (headingDeg, lateral) => { // lateral metres to the right of heading → east/north
  const h = (headingDeg * Math.PI) / 180; return { e: Math.cos(h) * lateral, n: -Math.sin(h) * lateral };
};
const fwd = (headingDeg, d) => { const h = (headingDeg * Math.PI) / 180; return { e: Math.sin(h) * d, n: Math.cos(h) * d }; };

export function createSim({ plan, stream, startUtcMs }) {
  const dt = RULES.tickS, track = plan.track;
  let S;
  const injections = []; // { type, tick } — kept across scrubs so a replay is identical
  function reset() {
    S = { tick: 0, t: 0, s: 0, wp: 0, stopLeft: 0, engine: createDecisionEngine(), alerts: [], done: null, inj: [],
      frame: null, lateral: 0, bias: 0, movingS: 0 };
    step(true);
  }
  function inject(type, tick = S.tick + 1) { injections.push({ type, tick }); injections.sort((a, b) => a.tick - b.tick); }

  function step(first = false) {
    if (!first) { if (S.done || S.tick >= stream.length - 1) { S.done ||= 'STREAM_END'; return S; } S.tick++; S.t = S.tick * dt; }
    const rec = stream[S.tick], t = S.t;
    for (const j of injections) if (j.tick === S.tick) S.inj.push({ type: j.type, t0: t, st: {} });
    const here = track.at(S.s);
    const env = { ...rec.env }, hls = { ...rec.hls }, comms = { ...rec.comms }, rad = { ...rec.rad };
    let efield = rec.efield_vm, dustDevils = [], terrainUpdates = [], targetLateral = 0;
    const lead = Math.min(rec.drone.lead_m, Math.max(0, track.total - S.s));
    const droneTrue = track.at(S.s + lead);

    for (const j of S.inj) {
      const a = t - j.t0, st = j.st;
      if (j.type === 'dust_devil' && a <= 170) {
        if (!st.pos) { // spawn right-ahead of the crew, drifting across the planned path
          const p = track.at(S.s + 230), o = perp(p.heading, 170);
          st.pos = offset(p.lat, p.lon, o.e, o.n); st.cross = track.at(S.s + 110); st.s0 = S.s;
          const v = perp(p.heading, -1), f = fwd(p.heading, -0.55), n = Math.hypot(v.e + f.e, v.n + f.n);
          st.vel = { e: (4.2 * (v.e + f.e)) / n, n: (4.2 * (v.n + f.n)) / n };
        } else st.pos = offset(st.pos.lat, st.pos.lon, st.vel.e * dt, st.vel.n * dt);
        const en = localEN(here.lat, here.lon, st.pos.lat, st.pos.lon), de = en.e, dn = en.n, range = Math.hypot(de, dn);
        // closest approach of the vortex to the crew's current position, assuming straight-line motion
        const vv = st.vel.e * st.vel.e + st.vel.n * st.vel.n, tca = clamp(-(de * st.vel.e + dn * st.vel.n) / vv, 0, 1e4);
        const miss = Math.hypot(de + st.vel.e * tca, dn + st.vel.n * tca);
        const life = a < 150 ? 1 : clamp(1 - (a - 150) / 20, 0, 1);
        const confidence = clamp(0.35 + a / 25, 0, 0.96) * life;
        dustDevils.push({ id: `DD-${Math.round(j.t0)}`, lat: st.pos.lat, lon: st.pos.lon, diameter_m: 34 + 6 * Math.sin(a / 17), height_m: 380 + 60 * Math.sin(a / 23),
          pressure_drop_pa: 2.6 * life, tangential_speed_ms: 14 * life, velocity_east_ms: st.vel.e, velocity_north_ms: st.vel.n, confidence,
          range_to_crew_m: range, miss_distance_m: miss, time_to_intercept_s: miss < 150 && tca > 0 ? tca : null });
        efield += 5200 * life * Math.exp(-range / 90); env.tau += 0.25 * life * Math.exp(-range / 150);
        env.wind_gust_ms = Math.max(env.wind_gust_ms, env.wind_ms + 9 * life * Math.exp(-range / 120));
      }
      if (j.type === 'obstacle') {
        if (!st.s) { st.s = Math.min(track.total - 5, S.s + 95); const p = track.at(st.s); st.pos = { lat: p.lat, lon: p.lon }; }
        const ahead = st.s - S.s;
        if (ahead > -25) {
          terrainUpdates.push({ id: `OBS-${Math.round(j.t0)}`, lat: st.pos.lat, lon: st.pos.lon, type: 'boulder_field', size_m: 3.6, height_m: 0.7, slope_deg: 19,
            traversability: 0.15, is_new: true, baseline: 'HiRISE 25 cm orthomosaic', confidence: 0.9, along_track_ahead_m: ahead, cross_track_m: 0 });
          if (st.detour || S.engine.decision === 'REROUTE') { st.detour = true; if (ahead < 70) targetLateral = 14; }
        }
      }
      if (j.type === 'loc_drift') {
        if (!st.fix && Math.abs(S.bias) < 3.4) S.bias += 0.3 * dt / 5 * 2.5; // grows ≈ 0.15 m/s
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

    // Localization: estimate = truth on (re)planned track + Gaussian noise (σ per axis, 30 cm = 95 % radius).
    const lat = perp(here.heading, S.lateral + S.bias);
    const crewTrue = offset(here.lat, here.lon, lat.e, lat.n);
    const crewEst = offset(crewTrue.lat, crewTrue.lon, rec.loc.crew[0], rec.loc.crew[1]);
    const droneEst = offset(droneTrue.lat, droneTrue.lon, rec.loc.drone[0], rec.loc.drone[1]);
    const nrm = perp(here.heading, 1);
    const loc = { crew: crewEst, drone: droneEst, crew_err_m: Math.hypot(...rec.loc.crew), drone_err_m: Math.hypot(...rec.loc.drone),
      sigma_m: LOC_SIGMA_M, cross_track_m: S.bias + rec.loc.crew[0] * nrm.e + rec.loc.crew[1] * nrm.n };

    const droneMsg = {
      schema: 'flammarion.drone/1.0', msg_id: S.tick, timestamp_utc: new Date(startUtcMs + t * 1000).toISOString(), mission_elapsed_s: t,
      provenance: 'SIMULATED',
      pose: { lat: droneEst.lat, lon: droneEst.lon, alt_agl_m: rec.drone.alt_agl_m, heading_deg: droneTrue.heading, ground_speed_ms: S.moving ? rec.drone.ground_speed_ms : 0,
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
    const L = plan.legs;
    let moving = false, status = 'Driving';
    if (res.decision === 'ABORT') { S.done = 'ABORTED'; status = 'ABORT — return to habitat'; }
    else if (S.s >= track.total - 1e-6) { S.done = 'COMPLETE'; status = 'Arrived — mission complete'; }
    else if (res.decision === 'HOLD') status = 'HOLD — stationary';
    else if (S.stopLeft > 0) { S.stopLeft -= dt; status = `Science stop at ${L[S.wp].id}`; }
    else {
      moving = true; if (res.decision === 'REROUTE') status = 'Rerouting';
      const next = L[S.wp + 1];
      S.s = Math.min(next.cum_m, S.s + next.seg.speed_ms * (res.decision === 'REROUTE' ? 0.6 : 1) * dt); S.movingS += dt;
      if (S.s >= next.cum_m - 1e-6) { S.wp++; S.stopLeft = L[S.wp].stop_s; }
    }
    S.moving = moving; S.status = status; S.frame = frame; S.active = res.active; S.decision = res.decision;
    S.battery_pct = batterySoc(t, S.s, env.air_temp_c); S.here = here; S.lead = lead;
    S.utcMs = startUtcMs + t * 1000;
    return S;
  }
  function seek(tick) { reset(); while (S.tick < tick && !S.done) step(); return S; }
  reset();
  return { step, seek, inject, reset: () => { injections.length = 0; reset(); }, get state() { return S; }, injections, dt };
}
