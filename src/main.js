import './style.css';
import { createViewer, Cesium, deg } from './viewer.js';
import { h, badge, PROVENANCE } from './ui/dom.js';
import { buildPlan, missionStartUtcMs } from './lib/mission.js';
import { initA } from './moduleA.js';
import { initB } from './moduleB.js';
import { initC } from './moduleC.js';
import { SOURCES } from './sources.js';

const ui = document.getElementById('ui');
const { viewer, layers } = createViewer('globe');

// Shared application state. `route` is the single route object handed A → B → C.
const app = {
  viewer, layers, ui, Cesium, stage: null, plan: buildPlan(), startUtcMs: missionStartUtcMs(),
  slots: { left: h('.slot'), right: h('.slot'), bottom: h('.slot'), center: h('.slot') },
  crew: { lat: 0, lon: 0, show: false }, handlers: {},
  setStage, flyTo,
};
const STAGES = [
  { id: 'mars', crumb: 'Mars' }, { id: 'quads', crumb: null }, { id: 'mc13', crumb: 'MC-13' }, { id: 'ne', crumb: 'MC-13 NE' },
  { id: 'jezero', crumb: 'Jezero Crater' }, { id: 'pre', crumb: 'Pre-mission' }, { id: 'intra', crumb: 'Intra-mission' },
];
const crumbs = h('.crumbs');
const cursor = h('span', {}, '');
ui.append(
  h('.topbar', {}, h('.brand', {}, 'FLAMMARION'), crumbs, h('.sp'),
    h('button', { onclick: showSources }, 'Data sources')),
  app.slots.left, app.slots.right, app.slots.center, app.slots.bottom,
  h('.zoom', {}, h('button', { title: 'Zoom in', onclick: () => zoom(0.5) }, '+'), h('button', { title: 'Zoom out', onclick: () => zoom(2) }, '−'),
    h('button', { title: 'Full planet view', onclick: () => setStage('mars') }, '◯')),
  h('.footer', {}, 'IAU 2000 Mars · planetocentric · °E ', cursor, h('br'), 'Imagery NASA/JPL/USGS · MSSS · UArizona via Mars Trek'),
);

function zoom(f) {
  const c = viewer.camera, hgt = c.positionCartographic.height;
  viewer.trackedEntity ? c.zoomIn(hgt * (1 - f) * 0.6) : c.flyTo({ destination: Cesium.Cartesian3.fromRadians(c.positionCartographic.longitude, c.positionCartographic.latitude, hgt * f), orientation: { heading: c.heading, pitch: c.pitch, roll: 0 }, duration: 0.5 });
}
function flyTo(opts) { viewer.trackedEntity = undefined; viewer.camera.flyTo({ duration: 2.4, easingFunction: Cesium.EasingFunction.QUADRATIC_IN_OUT, ...opts }); }

function renderCrumbs() {
  crumbs.replaceChildren();
  const idx = STAGES.findIndex((s) => s.id === app.stage);
  STAGES.slice(0, Math.max(idx, 0) + 1).filter((s) => s.crumb).forEach((s, i, arr) => {
    if (i) crumbs.append(h('span.sep', {}, '/'));
    const last = i === arr.length - 1;
    crumbs.append(last ? h('span.cur', {}, s.crumb) : h('a', { onclick: () => setStage(s.id) }, s.crumb));
  });
}
function setStage(id) {
  const prev = app.stage;
  if (prev === id) return;
  if (prev === 'intra' && id !== 'intra') modC.leave();
  if (prev === 'pre' && id !== 'pre') modB.leave();
  app.stage = id;
  for (const s of Object.values(app.slots)) s.replaceChildren();
  renderCrumbs();
  if (id === 'pre' || id === 'intra') layers.ctx_regional.show = layers.ctx.show = layers.hirise.show = true;
  if (id === 'pre') modB.enter(); else if (id === 'intra') modC.enter(); else modA.enter(id, prev);
}

function showSources() {
  const m = h('.modal', { onclick: (e) => e.target === m && m.remove() },
    h('.panel', {}, h('p.eyebrow', {}, 'Provenance'), h('h1', {}, 'Data sources'),
      h('p', {}, 'Every value on screen carries one of these tags. Nothing historic, modelled or simulated is presented as a live measurement.'),
      h('.legend', {}, Object.entries(PROVENANCE).map(([k, v]) => h('span', { style: 'margin-right:10px' }, badge(k), ' ', h('small', { style: 'color:var(--dim)' }, v)))),
      h('table', { style: 'margin-top:14px' }, h('tr', {}, ['Dataset', 'Used for', 'Tag', 'Source / licence'].map((t) => h('th', {}, t))),
        SOURCES.map((s) => h('tr', {}, h('td', {}, s.name), h('td', {}, s.use), h('td', {}, badge(s.tag)), h('td', {}, h('a', { href: s.url, target: '_blank', rel: 'noopener' }, s.org), h('br'), h('small', { style: 'color:var(--dim)' }, s.licence))))),
      h('p.note', { style: 'margin-top:12px' }, 'Not integrated in this build: MOLA MEGDR elevation mesh (no DEM tile service reachable — terrain is the reference spheroid with real imagery draped), MEDA/REMS PDS records (weather is a model fitted to published MEDA ranges), CRISM composition maps. See DATA_SOURCES.md.'),
      h('.row', { style: 'justify-content:flex-end' }, h('button', { onclick: () => m.remove() }, 'Close'))));
  ui.append(m);
}

// cursor lat/lon read-out
new Cesium.ScreenSpaceEventHandler(viewer.canvas).setInputAction((e) => {
  const p = viewer.camera.pickEllipsoid(e.endPosition, Cesium.Ellipsoid.MARS);
  if (!p) { cursor.textContent = ''; return; }
  const c = Cesium.Cartographic.fromCartesian(p, Cesium.Ellipsoid.MARS);
  const lat = Cesium.Math.toDegrees(c.latitude), lon = (Cesium.Math.toDegrees(c.longitude) + 360) % 360;
  cursor.textContent = `·   ${Math.abs(lat).toFixed(3)}°${lat >= 0 ? 'N' : 'S'}  ${lon.toFixed(3)}°E`;
  app.handlers.move?.(lat, lon, e.endPosition);
}, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
new Cesium.ScreenSpaceEventHandler(viewer.canvas).setInputAction((e) => {
  const p = viewer.camera.pickEllipsoid(e.position, Cesium.Ellipsoid.MARS);
  if (!p) return;
  const c = Cesium.Cartographic.fromCartesian(p, Cesium.Ellipsoid.MARS);
  app.handlers.click?.(Cesium.Math.toDegrees(c.latitude), (Cesium.Math.toDegrees(c.longitude) + 360) % 360, e.position);
}, Cesium.ScreenSpaceEventType.LEFT_CLICK);

const stream = fetch('./data/telemetry.ndjson').then((r) => r.text()).then((t) => t.trim().split('\n').map((l) => JSON.parse(l)).filter((r) => !r._meta));
const weather = fetch('./data/weather_sol.json').then((r) => r.json());
app.data = { stream, weather };

const modA = initA(app), modB = initB(app), modC = initC(app);
viewer.camera.setView({ destination: deg(60, 14, 1.9e7) });
setStage('mars');
window.__app = app; // for automated checks
