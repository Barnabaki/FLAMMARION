// The single shared route object (A → B → C) and the nominal traverse plan derived from it.
import { buildTrack } from './mars.js';
import { elevAt } from './dem.js';
import { marsTime } from './marsTime.js';

export const SITE = { name: 'Jezero Crater', lat: 18.4447, lon: 77.4508 }; // habitat = route start
// Simulated mission epoch: Perseverance sol 47 (2021-04-07), Ls ≈ 28°, MY 36 — the middle of the MEDA sols (44–51)
// the weather data comes from. The clock is a SIMULATED replay epoch, never "now". Departure is 09:30 LMST at the site.
export const LANDING_UTC_MS = Date.UTC(2021, 1, 18, 20, 44);
/** Perseverance sol number at a UTC instant (sol 0 = landing sol, local mean solar days at the site). */
export const m2020Sol = (ms) => { const d = (t) => Math.floor(marsTime(t).msd + SITE.lon / 360); return d(ms) - d(LANDING_UTC_MS); };
export const DEPART_LMST_H = 9.5;
export function missionStartUtcMs() {
  let t = Date.UTC(2021, 3, 7, 0, 0, 0);
  for (let i = 0; i < 2000; i++) { // step forward to the first 09:30 LMST after 00:00 UTC
    const d = ((DEPART_LMST_H - marsTime(t, SITE.lon).lmst + 24) % 24);
    if (d < 1e-4 || d > 24 - 1e-4) break;
    t += d * 3600e3 * 1.0274912517;
  }
  return Math.round(t / 1000) * 1000;
}

// PROPOSED ROUTE (demo). Not a path driven by any NASA rover. Elevations are sampled from the 20 m CTX DEM (dem.js).
export const WAYPOINTS = [
  { id: 'WP0', name: 'Habitat — Octavia E. Butler Landing', lat: 18.4447, lon: 77.4508, stop_s: 0,
    note: 'Start. Perseverance touchdown site (18 Feb 2021), used here as the notional habitat location.' },
  { id: 'WP1', name: 'Crater-floor margin', lat: 18.44935, lon: 77.44918, stop_s: 240,
    note: 'North-west along the boundary between the cratered floor and the rougher unit to the west.', terrain: 'fractured bedrock', quality: 0.82 },
  { id: 'WP2', name: 'Floor traverse', lat: 18.45249, lon: 77.44380, stop_s: 240,
    note: 'Enters the smoother corridor south of a ~250 m crater.', terrain: 'fractured bedrock', quality: 0.85 },
  { id: 'WP3', name: 'Smooth corridor', lat: 18.45343, lon: 77.43528, stop_s: 240,
    note: 'Low-relief, smooth-textured band leading west toward the delta.', terrain: 'smooth regolith', quality: 0.9 },
  { id: 'WP4', name: 'Delta approach', lat: 18.45437, lon: 77.42610, stop_s: 240,
    note: 'Gentle rise toward the foot of the western fan-delta.', terrain: 'smooth regolith', quality: 0.88 },
  { id: 'WP5', name: 'Delta-front apron', lat: 18.45751, lon: 77.42479, stop_s: 240,
    note: 'Debris apron below the scarp; sand ripples and float rocks.', terrain: 'rocky apron with ripples', quality: 0.65 },
  { id: 'WP6', name: 'Delta front — south-east scarp base', lat: 18.46159, lon: 77.42400, stop_s: 240,
    note: 'Foot of the layered delta scarp.', terrain: 'rocky apron', quality: 0.6 },
  { id: 'WP7', name: 'Delta front — east scarp base', lat: 18.46944, lon: 77.42807, stop_s: 0,
    note: 'Destination: base of the eastern delta-front scarp.', terrain: 'rocky apron', quality: 0.55 },
].map((w) => ({ ...w, elev: Math.round(elevAt(w.lat, w.lon) * 10) / 10 }));
export const VEHICLE = { // EMULATED crew rover
  base_speed_ms: 1.0, battery_kwh: 24, hotel_kw: 1.1, drive_kwh_per_km: 1.25, heater_kw_per_k: 0.012, heater_ref_c: -20,
};

/** Segment speed: base speed derated by terrain quality (quality of the segment's END waypoint). */
export const segmentSpeed = (wpEnd) => VEHICLE.base_speed_ms * (0.45 + 0.55 * (wpEnd.quality ?? 0.8));

