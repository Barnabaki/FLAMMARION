// MODULE A — Area to Region. Mars → Mars Chart region → quadrant → named feature → Jezero site, one continuous scene.
import { Cesium, deg, gdeg, rectOf, wrap, dynamicShow } from './viewer.js';
import { h, icon, cite, row, fmtDist, fmtDur, fmtLat, fmtLon, latRange, lonRange, toast } from './ui/dom.js';
import { QUADRANGLES, quadrants, findQuadrangle, contains, centre, JEZERO } from './lib/quadrangles.js';
import { FEATURES } from './lib/features.js';
import { geodesic } from './lib/mars.js';
import { marsTime } from './lib/marsTime.js';
import { SOL_TABLE, weatherAt } from './lib/weather.js';
import { SITE } from './lib/mission.js';
import { DEM_INFO } from './lib/dem.js';
import { createRouteLayer } from './routeLayer.js';

const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, "Helvetica Neue", Helvetica, Arial, sans-serif';
const ROUTE_VIEW = { west: 77.416, east: 77.458, south: 18.442, north: 18.472 };
const POOL = 36, LABELLED = 8;
const feats = (q) => FEATURES[q.parent || q.id].filter((f) => contains(q, f[2], f[3])).map((f) => ({ name: f[0], type: f[1], lat: f[2], lon: f[3], rank: f[4], label: f[0] === 'Jezero' ? 'Jezero Crater' : f[0], target: f[0] === 'Jezero' }));
/** Highest-ranked features that are at least `minDeg` apart, so labels do not collide. */
function spread(list, n, minDeg) {
  const out = [];
  for (const f of list) { if (out.length >= n) break; if (out.every((o) => Math.hypot(o.lat - f.lat, (o.lon - f.lon) * Math.cos((f.lat * Math.PI) / 180)) >= minDeg)) out.push(f); }
  return out;
}

