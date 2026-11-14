// MODULE B — Pre-mission. Forecast time-lapse along the planned route → GO / NO-GO.
import { Cesium, deg } from './viewer.js';
import { h, badge, metric, fmtDist, fmtDur } from './ui/dom.js';
import { marsTime, hms } from './lib/marsTime.js';
import { weatherAt } from './lib/weather.js';
import { SITE, GO_CRITERIA, batterySoc } from './lib/mission.js';

const LAPSE_S = 24; // real seconds for one full time-lapse

export function initB(app) {
  const { viewer } = app;
  let raf = 0, playing = false, t = 0, last = 0, samples = [], m = {}, table, whatIf = false, ui = {};
  const provOf = (key) => (key === 'sun_elev_deg' ? 'COMPUTED' : key === 'battery_pct' ? 'EMULATED' : whatIf && key === 'tau' ? 'EMULATED' : table.provenance);

  function compute() {
    const p = app.plan, tb = whatIf ? { ...table, tau: 1.4 } : table;
    samples = [];
    for (let s = 0; s <= p.duration + 29; s += 30) {
      const tt = Math.min(s, p.duration), mt = marsTime(app.startUtcMs + tt * 1000, SITE.lon, SITE.lat), w = weatherAt(tb, mt.lmst, mt.sunElevDeg), nom = p.nominalAt(tt);
      samples.push({ t: tt, lmst: mt.lmst, ls: mt.ls, ...w, sun_elev_deg: mt.sunElevDeg, s: nom.s, wp: nom.wp, moving: nom.moving, battery_pct: batterySoc(tt, nom.s, w.air_temp_c) });
    }
    return GO_CRITERIA.map((c) => { const vs = samples.map((x) => x[c.key]), v = c.agg === 'min' ? Math.min(...vs) : Math.max(...vs); return { ...c, value: v, pass: c.test(v) }; });
  }
  const at = (time) => { const i = Math.max(0, Math.min(samples.length - 2, Math.floor(time / 30))), a = samples[i], b = samples[i + 1], k = b.t > a.t ? (time - a.t) / (b.t - a.t) : 0, o = {}; for (const key in a) o[key] = typeof a[key] === 'number' && key !== 'wp' ? a[key] + (b[key] - a[key]) * k : a[key]; return o; };

  function chart() { // whole-sol context (LMST 0–24 h) with the mission window shaded
    const W = 940, H = 92, x = (hr) => 30 + (hr / 24) * (W - 40), tb = whatIf ? { ...table, tau: 1.4 } : table;
    const hrs = []; for (let q = 0; q <= 96; q++) hrs.push(q / 4);
    const sol = hrs.map((hr) => ({ hr, ...weatherAt(tb, hr, 0) }));
    const l0 = samples[0].lmst, l1 = samples[samples.length - 1].lmst;
    const series = [['air_temp_c', '#f0a04a', 'Air temp', '°C'], ['wind_ms', '#9ec9f2', 'Wind', 'm/s'], ['vortex_per_h', '#e89a7a', 'Vortex rate', '/h']];
    let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" style="height:auto"><rect x="${x(l0)}" y="12" width="${x(l1) - x(l0)}" height="${H - 28}" fill="rgba(255,255,255,.08)"/>
      <text x="${(x(l0) + x(l1)) / 2}" y="${H - 20}" text-anchor="middle">mission window</text>`;
    for (let hr = 0; hr <= 24; hr += 3) svg += `<line x1="${x(hr)}" x2="${x(hr)}" y1="12" y2="${H - 16}" stroke="rgba(255,255,255,.08)"/><text x="${x(hr)}" y="${H - 4}" text-anchor="middle">${String(hr).padStart(2, '0')}:00</text>`;
    series.forEach(([k, c, name, unit], i) => {
      const vs = sol.map((s) => s[k]), lo = Math.min(...vs), hi = Math.max(...vs), y = (v) => H - 20 - ((v - lo) / (hi - lo || 1)) * (H - 36);
      svg += `<polyline fill="none" stroke="${c}" stroke-width="1.4" points="${sol.map((s) => `${x(s.hr).toFixed(1)},${y(s[k]).toFixed(1)}`).join(' ')}"/><text x="${34 + i * 190}" y="9" style="fill:${c}">${name} ${lo.toFixed(1)} … ${hi.toFixed(1)} ${unit} over the sol</text>`;
    });
    svg += `<text x="${W - 10}" y="9" text-anchor="end">LMST · ${table.provenance}</text><line id="ph" x1="0" x2="0" y1="12" y2="${H - 16}" stroke="#fff" stroke-width="1.2"/></svg>`;
    const d = h('div', { html: svg }); ui.ph = d.querySelector('#ph'); ui.phx = x; return d;
  }

  function build() {
    const crit = compute(), go = crit.every((c) => c.pass), fails = crit.filter((c) => !c.pass), p = app.plan;
    const M = (k, lab, prov, unit) => (m[k] = metric(lab, prov, unit)).el;
    app.slots.left.replaceChildren(h('.panel.left', {},
      h('button', { style: 'margin-bottom:12px', onclick: () => app.setStage('jezero') }, '← Route'),
      h('p.eyebrow', {}, 'Pre-mission · forecast time-lapse'), h('h1', {}, 'Planned traverse'),
      h('p', {}, `Jezero Crater · Ls ${samples[0].ls.toFixed(1)}°, MY ${table.marsYear} · departure 09:30 LMST. Forecast = seasonal climatology, not current conditions.`),
      h('h2', {}, 'Forecast at playhead'), M('lmst', 'Local mean solar time (LMST)', 'COMPUTED'),
      M('air', 'Air temperature (1.45 m)', provOf('air_temp_c'), '°C'), M('gnd', 'Ground temperature', provOf('ground_temp_c'), '°C'), M('prs', 'Pressure', provOf('pressure_pa'), 'Pa'),
      M('wind', 'Wind', provOf('wind_ms'), 'm/s'), M('tau', 'Dust optical depth τ', provOf('tau')), M('flux', 'Solar flux at surface', 'MODELLED', 'W/m²'),
      M('vor', 'Convective vortex rate', provOf('vortex_per_h'), '/h'), M('sun', 'Sun elevation', 'COMPUTED', '°'),
      h('h2', {}, 'Predicted mission stats'), M('dist', 'Distance travelled', 'COMPUTED'), M('time', 'Time elapsed', 'EMULATED'), M('bat', 'Battery', 'EMULATED', '%'), M('act', 'Activity', 'EMULATED'),
      h('p.note', { style: 'margin-top:8px' }, 'Weather source: Perseverance/MEDA (Jezero). Values here are a model fitted to published MEDA ranges; Curiosity/REMS (Gale, ~3,700 km away) is not loaded.')));
    app.slots.right.replaceChildren(h('.panel.right', {},
      h('p.eyebrow', {}, 'Crew feedback'), h(`.gonogo.${go ? 'go' : 'nogo'}`, {}, go ? 'GO' : 'NO-GO'),
      h('p', {}, go ? `All ${crit.length} criteria within limits for the whole ${fmtDur(p.duration)} window.` : `Driven by: ${fails.map((f) => f.label.toLowerCase()).join(', ')}.`),
      h('h2', {}, 'Criteria over the mission window'),
      crit.map((c) => h(`.crit${c.pass ? '' : '.fail'}`, {}, h('i'), h('span', {}, c.label, h('br'), h('small', {}, 'limit ' + c.rule)), h('span.v', {}, `${c.fmt(c.value)} ${c.unit} `, badge(provOf(c.key))))),
      h('h2', {}, 'What-if'), h('label', { style: 'display:flex;gap:8px;align-items:center;color:var(--dim);cursor:pointer' },
        h('input', { type: 'checkbox', ...(whatIf ? { checked: true } : {}), onchange: (e) => { whatIf = e.target.checked; build(); } }), 'Regional dust event, τ = 1.4 ', badge('EMULATED')),
      h('button.primary', { style: 'width:100%;margin-top:14px', ...(go && !whatIf ? {} : { disabled: true }), onclick: () => app.setStage('intra') }, 'Start Mission →'),
      !go || whatIf ? h('p.note', { style: 'margin-top:6px' }, whatIf ? 'What-if scenario active — clear it to start the mission.' : 'Mission start is blocked while the assessment is NO-GO.') : null));
    ui.play = h('button', { onclick: () => { if (t >= p.duration) t = 0; playing = !playing; ui.play.textContent = playing ? 'Pause' : 'Play'; } }, playing ? 'Pause' : 'Play');
    ui.slider = h('input', { type: 'range', min: 0, max: Math.round(p.duration), value: t, oninput: (e) => { t = +e.target.value; playing = false; ui.play.textContent = 'Play'; } });
    ui.time = h('span.t', {}, '');
    app.slots.bottom.replaceChildren(h('.panel.bottom', {}, chart(), h('.controls', {}, ui.play, ui.slider, ui.time)));
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const p = app.plan, dtR = Math.max(0, Math.min(0.1, (now - last) / 1000)); last = now;
    if (playing) { t += (dtR * p.duration) / LAPSE_S; if (t >= p.duration) { t = p.duration; playing = false; ui.play.textContent = 'Replay'; } ui.slider.value = t; }
    const s = at(t), pos = p.track.at(s.s);
    app.crew.lat = pos.lat; app.crew.lon = pos.lon;
    m.lmst.set(hms(s.lmst)); m.air.set(s.air_temp_c.toFixed(0)); m.gnd.set(s.ground_temp_c.toFixed(0)); m.prs.set(s.pressure_pa.toFixed(0));
    m.wind.set(`${s.wind_ms.toFixed(1)} from ${Math.round(s.wind_dir_deg)}°`); m.tau.set(s.tau.toFixed(2)); m.flux.set(s.solar_flux_wm2.toFixed(0)); m.vor.set(s.vortex_per_h.toFixed(2)); m.sun.set(s.sun_elev_deg.toFixed(0));
    m.dist.set(`${fmtDist(s.s)} / ${fmtDist(p.total_m)}`); m.time.set(`${fmtDur(t)} / ${fmtDur(p.duration)}`); m.bat.set(s.battery_pct.toFixed(0));
    m.act.set(t >= p.duration ? 'Arrived' : s.moving ? `Driving to ${p.legs[Math.min(s.wp + 1, p.legs.length - 1)].id}` : `Stop at ${p.legs[s.wp].id}`);
    ui.time.textContent = `T+${fmtDur(t)} · ${hms(s.lmst, false)} LMST`;
    const x = ui.phx(s.lmst); ui.ph.setAttribute('x1', x); ui.ph.setAttribute('x2', x);
  }

  async function enter() {
    table = await app.data.weather;
    if (app.stage !== 'pre') return;
    whatIf = false; t = 0; playing = true; app.routeLayer.show(true); app.crew.show = true; app.routeLayer.crew.show = true;
    const mid = app.plan.track.at(app.plan.total_m * 0.55);
    viewer.trackedEntity = undefined;
    viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(deg(mid.lon, mid.lat), 900), { duration: 2.4, offset: new Cesium.HeadingPitchRange(Cesium.Math.toRadians(-20), Cesium.Math.toRadians(-48), 5200) });
    build(); last = performance.now(); raf = requestAnimationFrame(frame);
  }
  function leave() { cancelAnimationFrame(raf); playing = false; }
  return { enter, leave };
}
