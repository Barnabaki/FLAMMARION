// Flag-based decision engine. One decision per frame: ABORT > HOLD > REROUTE > PROCEED.
// All thresholds are documented in DECISION_RULES.md. Thresholds are demo values (see provenance there).
export const RULES = {
  tickS: 5,
  debounceTicks: 2,        // a flag must be true on N consecutive frames before it is raised
  clearHoldoffS: 30,       // a raised flag must be false this long before it clears
  dustDevil: { minConfidence: 0.6, maxRangeM: 300, maxTtiS: 300 },
  solar: { holdPfu: 10, abortPfu: 1000 },                 // >10 MeV proton flux, NOAA S1 / S3
  locMismatch: { crossTrackM: 2.0 },
  hls: {
    o2_kpa: { warnLow: 22, critLow: 18 },                 // suit ppO2 (nominal ≈ 29.6 kPa pure O2)
    co2_kpa: { warnHigh: 1.0, critHigh: 2.0 },            // 7.6 / 15 mmHg
    hr_bpm: { warnHigh: 160, critHigh: 185 },
    core_temp_c: { warnLow: 36.0, warnHigh: 38.0, critLow: 35.0, critHigh: 39.0 },
  },
  comms: { minRssiDbm: -95, abortAfterS: 300 },
  terrain: { corridorM: 5, lookaheadM: 150, minTraversability: 0.4 },
  weather: { holdWindMs: 20, abortWindMs: 30, holdTau: 1.5, abortTau: 3.0 },
};
export const PRIORITY = { PROCEED: 0, REROUTE: 1, HOLD: 2, ABORT: 3 };
export const FLAGS = {
  dust_devil: 'Dust devil forming', solar_event: 'Solar flare / CME', loc_mismatch: 'Localization mismatch',
  hls: 'Life support anomalous', comms: 'Comms below threshold', terrain: 'Terrain update — obstacle in path',
  weather: 'Anomalous weather formation',
};