export function initA(app) {
  const { viewer } = app, WHITE = Cesium.Color.WHITE, ORANGE = Cesium.Color.fromCssColorString('#ff9f0a');
  const fade = { grid: 0, sel: 0, cross: 0 }, target = { ...fade };
  viewer.scene.preRender.addEventListener(() => { for (const k in fade) fade[k] += (target[k] - fade[k]) * 0.09; });
  const showIf = dynamicShow(viewer);
  const col = (k, a, base = WHITE) => new Cesium.CallbackProperty(() => base.withAlpha(Math.max(0, a * fade[k])), false);
  const vis = (k) => () => fade[k] > 0.02;
  const scratch = new Cesium.Cartesian3();
  const front = (pos) => { const cam = viewer.camera.positionWC, d = Cesium.Cartesian3.subtract(pos, cam, scratch); return Cesium.Cartesian3.dot(d, pos) < -0.12 * Cesium.Cartesian3.magnitude(d) * Cesium.Cartesian3.magnitude(pos) || Cesium.Cartesian3.magnitude(d) < 2.5e6; };
  const pts = (arr, hgt = 2500) => Cesium.Cartesian3.fromDegreesArrayHeights(arr.flatMap(([lon, lat]) => [wrap(lon), lat, hgt]));
  const mkLine = (k, a, w = 1) => showIf(viewer.entities.add({ polyline: { positions: pts([[0, 0], [1, 0]]), width: w, arcType: Cesium.ArcType.RHUMB, material: new Cesium.ColorMaterialProperty(col(k, a)) } }), vis(k));
  const mkLabel = (k, a, size, weight = 500) => { const e = viewer.entities.add({ position: deg(0, 0), label: { text: '', font: `${weight} ${size}px ${FONT}`, fillColor: col(k, a), outlineColor: col(k, 0.75, Cesium.Color.BLACK), outlineWidth: 3,
    style: Cesium.LabelStyle.FILL_AND_OUTLINE, horizontalOrigin: Cesium.HorizontalOrigin.CENTER, verticalOrigin: Cesium.VerticalOrigin.CENTER } }); return e; };
  const parallel = (lat, w, e) => { const p = []; for (let l = w; l <= e + 1e-9; l += 2.5) p.push([l, lat]); return p; };
  const ringOf = (q) => [...parallel(q.south, q.west, q.east), ...parallel(q.north, q.west, q.east).reverse(), [q.west, q.south]];

  // --- 30 Mars Chart regions: unique boundary lines + two-line labels
  for (const lat of [65, 30, 0, -30, -65]) mkLine('grid', 0.55).polyline.positions = pts(parallel(lat, -180, 180));
  for (const [s, n, step] of [[30, 65, 60], [0, 30, 45], [-30, 0, 45], [-65, -30, 60]]) for (let l = 0; l < 360; l += step) mkLine('grid', 0.55).polyline.positions = pts([[l, s], [l, n]]);
  for (const q of QUADRANGLES) { const c = centre(q), pos = deg(wrap(c.lon), c.lat, 4000), e = mkLabel('grid', 0.95, 12.5, 600);
    e.position = pos; e.label.text = `${q.id}\n${q.name}`; e.label.distanceDisplayCondition = new Cesium.DistanceDisplayCondition(2.5e6, 1e9); showIf(e, () => fade.grid > 0.02 && front(pos)); }
  // --- selection outline, quadrant cross + labels (re-positioned on selection)
  const outline = mkLine('sel', 0.95, 1.6), crossH = mkLine('cross', 0.7), crossV = mkLine('cross', 0.7);
  const qLabels = ['NW', 'NE', 'SW', 'SE'].map((k) => { const e = mkLabel('cross', 1, 17, 600); e.label.text = k; showIf(e, vis('cross')); return e; });
  // --- hover / selection fills (one rectangle each, moved on demand)
  const mkRect = (alpha) => viewer.entities.add({ show: false, rectangle: { coordinates: Cesium.Rectangle.fromDegrees(0, 0, 1, 1), height: 1500, material: WHITE.withAlpha(alpha) } });
  const hoverRect = mkRect(0.2);
  const setRect = (ent, q) => { if (ent._q === q) return; ent._q = q; ent.show = !!q; if (q) ent.rectangle.coordinates = rectOf(q); };
  // --- feature markers (pool) + hover ring
  const pool = Array.from({ length: POOL }, () => viewer.entities.add({ show: false, position: deg(0, 0),
    point: { pixelSize: 5, color: WHITE, outlineColor: Cesium.Color.BLACK.withAlpha(0.6), outlineWidth: 1, disableDepthTestDistance: Number.POSITIVE_INFINITY },
    label: { text: '', font: `500 12.5px ${FONT}`, fillColor: WHITE, outlineColor: Cesium.Color.BLACK.withAlpha(0.8), outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      horizontalOrigin: Cesium.HorizontalOrigin.LEFT, pixelOffset: new Cesium.Cartesian2(10, -1), disableDepthTestDistance: Number.POSITIVE_INFINITY } }));
  let shown = [];
  function showFeatures(list, labelled = LABELLED) {
    shown = list.slice(0, POOL);
    pool.forEach((e, i) => { const f = shown[i]; e.show = !!f; if (!f) return; e.position = deg(f.lon, f.lat, 3000); e.label.text = f.label; e.label.show = i < labelled;
      e.point.color = f.target ? ORANGE : WHITE; e.point.pixelSize = f.target ? 7 : 5; });
    setHot(null);
  }
  const ring = viewer.entities.add({ show: false, position: deg(0, 0), point: { pixelSize: 22, color: WHITE.withAlpha(0.08), outlineColor: WHITE, outlineWidth: 1.5, disableDepthTestDistance: Number.POSITIVE_INFINITY } });
  let hot = null, onHot = null;
  function setHot(f) {
    if (hot === f) return; const prev = shown.indexOf(hot); if (prev >= LABELLED && pool[prev]) pool[prev].label.show = false;
    hot = f; ring.show = !!f; if (f) { ring.position = deg(f.lon, f.lat, 3000); const i = shown.indexOf(f); if (pool[i]) pool[i].label.show = true; }
    onHot?.(f);
  }
  const nearest = (pos) => { let best = null, bd = 18; shown.forEach((f) => { const w = Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, deg(f.lon, f.lat, 3000)); if (!w) return; const d = Math.hypot(w.x - pos.x, w.y - pos.y); if (d < bd) { bd = d; best = f; } }); return best; };
  // --- guided ping on the mission target
  const phase = () => (performance.now() / 1700) % 1, pingPos = deg(JEZERO.lon, JEZERO.lat, 3200);
  let pingOn = false;
  showIf(viewer.entities.add({ position: pingPos, point: { pixelSize: new Cesium.CallbackProperty(() => 8 + 30 * phase(), false), color: ORANGE.withAlpha(0.02),
    outlineColor: new Cesium.CallbackProperty(() => ORANGE.withAlpha(0.9 * (1 - phase())), false), outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY } }), () => pingOn && front(pingPos));
  showIf(viewer.entities.add({ position: pingPos, point: { pixelSize: 6, color: ORANGE, disableDepthTestDistance: Number.POSITIVE_INFINITY } }), () => pingOn && front(pingPos));

  const route = (app.routeLayer = createRouteLayer(app));
  let selWp = null;
  const hasTarget = (q) => q && contains(q, JEZERO.lat, JEZERO.lon);
  const viewOf = (q, k = 1) => { const c = { lat: (q.south + q.north) / 2, lon: (q.west + q.east) / 2 }, dLon = q.east - q.west;
    return { destination: deg(wrap(c.lon - 0.09 * dLon), c.lat, 3.4e6 * k * Math.max(dLon / 45, (q.north - q.south) / 30)) }; };
  const VIEWS = {
    mars: () => ({ destination: deg(JEZERO.lon - 14, 12, 1.08e7) }), regions: () => null,
    region: () => viewOf(app.sel.quad), sector: () => viewOf(app.sel.sector, 0.86),
    site: () => ({ destination: deg((ROUTE_VIEW.west + ROUTE_VIEW.east) / 2 - 0.013, (ROUTE_VIEW.south + ROUTE_VIEW.north) / 2, 2900) }),
  };

  function enter(stage, prev) {
    const { quad, sector } = app.sel;
    Object.assign(target, { grid: stage === 'regions' ? 1 : 0, sel: stage === 'region' ? 1 : stage === 'sector' ? 0.5 : 0, cross: stage === 'region' ? 1 : 0 });
    setRect(hoverRect, null); route.show(stage === 'site'); app.crew.show = false; route.crew.show = false; viewer.canvas.style.cursor = '';
    pingOn = stage === 'regions' || (stage === 'region' && hasTarget(quad)) || (stage === 'sector' && hasTarget(sector));
    if (stage === 'region') {
      const mLat = (quad.south + quad.north) / 2, mLon = (quad.west + quad.east) / 2;
      outline.polyline.positions = pts(ringOf(quad)); crossH.polyline.positions = pts(parallel(mLat, quad.west, quad.east)); crossV.polyline.positions = pts([[mLon, quad.south], [mLon, quad.north]]);
      quadrants(quad).forEach((s, i) => { qLabels[i].position = deg(wrap((s.west + s.east) / 2), s.south + (s.north - s.south) * 0.62, 4000); });
      showFeatures(spread(feats(quad), 7, (quad.east - quad.west) / 9), 7);
    } else if (stage === 'sector') { outline.polyline.positions = pts(ringOf(sector)); showFeatures(feats(sector)); }
    else showFeatures([]);
    const v = VIEWS[stage]?.();
    if (v) app.flyTo({ ...v, duration: prev === 'select' ? 1.8 : stage === 'site' ? 3.2 : 2.4 });
    app.slots.mode.replaceChildren(stage === 'select' ? '' : app.modeToggle());

    app.handlers.move = (lat, lon, pos) => {
      let q = null, pointer = false;
      if (lat == null) { setRect(hoverRect, null); viewer.canvas.style.cursor = ''; hintEl?.classList.remove('hot'); if (stage === 'regions' || stage === 'region') preview(null); return; }
      if (stage === 'mars') { pointer = true; hintEl?.classList.add('hot'); }
      if (stage === 'regions') { q = findQuadrangle(lat, lon); preview(q); }
      if (stage === 'region' && contains(quad, lat, lon)) { q = quadrants(quad).find((s) => contains(s, lat, lon)); preview(q); } else if (stage === 'region') preview(null);
      if (stage === 'sector') { const f = nearest(pos); setHot(f); pointer = !!f; }
      setRect(hoverRect, q); viewer.canvas.style.cursor = q || pointer ? 'pointer' : '';
    };
    app.handlers.click = (lat, lon, pos) => {
      if (stage === 'mars') return app.setStage('regions');
      if (stage === 'regions') { const q = findQuadrangle(lat, lon); if (Math.abs(q.north) === 90 || Math.abs(q.south) === 90) return toast(`${q.id} ${q.name} — the polar charts have no quadrant view in this demo`); app.sel.quad = q; app.sel.sector = null; return app.setStage('region'); }
      if (stage === 'region') { const s = contains(quad, lat, lon) && quadrants(quad).find((x) => contains(x, lat, lon)); if (s) { app.sel.sector = s; app.setStage('sector'); } return; }
      if (stage === 'sector') { const f = nearest(pos); if (f) go(f); return; }
      if (stage === 'site') { const i = route.pickWaypoint(pos); if (i != null) { selWp = i; panel(stage); } }
    };
    panel(stage);
  }
  function go(f) {
    if (f.target) return app.setStage('site');
    app.flyTo({ destination: deg(f.lon, f.lat, 160000), duration: 2 }); toast(`${f.label} — no mission is defined here. The demo mission site is Jezero Crater.`);
  }

  // ---- panels ------------------------------------------------------------------------------------------------
  let hintEl = null, prevBox = null, prevKey;
  const card = (...c) => h('.panel.left.glass', {}, ...c);
  const back = (to) => h('button', { onclick: () => app.setStage(to) }, icon('back', 15), 'Back');
  const instr = (text) => h('.instr', {}, icon('mouse', 26), h('span', {}, text));
  const coords = (q) => [row('Latitude', latRange(q), 'mc', 'pin'), row('Longitude', lonRange(q), 'mc', 'pin')];
  const notable = (list) => list.length ? h('ul.dots', {}, list.map((f) => h('li', {}, cite(f.label, 'iau')))) : h('p', {}, 'No named features listed here.');
  /** Hover preview in the left panel — only re-rendered when the hovered region changes. */
  function preview(q) {
    if (!prevBox || prevKey === (q?.id ?? null)) return; prevKey = q?.id ?? null;
    if (!q) { prevBox.replaceChildren(); if (app.stage === 'regions') showFeatures([]); return; }
    const isQuad = !q.parent, all = feats(q), list = all.slice(0, 4);
    prevBox.replaceChildren(h('.fade-in', {}, h('h2', {}, isQuad ? `Region preview · ${q.id}` : 'Quadrant preview'), h('h1.sm', {}, isQuad ? q.name : q.id), coords(q), h('h2', {}, 'Notable features'), notable(list)));
    if (isQuad) showFeatures(spread(all, 4, (q.east - q.west) / 16), 4);
  }

  function panel(stage) {
    const L = app.slots.left, C = app.slots.center; L.replaceChildren(); C.replaceChildren(); hintEl = null; prevBox = null; prevKey = undefined; onHot = null;
    const { quad, sector } = app.sel;
    if (stage === 'select') {
      C.append(h('.scrim', {}, h('.select.glass', {}, h('p.eyebrow', {}, 'Missions'), h('h1', {}, 'Select a mission'), h('p', {}, 'Choose a mission to explore its site, plan the route and fly it.'),
        h('button.mission', { onclick: () => app.setStage('mars') }, h('span', {}, h('b', {}, 'Jezero Crater'), h('small', {}, 'MC-13 NE · Syrtis Major · crewed traverse with scout drone')), icon('chevR', 18)),
        h('button.add', { disabled: true, title: 'Custom missions are not part of this demo' }, icon('plus', 16), 'Add Mission'))));
    } else if (stage === 'mars') {
      L.append(card(h('p.eyebrow', {}, 'Planet view'), h('h1', {}, 'Mars'), h('p', {}, 'Explore Mars by official cartographic regions and create a mission route.'),
        h('h2', {}, 'Basic facts'), row('Diameter', '6,779 km', 'facts', 'ruler'), row('Gravity', '3.71 m/s²', 'facts', 'orbit'), row('Length of day (sol)', '24 h 39 min', 'facts', 'clock'),
        row('Avg. temperature', '−63 °C', 'facts', 'thermo'), row('Atmosphere', 'Mostly CO₂', 'facts', 'wind'), row('Polar caps', 'H₂O / CO₂ ice', 'facts', 'snow')));
      hintEl = h('.hint', {}, h('.halo', {}, icon('tap', 44)), h('b', {}, 'Click the planet'), h('span', {}, 'to explore cartographic regions')); C.append(hintEl);
    } else if (stage === 'regions') {
      prevBox = h('div');
      L.append(card(h('p.eyebrow', {}, 'Region view'), h('h1', {}, 'Select a region'), instr('Hover over an official Mars Chart region to preview its details. Click to explore.'), prevBox));
    } else if (stage === 'region') {
      prevBox = h('div');
      L.append(card(h('.toprow', {}, back('regions')), h('h1', {}, quad.name), instr('Hover over a quadrant to preview its details. Click to explore.'), prevBox));
    } else if (stage === 'sector') {
      const list = feats(sector), rows = new Map();
      const fl = h('.flist', {}, list.map((f) => { const r = h(`div${f.target ? '.target' : ''}`, { onmouseenter: () => setHot(f), onmouseleave: () => setHot(null), onclick: () => go(f) }, h('span', {}, f.label), h('span', {}, `${fmtLat(f.lat)} ${fmtLon(f.lon)}`)); rows.set(f, r); return r; }));
      onHot = (f) => { rows.forEach((r, k) => r.classList.toggle('hot', k === f)); if (f && !fl.matches(':hover')) rows.get(f)?.scrollIntoView({ block: 'nearest' }); };
      const state = h('span.cite', { 'data-src': 'mola', 'data-prov': 'SATELLITE' }, app.terrainMode ? 'On' : 'Off');
      L.append(card(h('.toprow', {}, back('region')), h('h1', {}, `${quad.name} ${sector.key}`), h('p.sub', {}, `${sector.id}  ·  1:2,000,000`), coords(sector),
        h('h2', {}, 'Named features · IAU'), list.length ? fl : h('p', {}, 'No named features listed in this quadrant.'),
        h('h2', {}, 'Topography'), h('.row', { style: 'cursor:pointer', onclick: (e) => { if (e.target === state) return; app.setTerrainMode(!app.terrainMode); state.textContent = app.terrainMode ? 'On' : 'Off'; } }, icon('layers', 18), h('span.lab', {}, 'MOLA elevation data'), state)));
    } else if (stage === 'site') sitePanel(L);
  }

  function sitePanel(L) {
    const p = app.plan, w = selWp != null ? p.legs[selWp] : null, T = SOL_TABLE;
    const mt = marsTime(app.startUtcMs, SITE.lon, SITE.lat), now = weatherAt(T, mt.ltst, mt.sunElevDeg), mm = (a) => [Math.min(...a), Math.max(...a)];
    const tile = (ic, label, value, unit, src, graphic, sub) => h('.tile', {}, h('.tl', {}, icon(ic, 14), label), h('.tv', {}, cite(h('span', {}, value, unit ? h('span.unit', {}, ' ' + unit) : ''), src)), h('.tg', { html: graphic }), h('.ts', {}, sub));
    const [g0, g1] = mm(T.ground_temp_c), [p0, p1] = mm(T.pressure_pa), [w0, w1] = mm(T.wind_ms);
    const gx = 4 + ((now.ground_temp_c - g0) / (g1 - g0)) * 112, pf = Math.max(0.04, Math.min(1, (now.pressure_pa - 700) / 100)), wk = now.wind_ms / 10, dn = Math.round((T.tau / 2) * 10);
    const gTemp = `<svg class="g" viewBox="0 0 120 16"><defs><linearGradient id="tg"><stop offset="0" stop-color="#64d2ff"/><stop offset=".55" stop-color="#ffd60a"/><stop offset="1" stop-color="#ff6b3d"/></linearGradient></defs><rect x="4" y="6" width="112" height="4" rx="2" fill="url(#tg)" opacity=".9"/><circle cx="${gx.toFixed(1)}" cy="8" r="5" fill="#fff" stroke="rgba(0,0,0,.35)"/></svg>`;
    const gPres = `<svg class="g" viewBox="0 0 120 40" fill="none" stroke-width="4" stroke-linecap="round"><path d="M22 36a38 38 0 0 1 76 0" stroke="rgba(255,255,255,.22)"/><path d="M22 36a38 38 0 0 1 76 0" stroke="#fff" stroke-dasharray="${(119.4 * pf).toFixed(1)} 200"/></svg>`;
    const gWind = `<svg class="g" viewBox="0 0 120 26" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round">${[0, 1, 2, 3].map((i) => `<path d="M6 ${4 + i * 6}h${(22 + 86 * wk * (1 - 0.16 * ((i * 3) % 4))).toFixed(0)}" opacity="${0.95 - i * 0.18}"/>`).join('')}</svg>`;
    const gDust = `<svg class="g" viewBox="0 0 120 14">${Array.from({ length: 10 }, (_, i) => `<rect x="${4 + i * 11.400}" y="3" width="8.400" height="8" rx="2.500" fill="${i < dn ? '#e8a25a' : 'rgba(255,255,255,.2)'}"/>`).join('')}</svg>`;
    L.append(h('.panel.left.glass.site', {}, h('.scroll', {},
      h('.toprow', {}, back('sector')), h('p.eyebrow', {}, 'Site inspection'), h('h1', {}, 'Jezero Crater'),
      h('p', {}, h('b', { style: 'color:#ffb35c;font-weight:600' }, 'Proposed route'), ' — a demonstration route, not a path travelled by a NASA rover.'),
      h('.stats', {}, h('div', {}, cite(fmtDist(p.total_m), 'geodesy'), h('small', {}, 'Distance')), h('div', {}, cite(fmtDur(p.duration).replace(' min', ' m'), 'vehicle'), h('small', {}, 'Duration')), h('div', {}, cite(`+${p.climb_m.toFixed(0)} m`, 'dem'), h('small', {}, 'Climb'))),
      h('h2', {}, `Conditions at departure · ${String(Math.floor(mt.ltst)).padStart(2, '0')}:${String(Math.floor((mt.ltst % 1) * 60)).padStart(2, '0')} local`),
      h('.bento', {},
        tile('thermo', 'Ground temp', now.ground_temp_c.toFixed(0), '°C', 'meda', gTemp, `Sol ${g0.toFixed(0)} … ${g1.toFixed(0)} °C`),
        tile('gauge', 'Pressure', now.pressure_pa.toFixed(0), 'Pa', 'meda', gPres, `Sol ${p0.toFixed(0)} … ${p1.toFixed(0)} Pa`),
        tile('wind', 'Wind speed', now.wind_ms.toFixed(1), 'm/s', 'meda', gWind, `Sol ${w0.toFixed(1)} … ${w1.toFixed(1)} m/s`),
        tile('dust', 'Dust opacity', T.tau.toFixed(2), 'τ', 'wxmodel', gDust, 'Modelled · clear season')),
      h('p.note', { style: 'margin-top:10px' }, `Perseverance measurements, sols ${T.sols[0]}–${T.sols.at(-1)} (April 2021) — archived, not current conditions.`),
      h('h2', {}, 'Waypoints'),
      h('ul.wplist', {}, p.legs.map((l, i) => h(`li${selWp === i ? '.sel' : ''}`, { onclick: () => { selWp = selWp === i ? null : i; panel('site'); if (selWp != null) app.flyTo({ destination: gdeg(l.lon, l.lat, 2000), duration: 1.2 }); } },
        h('span.dot'), h('span', {}, i === 0 ? 'Start' : i === p.legs.length - 1 ? 'Destination' : `Waypoint ${i}`, h('small', {}, l.name)), h('span.r', {}, fmtDist(l.cum_m))))),
      w && h('.wpinfo.fade-in', {}, h('p', {}, w.note), row('Position', `${fmtLat(w.lat, 4)} ${fmtLon(w.lon, 4)}`, 'route'), row('Elevation', `${w.elev.toFixed(1)} m`, 'dem'), row('Slope', `${p.slopeAtS(w.cum_m).toFixed(1)}°`, 'dem'),
        w.seg && row('Leg distance', fmtDist(w.seg.distance_m), 'geodesy'), w.terrain && row('Surface', w.terrain, 'terrainclass')),
      h('h2', {}, 'Elevation profile'), elevationProfile(p), row('Steepest slope', `${p.max_slope_deg.toFixed(1)}°`, 'dem'),
      h('p.note', {}, `${DEM_INFO.cell_m} m CTX terrain model, sampled every 10 m along the route.`)),
      h('.sticky', {}, h('button.cta', { onclick: () => app.setStage('pre') }, icon('route', 17), 'Plan this route'))));
  }
  return { enter };
}

