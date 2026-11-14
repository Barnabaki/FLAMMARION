// Route + waypoint entities, shared by Module A stage 04, Module B and Module C.
import { Cesium, deg } from './viewer.js';

export function createRouteLayer(app) {
  const { viewer, plan } = app;
  const ents = [];
  const add = (e) => { const x = viewer.entities.add(e); ents.push(x); return x; };
  const ORANGE = Cesium.Color.fromCssColorString('#f0a04a');
  add({ polyline: { positions: plan.legs.map((l) => deg(l.lon, l.lat)), width: 3, clampToGround: true, material: new Cesium.PolylineDashMaterialProperty({ color: ORANGE, dashLength: 14 }) } });
  plan.legs.forEach((l, i) => {
    const end = i === 0 || i === plan.legs.length - 1;
    add({ position: deg(l.lon, l.lat, 1), properties: { wp: i },
      point: { pixelSize: end ? 11 : 8, color: end ? Cesium.Color.WHITE : Cesium.Color.fromCssColorString('#05060a'), outlineColor: Cesium.Color.WHITE, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY },
      label: { text: i === 0 ? 'START · Habitat' : i === plan.legs.length - 1 ? 'END · Delta front' : l.id, font: '500 11px "Helvetica Neue", Helvetica, Arial, sans-serif', pixelOffset: new Cesium.Cartesian2(0, -18),
        fillColor: Cesium.Color.WHITE, outlineColor: Cesium.Color.BLACK, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, disableDepthTestDistance: Number.POSITIVE_INFINITY,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 60000) } });
  });
  // crew / rover marker (position driven by app.crew)
  const crew = add({ position: new Cesium.CallbackProperty(() => deg(app.crew.lon, app.crew.lat, 1.5), false), show: false,
    point: { pixelSize: 13, color: Cesium.Color.fromCssColorString('#d9744a'), outlineColor: Cesium.Color.WHITE, outlineWidth: 2.5, disableDepthTestDistance: Number.POSITIVE_INFINITY },
    label: { text: 'CREW', font: '500 10px "Helvetica Neue", Helvetica, Arial, sans-serif', pixelOffset: new Cesium.Cartesian2(0, 18), fillColor: Cesium.Color.WHITE, outlineColor: Cesium.Color.BLACK, outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE, disableDepthTestDistance: Number.POSITIVE_INFINITY } });
  const set = (v) => ents.forEach((e) => (e.show = e === crew ? v && app.crew.show : v));
  set(false);
  return { show: set, crew, pickWaypoint(pos) { const p = viewer.scene.pick(pos); return p?.id?.properties?.wp?.getValue(); } };
}
