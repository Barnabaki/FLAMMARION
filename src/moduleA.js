// MODULE A — Area to Region. Mars → MC-13 → MC-13 NE → Jezero crater, one continuous scene.
import { Cesium, deg, gdeg, rectOf, wrap, dynamicShow } from './viewer.js';
import { DEM_INFO } from './lib/dem.js';
import { h, badge, metric, fmtDist, fmtDur, fmtLat, fmtLon, toast } from './ui/dom.js';
import { QUADRANGLES, quadrants, findQuadrangle, contains, centre, FEATURES_MC13_NE, JEZERO } from './lib/quadrangles.js';
import { geodesic, offset } from './lib/mars.js';
import { createRouteLayer } from './routeLayer.js';
import { SOL_TABLE } from './lib/weather.js';

const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const MC13 = QUADRANGLES.find((q) => q.id === 'MC-13');
const SECTORS = quadrants(MC13);
const NE = SECTORS.find((s) => s.key === 'NE');
const ROUTE_VIEW = { west: 77.416, east: 77.458, south: 18.442, north: 18.472 };

export function initA(app) {
  const { viewer } = app;
  const WHITE = Cesium.Color.WHITE;
  // fade groups: 0..1 alpha, animated toward targets every frame
  const fade = { quads: 0, mc13: 0, sectors: 0, features: 0, marker: 1 }, target = { ...fade };
  viewer.scene.preRender.addEventListener(() => { for (const k in fade) fade[k] += (target[k] - fade[k]) * 0.08; });
  const col = (k, a, base = WHITE) => new Cesium.CallbackProperty(() => base.withAlpha(Math.max(0, a * fade[k])), false);
  const showIf = dynamicShow(viewer);
  const vis = (k) => () => fade[k] > 0.02;
  // labels: additionally hidden when beyond the horizon (labels are not occluded by the globe near the limb)
  const scratch = new Cesium.Cartesian3();
  const visAt = (k, pos) => () => {
    if (fade[k] <= 0.02) return false;
    const cam = viewer.camera.positionWC, d = Cesium.Cartesian3.subtract(pos, cam, scratch);
    return Cesium.Cartesian3.dot(d, pos) < -0.12 * Cesium.Cartesian3.magnitude(d) * Cesium.Cartesian3.magnitude(pos) || Cesium.Cartesian3.magnitude(d) < 2.5e6;
  };
  const line = (pts, k, a, w = 1) => showIf(viewer.entities.add({ polyline: { positions: Cesium.Cartesian3.fromDegreesArrayHeights(pts.flatMap(([lon, lat]) => [wrap(lon), lat, 2500])), width: w, arcType: Cesium.ArcType.RHUMB,
    material: new Cesium.ColorMaterialProperty(col(k, a)) } }), vis(k));
  const label = (text, lon, lat, k, a, size = 11, extra = {}) => showIf(viewer.entities.add({ position: deg(wrap(lon), lat, 4000),
    label: { text, font: `${size}px ${FONT}`, fillColor: col(k, a), outlineColor: col(k, 0.7, Cesium.Color.BLACK), outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      horizontalOrigin: Cesium.HorizontalOrigin.CENTER, verticalOrigin: Cesium.VerticalOrigin.CENTER, ...extra } }), visAt(k, deg(wrap(lon), lat, 4000)));
  const parallel = (lat, w, e) => { const p = []; for (let l = w; l <= e + 1e-9; l += 5) p.push([l, lat]); return p; };

  // --- 30 Mars Chart quadrangles: unique boundary lines (parallels + meridian segments), labels
  for (const lat of [65, 30, 0, -30, -65]) line(parallel(lat, -180, 180), 'quads', 0.5);
  for (const [s, n, step] of [[30, 65, 60], [0, 30, 45], [-30, 0, 45], [-65, -30, 60]]) for (let l = 0; l < 360; l += step) line([[l, s], [l, n]], 'quads', 0.5);
  for (const q of QUADRANGLES) { const c = centre(q); label(`${q.id}\n${q.name}`, c.lon, c.lat, 'quads', q.id === 'MC-13' ? 1 : 0.75, q.id === 'MC-13' ? 13 : 10, { distanceDisplayCondition: new Cesium.DistanceDisplayCondition(2.5e6, 1e9) }); }
  // --- MC-13 highlight + 1:2M quadrants
  line([...parallel(0, 45, 90), ...parallel(30, 45, 90).reverse(), [45, 0]], 'mc13', 0.95, 1.6);
  line(parallel(15, 45, 90), 'sectors', 0.6); line([[67.5, 0], [67.5, 30]], 'sectors', 0.6);
  for (const s of SECTORS) label(`${s.key}`, (s.west + s.east) / 2, (s.south + s.north) / 2, 'sectors', 0.9, 13, { distanceDisplayCondition: new Cesium.DistanceDisplayCondition(8e5, 1e9) });
  // --- IAU features in MC-13 NE
  for (const f of FEATURES_MC13_NE) showIf(viewer.entities.add({ position: deg(f.lon, f.lat, 3000),
    point: { pixelSize: f === JEZERO ? 0 : 4, color: col('features', 0.9) },
    label: { text: f === JEZERO ? 'Jezero Crater' : f.name, font: `${f === JEZERO ? 14 : 11}px ${FONT}`, fillColor: col('features', f === JEZERO ? 1 : 0.8), outlineColor: col('features', 0.8, Cesium.Color.BLACK), outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, f === JEZERO ? -4 : -14), distanceDisplayCondition: new Cesium.DistanceDisplayCondition(1.2e5, 1e9) } }), vis('features'));
  const ring = []; for (let a = 0; a <= 360; a += 6) { const p = offset(JEZERO.lat, JEZERO.lon, (JEZERO.diameterKm * 500) * Math.sin(a * Math.PI / 180), (JEZERO.diameterKm * 500) * Math.cos(a * Math.PI / 180)); ring.push([p.lon, p.lat]); }
  showIf(viewer.entities.add({ polyline: { positions: Cesium.Cartesian3.fromDegreesArrayHeights(ring.flatMap(([lo, la]) => [lo, la, 2500])), width: 1.5, material: new Cesium.ColorMaterialProperty(col('features', 0.9, Cesium.Color.fromCssColorString('#f0a04a'))) } }), vis('features'));
  // --- demo mission marker on the globe
  showIf(viewer.entities.add({ position: deg(JEZERO.lon, JEZERO.lat, 5000),
    point: { pixelSize: 7, color: col('marker', 1), outlineColor: col('marker', 0.9, Cesium.Color.BLACK), outlineWidth: 2 },
    label: { text: 'Jezero Crater', font: `12px ${FONT}`, fillColor: col('marker', 1), outlineColor: col('marker', 0.8, Cesium.Color.BLACK), outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      horizontalOrigin: Cesium.HorizontalOrigin.LEFT, pixelOffset: new Cesium.Cartesian2(10, 0) } }), visAt('marker', deg(JEZERO.lon, JEZERO.lat, 5000)));
  // --- hover / selection highlight (a single rectangle each, moved on demand)
  const mkRect = (alpha) => viewer.entities.add({ show: false, rectangle: { coordinates: rectOf(MC13), height: 1500, material: WHITE.withAlpha(alpha) } });
  const hoverRect = mkRect(0.16), selRect = mkRect(0.07);
  const setRect = (ent, q) => { if (ent._q === q) return; ent._q = q; ent.show = !!q; if (q) ent.rectangle.coordinates = rectOf(q); };

  const route = (app.routeLayer = createRouteLayer(app));
  let selWp = null;

  const VIEWS = {
    mars: () => ({ destination: deg(JEZERO.lon - 12, 14, 1.05e7) }),
    quads: () => ({ destination: deg(JEZERO.lon - 12, 14, 1.05e7) }),
    mc13: () => ({ destination: deg(67.5, 15, 3.4e6) }),
    ne: () => ({ destination: deg(78.75, 22.5, 1.45e6) }),
    jezero: () => ({ destination: deg((ROUTE_VIEW.west + ROUTE_VIEW.east) / 2 - 0.012, (ROUTE_VIEW.south + ROUTE_VIEW.north) / 2, 2700) }),
  };

  function enter(stage, prev) {
    Object.assign(target, { quads: stage === 'quads' ? 1 : stage === 'mc13' ? 0.35 : 0, mc13: stage === 'mc13' ? 1 : stage === 'ne' ? 0.25 : 0,
      sectors: stage === 'mc13' ? 1 : 0, features: stage === 'ne' ? 1 : 0, marker: stage === 'mars' || stage === 'quads' || stage === 'mc13' ? 1 : 0 });
    setRect(hoverRect, null); setRect(selRect, stage === 'mc13' ? MC13 : null);
    const detail = stage === 'jezero';
    app.layers.ctx_regional.show = app.layers.ctx.show = app.layers.hirise.show = detail;
    route.show(stage === 'jezero'); app.crew.show = false; route.crew.show = false;
    if (!(stage === 'quads' && prev === 'mars')) app.flyTo({ ...VIEWS[stage](), duration: prev == null ? 0 : stage === 'jezero' ? 3.2 : 2.4 });
    app.handlers.move = (lat, lon) => {
      let q = null;
      if (stage === 'quads') q = findQuadrangle(lat, lon); else if (stage === 'mc13' && contains(MC13, lat, lon)) q = SECTORS.find((s) => contains(s, lat, lon));
      setRect(hoverRect, q); viewer.canvas.style.cursor = q || (stage === 'ne' && inJezero(lat, lon)) || stage === 'mars' ? 'pointer' : '';
    };
    app.handlers.click = (lat, lon, pos) => {
      if (stage === 'mars') return app.setStage('quads');
      if (stage === 'quads') { const q = findQuadrangle(lat, lon); return q.id === 'MC-13' ? app.setStage('mc13') : toast(`${q.id} ${q.name} — demo scope covers MC-13 Syrtis Major only`); }
      if (stage === 'mc13') { const s = SECTORS.find((x) => contains(x, lat, lon)); return s?.key === 'NE' ? app.setStage('ne') : s ? toast(`${s.id} — demo scope covers MC-13 NE only`) : null; }
      if (stage === 'ne' && inJezero(lat, lon)) return app.setStage('jezero');
      if (stage === 'jezero') { const i = route.pickWaypoint(pos); if (i != null) { selWp = i; panel(stage); } }
    };
    panel(stage);
  }
  const inJezero = (lat, lon) => geodesic(lat, lon, JEZERO.lat, JEZERO.lon).distance < JEZERO.diameterKm * 500 * 1.15;

  function panel(stage) {
    const L = app.slots.left, B = app.slots.bottom; L.replaceChildren(); B.replaceChildren();
    const card = (...c) => h('.panel.left', {}, ...c);
    const back = (to) => h('button', { style: 'margin-bottom:12px', onclick: () => app.setStage(to) }, '← Back');
    if (stage === 'mars' || stage === 'quads') {
      L.append(card(h('p.eyebrow', {}, 'Planet view'), h('h1', {}, 'Mars'), h('p', {}, 'Explore Mars by official cartographic regions down to the demo mission site.'),
        h('h2', {}, 'Selected mission'), mv('Site', 'Jezero Crater', 'IAU'),
        mv('Centre', `${fmtLat(JEZERO.lat)}, ${fmtLon(JEZERO.lon)}`, 'IAU'), mv('Diameter', `${JEZERO.diameterKm} km`, 'IAU'),
        h('h2', {}, 'Official regions'), mv('Mars Charts', 'MC-01 – MC-30', 'IAU'), mv('Globe imagery', 'Viking MDIM 2.1', 'SATELLITE')));
      B.append(h('.hint', {}, stage === 'mars' ? 'Drag to rotate · scroll to zoom · click the planet to show the 30 Mars Chart quadrangles' : 'Select MC-13 Syrtis Major'));
    } else if (stage === 'mc13') {
      L.append(card(back('quads'), h('p.eyebrow', {}, 'Regional view · 1:5,000,000'), h('h1', {}, 'Syrtis Major'), h('p', {}, 'Mars Chart MC-13 — one of 30 official quadrangles.'),
        mv('Latitude', '0° – 30°N', 'IAU'), mv('Longitude', '45° – 90°E', 'IAU'), h('h2', {}, 'Quadrants · 1:2,000,000'),
        h('p', {}, 'MC-13 NW · NE · SW · SE. Jezero Crater lies in MC-13 NE (15–30°N, 67.5–90°E).'), h('h2', {}, 'Topography'), molaToggle(), molaNote()));
      B.append(h('.hint', {}, 'Select the NE quadrant'));
    } else if (stage === 'ne') {
      L.append(card(back('mc13'), h('p.eyebrow', {}, 'Sub-regional view · 1:2,000,000'), h('h1', {}, 'Syrtis Major NE'), h('p', {}, 'MC-13 NE, on the north-western rim of the Isidis basin.'),
        mv('Latitude', '15° – 30°N', 'IAU'), mv('Longitude', '67.5° – 90°E', 'IAU'), h('h2', {}, 'Named features (IAU)'),
        FEATURES_MC13_NE.map((f) => mv(f.name, `${f.lat.toFixed(2)}°N ${f.lon.toFixed(2)}°E`, 'IAU')),
        h('h2', {}, 'Topography'), molaToggle(), molaNote()));
      B.append(h('.hint', {}, 'Select Jezero Crater'));
    } else if (stage === 'jezero') {
      const p = app.plan, w = selWp != null ? p.legs[selWp] : null;
      L.append(card(back('ne'), h('p.eyebrow', {}, 'Terrain & route view'), h('h1', {}, 'Jezero Crater'),
        h('p', {}, h('b', { style: 'color:#f0a04a' }, 'Proposed route'), ' ', badge('DEMO'), h('br'), 'Demonstration route — not a path travelled by NASA’s Perseverance rover.'),
        mv('Total distance (geodesic)', fmtDist(p.total_m), 'COMPUTED'), mv('Planned duration', fmtDur(p.duration), 'EMULATED'), mv('Waypoints', String(p.legs.length), 'DEMO'),
        mv('Surface imagery', 'HiRISE 25 cm · CTX 6 m', 'SATELLITE'), mv('Terrain mesh', 'CTX DEM 20 m', 'SATELLITE'),
        h('h2', {}, 'Waypoints'),
        h('ul.wplist', {}, p.legs.map((l, i) => h(`li${selWp === i ? '.sel' : ''}`, { onclick: () => { selWp = i; panel(stage); app.flyTo({ destination: gdeg(l.lon, l.lat, 2200), duration: 1.2 }); } },
          h('span.dot'), h('span', {}, i === 0 ? 'Start' : i === p.legs.length - 1 ? 'Destination' : l.id, h('small', {}, l.name)), h('span.r', {}, fmtDist(l.cum_m))))),
        w && h('div', {}, h('h2', {}, `${w.id} · ${w.name}`), h('p', {}, w.note),
          mv('Position', `${fmtLat(w.lat)}, ${fmtLon(w.lon)}`, 'DEMO'), mv('Elevation (MOLA areoid)', `${w.elev.toFixed(1)} m`, 'SATELLITE'), mv('Slope here', `${p.slopeAtS(w.cum_m).toFixed(1)}°`, 'SATELLITE'),
          w.seg && mv('Leg distance', fmtDist(w.seg.distance_m), 'COMPUTED'), w.terrain && mv('Terrain', w.terrain, 'MODELLED')),
        h('h2', {}, 'Elevation profile'), elevationProfile(p), mv('Climb / descent', `+${p.climb_m.toFixed(0)} m / −${p.descent_m.toFixed(0)} m`, 'SATELLITE'), mv('Steepest slope (40 m baseline)', `${p.max_slope_deg.toFixed(1)}°`, 'SATELLITE'),
        h('p.note', {}, `Sampled every 10 m from the ${DEM_INFO.cell_m} m Mars 2020 CTX DEM mosaic.`),
        h('h2', {}, `Environment · Ls ${SOL_TABLE.ls_range[0]}–${SOL_TABLE.ls_range[1]}°, MY ${SOL_TABLE.marsYear}`),
        mv('Air temp, hourly means', `${rng(SOL_TABLE.air_temp_c, 0)} °C`, SOL_TABLE.provenance.air_temp_c), mv('Ground temp', `${rng(SOL_TABLE.ground_temp_c, 0)} °C`, SOL_TABLE.provenance.ground_temp_c),
        mv('Surface pressure', `${rng(SOL_TABLE.pressure_pa, 0)} Pa`, SOL_TABLE.provenance.pressure_pa), mv('Wind speed', `${rng(SOL_TABLE.wind_ms, 1)} m/s`, SOL_TABLE.provenance.wind_ms),
        mv('Dust optical depth τ', `≈ ${SOL_TABLE.tau}`, SOL_TABLE.provenance.tau),
        h('p.note', {}, `Perseverance/MEDA, sols ${SOL_TABLE.sols[0]}–${SOL_TABLE.sols.at(-1)} (April 2021), mean per local hour — archived measurements, not current conditions.`),
        h('button.primary', { style: 'width:100%;margin-top:10px', onclick: () => app.setStage('pre') }, 'Plan this route → Pre-mission')));
    }
  }
  const rng = (a, d) => `${Math.min(...a).toFixed(d)} … ${Math.max(...a).toFixed(d)}`;
  const molaToggle = () => h('label', { style: 'display:flex;gap:8px;align-items:center;color:var(--dim);cursor:pointer;margin-top:10px' },
    h('input', { type: 'checkbox', ...(app.layers.mola.show ? { checked: true } : {}), onchange: (e) => { app.layers.mola.show = e.target.checked; } }), 'MOLA colour-coded elevation ', badge('SATELLITE'));
  const molaNote = () => h('p.note', {}, 'MGS MOLA MEGDR megt44n000hb, 128 px/deg (PDS ODE colour rendering; relative scale, no legend supplied).');
  const mv = (lab, val, prov) => { const m = metric(lab, prov); m.set(val); return m.el; };
  return { enter };
}

