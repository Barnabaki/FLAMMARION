import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import { geodesic, MARS, LOC_SIGMA_M, LOC_R95_M } from '../src/lib/mars.js';
import { marsTime, hms } from '../src/lib/marsTime.js';
import { QUADRANGLES, quadrants, findQuadrangle, contains, JEZERO } from '../src/lib/quadrangles.js';
import { createDecisionEngine, evaluateFlags, RULES } from '../src/lib/decision.js';
import { buildPlan, missionStartUtcMs, SITE } from '../src/lib/mission.js';
import { createSim, INJECTIONS } from '../src/lib/sim.js';

const rd = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const stream = rd('public/data/telemetry.ndjson').trim().split('\n').map((l) => JSON.parse(l)).filter((r) => !r._meta);
const newSim = () => createSim({ plan: buildPlan(), stream, startUtcMs: missionStartUtcMs() });

test('geodesic: quarter meridian and equator on the Mars spheroid', () => {
  assert.ok(Math.abs(geodesic(0, 0, 0, 90).distance - (Math.PI / 2) * MARS.a) < 1);
  const m = geodesic(0, 0, 90, 0).distance; // meridian quadrant lies between b·π/2 and a·π/2
  assert.ok(m > (Math.PI / 2) * MARS.b && m < (Math.PI / 2) * MARS.a);
  assert.ok(Math.abs(geodesic(18, 77, 19, 77).distance - 59000) < 400);
});
test('Mars24 reference epoch 2000-01-06 00:00 UTC', () => {
  const r = marsTime(Date.UTC(2000, 0, 6));
  assert.equal(r.msd.toFixed(5), '44795.99976'); assert.equal(hms(r.mtc), '23:59:39');
  assert.ok(Math.abs(r.ls - 277.18758) < 1e-4); assert.ok(Math.abs(r.eotDeg + 5.18774) < 1e-4);
});
test('mission epoch: 09:30 LMST at Jezero, Ls ≈ 45°, MY 36', () => {
  const r = marsTime(missionStartUtcMs(), SITE.lon, SITE.lat);
  assert.ok(Math.abs(r.lmst - 9.5) < 0.001); assert.ok(Math.abs(r.ls - 45) < 1); assert.equal(r.marsYear, 36);
});
test('30 MC quadrangles tile the sphere exactly once; Jezero in MC-13 NE', () => {
  assert.equal(QUADRANGLES.length, 30);
  let sr = 0; for (const q of QUADRANGLES) sr += (q.east - q.west) * (Math.PI / 180) * (Math.sin(q.north * Math.PI / 180) - Math.sin(q.south * Math.PI / 180));
  assert.ok(Math.abs(sr - 4 * Math.PI) < 1e-9);
  const mc13 = findQuadrangle(JEZERO.lat, JEZERO.lon);
  assert.deepEqual([mc13.id, mc13.name, mc13.south, mc13.north, mc13.west, mc13.east], ['MC-13', 'Syrtis Major', 0, 30, 45, 90]);
  const ne = quadrants(mc13).find((s) => contains(s, JEZERO.lat, JEZERO.lon));
  assert.deepEqual([ne.id, ne.south, ne.north, ne.west, ne.east], ['MC-13 NE', 15, 30, 67.5, 90]);
  assert.ok(Math.abs(JEZERO.lat - 18.41) < 0.1 && Math.abs(JEZERO.lon - 77.69) < 0.1); // IAU Gazetteer: 18.41°N, 77.69°E
});
test('localization noise: 95 % of horizontal errors within 30 cm', () => {
  const errs = stream.flatMap((r) => [Math.hypot(...r.loc.crew), Math.hypot(...r.loc.drone)]);
  const frac = errs.filter((e) => e <= LOC_R95_M).length / errs.length;
  assert.ok(Math.abs(frac - 0.95) < 0.015, `fraction within 30 cm = ${frac}`);
  assert.ok(Math.abs(LOC_SIGMA_M - 0.1226) < 1e-4);
});
test('decision engine: priority, debounce, hold-off, comms escalation, ABORT latch', () => {
  const ok = { env: { wind_ms: 5, wind_gust_ms: 7, tau: 0.4 }, hls: { o2_kpa: 29.6, co2_kpa: 0.3, hr_bpm: 100, core_temp_c: 37 }, comms: { local_rssi_dbm: -70 }, rad: { sep_flux_pfu: 0.3 }, loc: { cross_track_m: 0.1 }, drone: { dust_devils: [], terrain_updates: [] } };
  assert.deepEqual(evaluateFlags(ok), {});
  const e = createDecisionEngine(), bad = { ...ok, comms: { local_rssi_dbm: -100 }, loc: { cross_track_m: 3 } };
  assert.equal(e.step(0, bad).decision, 'PROCEED');          // debounce: first frame ignored
  assert.equal(e.step(5, bad).decision, 'HOLD');             // HOLD (comms) outranks REROUTE (loc)
  assert.equal(e.step(10, ok).decision, 'HOLD');             // hold-off keeps the flag raised
  assert.equal(e.step(45, ok).decision, 'PROCEED');
  for (let t = 50; t <= 50 + RULES.comms.abortAfterS + 10; t += 5) e.step(t, bad);
  assert.equal(e.decision, 'ABORT');                         // comms lost > timeout
  assert.equal(e.step(1000, ok).decision, 'ABORT');          // latched
  assert.ok(e.log.length >= 4 && e.log.every((l) => 't' in l && l.flags));
});
test('nominal mission completes with PROCEED only', () => {
  const sim = newSim(); while (!sim.state.done) sim.step();
  assert.equal(sim.state.done, 'COMPLETE'); assert.equal(sim.state.engine.log.length, 0);
  assert.ok(Math.abs(sim.state.t - buildPlan().duration) < 60);
});
test('dust-devil scenario: alert to crew + habitat and HOLD, then resume', () => {
  const sim = newSim(); sim.inject('dust_devil', 240); let moved = 0;
  while (sim.state.tick < 300) { const s0 = sim.state.s; sim.step(); if (sim.state.decision === 'HOLD') moved += sim.state.s - s0; }
  const log = sim.state.engine.log;
  assert.deepEqual(log.map((l) => l.to), ['HOLD', 'PROCEED']); assert.equal(log[0].flags[0].flag, 'dust_devil');
  assert.ok(log[0].t - 1200 <= 20); assert.equal(moved, 0);
  assert.ok(sim.state.alerts[0].delivered.crew && sim.state.alerts[0].delivered.habitat);
});
test('every injection yields its documented decision; seek() replays deterministically', () => {
  for (const [type, def] of Object.entries(INJECTIONS)) {
    const sim = newSim(); sim.inject(type, 100); const seen = new Set();
    while (sim.state.tick < 400 && !sim.state.done) { sim.step(); seen.add(sim.state.decision); }
    assert.ok(seen.has(def.expect), `${type} → ${def.expect}, saw ${[...seen]}`);
    if (def.expect !== 'ABORT') assert.equal(sim.state.decision, 'PROCEED', `${type} recovers`);
  }
  const a = newSim(); a.inject('obstacle', 100); while (a.state.tick < 180) a.step();
  const snap = JSON.stringify([a.state.s, a.state.decision, a.state.frame.loc]);
  a.seek(180); assert.equal(JSON.stringify([a.state.s, a.state.decision, a.state.frame.loc]), snap);
});
test('drone messages validate against drone_message_schema.json', () => {
  const validate = new Ajv({ allErrors: true }).compile(JSON.parse(rd('drone_message_schema.json')));
  const msgs = [JSON.parse(rd('examples/drone_message_nominal.json')), JSON.parse(rd('examples/drone_message_dust_devil.json')),
    ...rd('public/data/dustdevil_scenario.ndjson').trim().split('\n').map((l) => JSON.parse(l).drone)];
  const sim = newSim(); sim.inject('obstacle', 50); while (sim.state.tick < 80) { sim.step(); msgs.push(sim.state.frame.drone); }
  for (const m of msgs) assert.ok(validate(m), JSON.stringify(validate.errors));
  assert.ok(msgs.some((m) => m.terrain_updates.length) && msgs.some((m) => m.dust_devils.length));
});
test('route file: geodesic total equals sum of segments and matches the plan', () => {
  const g = JSON.parse(rd('public/data/route.geojson')), c = g.features[0].geometry.coordinates;
  let sum = 0; for (let i = 1; i < c.length; i++) sum += geodesic(c[i - 1][1], c[i - 1][0], c[i][1], c[i][0]).distance;
  assert.ok(Math.abs(sum - g.properties.total_distance_m) < 0.1); assert.equal(g.properties.label, 'Proposed route');
});
