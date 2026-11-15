// MODULE B — Route planned. Forecast time-lapse along the planned route → GO / NO-GO → Start Mission.
import { Cesium, gdeg } from './viewer.js';
import { h, icon, cite, metric, fmtDist, fmtDur } from './ui/dom.js';
import { marsTime, hms } from './lib/marsTime.js';
import { weatherAt, remsAt, REMS_TABLE } from './lib/weather.js';
import { SITE, GO_CRITERIA, batterySoc } from './lib/mission.js';

const LAPSE_S = 24; // real seconds for one full time-lapse
const SRC = { HISTORIC: 'meda', MODELLED: 'wxmodel' };

export function initB(app) {
  const { viewer } = app;
  let raf = 0, playing = false, t = 0, last = 0, samples = [], m = {}, table, whatIf = false, ui = {};
  const srcOf = (key) => (key === 'sun_elev_deg' ? 'mars24' : key === 'battery_pct' ? 'vehicle' : SRC[table.provenance[key]] || 'wxmodel');

  function compute() {
    const p = app.plan, tb = whatIf ? { ...table, tau: 1.4 } : table;
    samples = [];
    for (let s = 0; s <= p.duration + 29; s += 30) {
      const tt = Math.min(s, p.duration), mt = marsTime(app.startUtcMs + tt * 1000, SITE.lon, SITE.lat), w = weatherAt(tb, mt.ltst, mt.sunElevDeg), nom = p.nominalAt(tt);
      samples.push({ t: tt, lmst: mt.lmst, ltst: mt.ltst, ls: mt.ls, ...w, sun_elev_deg: mt.sunElevDeg, s: nom.s, wp: nom.wp, moving: nom.moving, battery_pct: batterySoc(tt, nom.s, w.air_temp_c) });
    }
    return GO_CRITERIA.map((c) => { const vs = samples.map((x) => x[c.key]), v = c.agg === 'min' ? Math.min(...vs) : Math.max(...vs); return { ...c, value: v, pass: c.test(v) }; });
  }
  const at = (time) => { const i = Math.max(0, Math.min(samples.length - 2, Math.floor(time / 30))), a = samples[i], b = samples[i + 1], k = b.t > a.t ? (time - a.t) / (b.t - a.t) : 0, o = {}; for (const key in a) o[key] = typeof a[key] === 'number' && key !== 'wp' ? a[key] + (b[key] - a[key]) * k : a[key]; return o; };

  function chart() { // whole-sol context (local true solar time 0–24 h) with the mission window shaded
    const W = 900, H = 104, x = (hr) => 8 + (hr / 24) * (W - 16), tb = whatIf ? { ...table, tau: 1.4 } : table;
    const sol = Array.from({ length: 97 }, (_, q) => ({ hr: q / 4, ...weatherAt(tb, q / 4, 0) })), l0 = samples[0].ltst, l1 = samples[samples.length - 1].ltst;
    const series = [['air_temp_c', '#ffb35c', 'Air temp', '°C'], ['ground_temp_c', '#ff6b3d', 'Ground temp', '°C'], ['wind_ms', '#64d2ff', 'Wind', 'm/s']];
    let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}"><rect x="${x(l0)}" y="20" width="${x(l1) - x(l0)}" height="${H - 42}" rx="6" fill="rgba(255,255,255,.12)"/>`;
    for (let hr = 0; hr <= 24; hr += 3) svg += `<text x="${x(hr)}" y="${H - 4}" text-anchor="${hr === 0 ? 'start' : hr === 24 ? 'end' : 'middle'}">${String(hr).padStart(2, '0')}:00</text>`;
    series.forEach(([k, c, name, unit], i) => {
      const vs = sol.map((s) => s[k]), lo = Math.min(...vs), hi = Math.max(...vs), y = (v) => H - 26 - ((v - lo) / (hi - lo || 1)) * (H - 52);
      svg += `<polyline fill="none" stroke="${c}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" points="${sol.map((s) => `${x(s.hr).toFixed(1)},${y(s[k]).toFixed(1)}`).join(' ')}"/><circle cx="${12 + i * 215}" cy="6" r="4" fill="${c}"/><text x="${22 + i * 215}" y="10.500">${name}  ${lo.toFixed(0)} … ${hi.toFixed(0)} ${unit}</text>`;
    });
    svg += `<text x="${W - 8}" y="10.500" text-anchor="end">shaded = mission window</text><line id="ph" x1="0" x2="0" y1="18" y2="${H - 20}" stroke="#fff" stroke-width="1.500"/></svg>`;
    const d = h('div', { html: svg, style: 'filter: drop-shadow(0 1px 3px rgba(0,0,0,.8))' }); ui.ph = d.querySelector('#ph'); ui.phx = x; return d;
  }

  function build() {
    const crit = compute(), go = crit.every((c) => c.pass), fails = crit.filter((c) => !c.pass), p = app.plan;
    const M = (k, lab, src, unit, ic) => (m[k] = metric(lab, src, unit, ic)).el;
    app.slots.left.replaceChildren(h('.panel.left.glass', {},
      h('.toprow', {}, h('button', { onclick: () => app.setStage('site') }, icon('back', 15), 'Back')),
      h('p.eyebrow', {}, 'Route planned'), h('h1', {}, 'Forecast'),
      h('p', {}, `Departure 09:30 local, Ls ${samples[0].ls.toFixed(0)}°. Weather is replayed from Perseverance measurements of sols ${table.sols[0]}–${table.sols.at(-1)}.`),
      h('h2', {}, 'At the playhead'), M('lmst', 'Local time', 'mars24', '', 'clock'),
      M('air', 'Air temperature', srcOf('air_temp_c'), '°C', 'thermo'), M('gnd', 'Ground temperature', srcOf('ground_temp_c'), '°C', 'thermo'), M('prs', 'Pressure', srcOf('pressure_pa'), 'Pa', 'gauge'),
      M('wind', 'Wind speed', srcOf('wind_ms'), 'm/s', 'wind'), M('tau', 'Dust opacity', whatIf ? 'vehicle' : srcOf('tau'), '𝜏', 'dust'), M('sun', 'Sun elevation', 'mars24', '°', 'sun'),
      h('h2', {}, 'Predicted mission'), M('dist', 'Distance', 'geodesy', '', 'route'), M('time', 'Elapsed', 'vehicle', '', 'clock'), M('bat', 'Battery', 'vehicle', '%', 'battery'), M('act', 'Activity', 'vehicle', '', 'flag'),
      h('details', {}, h('summary', {}, 'Compare with Curiosity at Gale crater'), M('rT', 'Air temperature', 'rems', '°C'), M('rP', 'Pressure', 'rems', 'Pa'), M('rW', 'Wind speed', 'rems', 'm/s'),
        h('p.note', {}, `A different site ~3,760 km away, MSL sols ${REMS_TABLE.sols[0]}–${REMS_TABLE.sols.at(-1)}. Not used in the assessment.`))));
    app.slots.right.replaceChildren(h('.panel.right.glass', { style: 'top:74px;max-height:calc(100% - 150px)' },
      h('p.eyebrow', {}, 'Crew feedback'), h(`.gonogo.${go ? 'go' : 'nogo'}`, {}, go ? 'GO' : 'NO-GO'),
      h('p', {}, go ? `All ${crit.length} conditions hold for the whole ${fmtDur(p.duration)} traverse.` : `Blocked by ${fails.map((f) => f.label.toLowerCase()).join(' and ')}.`),
      h('div', { style: 'margin:14px 0 6px' }, crit.map((c) => h(`.crit${c.pass ? '' : '.fail'}`, {}, h('i'), h('span', {}, c.label, h('small', {}, c.rule)), cite(`${c.fmt(c.value)} ${c.unit}`, whatIf && c.key === 'tau' ? 'vehicle' : srcOf(c.key), c.pass ? 'ok' : 'bad')))),
      h('label.switch', {}, h('input', { type: 'checkbox', ...(whatIf ? { checked: true } : {}), onchange: (e) => { whatIf = e.target.checked; build(); } }), 'What if a regional dust event raises 𝜏 to 1.4?'),
      h('button.cta.green', { ...(go && !whatIf ? {} : { disabled: true }), onclick: () => app.setStage('intra') }, icon('play', 16), 'Start Mission'),
      !go || whatIf ? h('p.note', { style: 'margin-top:10px' }, whatIf ? 'What-if scenario active — clear it to start the mission.' : 'Mission start is blocked while the assessment is NO-GO.') : null));
    ui.play = h('button.round', { title: 'Play / pause', onclick: () => { if (t >= p.duration) t = 0; setPlay(!playing); } });
    ui.slider = h('input', { type: 'range', min: 0, max: Math.round(p.duration), value: t, oninput: (e) => { t = +e.target.value; setPlay(false); } });
    ui.time = h('span.t', {}, '');
    app.slots.bottom.replaceChildren(h('.timeline', {}, chart(), h('.controls', {}, ui.play, ui.slider, ui.time)));
    setPlay(playing);
  }
  function setPlay(v) { playing = v; ui.play.replaceChildren(icon(v ? 'pause' : 'play', 17)); }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const p = app.plan, dtR = Math.max(0, Math.min(0.1, (now - last) / 1000)); last = now;
    if (playing) { t += (dtR * p.duration) / LAPSE_S; if (t >= p.duration) { t = p.duration; setPlay(false); } ui.slider.value = t; }
    const s = at(t), pos = p.track.at(s.s);
    app.crew.lat = pos.lat; app.crew.lon = pos.lon;
    m.lmst.set(`${hms(s.lmst, false)} LMST`); m.air.set(s.air_temp_c.toFixed(0)); m.gnd.set(s.ground_temp_c.toFixed(0)); m.prs.set(s.pressure_pa.toFixed(0));
    m.wind.set(s.wind_ms.toFixed(1)); m.tau.set(s.tau.toFixed(2)); m.sun.set(s.sun_elev_deg.toFixed(0));
    m.dist.set(`${fmtDist(s.s)} of ${fmtDist(p.total_m)}`); m.time.set(fmtDur(t)); m.bat.set(s.battery_pct.toFixed(0));
    m.act.set(t >= p.duration ? 'Arrived' : s.moving ? `Driving to waypoint ${Math.min(s.wp + 1, p.legs.length - 1)}` : `Measurements at waypoint ${s.wp}`);
    const r = remsAt(s.ltst); m.rT.set(r.air_temp_c.toFixed(0)); m.rP.set(r.pressure_pa.toFixed(0)); m.rW.set(r.wind_ms == null ? 'no data' : r.wind_ms.toFixed(1));
    ui.time.textContent = `T+${fmtDur(t)}  ·  ${hms(s.lmst, false)} LMST`;
    const x = ui.phx(s.ltst); ui.ph.setAttribute('x1', x); ui.ph.setAttribute('x2', x);
  }

  async function enter() {
    table = await app.data.weather;
    if (app.stage !== 'pre') return;
    whatIf = false; t = 0; playing = true; app.routeLayer.show(true); app.crew.show = true; app.routeLayer.crew.show = true;
    const mid = app.plan.track.at(app.plan.total_m * 0.55);
    viewer.trackedEntity = undefined;
    viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(gdeg(mid.lon, mid.lat), 900), { duration: 2.4, offset: new Cesium.HeadingPitchRange(Cesium.Math.toRadians(-20), Cesium.Math.toRadians(-48), 5200) });
    build(); last = performance.now(); raf = requestAnimationFrame(frame);
  }
  function leave() { cancelAnimationFrame(raf); playing = false; }
  return { enter, leave };
}
