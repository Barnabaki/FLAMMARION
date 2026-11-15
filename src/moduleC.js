// MODULE C — Active mission. Simulated real-time replay of the stored telemetry stream with drone scouting,
// localization, decision engine, anomaly alerts, flown-path history and the post-mission report.
import { Cesium, gdeg, dynamicShow } from './viewer.js';
import { h, icon, cite, metric, row, fmtDist, fmtDur, toast } from './ui/dom.js';
import { marsTime, hms } from './lib/marsTime.js';
import { SITE, m2020Sol } from './lib/mission.js';
import { FLAGS, RULES } from './lib/decision.js';
import { createSim, INJECTIONS, missionReport } from './lib/sim.js';
import { LOC_R95_M, offset } from './lib/mars.js';

const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, "Helvetica Neue", Helvetica, Arial, sans-serif';
const SPEEDS = [1, 10, 60, 240], SEG = 10, HELIX = 3;
const lerp = (a, b, k) => a + (b - a) * k, lerpAng = (a, b, k) => a + ((((b - a) % 360) + 540) % 360 - 180) * k;

export function initC(app) {
  const { viewer } = app;
  let sim = null, raf = 0, last = 0, playing = false, speed = 60, acc = 0, view = 'bird', m = {}, ui = {}, prev = null, cur = null, active = false, logLen = -1, alertKey = '', docks = [], dockTimer = 0;
  const R = { crew: { lat: SITE.lat, lon: SITE.lon }, drone: { lat: SITE.lat, lon: SITE.lon }, heading: 0, dHeading: 0, alt: 12, dd: null }; // interpolated render state
  const S = () => sim.state;
  const CYAN = Cesium.Color.fromCssColorString('#64d2ff'), ORANGE = Cesium.Color.fromCssColorString('#ff9f0a'), RED = Cesium.Color.fromCssColorString('#ff453a'), TAN = Cesium.Color.fromCssColorString('#d9b38c');
  const on = () => active, bird = () => active && view === 'bird';
  const cb = (f) => new Cesium.CallbackProperty(f, false);
  const lbl = (text, color = Cesium.Color.WHITE, dy = 18) => ({ text, font: `600 10.5px ${FONT}`, pixelOffset: new Cesium.Cartesian2(0, dy), fillColor: color, outlineColor: Cesium.Color.BLACK, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, disableDepthTestDistance: Number.POSITIVE_INFINITY });
  const ringPts = (lat, lon, radius, hgt = 2) => { const pts = []; for (let a = 0; a <= 360; a += 10) { const q = offset(lat, lon, radius * Math.sin((a * Math.PI) / 180), radius * Math.cos((a * Math.PI) / 180)); pts.push(gdeg(q.lon, q.lat, hgt)); } return pts; };
  const HOME = [gdeg(SITE.lon, SITE.lat), gdeg(SITE.lon, SITE.lat, 1)];
  // --- scene entities (created once, shown only while the module is active)
  const showIf = dynamicShow(viewer), add = (def, fn) => showIf(viewer.entities.add(def), fn);
  add({ position: cb(() => gdeg(R.drone.lon, R.drone.lat, Math.max(0.6, R.alt))), point: { pixelSize: 9, color: CYAN, outlineColor: Cesium.Color.BLACK, outlineWidth: 1.5, disableDepthTestDistance: Number.POSITIVE_INFINITY },
    label: { ...lbl('DRONE', CYAN, -16), text: cb(() => (active && S().droneState === 'LANDED' ? 'DRONE · landed' : 'DRONE')) } }, bird);
  add({ polyline: { positions: cb(() => ringPts(R.drone.lat, R.drone.lon, 60)), width: 1.5, material: CYAN.withAlpha(0.7) } }, () => bird() && R.alt > 1); // scan footprint
  add({ polyline: { positions: cb(() => [gdeg(R.crew.lon, R.crew.lat, 1.5), gdeg(R.drone.lon, R.drone.lat, Math.max(0.6, R.alt))]), width: 1.5, material: new Cesium.PolylineDashMaterialProperty({ color: CYAN.withAlpha(0.8), dashLength: 10 }) } }, bird);
  add({ polyline: { positions: cb(() => [gdeg(SITE.lon, SITE.lat, 3), gdeg(R.crew.lon, R.crew.lat, 1.5)]), width: 1,
    material: new Cesium.PolylineDashMaterialProperty({ color: cb(() => (active && S().frame.comms.local_rssi_dbm < RULES.comms.minRssiDbm ? RED : Cesium.Color.WHITE.withAlpha(0.4))), dashLength: 8 }) } }, on);
  // flown / driven history — actual positions including detours
  const trail = (key, hgt) => { let n = -1, pts = HOME; return cb(() => { if (!active) return HOME; const t = S()[key]; if (t.length !== n) { n = t.length; pts = t.map(([la, lo]) => gdeg(lo, la, hgt)); if (pts.length < 2) pts = [pts[0] || HOME[0], pts[0] || HOME[0]]; } return pts; }); };
  add({ polyline: { positions: trail('trail', 1), width: 3.5, material: Cesium.Color.WHITE } }, on);
  add({ polyline: { positions: trail('droneTrail', 1.2), width: 1.5, material: CYAN.withAlpha(0.55) } }, on);
  // drone-detected obstacles stay on the map until the mission is restarted
  for (let i = 0; i < 6; i++) { const o = () => (active && S().obstacles[i]) || null;
    add({ position: cb(() => { const x = o(); return x ? gdeg(x.lon, x.lat, 1.5) : HOME[0]; }), point: { pixelSize: 12, color: RED, outlineColor: Cesium.Color.WHITE, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY }, label: lbl('OBSTACLE · found by drone', RED, -19) }, () => !!o());
    add({ polyline: { positions: cb(() => { const x = o(); return x ? ringPts(x.lat, x.lon, 8, 1.2) : HOME; }), width: 1.5, material: RED.withAlpha(0.8) } }, () => !!o()); }
  // dust devil: wandering ground track + smooth procedural vortex (tapered translucent column, rotating helical bands)
  for (let i = 0; i < 3; i++) { const d = () => (active && S().dustDevils[i]) || null;
    add({ polyline: { positions: cb(() => { const x = d(); return x && x.path.length > 1 ? x.path.map(([la, lo]) => gdeg(lo, la, 1.5)) : HOME; }), width: 1.5, material: new Cesium.PolylineDashMaterialProperty({ color: ORANGE.withAlpha(0.75), dashLength: 9 }) } }, () => !!d() && d().path.length > 1); }
  const dd = () => (active ? R.dd : null), tau = () => performance.now() / 1000;
  const rad = (d, z) => (d.dia / 2) * (0.28 + 1.05 * Math.pow(z / d.h, 1.25));
  const axis = (d, z, hgt = z) => { const A = 0.085 * d.h * Math.pow(z / d.h, 1.6), t = tau(), q = offset(d.lat, d.lon, A * Math.sin(0.8 * t + (3.1 * z) / d.h), A * Math.cos(0.63 * t + (2.3 * z) / d.h)); return { q, pos: gdeg(q.lon, q.lat, hgt) }; };
  for (let i = 0; i < SEG; i++) add({ position: cb(() => { const d = dd(); return d ? axis(d, ((i + 0.5) * d.h) / SEG).pos : HOME[0]; }),
    cylinder: { length: cb(() => (dd()?.h ?? SEG) / SEG), bottomRadius: cb(() => { const d = dd(); return d ? rad(d, (i * d.h) / SEG) : 1; }), topRadius: cb(() => { const d = dd(); return d ? rad(d, ((i + 1) * d.h) / SEG) : 1; }), slices: 28,
      material: new Cesium.ColorMaterialProperty(cb(() => TAN.withAlpha((0.4 - 0.026 * i) * (dd()?.k ?? 0)))) } }, () => !!dd());
  for (let k = 0; k < HELIX; k++) add({ polyline: { width: 1.6, material: new Cesium.ColorMaterialProperty(cb(() => Cesium.Color.fromCssColorString('#f3dcc0').withAlpha(0.55 * (dd()?.k ?? 0)))),
    positions: cb(() => { const d = dd(); if (!d) return HOME; const pts = [], t = tau(); for (let j = 0; j <= 40; j++) { const z = (j / 40) * d.h, a = (5 * Math.PI * z) / d.h - 2.6 * t + (2 * Math.PI * k) / HELIX, c = axis(d, z).q, r = rad(d, z) * 1.03, q = offset(c.lat, c.lon, r * Math.sin(a), r * Math.cos(a)); pts.push(gdeg(q.lon, q.lat, z)); } return pts; }) } }, () => !!dd());
  add({ polyline: { positions: cb(() => { const d = dd(); return d ? ringPts(d.lat, d.lon, 120) : HOME; }), width: 2, material: ORANGE } }, () => !!dd()); // hazard radius
  add({ position: cb(() => { const d = dd(); return d ? gdeg(d.lon, d.lat, d.h * 0.55) : HOME[0]; }), label: { ...lbl('DUST DEVIL', ORANGE, 0), font: `600 12px ${FONT}` } }, () => !!dd());
  add({ position: gdeg(SITE.lon, SITE.lat, 2), label: lbl('HABITAT', Cesium.Color.WHITE, 30) }, bird);

  const snap = () => { const f = S().frame, d = f.drone.dust_devils[0];
    return { crew: { ...f.loc.crew }, drone: { ...f.loc.drone }, heading: S().here.heading, dHeading: f.drone.pose.heading_deg, alt: f.drone.pose.alt_agl_m, dd: d ? { lat: d.lat, lon: d.lon, dia: d.diameter_m, h: d.height_m, k: d.tangential_speed_ms / 14 } : null }; };
  const mixLL = (a, b, k) => ({ lat: lerp(a.lat, b.lat, k), lon: lerp(a.lon, b.lon, k) });
  const resync = () => { prev = cur = snap(); acc = 0; logLen = -1; alertKey = ''; };

  // ---- HUD ---------------------------------------------------------------------------------------------------
  const M = (k, lab, src, unit, ic) => (m[k] = metric(lab, src, unit, ic)).el;
  const set = (k, text, cls) => m[k]?.set(text, cls);
  function sidePanels() {
    m = {}; docks = []; clearTimeout(dockTimer); const p = app.plan;
    if (view === 'fpv') { // curated flight parameters in auto-retracting edge docks
      const dock = (side, ...content) => { const d = h(`.dock.${side}`, {}, h('.panel.glass', {}, ...content), h('button.strap.glass', { title: 'Show / hide panel', onclick: () => { d.classList.toggle('closed'); arm(); } }, icon(side === 'left' ? 'chevL' : 'chevR', 16))); docks.push(d); return d; };
      app.slots.left.replaceChildren(dock('left', h('p.eyebrow', {}, 'Drone camera'), M('alt', 'Altitude AGL', 'drone', 'm', 'altitude'), M('gs', 'Ground speed', 'drone', 'm/s', 'speed'), M('hdg', 'Heading / pitch', 'drone', '', 'compass'),
        M('bat', 'Battery', 'vehicle', '%', 'battery'), M('wpd', 'Next waypoint', 'geodesy', '', 'flag')));
      app.slots.right.replaceChildren(dock('right', h('p.eyebrow', {}, 'Status'), M('dec', 'Decision', 'rules', '', 'check'), M('met', 'Elapsed', 'telemetry', '', 'clock'), M('haz', 'Hazards in view', 'drone', '', 'alert')));
      arm(2600);
    } else {
      ui.wps = p.legs.map((l, i) => h('li', {}, h('span.dot'), h('span', {}, i === 0 ? 'Depart habitat' : i === p.legs.length - 1 ? 'Arrive at delta front' : `Waypoint ${i}`, h('small', {}, i === 0 || i === p.legs.length - 1 ? l.name : 'Measurements · drone lands')), h('span.r', {}, '')));
      app.slots.left.replaceChildren(h('.panel.left.glass', {},
        h('p.eyebrow', {}, 'Active mission'), h('h1', {}, 'Traverse'),
        M('lmst', 'Local time', 'mars24', '', 'clock'), M('utc', 'Earth UTC', 'mars24', '', 'sun'), M('met', 'Elapsed', 'telemetry', '', 'play'),
        h('p.note', {}, cite('Replay of Perseverance sol 47', 'meda'), ' — the clock is a past date so archived weather is never shown as live.'),
        h('h2', {}, 'Navigation'), M('dEl', 'Distance covered', 'geodesy', '', 'route'), M('dRem', 'Remaining', 'geodesy', '', 'flag'), M('tRem', 'Time remaining', 'vehicle', '', 'clock'), M('spd', 'Ground speed', 'telemetry', 'm/s', 'speed'), M('bat', 'Battery', 'vehicle', '%', 'battery'),
        h('h2', {}, 'Waypoints'), h('ul.wplist', {}, ui.wps)));
      ui.log = h('.log'); ui.feed = h('pre.feed');
      app.slots.right.replaceChildren(h('.panel.right.glass', {},
        h('h2.plain', {}, 'Weather'), M('air', 'Air temperature', 'meda', '°C', 'thermo'), M('gnd', 'Ground temperature', 'meda', '°C', 'thermo'), M('prs', 'Pressure', 'meda', 'Pa', 'gauge'), M('wind', 'Wind speed', 'meda', 'm/s', 'wind'),
        M('gust', 'Gust', 'telemetry', 'm/s', 'wind'), M('tau', 'Dust opacity', 'wxmodel', 'τ', 'dust'), M('ef', 'Electric field', 'telemetry', 'V/m', 'bolt'), M('sep', 'Solar protons', 'telemetry', 'pfu', 'sun'),
        h('h2', {}, 'Terrain'), M('elev', 'Elevation', 'dem', 'm', 'mountain'), M('slope', 'Slope', 'dem', '°', 'altitude'), M('ter', 'Surface', 'terrainclass', '', 'layers'), M('tq', 'Terrain quality', 'terrainclass', '', 'gauge'),
        h('h2', {}, 'Crew'), M('o2', 'Suit O₂', 'telemetry', 'kPa', 'heart'), M('co2', 'Suit CO₂', 'telemetry', 'kPa', 'heart'), M('hr', 'Heart rate', 'telemetry', 'bpm', 'heart'), M('core', 'Core temperature', 'telemetry', '°C', 'thermo'),
        h('h2', {}, 'Links & position'), M('rssi', 'Crew ↔ habitat', 'telemetry', 'dBm', 'signal'), M('earth', 'Earth light time', 'telemetry', '', 'signal'), M('lerr', 'Position error', 'telemetry', 'm', 'target'), M('xt', 'Off-track', 'telemetry', 'm', 'target'),
        h('h2', {}, 'Scout drone'), M('dstate', 'State', 'drone', '', 'drone'), M('lead', 'Ahead of crew', 'drone', 'm', 'route'), M('alt', 'Altitude AGL', 'drone', 'm', 'altitude'), M('haz', 'Hazards in view', 'drone', '', 'alert'),
        h('details', {}, h('summary', {}, 'Last drone message'), ui.feed),
        h('h2', {}, 'Decision log'), ui.log));
    }
    logLen = -1;
  }
  /** FPV docks retract to their edge straps after `ms` of idle. */
  function arm(ms = 8000) { clearTimeout(dockTimer); dockTimer = setTimeout(() => docks.forEach((d) => d.classList.add('closed')), ms); }

  function build() {
    const p = app.plan;
    ui.pill = h('.pill.glass.d-PROCEED', {}, 'PROCEED'); ui.status = h('.status', {}, ''); ui.alert = h('div'); ui.report = h('div');
    ui.fpv = h('.fpv', { style: 'display:none' }, h('.cross'));
    app.slots.center.replaceChildren(ui.fpv, h('.decision', {}, ui.pill, ui.status, ui.alert), ui.report);
    ui.views = [['bird', 'Bird’s-eye', 'eye'], ['fpv', 'First-person', 'drone']].map(([k, t, i]) => h(`button${k === view ? '.on' : ''}`, { onclick: () => setView(k) }, icon(i, 16), t));
    app.slots.mode.replaceChildren(h('.mode.seg.glass', {}, ui.views));
    ui.play = h('button.round', { title: 'Play / pause', onclick: () => setPlaying(!playing) });
    ui.slider = h('input', { type: 'range', min: 0, max: Math.ceil((p.duration + 900) / sim.dt), value: 0, oninput: (e) => { sim.seek(+e.target.value); resync(); } });
    ui.time = h('span.t', {}, '');
    ui.speeds = SPEEDS.map((v) => h(`button${v === speed ? '.on' : ''}`, { onclick: () => { speed = v; ui.speeds.forEach((b, i) => b.classList.toggle('on', SPEEDS[i] === v)); } }, `${v}×`));
    app.slots.bottom.replaceChildren(h('.simtools.glass', {},
      h('.hd', {}, h('b', {}, 'SIMULATION TOOLS'), h('span', {}, 'These controls simulate mission conditions to show how the flight software would respond during a real mission.')),
      h('.controls', {}, ui.play, h('.seg.glass', {}, ui.speeds), ui.slider, ui.time),
      h('.injects', {}, Object.entries(INJECTIONS).map(([k, d]) => h(`button${k === 'dust_devil' ? '.dd' : ''}`, { title: `Expected response: ${d.expect}`, onclick: () => inject(k) }, d.label)),
        h('span', { style: 'flex:1' }), h('button', { onclick: restart }, icon('restart', 15), 'Restart'))));
    sidePanels();
  }
  function restart() { sim.reset(); resync(); setPlaying(true); }
  function inject(k) {
    if (S().done) return toast('Mission ended — restart to simulate more conditions');
    sim.inject(k); setPlaying(true); toast(`Simulating: ${INJECTIONS[k].label.toLowerCase()}`);
  }
  function setPlaying(v) { playing = v; ui.play.replaceChildren(icon(v ? 'pause' : 'play', 17)); }
  function setView(k) {
    view = k; ui.views.forEach((b, i) => b.classList.toggle('on', ['bird', 'fpv'][i] === k));
    ui.fpv.style.display = k === 'fpv' ? '' : 'none'; app.routeLayer.crew.show = k === 'bird';
    viewer.scene.backgroundColor = Cesium.Color.fromCssColorString(k === 'fpv' ? '#3a2a20' : '#050508'); if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = k !== 'fpv';
    if (k === 'bird') { app.routeLayer.crew.viewFrom = new Cesium.Cartesian3(-260, -620, 520); viewer.trackedEntity = app.routeLayer.crew; } else viewer.trackedEntity = undefined;
    sidePanels();
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
    R.crew = mixLL(prev.crew, cur.crew, k); R.drone = mixLL(prev.drone, cur.drone, k); R.heading = lerpAng(prev.heading, cur.heading, k); R.dHeading = lerpAng(prev.dHeading, cur.dHeading, k); R.alt = lerp(prev.alt, cur.alt, k);
    R.dd = cur.dd ? (prev.dd ? { lat: lerp(prev.dd.lat, cur.dd.lat, k), lon: lerp(prev.dd.lon, cur.dd.lon, k), dia: lerp(prev.dd.dia, cur.dd.dia, k), h: lerp(prev.dd.h, cur.dd.h, k), k: lerp(prev.dd.k, cur.dd.k, k) } : cur.dd) : null;
    app.crew.lat = R.crew.lat; app.crew.lon = R.crew.lon;
    if (view === 'fpv') viewer.camera.setView({ destination: gdeg(R.drone.lon, R.drone.lat, Math.max(1.4, R.alt + 0.3)), orientation: { heading: Cesium.Math.toRadians(R.dHeading), pitch: Cesium.Math.toRadians(R.alt > 2 ? -14 : -4), roll: 0 } });
    render();
  }

  function render() {
    const s = S(), f = s.frame, p = app.plan, mt = marsTime(s.utcMs, SITE.lon, SITE.lat), H = RULES.hls, e = f.env, d = f.drone;
    const st = (bad, warn) => (bad ? 'bad' : warn ? 'warn' : 'ok');
    const nextLeg = p.legs[Math.min(s.wp + 1, p.legs.length - 1)];
    const planRem = Math.max(0, p.duration - (p.legs[s.wp].depart_s + (nextLeg.seg ? (s.s - p.legs[s.wp].cum_m) / nextLeg.seg.speed_ms : 0)) + (s.stopLeft > 0 ? s.stopLeft - (p.legs[s.wp].stop_s || 0) : 0));
    const hazards = d.dust_devils.length + d.terrain_updates.length;
    set('lmst', `${hms(mt.lmst)} LMST`); set('utc', new Date(s.utcMs).toISOString().slice(11, 19)); set('met', fmtDur(s.t));
    set('dEl', fmtDist(s.s)); set('dRem', fmtDist(p.total_m - s.s)); set('tRem', s.done === 'COMPLETE' ? '0 min' : fmtDur(planRem)); set('spd', s.speed_ms.toFixed(2));
    set('bat', s.battery_pct.toFixed(0), st(s.battery_pct < 20, s.battery_pct < 30));
    if (ui.wps && view === 'bird') ui.wps.forEach((li, i) => { const done = i < s.wp || (i === s.wp && (s.stopLeft <= 0 || i === 0)) || s.done === 'COMPLETE'; const c = done ? 'done' : i === s.wp + 1 && !s.done ? 'cur' : i === s.wp && s.stopLeft > 0 ? 'cur' : ''; if (li.className !== c) li.className = c;
      const tx = done ? '✓' : i === s.wp ? 'now' : hms(marsTime(app.startUtcMs + (s.t + Math.max(0, planRem - (p.duration - p.legs[i].arrive_s))) * 1000, SITE.lon).lmst, false); if (li.lastChild.textContent !== tx) li.lastChild.textContent = tx; });
    set('air', e.air_temp_c.toFixed(1), st(false, e.air_temp_c < -70)); set('gnd', e.ground_temp_c.toFixed(1)); set('prs', e.pressure_pa.toFixed(0)); set('wind', e.wind_ms.toFixed(1), st(e.wind_ms > 20, e.wind_ms > 15));
    set('gust', e.wind_gust_ms.toFixed(1), st(e.wind_gust_ms >= RULES.weather.abortWindMs, e.wind_gust_ms >= RULES.weather.holdWindMs)); set('tau', e.tau.toFixed(2), st(e.tau >= RULES.weather.abortTau, e.tau >= RULES.weather.holdTau));
    set('ef', Math.round(f.efield_vm).toLocaleString('en'), st(f.efield_vm > 5000, f.efield_vm > 1000)); set('sep', f.rad.sep_flux_pfu.toFixed(1), st(f.rad.sep_flux_pfu >= RULES.solar.abortPfu, f.rad.sep_flux_pfu >= RULES.solar.holdPfu));
    const wpT = p.legs[Math.min(s.here.seg + 1, p.legs.length - 1)];
    set('elev', s.elev_m.toFixed(1)); set('slope', s.slope_deg.toFixed(1), st(Math.abs(s.slope_deg) > 20, Math.abs(s.slope_deg) > 12)); set('ter', wpT.terrain); set('tq', `${Math.round(wpT.quality * 100)} / 100`, st(wpT.quality < 0.4, wpT.quality < 0.6));
    set('o2', f.hls.o2_kpa.toFixed(1), st(f.hls.o2_kpa < H.o2_kpa.critLow, f.hls.o2_kpa < H.o2_kpa.warnLow)); set('co2', f.hls.co2_kpa.toFixed(2), st(f.hls.co2_kpa > H.co2_kpa.critHigh, f.hls.co2_kpa > H.co2_kpa.warnHigh));
    set('hr', String(Math.round(f.hls.hr_bpm)), st(f.hls.hr_bpm > H.hr_bpm.critHigh, f.hls.hr_bpm > H.hr_bpm.warnHigh)); const c = f.hls.core_temp_c, C = H.core_temp_c; set('core', c.toFixed(1), st(c > C.critHigh || c < C.critLow, c > C.warnHigh || c < C.warnLow));
    set('rssi', f.comms.local_rssi_dbm.toFixed(0), st(f.comms.local_rssi_dbm < RULES.comms.minRssiDbm - 8, f.comms.local_rssi_dbm < RULES.comms.minRssiDbm)); set('earth', `${Math.floor(f.comms.earth_owlt_s / 60)} min ${f.comms.earth_owlt_s % 60} s`);
    set('lerr', f.loc.crew_err_m.toFixed(2), st(f.loc.crew_err_m > 1, f.loc.crew_err_m > LOC_R95_M * 1.5)); set('xt', f.loc.cross_track_m.toFixed(2), st(Math.abs(f.loc.cross_track_m) > 4, Math.abs(f.loc.cross_track_m) > RULES.locMismatch.crossTrackM));
    set('dstate', { FLYING: 'Flying', LANDING: 'Landing', LANDED: 'Landed · low power', TAKEOFF: 'Taking off' }[s.droneState]); set('lead', d.pose.lead_distance_m.toFixed(0));
    set('alt', R.alt.toFixed(1)); set('haz', hazards ? `${hazards}` : 'None', st(false, hazards > 0));
    set('gs', d.pose.ground_speed_ms.toFixed(2)); set('hdg', `${String(Math.round((R.dHeading + 360) % 360)).padStart(3, '0')}° / ${R.alt > 2 ? '−14' : '−4'}°`); set('wpd', s.done === 'COMPLETE' ? 'Arrived' : fmtDist(nextLeg.cum_m - s.s));
    set('dec', s.decision, s.decision === 'PROCEED' ? 'ok' : s.decision === 'ABORT' ? 'bad' : 'warn');
    if (ui.feed?.parentElement?.open) ui.feed.textContent = JSON.stringify(d, (key, v) => (typeof v === 'number' ? +v.toFixed(5) : v), 1);
    // decision + alerts
    if (ui.pill.textContent !== s.decision) { ui.pill.textContent = s.decision; ui.pill.className = `pill glass d-${s.decision}`; }
    const status = `${s.status}${s.droneState === 'LANDED' && !s.done ? ' · drone landed, low power' : s.droneState === 'TAKEOFF' ? ' · drone taking off' : ''}`; if (ui.status.textContent !== status) ui.status.textContent = status;
    const flags = Object.entries(s.active), obs = d.terrain_updates[0], key = flags.map(([k2, a]) => k2 + a.action + a.detail + a.clearing).join('|') + (obs ? `o${Math.round(obs.along_track_ahead_m / 5)}` : '');
    if (key !== alertKey) { alertKey = key;
      const delivered = () => h('.to', {}, h('span', {}, icon('check'), 'Crew notified'), h('span', {}, icon('check'), 'Habitat notified'), h('span', {}, `Mission Control on Earth in ≈ ${Math.round(f.comms.earth_owlt_s / 60)} min (light time)`));
      const discovery = obs && h('div', {}, h('b', { style: 'margin-top:2px' }, icon('drone', 14), 'AUTONOMOUS DRONE DISCOVERY'),
        `Unmapped ${obs.type.replace('_', ' ')}, ${obs.size_m.toFixed(1)} m across, ${Math.max(0, Math.round(obs.along_track_ahead_m))} m ahead. `,
        h('small', {}, 'Too small for orbital imaging and absent from the satellite basemap — the drone’s on-board sensors found it early and the path is re-planned around it.'));
      if (flags.length) {
        const top = flags.some(([, a]) => a.action === 'ABORT') ? '.abort' : flags.some(([, a]) => a.action === 'HOLD') ? '' : '.reroute';
        ui.alert.replaceChildren(h(`.alert.glass${top}`, {}, h('b', {}, icon('alert', 14), 'ANOMALY ALERT'), flags.map(([k2, a]) => k2 === 'terrain' && discovery ? h('div', {}, `${FLAGS[k2]} → ${a.action}`) : h('div', {}, `${FLAGS[k2]} → ${a.action}`, h('small', {}, ` · ${a.detail}${a.clearing ? ' · clearing' : ''}`))), discovery, delivered()));
      } else if (discovery) ui.alert.replaceChildren(h('.alert.glass.info', {}, discovery));
      else ui.alert.replaceChildren();
    }
    if (ui.log && s.engine.log.length !== logLen) {
      logLen = s.engine.log.length;
      ui.log.replaceChildren(...(logLen ? [...s.engine.log].reverse().map((l) => h('div', {}, h('span.tt', {}, `T+${fmtDur(l.t)}`), h(`b.d-${l.to}`, {}, l.to), ` from ${l.from}`, h('br'), h('small', {}, l.flags.length ? l.flags.map((x) => `${FLAGS[x.flag]} (${x.detail})`).join('; ') : 'All flags clear')))
        : [h('div', { style: 'color:var(--dim)' }, 'No changes — PROCEED since departure.')]));
    }
    ui.slider.value = s.tick; ui.time.textContent = `T+${fmtDur(s.t)}  ·  ${hms(mt.lmst, false)} LMST`;
    if (!!s.done !== !!ui.report.firstChild) ui.report.replaceChildren(s.done ? h('button.reportbtn.glass', { onclick: showReport }, icon('doc', 19), 'Show the Report') : '');
    if (s.done && playing) setPlaying(false);
  }

  function showReport() {
    const s = S(), p = app.plan, r = missionReport(s, p), close = () => veil.remove(), T = (x) => `T+${fmtDur(x)}`;
    const ok = r.outcome === 'COMPLETE', env = (k, d, u) => `${r.env[k].min.toFixed(d)} … ${r.env[k].max.toFixed(d)} ${u} · mean ${r.env[k].mean.toFixed(d)}`;
    const holds = r.decisions.filter((l) => l.to === 'HOLD').length, reroutes = r.decisions.filter((l) => l.to === 'REROUTE').length;
    const veil = h('.veil', { onclick: (e) => e.target === veil && close() }, h('.modal', {}, h('.report.glass', {},
      h('.toprow', { style: 'justify-content:space-between' }, h('p.eyebrow', { style: 'margin:0' }, 'Mission summary report'), h('button', { onclick: close, title: 'Close' }, icon('x', 16))),
      h('h1', {}, 'Jezero Crater traverse'), h('p.sub', {}, `MC-13 NE · Syrtis Major · habitat to western delta front · replay of Perseverance sol ${m2020Sol(app.startUtcMs)} · all mission telemetry simulated`),
      h('.big', {}, h('div', {}, h(`b.${ok ? 'ok' : 'bad'}`, {}, ok ? 'Complete' : r.outcome === 'ABORTED' ? 'Aborted' : 'Ended'), h('small', {}, 'Outcome')), h('div', {}, h('b', {}, fmtDur(r.duration_s)), h('small', {}, `Duration · planned ${fmtDur(r.planned_duration_s)}`)),
        h('div', {}, h('b', {}, fmtDist(r.drone_m)), h('small', {}, `Flown by drone · planned ${fmtDist(r.planned_m)}`)), h('div', {}, h('b', {}, `${r.battery_used_pct.toFixed(0)} %`), h('small', {}, 'Battery used'))),
      h('.grid', {},
        h('.card', {}, h('h2', {}, 'Distance & time'), row('Planned route', fmtDist(r.planned_m), 'geodesy'), row('Flown by drone', fmtDist(r.drone_m), 'drone'), row('Driven by crew', `${fmtDist(r.crew_m)} (+${Math.max(0, r.crew_m - r.progress_m).toFixed(0)} m detours)`, 'telemetry'),
          row('Moving', fmtDur(r.moving_s), 'telemetry'), row('Waypoint measurements', fmtDur(r.stop_s), 'vehicle'), row('Drone landed, resting', fmtDur(r.landed_s), 'drone'), row('Held for hazards', fmtDur(r.hold_s), 'telemetry')),
        h('.card', {}, h('h2', {}, 'Flight & battery'), row('Battery', `${r.battery_start_pct.toFixed(0)} % → ${r.battery_end_pct.toFixed(0)} %`, 'vehicle'), row('Consumption', `${r.battery_per_km_pct.toFixed(1)} % per km`, 'vehicle'), row('Drone airborne', fmtDur(Math.max(0, r.duration_s - r.landed_s)), 'drone'),
          row('Decision changes', String(r.decisions.length), 'rules'), row('Holds / re-routes', `${holds} / ${reroutes}`, 'rules'), row('Final decision', s.decision, 'rules')),
        h('.card.wide', {}, h('h2', {}, 'Autonomous obstacle detections & re-routing'), r.obstacles.length ? r.obstacles.map((o) => h('.ev', {}, h('b', {}, `${T(o.t_detected)} — ${o.type.replace('_', ' ')}, ${o.size_m} m across`), ` found by the drone ${Math.round(o.detected_ahead_m)} m ahead of the crew. `,
          'It was too small for orbital imaging and missing from the satellite basemap. ', o.rerouted ? 'The path was re-planned with a 14 m detour and the flown track keeps that detour.' : 'Not yet reached when the mission ended.'))
          : h('p', {}, 'No unmapped obstacles were encountered.')),
        h('.card.wide', {}, h('h2', {}, 'Dust devil encounters'), r.dust_devils.length ? r.dust_devils.map((d) => h('.ev', {}, h('b', {}, `${T(d.t0)} — vortex ${d.id}`), ` tracked for ${fmtDur(d.duration_s)}, closest approach ${Math.round(d.min_range_m)} m, peak tangential wind ${d.peak_tangential_ms.toFixed(0)} m/s. Crew and habitat were alerted and the traverse held until it cleared.`))
          : h('p', {}, 'No dust devils were detected.')),
        h('.card.wide', {}, h('h2', {}, 'Environment along the traverse'), row('Air temperature', env('air_temp_c', 0, '°C'), 'meda', 'thermo'), row('Ground temperature', env('ground_temp_c', 0, '°C'), 'meda', 'thermo'), row('Pressure', env('pressure_pa', 0, 'Pa'), 'meda', 'gauge'),
          row('Wind speed', env('wind_ms', 1, 'm/s'), 'meda', 'wind'), row('Peak gust', `${r.max_gust_ms.toFixed(1)} m/s`, 'telemetry', 'wind'), row('Dust opacity', env('tau', 2, 'τ'), 'wxmodel', 'dust'), row('Peak electric field', `${Math.round(r.max_efield_vm).toLocaleString('en')} V/m`, 'telemetry', 'bolt'))),
      h('.toprow', { style: 'justify-content:flex-end;margin:18px 0 0' }, h('button', { onclick: () => { close(); restart(); } }, icon('restart', 15), 'Restart mission'), h('button', { onclick: close }, 'Close')))));
    app.ui.append(veil);
  }

  async function enter() {
    const stream = await app.data.stream;
    if (app.stage !== 'intra') return;
    sim = createSim({ plan: app.plan, stream, startUtcMs: app.startUtcMs });
    app.sim = sim; active = true; view = 'bird'; resync();
    app.routeLayer.show(true); app.crew.show = true; app.crew.lat = cur.crew.lat; app.crew.lon = cur.crew.lon;
    build(); setView('bird'); setPlaying(true); last = performance.now(); raf = requestAnimationFrame(frame);
  }
  function leave() { cancelAnimationFrame(raf); clearTimeout(dockTimer); active = false; playing = false; viewer.trackedEntity = undefined; viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#050508'); if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = true; }
  return { enter, leave };
}
