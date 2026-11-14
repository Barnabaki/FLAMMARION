// MODULE C — Intra-mission. Simulated real-time replay of the stored telemetry stream with drone scouting,
// localization, decision engine and anomaly alerts. Two screens: bird's-eye (third person) and first person.
import { Cesium, deg, dynamicShow } from './viewer.js';
import { h, badge, metric, fmtDist, fmtDur, toast } from './ui/dom.js';
import { marsTime, hms } from './lib/marsTime.js';
import { SITE } from './lib/mission.js';
import { FLAGS, RULES } from './lib/decision.js';
import { createSim, INJECTIONS } from './lib/sim.js';
import { LOC_R95_M } from './lib/mars.js';

const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const SPEEDS = [1, 10, 60, 240];

export function initC(app) {
  const { viewer } = app;
  let sim = null, raf = 0, last = 0, playing = false, speed = 60, acc = 0, view = 'bird', m = {}, ui = {}, prev = null, cur = null, active = false, logLen = -1;
  const R = { crew: { lat: SITE.lat, lon: SITE.lon }, drone: { lat: SITE.lat, lon: SITE.lon }, heading: 0 }; // interpolated render state
  const S = () => sim.state;
  const CYAN = Cesium.Color.fromCssColorString('#7fd6e8'), ORANGE = Cesium.Color.fromCssColorString('#f0b54a'), RED = Cesium.Color.fromCssColorString('#f0615a');
  const on = () => active, dd = () => (active && S().frame.drone.dust_devils[0]) || null, obs = () => (active && S().frame.drone.terrain_updates[0]) || null;
  const cb = (f) => new Cesium.CallbackProperty(f, false);
  const lbl = (text, color = Cesium.Color.WHITE, dy = 18) => ({ text, font: `500 10px ${FONT}`, pixelOffset: new Cesium.Cartesian2(0, dy), fillColor: color, outlineColor: Cesium.Color.BLACK, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, disableDepthTestDistance: Number.POSITIVE_INFINITY });
  // --- scene entities (created once, shown only while the module is active)
  const showIf = dynamicShow(viewer), add = (def, fn) => showIf(viewer.entities.add(def), fn);
  add({ position: cb(() => deg(R.drone.lon, R.drone.lat, active ? S().frame.drone.pose.alt_agl_m : 12)),
    point: { pixelSize: 9, color: CYAN, outlineColor: Cesium.Color.BLACK, outlineWidth: 1.5, disableDepthTestDistance: Number.POSITIVE_INFINITY }, label: lbl('DRONE', CYAN, -16) }, on);
  add({ position: cb(() => deg(R.drone.lon, R.drone.lat, 0.4)), ellipse: { semiMajorAxis: 60, semiMinorAxis: 60, height: 0.4, material: CYAN.withAlpha(0.13), outline: true, outlineColor: CYAN.withAlpha(0.6) } }, on);
  add({ polyline: { positions: cb(() => [deg(R.crew.lon, R.crew.lat, 1.5), deg(R.drone.lon, R.drone.lat, 12)]), width: 1.5, material: new Cesium.PolylineDashMaterialProperty({ color: CYAN.withAlpha(0.8), dashLength: 10 }) } }, on);
  add({ polyline: { positions: cb(() => [deg(SITE.lon, SITE.lat, 3), deg(R.crew.lon, R.crew.lat, 1.5)]), width: 1,
    material: new Cesium.PolylineDashMaterialProperty({ color: cb(() => (active && S().frame.comms.local_rssi_dbm < RULES.comms.minRssiDbm ? RED : Cesium.Color.WHITE.withAlpha(0.45))), dashLength: 8 }) } }, on);
  add({ polyline: { width: 3.5, material: Cesium.Color.WHITE, positions: cb(() => {
    if (!active) return [deg(SITE.lon, SITE.lat), deg(SITE.lon, SITE.lat)];
    const p = app.plan, s = S().s, pts = p.legs.filter((l) => l.cum_m < s).map((l) => deg(l.lon, l.lat, 0.8)); pts.push(deg(R.crew.lon, R.crew.lat, 0.8)); return pts.length > 1 ? pts : [pts[0], pts[0]]; }) } }, on);
  add({ position: cb(() => { const d = dd(); return d ? deg(d.lon, d.lat, d.height_m / 2) : deg(SITE.lon, SITE.lat); }),
    cylinder: { length: cb(() => dd()?.height_m ?? 1), topRadius: cb(() => (dd()?.diameter_m ?? 1) * 1.4), bottomRadius: cb(() => (dd()?.diameter_m ?? 1) / 2), material: Cesium.Color.fromCssColorString('#d9b38c').withAlpha(0.5) },
    label: { ...lbl('DUST DEVIL', ORANGE, 0), font: `500 12px ${FONT}` } }, () => !!dd());
  add({ position: cb(() => { const d = dd(); return d ? deg(d.lon, d.lat, 0.5) : deg(SITE.lon, SITE.lat); }),
    ellipse: { semiMajorAxis: 120, semiMinorAxis: 120, height: 0.5, material: ORANGE.withAlpha(0.12), outline: true, outlineColor: ORANGE } }, () => !!dd());
  add({ position: cb(() => { const o = obs(); return o ? deg(o.lon, o.lat, 1) : deg(SITE.lon, SITE.lat); }),
    point: { pixelSize: 12, color: RED, outlineColor: Cesium.Color.WHITE, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY }, label: lbl('NEW OBSTACLE', RED, -18),
    ellipse: { semiMajorAxis: 8, semiMinorAxis: 8, height: 0.5, material: RED.withAlpha(0.25) } }, () => !!obs());
  add({ position: deg(SITE.lon, SITE.lat, 2), label: lbl('HABITAT', Cesium.Color.WHITE, 30) }, on);

  const snap = () => ({ crew: { ...S().frame.loc.crew }, drone: { ...S().frame.loc.drone }, heading: S().here.heading });
  const mix = (a, b, k) => ({ lat: a.lat + (b.lat - a.lat) * k, lon: a.lon + (b.lon - a.lon) * k });

  function build() {
    const M = (k, lab, prov, unit) => (m[k] = metric(lab, prov, unit)).el, p = app.plan;
    ui.wps = p.legs.map((l, i) => h('li', {}, h('span.dot'), h('span', {}, i === 0 ? 'Depart habitat' : i === p.legs.length - 1 ? 'Arrive delta front' : `${l.id} · science stop`, h('small', {}, l.name)), h('span.r', {}, '')));
    app.slots.left.replaceChildren(h('.panel.left', {},
      h('p.eyebrow', {}, 'Intra-mission · simulated real time'), h('h1', {}, 'Traverse monitor'),
      h('h2', {}, 'Time'), M('lmst', 'Local mean solar time', 'COMPUTED'), M('ltst', 'Local true solar time', 'COMPUTED'), M('utc', 'UTC / GMT (Earth)', 'COMPUTED'), M('sol', 'Season', 'COMPUTED'), M('met', 'Mission elapsed', 'SIMULATED'),
      h('p.note', {}, 'Mission clock is a replay epoch (Perseverance sol 84, May 2021) — not now.'),
      h('h2', {}, 'Route navigation'), M('dEl', 'Distance elapsed', 'COMPUTED'), M('dRem', 'Distance remaining', 'COMPUTED'), M('tRem', 'Time remaining (est.)', 'EMULATED'), M('spd', 'Ground speed', 'SIMULATED', 'm/s'), M('bat', 'Battery', 'EMULATED', '%'),
      h('h2', {}, 'Timeline & milestones'), h('ul.wplist', {}, ui.wps)));
    ui.log = h('.log'); ui.feed = h('pre.feed');
    app.slots.right.replaceChildren(h('.panel.right', {},
      h('h2', {}, 'Weather'), M('air', 'Air temperature', 'MODELLED', '°C'), M('gnd', 'Ground temperature', 'MODELLED', '°C'), M('prs', 'Pressure', 'MODELLED', 'Pa'), M('wind', 'Wind / gust', 'MODELLED', 'm/s'), M('tau', 'Dust opacity τ', 'MODELLED'),
      M('ef', 'Electric field', 'SIMULATED', 'V/m'), M('sep', 'Solar protons >10 MeV', 'SIMULATED', 'pfu'), M('dose', 'Dose rate', 'SIMULATED', 'µSv/h'),
      h('h2', {}, 'Terrain'), M('ter', 'Surface', 'MODELLED'), M('tq', 'Terrain quality', 'MODELLED'), M('slope', 'Slope', 'MODELLED', '°'),
      h('h2', {}, 'Localization'), M('lerr', 'Crew position error', 'SIMULATED', 'm'), M('derr', 'Drone position error', 'SIMULATED', 'm'), M('xt', 'Cross-track deviation', 'SIMULATED', 'm'),
      h('p.note', {}, `Gaussian model, ${(LOC_R95_M * 100).toFixed(0)} cm at 95 % (σ = 12.3 cm per axis), on the planned track.`),
      h('h2', {}, 'Life support (crew)'), M('o2', 'Suit ppO₂', 'SIMULATED', 'kPa'), M('co2', 'Suit ppCO₂', 'SIMULATED', 'kPa'), M('hr', 'Heart rate', 'SIMULATED', 'bpm'), M('core', 'Core temperature', 'SIMULATED', '°C'),
      h('h2', {}, 'Communications'), M('rssi', 'Crew ↔ habitat link', 'SIMULATED', 'dBm'), M('relay', 'Orbiter relay pass', 'SIMULATED'), M('earth', 'Habitat ↔ Earth (MCC)', 'SIMULATED'), M('owlt', 'One-way light time', 'MODELLED'),
      h('h2', {}, 'Scout drone'), M('lead', 'Lead distance', 'SIMULATED', 'm'), M('dalt', 'Altitude AGL', 'SIMULATED', 'm'), M('ddn', 'Dust devils in view', 'SIMULATED'), M('tun', 'Terrain updates', 'SIMULATED'),
      h('details', {}, h('summary', { style: 'color:var(--dim);cursor:pointer;margin:6px 0' }, 'Last drone message'), ui.feed),
      h('h2', {}, 'Decision log'), ui.log));
    ui.pill = h('.pill.d-PROCEED', {}, 'PROCEED'); ui.status = h('.status', {}, ''); ui.alert = h('div');
    ui.fpv = h('.fpv', { style: 'display:none' }, h('.cross'), h('.hdg', {}, ''));
    app.slots.center.replaceChildren(ui.fpv, h('.decision', {}, ui.pill, ui.status, ui.alert));
    ui.play = h('button', { onclick: () => setPlaying(!playing) }, 'Pause');
    ui.slider = h('input', { type: 'range', min: 0, max: Math.ceil((p.duration + 900) / sim.dt), value: 0, oninput: (e) => { sim.seek(+e.target.value); prev = cur = snap(); acc = 0; logLen = -1; } });
    ui.time = h('span.t', {}, '');
    ui.speeds = SPEEDS.map((v) => h(`button${v === speed ? '.on' : ''}`, { onclick: () => { speed = v; ui.speeds.forEach((b, i) => b.classList.toggle('on', SPEEDS[i] === v)); } }, `${v}×`));
    ui.views = [['bird', 'Bird’s-eye'], ['fpv', 'First-person']].map(([k, t]) => h(`button${k === view ? '.on' : ''}`, { onclick: () => setView(k) }, t));
    app.slots.bottom.replaceChildren(h('.panel.bottom', {},
      h('.controls', {}, ui.play, h('.seg', {}, ui.speeds), ui.slider, ui.time, h('.seg', {}, ui.views)),
      h('.injects', {}, h('span', { style: 'color:var(--dim);font-size:11px' }, 'Inject anomaly ', badge('SIMULATED')),
        Object.entries(INJECTIONS).map(([k, d]) => h(`button${k === 'dust_devil' ? '.dd' : ''}`, { title: `Expected decision: ${d.expect}`, onclick: () => inject(k) }, d.label)),
        h('span', { style: 'flex:1' }), h('button', { onclick: () => { sim.reset(); prev = cur = snap(); acc = 0; logLen = -1; setPlaying(true); } }, 'Restart'))));
  }
  function inject(k) {
    if (S().done) return toast('Mission ended — restart to inject');
    sim.inject(k); setPlaying(true); toast(`Injected: ${INJECTIONS[k].label}`);
  }
  function setPlaying(v) { playing = v; ui.play.textContent = v ? 'Pause' : 'Play'; }
  function setView(k) {
    view = k; ui.views.forEach((b, i) => b.classList.toggle('on', ['bird', 'fpv'][i] === k));
    ui.fpv.style.display = k === 'fpv' ? '' : 'none'; app.routeLayer.crew.show = k === 'bird';
    viewer.scene.backgroundColor = Cesium.Color.fromCssColorString(k === 'fpv' ? '#3a2a20' : '#05060a');
    if (k === 'bird') { app.routeLayer.crew.viewFrom = new Cesium.Cartesian3(-260, -620, 520); viewer.trackedEntity = app.routeLayer.crew; } else viewer.trackedEntity = undefined;
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dtR = Math.max(0, Math.min(0.1, (now - last) / 1000)); last = now;
    if (playing && !S().done) {
      acc += dtR * speed; let n = 0;
      while (acc >= sim.dt && n++ < 60 && !S().done) { prev = cur; sim.step(); cur = snap(); acc -= sim.dt; }
      if (n >= 60) acc = 0;
    }
    const k = S().done ? 1 : Math.min(1, acc / sim.dt);
    R.crew = mix(prev.crew, cur.crew, k); R.drone = mix(prev.drone, cur.drone, k); R.heading = cur.heading;
    app.crew.lat = R.crew.lat; app.crew.lon = R.crew.lon;
    if (view === 'fpv') viewer.camera.setView({ destination: deg(R.crew.lon, R.crew.lat, 2.2), orientation: { heading: Cesium.Math.toRadians(R.heading), pitch: Cesium.Math.toRadians(-7), roll: 0 } });
    render();
  }

  function render() {
    const s = S(), f = s.frame, p = app.plan, mt = marsTime(s.utcMs, SITE.lon, SITE.lat), H = RULES.hls;
    const cls = (bad, warn) => (bad ? 'bad' : warn ? 'warn' : '');
    m.lmst.set(hms(mt.lmst)); m.ltst.set(hms(mt.ltst)); m.utc.set(new Date(s.utcMs).toISOString().slice(0, 19).replace('T', ' ')); m.sol.set(`Ls ${mt.ls.toFixed(1)}° · MY ${mt.marsYear}`); m.met.set(fmtDur(s.t));
    m.dEl.set(fmtDist(s.s)); m.dRem.set(fmtDist(p.total_m - s.s));
    const nextLeg = p.legs[Math.min(s.wp + 1, p.legs.length - 1)], planRem = Math.max(0, p.duration - (p.legs[s.wp].depart_s + (nextLeg.seg ? ((s.s - p.legs[s.wp].cum_m) / nextLeg.seg.speed_ms) : 0)) + (s.stopLeft > 0 ? s.stopLeft - (p.legs[s.wp].stop_s || 0) : 0));
    m.tRem.set(s.done === 'COMPLETE' ? '0 min' : fmtDur(planRem)); m.spd.set(s.moving ? (nextLeg.seg.speed_ms * (s.decision === 'REROUTE' ? 0.6 : 1)).toFixed(2) : '0.00'); m.bat.set(s.battery_pct.toFixed(0), cls(s.battery_pct < 20, s.battery_pct < 30));
    ui.wps.forEach((li, i) => { const done = i < s.wp || (i === s.wp && (s.stopLeft <= 0 || i === 0)) || s.done === 'COMPLETE'; li.className = done ? 'done' : ''; if (i === s.wp + 1 && !s.done) li.className = 'cur';
      li.lastChild.textContent = done ? '✓' : `ETA ${hms(marsTime(app.startUtcMs + (s.t + Math.max(0, planRem - (p.duration - p.legs[i].arrive_s))) * 1000, SITE.lon).lmst, false)}`; });
    const e = f.env;
    m.air.set(e.air_temp_c.toFixed(1)); m.gnd.set(e.ground_temp_c.toFixed(1)); m.prs.set(e.pressure_pa.toFixed(0));
    m.wind.set(`${e.wind_ms.toFixed(1)} / ${e.wind_gust_ms.toFixed(1)}`, cls(e.wind_gust_ms >= RULES.weather.abortWindMs, e.wind_gust_ms >= RULES.weather.holdWindMs)); m.tau.set(e.tau.toFixed(2), cls(e.tau >= RULES.weather.abortTau, e.tau >= RULES.weather.holdTau));
    m.ef.set(Math.round(f.efield_vm).toLocaleString('en'), cls(false, f.efield_vm > 1000)); m.sep.set(f.rad.sep_flux_pfu.toFixed(1), cls(f.rad.sep_flux_pfu >= RULES.solar.abortPfu, f.rad.sep_flux_pfu >= RULES.solar.holdPfu)); m.dose.set(f.rad.dose_usv_h.toFixed(0));
    const wpT = p.legs[Math.min(s.here.seg + 1, p.legs.length - 1)];
    m.ter.set(wpT.terrain); m.tq.set(`${Math.round(wpT.quality * 100)} / 100`, cls(false, wpT.quality < 0.6)); m.slope.set(s.here.slopeDeg.toFixed(1));
    m.lerr.set(f.loc.crew_err_m.toFixed(2)); m.derr.set(f.loc.drone_err_m.toFixed(2)); m.xt.set(f.loc.cross_track_m.toFixed(2), cls(false, Math.abs(f.loc.cross_track_m) > RULES.locMismatch.crossTrackM));
    m.o2.set(f.hls.o2_kpa.toFixed(1), cls(f.hls.o2_kpa < H.o2_kpa.critLow, f.hls.o2_kpa < H.o2_kpa.warnLow)); m.co2.set(f.hls.co2_kpa.toFixed(2), cls(f.hls.co2_kpa > H.co2_kpa.critHigh, f.hls.co2_kpa > H.co2_kpa.warnHigh));
    m.hr.set(String(Math.round(f.hls.hr_bpm)), cls(f.hls.hr_bpm > H.hr_bpm.critHigh, f.hls.hr_bpm > H.hr_bpm.warnHigh)); m.core.set(f.hls.core_temp_c.toFixed(1));
    m.rssi.set(f.comms.local_rssi_dbm.toFixed(0), cls(false, f.comms.local_rssi_dbm < RULES.comms.minRssiDbm)); m.relay.set(f.comms.relay_pass ? 'In view' : 'No pass'); m.earth.set(f.comms.earth_dte ? 'Link up' : 'No link');
    m.owlt.set(`≈ ${Math.floor(f.comms.earth_owlt_s / 60)} min ${f.comms.earth_owlt_s % 60} s`);
    const d = f.drone; m.lead.set(d.pose.lead_distance_m.toFixed(0)); m.dalt.set(d.pose.alt_agl_m.toFixed(1)); m.ddn.set(String(d.dust_devils.length), cls(false, d.dust_devils.length)); m.tun.set(String(d.terrain_updates.length), cls(false, d.terrain_updates.length));
    if (ui.feed.parentElement.open) ui.feed.textContent = JSON.stringify(d, (key, v) => (typeof v === 'number' ? +v.toFixed(5) : v), 1);
    // decision + alerts
    ui.pill.textContent = s.decision; ui.pill.className = `pill d-${s.decision}`; ui.status.textContent = `${s.status} · ${view === 'bird' ? 'Screen 1 — bird’s-eye' : 'Screen 2 — first person'}`;
    const flags = Object.entries(s.active);
    if (flags.length) {
      const top = flags.some(([, a]) => a.action === 'ABORT') ? 'abort' : flags.some(([, a]) => a.action === 'HOLD') ? '' : 'reroute';
      ui.alert.className = `alert ${top}`;
      ui.alert.replaceChildren(h('b', {}, 'ANOMALY ALERT'), ...flags.map(([key, a]) => h('div', {}, `${FLAGS[key]} → ${a.action}`, h('small', { style: 'color:var(--dim)' }, ` · ${a.detail}${a.clearing ? ' · clearing' : ''}`))),
        h('.to', {}, h('span', {}, 'Crew notified'), h('span', {}, 'Habitat notified'), h('span.wait', {}, `Mission Control (Earth) in ≈ ${Math.round(f.comms.earth_owlt_s / 60)} min light time`)));
    } else { ui.alert.className = ''; ui.alert.replaceChildren(); }
    if (s.engine.log.length !== logLen) {
      logLen = s.engine.log.length;
      ui.log.replaceChildren(...(logLen ? [...s.engine.log].reverse().map((l) => h('div', {}, h('span.tt', {}, `T+${fmtDur(l.t)}`), h(`b.d-${l.to}`, {}, l.to), ` ← ${l.from}`, h('br'), h('small', { style: 'color:var(--dim)' }, l.flags.length ? l.flags.map((x) => `${FLAGS[x.flag]} (${x.detail})`).join('; ') : 'all flags clear')))
        : [h('div', { style: 'color:var(--dim)' }, 'No decision changes yet — PROCEED since departure.')]));
    }
    ui.slider.value = s.tick; ui.time.textContent = `T+${fmtDur(s.t)} · ${hms(mt.lmst, false)} LMST`;
    if (view === 'fpv') ui.fpv.lastChild.textContent = `HDG ${String(Math.round(R.heading)).padStart(3, '0')}° · ${fmtDist(p.total_m - s.s)} to go`;
    if (s.done && playing) setPlaying(false);
  }

  async function enter() {
    const stream = await app.data.stream;
    if (app.stage !== 'intra') return;
    sim = createSim({ plan: app.plan, stream, startUtcMs: app.startUtcMs });
    app.sim = sim; prev = cur = snap(); acc = 0; logLen = -1; active = true;
    app.routeLayer.show(true); app.crew.show = true; app.crew.lat = cur.crew.lat; app.crew.lon = cur.crew.lon;
    build(); setView('bird'); setPlaying(true); last = performance.now(); raf = requestAnimationFrame(frame);
  }
  function leave() { cancelAnimationFrame(raf); active = false; playing = false; viewer.trackedEntity = undefined; viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#05060a'); }
  return { enter, leave };
}