export function buildPlan(waypoints = WAYPOINTS) {
  const track = buildTrack(waypoints);
  let t = 0;
  const legs = waypoints.map((w, i) => {
    let seg = null;
    if (i > 0) {
      const dist = track.cum[i] - track.cum[i - 1], v = segmentSpeed(w);
      seg = { distance_m: dist, speed_ms: v, drive_s: dist / v };
      t += seg.drive_s;
    }
    const arrive = t; t += w.stop_s || 0;
    return { ...w, index: i, cum_m: track.cum[i], seg, arrive_s: arrive, depart_s: t };
  });
  const duration = t;
  /** Nominal state at mission time t (s): distance along track + activity. */
  function nominalAt(time) {
    if (time <= 0) return { s: 0, moving: false, wp: 0 };
    for (let i = 1; i < legs.length; i++) {
      const L = legs[i];
      if (time < L.arrive_s) return { s: legs[i - 1].cum_m + (time - legs[i - 1].depart_s) * L.seg.speed_ms, moving: true, wp: i - 1 };
      if (time < L.depart_s) return { s: L.cum_m, moving: false, wp: i };
    }
    return { s: track.total, moving: false, wp: legs.length - 1 };
  }
  // Elevation profile sampled from the DEM every 10 m along the track; slope over a 40 m baseline (2 DEM cells).
  const profile = [];
  for (let s = 0; s <= track.total; s += 10) { const p = track.at(s); profile.push({ s, elev: elevAt(p.lat, p.lon) }); }
  const elevAtS = (s) => { const i = Math.max(0, Math.min(profile.length - 2, Math.floor(s / 10))), k = Math.max(0, Math.min(1, s / 10 - i)); return profile[i].elev + (profile[i + 1].elev - profile[i].elev) * k; };
  const slopeAtS = (s) => { const a = Math.max(0, s - 20), b = Math.min(track.total, s + 20); return (Math.atan((elevAtS(b) - elevAtS(a)) / Math.max(1, b - a)) * 180) / Math.PI; };
  let climb = 0, descent = 0, maxSlope = 0;
  for (let i = 1; i < profile.length; i++) { const d = profile[i].elev - profile[i - 1].elev; if (d > 0) climb += d; else descent -= d; }
  for (let s = 0; s <= track.total; s += 10) maxSlope = Math.max(maxSlope, Math.abs(slopeAtS(s)));
  return { track, legs, duration, total_m: track.total, nominalAt, profile, elevAtS, slopeAtS, climb_m: climb, descent_m: descent, max_slope_deg: maxSlope };
}

/** EMULATED battery state of charge (%) after `t` seconds, `s` metres, at mean air temperature `tempC`. */
export function batterySoc(t, s, tempC = -40) {
  const heater = Math.max(0, VEHICLE.heater_ref_c - tempC) * VEHICLE.heater_kw_per_k;
  const kwh = ((VEHICLE.hotel_kw + heater) * t) / 3600 + (VEHICLE.drive_kwh_per_km * s) / 1000;
  return Math.max(0, 100 * (1 - kwh / VEHICLE.battery_kwh));
}

// Pre-mission GO / NO-GO criteria (demo thresholds, see DECISION_RULES.md §Pre-mission).
export const GO_CRITERIA = [
  { key: 'air_temp_c', label: 'Min air temperature', unit: '°C', limit: -70, test: (v) => v >= -70, agg: 'min', fmt: (v) => v.toFixed(0), rule: '≥ −70 °C' },
  { key: 'wind_ms', label: 'Max sustained wind', unit: 'm/s', limit: 15, test: (v) => v <= 15, agg: 'max', fmt: (v) => v.toFixed(1), rule: '≤ 15 m/s' },
  { key: 'tau', label: 'Dust optical depth τ', unit: '', limit: 1.0, test: (v) => v <= 1.0, agg: 'max', fmt: (v) => v.toFixed(2), rule: '≤ 1.0' },
  { key: 'vortex_per_h', label: 'Peak vortex rate', unit: '/h', limit: 2.0, test: (v) => v <= 2.0, agg: 'max', fmt: (v) => v.toFixed(1), rule: '≤ 2.0 /h' },
  { key: 'sun_elev_deg', label: 'Min Sun elevation', unit: '°', limit: 10, test: (v) => v >= 10, agg: 'min', fmt: (v) => v.toFixed(0), rule: '≥ 10° (daylight)' },
  { key: 'battery_pct', label: 'Battery reserve at arrival', unit: '%', limit: 30, test: (v) => v >= 30, agg: 'min', fmt: (v) => v.toFixed(0), rule: '≥ 30 %' },
];