function elevationProfile(p) {
  const W = 280, H = 78, pad = 4, es = p.profile.map((q) => q.elev), lo = Math.min(...es) - 2, hi = Math.max(...es) + 2;
  const x = (d) => pad + (d / p.total_m) * (W - 2 * pad), y = (e) => H - 14 - ((e - lo) / (hi - lo)) * (H - 28);
  const pts = p.profile.map((q) => `${x(q.s).toFixed(1)},${y(q.elev).toFixed(1)}`).join(' ');
  const svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" style="height:auto"><polyline points="${pad},${H - 14} ${pts} ${W - pad},${H - 14}" fill="rgba(240,160,74,.12)" stroke="none"/>
    <polyline points="${pts}" fill="none" stroke="#f0a04a" stroke-width="1.3"/>${p.legs.map((l) => `<circle cx="${x(l.cum_m)}" cy="${y(l.elev)}" r="2" fill="#fff"/>`).join('')}
    <text x="${pad}" y="9">${Math.max(...es).toFixed(0)} m</text><text x="${pad}" y="${H - 3}">${Math.min(...es).toFixed(0)} m</text><text x="${W - pad}" y="${H - 3}" text-anchor="end">${(p.total_m / 1000).toFixed(2)} km</text></svg>`;
  const d = document.createElement('div'); d.innerHTML = svg; return d.firstChild;
}
