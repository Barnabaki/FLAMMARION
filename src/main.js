import './style.css';
import { createViewer, Cesium, deg, loadTerrain } from './viewer.js';
import { h, icon } from './ui/dom.js';
import { buildPlan, missionStartUtcMs } from './lib/mission.js';
import { initA } from './moduleA.js';
import { initB } from './moduleB.js';
import { initC } from './moduleC.js';
import { SOURCES, TAGS } from './sources.js';

const ui = document.getElementById('ui');
const { viewer, layers } = createViewer('globe');
const terrain = await loadTerrain(viewer);

// Shared application state. `plan` is the single route object handed A → B → C.
const app = {
  viewer, layers, ui, Cesium, terrain, stage: null, plan: buildPlan(), startUtcMs: missionStartUtcMs(), sel: { quad: null, sector: null }, terrainMode: false,
  slots: { left: h('.slot'), right: h('.slot'), bottom: h('.slot'), center: h('.slot'), mode: h('.slot') },
  crew: { lat: 0, lon: 0, show: false }, handlers: {},
  setStage, flyTo, openSources, setTerrainMode, modeToggle,
};
// Navigation levels. `crumb` may depend on the current selection.
const STAGES = [
  { id: 'select' }, { id: 'mars', crumb: () => 'Mars' }, { id: 'regions' }, { id: 'region', crumb: () => app.sel.quad?.id }, { id: 'sector', crumb: () => app.sel.sector?.id },
  { id: 'site', crumb: () => 'Jezero Crater' }, { id: 'pre', crumb: () => 'Pre-mission' }, { id: 'intra', crumb: () => 'Mission' },
];
const A_STAGES = ['mars', 'regions', 'region', 'sector', 'site'];
const crumbs = h('.crumbs'), cursor = h('span', {}, '');
const guide = h('.guide', {}, [['zoom', 'Zoom in'], ['scroll', 'Scroll'], ['pinch', 'Pinch'], ['tap', 'Click']].map(([i, t]) => h('span', {}, icon(i, 17), t)));
ui.append(
  h('.topbar', {}, h('.brand', {}, h('span.brand-demo', {}, 'Demo'), 'FLAMMARION'), crumbs, h('.sp'), h('button.glass', { onclick: () => openSources() }, 'Data sources')),
  h('.shade'), app.slots.mode, app.slots.left, app.slots.right, app.slots.center, app.slots.bottom, guide,
  h('.zoom.glass', {}, h('button', { title: 'Zoom in', onclick: () => zoom(0.5) }, icon('plus', 17)), h('button', { title: 'Zoom out', onclick: () => zoom(2) }, icon('minus', 17)),
    h('button', { title: 'Full planet view', onclick: () => setStage('mars') }, icon('target', 17))),
  h('.footer', {}, 'IAU 2000 Mars · planetocentric · °E ', cursor, h('br'), 'Imagery NASA/JPL/USGS · MSSS · UArizona via Mars Trek'),
);

function zoom(f) {
  const c = viewer.camera, hgt = c.positionCartographic.height, g = terrain.heightAt(Cesium.Math.toDegrees(c.positionCartographic.latitude), Cesium.Math.toDegrees(c.positionCartographic.longitude));
  if (viewer.trackedEntity) return f < 1 ? c.zoomIn((hgt - g) * 0.4) : c.zoomOut((hgt - g) * 0.7);
  c.flyTo({ destination: Cesium.Cartesian3.fromRadians(c.positionCartographic.longitude, c.positionCartographic.latitude, g + Math.max(40, (hgt - g) * f)), orientation: { heading: c.heading, pitch: c.pitch, roll: 0 }, duration: 0.5 });
}
function flyTo(opts) { viewer.trackedEntity = undefined; viewer.camera.flyTo({ duration: 2.4, easingFunction: Cesium.EasingFunction.QUADRATIC_IN_OUT, ...opts }); }

function renderCrumbs() {
  crumbs.replaceChildren();
  const idx = STAGES.findIndex((s) => s.id === app.stage);
  STAGES.slice(0, Math.max(idx, 0) + 1).filter((s) => s.crumb && s.crumb()).forEach((s, i, arr) => {
    if (i) crumbs.append(h('span.sep', {}, '/'));
    crumbs.append(i === arr.length - 1 ? h('span.cur', {}, s.crumb()) : h('a', { onclick: () => setStage(s.id) }, s.crumb()));
  });
}
function setStage(id) {
  const prev = app.stage;
  if (prev === id) return;
  if (prev === 'intra') modC.leave();
  if (prev === 'pre') modB.leave();
  app.stage = id;
  for (const s of Object.values(app.slots)) s.replaceChildren();
  renderCrumbs();
  guide.style.display = A_STAGES.includes(id) ? '' : 'none';
  const detail = id === 'site' || id === 'pre' || id === 'intra';
  layers.ctx_regional.show = layers.ctx.show = layers.hirise.show = detail;
  if (!A_STAGES.includes(id) && id !== 'select') setTerrainMode(false);
  if (id === 'pre') modB.enter(); else if (id === 'intra') modC.enter(); else modA.enter(id, prev);
}