/** Raw (un-debounced) flag evaluation for one frame. Returns { flag: {action, detail} }. */
export function evaluateFlags(f, R = RULES) {
  const out = {};
  const dd = (f.drone?.dust_devils || []).filter((d) => d.confidence >= R.dustDevil.minConfidence &&
    (d.range_to_crew_m <= R.dustDevil.maxRangeM || (d.time_to_intercept_s != null && d.time_to_intercept_s <= R.dustDevil.maxTtiS)));
  if (dd.length) {
    const d = dd[0];
    out.dust_devil = { action: 'HOLD', detail: `conf ${d.confidence.toFixed(2)}, range ${Math.round(d.range_to_crew_m)} m, TTI ${d.time_to_intercept_s == null ? '—' : Math.round(d.time_to_intercept_s) + ' s'}` };
  }
  const pfu = f.rad?.sep_flux_pfu ?? 0;
  if (pfu >= R.solar.holdPfu) out.solar_event = { action: pfu >= R.solar.abortPfu ? 'ABORT' : 'HOLD', detail: `SEP >10 MeV ${pfu.toFixed(0)} pfu` };
  if (Math.abs(f.loc?.cross_track_m ?? 0) > R.locMismatch.crossTrackM) out.loc_mismatch = { action: 'REROUTE', detail: `cross-track ${f.loc.cross_track_m.toFixed(1)} m` };
  if (f.hls) {
    const h = f.hls, H = R.hls, crit = [], warn = [];
    if (h.o2_kpa < H.o2_kpa.critLow) crit.push(`ppO₂ ${h.o2_kpa.toFixed(1)} kPa`); else if (h.o2_kpa < H.o2_kpa.warnLow) warn.push(`ppO₂ ${h.o2_kpa.toFixed(1)} kPa`);
    if (h.co2_kpa > H.co2_kpa.critHigh) crit.push(`ppCO₂ ${h.co2_kpa.toFixed(2)} kPa`); else if (h.co2_kpa > H.co2_kpa.warnHigh) warn.push(`ppCO₂ ${h.co2_kpa.toFixed(2)} kPa`);
    if (h.hr_bpm > H.hr_bpm.critHigh) crit.push(`HR ${Math.round(h.hr_bpm)} bpm`); else if (h.hr_bpm > H.hr_bpm.warnHigh) warn.push(`HR ${Math.round(h.hr_bpm)} bpm`);
    const c = h.core_temp_c, C = H.core_temp_c;
    if (c > C.critHigh || c < C.critLow) crit.push(`core ${c.toFixed(1)} °C`); else if (c > C.warnHigh || c < C.warnLow) warn.push(`core ${c.toFixed(1)} °C`);
    if (crit.length) out.hls = { action: 'ABORT', detail: crit.join(', ') };
    else if (warn.length) out.hls = { action: 'HOLD', detail: warn.join(', ') };
  }
  if ((f.comms?.local_rssi_dbm ?? 0) < R.comms.minRssiDbm) out.comms = { action: 'HOLD', detail: `RSSI ${f.comms.local_rssi_dbm.toFixed(0)} dBm` };
  const obs = (f.drone?.terrain_updates || []).filter((o) => o.is_new && o.traversability < R.terrain.minTraversability &&
    Math.abs(o.cross_track_m) <= R.terrain.corridorM && o.along_track_ahead_m >= 0 && o.along_track_ahead_m <= R.terrain.lookaheadM);
  if (obs.length) out.terrain = { action: 'REROUTE', detail: `${obs[0].type}, ${obs[0].size_m.toFixed(1)} m, ${Math.round(obs[0].along_track_ahead_m)} m ahead` };
  const w = f.env;
  if (w) {
    const g = w.wind_gust_ms ?? w.wind_ms;
    if (g >= R.weather.abortWindMs || w.tau >= R.weather.abortTau) out.weather = { action: 'ABORT', detail: `gust ${g.toFixed(0)} m/s, τ ${w.tau.toFixed(2)}` };
    else if (g >= R.weather.holdWindMs || w.tau >= R.weather.holdTau) out.weather = { action: 'HOLD', detail: `gust ${g.toFixed(0)} m/s, τ ${w.tau.toFixed(2)}` };
  }
  return out;
}

/** Stateful engine: debounce, clear hold-off, comms-timeout escalation, ABORT latch, change log. */
export function createDecisionEngine(R = RULES) {
  const st = {}; // flag -> { count, raised, lastTrueT, since, action, detail }
  let decision = 'PROCEED', aborted = false;
  const log = [];
  function step(t, frame) {
    const raw = evaluateFlags(frame, R);
    const active = {};
    for (const k of Object.keys(FLAGS)) {
      const s = (st[k] ||= { count: 0, raised: false, lastTrueT: -Infinity, since: null });
      if (raw[k]) {
        s.count++; s.lastTrueT = t; s.action = raw[k].action; s.detail = raw[k].detail;
        if (!s.raised && s.count >= R.debounceTicks) { s.raised = true; s.since = t; }
      } else {
        s.count = 0;
        if (s.raised && t - s.lastTrueT >= R.clearHoldoffS) { s.raised = false; s.since = null; }
      }
      if (s.raised) {
        let action = s.action, detail = s.detail;
        if (k === 'comms' && raw[k] && t - s.since >= R.comms.abortAfterS) { action = 'ABORT'; detail += ` — link lost > ${R.comms.abortAfterS} s`; }
        active[k] = { action, detail, since: s.since, clearing: !raw[k] };
      }
    }
    let next = 'PROCEED';
    for (const a of Object.values(active)) if (PRIORITY[a.action] > PRIORITY[next]) next = a.action;
    if (aborted) next = 'ABORT';
    if (next === 'ABORT') aborted = true;
    const changed = next !== decision;
    if (changed) {
      log.push({ t, from: decision, to: next, flags: Object.entries(active).map(([k, a]) => ({ flag: k, action: a.action, detail: a.detail })) });
      decision = next;
    }
    return { decision, active, changed };
  }
  return { step, log, get decision() { return decision; } };
}