function elevationProfile(p) {
  const W = 290, H = 78, pad = 4, es = p.profile.map((q) => q.elev), lo = Math.min(...es) - 2, hi = Math.max(...es) + 2;
  const x = (d) => pad + (d / p.total_m) * (W - 2 * pad), y = (e) => H - 14 - ((e - lo) / (hi - lo)) * (H - 28);
  const pts = p.profile.map((q) => `${x(q.s).toFixed(1)},${y(q.elev).toFixed(1)}`).join(' ');
  const svg = `<svg class="chart" viewBox="0 0 ${W} ${H}"><polyline points="${pad},${H - 14} ${pts} ${W - pad},${H - 14}" fill="rgba(255,179,92,.14)" stroke="none"/>
    <polyline points="${pts}" fill="none" stroke="#ffb35c" stroke-width="1.4"/>${p.legs.map((l) => `<circle cx="${x(l.cum_m)}" cy="${y(l.elev)}" r="2" fill="#fff"/>`).join('')}
    <text x="${pad}" y="9">${Math.max(...es).toFixed(0)} m</text><text x="${pad}" y="${H - 3}">${Math.min(...es).toFixed(0)} m</text><text x="${W - pad}" y="${H - 3}" text-anchor="end">${(p.total_m / 1000).toFixed(2)} km</text></svg>`;
  const d = document.createElement('div'); d.innerHTML = svg; return d.firstChild;
}