/** Satellite ↔ Terrain (MOLA colour shaded relief). */
function setTerrainMode(on) {
  app.terrainMode = on; layers.mola.show = on;
  layers.ctx_regional.alpha = layers.ctx.alpha = layers.hirise.alpha = on ? 0.45 : 1;
  app.onTerrainMode?.(on);
}
function modeToggle() {
  const b = [['Satellite', 'layers', false], ['Terrain', 'mountain', true]].map(([t, i, v]) => h(`button${app.terrainMode === v ? '.on' : ''}`, { onclick: () => { setTerrainMode(v); b.forEach((x, k) => x.classList.toggle('on', (k === 1) === v)); } }, icon(i, 16), t));
  app.onTerrainMode = (on) => b.forEach((x, k) => x.classList.toggle('on', (k === 1) === on));
  return h('.mode.seg.glass', {}, b);
}

/** Data Sources drawer. With an id it scrolls to that source and highlights it until the pointer reaches it. */
function openSources(id) {
  const close = () => veil.remove();
  const body = h('.body', {},
    h('p', {}, 'Every value in the app points here. Hover a value to see what kind of data it is, click it to jump to its source.'),
    h('.legend', { style: 'margin-top:14px' }, Object.entries(TAGS).flatMap(([k, v]) => [h('b', {}, k), h('span', {}, v)])),
    SOURCES.map((s) => s.group ? h('.grp', {}, s.group) : h('.srcard', { id: `src-${s.id}` }, h('b', {}, s.name), h('p', {}, s.use),
      h('.meta', {}, h('span.tag', {}, s.tag), h('a', { href: s.url, target: '_blank', rel: 'noopener' }, s.org), h('span', {}, s.licence)))));
  const veil = h('.veil', { onclick: (e) => e.target === veil && close() },
    h('.drawer.glass', {}, h('header', {}, h('div', { style: 'flex:1' }, h('p.eyebrow', {}, 'Provenance'), h('h1', {}, 'Data sources')), h('button', { onclick: close, title: 'Close' }, icon('x', 16))), body));
  ui.append(veil);
  const card = id && body.querySelector(`#src-${id}`);
  if (card) {
    card.classList.add('hl');
    requestAnimationFrame(() => card.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    const clear = () => { card.classList.remove('hl'); card.removeEventListener('mouseenter', clear); card.removeEventListener('mousemove', clear); };
    setTimeout(() => { card.addEventListener('mouseenter', clear); card.addEventListener('mousemove', clear); }, 700); // after the scroll settles
  }
}
const citeClick = (e) => { const c = e.target.closest?.('.cite'); if (c && c.dataset.src && (e.type === 'click' || e.key === 'Enter')) { e.stopPropagation(); openSources(c.dataset.src); } };
document.addEventListener('click', citeClick); document.addEventListener('keydown', citeClick);

// pointer → ground position (ray-cast against the terrain, falling back to the spheroid)
const pickGround = (pos) => { const ray = viewer.camera.getPickRay(pos); return (ray && viewer.scene.globe.pick(ray, viewer.scene)) || viewer.camera.pickEllipsoid(pos, Cesium.Ellipsoid.MARS); };
const toLL = (p) => { const c = Cesium.Cartographic.fromCartesian(p, Cesium.Ellipsoid.MARS); return [Cesium.Math.toDegrees(c.latitude), (Cesium.Math.toDegrees(c.longitude) + 360) % 360]; };
new Cesium.ScreenSpaceEventHandler(viewer.canvas).setInputAction((e) => {
  const p = pickGround(e.endPosition);
  if (!p) { cursor.textContent = ''; app.handlers.move?.(null, null, e.endPosition); return; }
  const [lat, lon] = toLL(p);
  cursor.textContent = `·  ${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'} ${lon.toFixed(2)}°E`;
  app.handlers.move?.(lat, lon, e.endPosition);
}, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
new Cesium.ScreenSpaceEventHandler(viewer.canvas).setInputAction((e) => {
  const p = pickGround(e.position); if (!p) return;
  const [lat, lon] = toLL(p); app.handlers.click?.(lat, lon, e.position);
}, Cesium.ScreenSpaceEventType.LEFT_CLICK);

const stream = fetch('./data/telemetry.ndjson').then((r) => r.text()).then((t) => t.trim().split('\n').map((l) => JSON.parse(l)).filter((r) => !r._meta));
const weather = fetch('./data/weather_sol.json').then((r) => r.json());
app.data = { stream, weather };

const modA = initA(app), modB = initB(app), modC = initC(app);
viewer.camera.setView({ destination: deg(60, 14, 1.9e7) });
setStage('select');
window.__app = app; // for automated checks
