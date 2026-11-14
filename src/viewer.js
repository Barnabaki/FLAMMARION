// One persistent Cesium scene for the whole app (spatial continuity A → B → C).
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';

Cesium.Ellipsoid.default = Cesium.Ellipsoid.MARS; // IAU 2000 Mars: 3396.19 km equatorial, 3376.20 km polar
export { Cesium };

const TREK = 'https://trek.nasa.gov/tiles/Mars/EQ';
export const LAYERS = [
  { id: 'viking', label: 'Viking MDIM 2.1 colour mosaic (232 m/px)', product: 'Mars_Viking_MDIM21_ClrMosaic_global_232m', ext: 'jpg', max: 7, credit: 'NASA / JPL / USGS — Viking Orbiter MDIM 2.1' },
  { id: 'ctx_regional', label: 'MRO CTX mosaic, Jezero region (preliminary)', product: 'Jezero_CTX_BlockAdj_dd', ext: 'png', max: 12, rect: [75.1537692, 15.9058484, 78.8717121, 19.4453003], credit: 'NASA / JPL / MSSS / USGS — MRO CTX' },
  { id: 'ctx', label: 'MRO CTX orthomosaic, Jezero (6 m/px, controlled)', product: 'JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0', ext: 'png', max: 13, rect: [77.1604655, 18.2110274, 77.6991776, 18.7211945], credit: 'NASA / JPL / MSSS / USGS — MRO CTX' },
  { id: 'hirise', label: 'MRO HiRISE orthomosaic, Jezero (25 cm/px, controlled)', product: 'JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd', ext: 'png', max: 17, rect: [77.2229331, 18.3067994, 77.583964, 18.669315], credit: 'NASA / JPL / University of Arizona / USGS — MRO HiRISE' },
];

export function createViewer(container) {
  const viewer = new Cesium.Viewer(container, {
    baseLayer: false, baseLayerPicker: false, geocoder: false, timeline: false, animation: false, homeButton: false,
    sceneModePicker: false, navigationHelpButton: false, fullscreenButton: false, infoBox: false, selectionIndicator: false,
    skyBox: false, skyAtmosphere: false, scene3DOnly: true, contextOptions: { webgl: { preserveDrawingBuffer: true } },
  });
  const { scene } = viewer;
  scene.backgroundColor = Cesium.Color.fromCssColorString('#05060a');
  scene.globe.baseColor = Cesium.Color.fromCssColorString('#3a1f15');
  scene.globe.showGroundAtmosphere = false; scene.globe.enableLighting = false;
  if (scene.sun) scene.sun.show = false; if (scene.moon) scene.moon.show = false; scene.fog.enabled = false;
  scene.screenSpaceCameraController.minimumZoomDistance = 2;
  scene.screenSpaceCameraController.maximumZoomDistance = 3.0e7;
  viewer.cesiumWidget.creditContainer.style.display = 'none'; // attribution is shown in our own Data sources panel + footer
  viewer.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

  const layers = {};
  for (const L of LAYERS) {
    const provider = new Cesium.UrlTemplateImageryProvider({
      url: `${TREK}/${L.product}/1.0.0/default/default028mm/{z}/{y}/{x}.${L.ext}`,
      tilingScheme: new Cesium.GeographicTilingScheme({ ellipsoid: Cesium.Ellipsoid.MARS }),
      maximumLevel: L.max, rectangle: L.rect ? Cesium.Rectangle.fromDegrees(...L.rect) : undefined, credit: L.credit,
    });
    layers[L.id] = viewer.imageryLayers.addImageryProvider(provider);
  }
  layers.viking.saturation = 1.05;
  return { viewer, layers };
}

export const deg = (lon, lat, h = 0) => Cesium.Cartesian3.fromDegrees(lon, lat, h);
export const rectOf = (q, pad = 0) => Cesium.Rectangle.fromDegrees(wrap(q.west) - pad, q.south - pad, q.east === 360 && q.west === 0 ? 180 : wrap(q.east) + pad, q.north + pad);
export const wrap = (lon) => (lon > 180 ? lon - 360 : lon);

/** Entity.show is a plain boolean (not a Property): register a predicate that is re-evaluated before every frame. */
export function dynamicShow(viewer) {
  const items = [];
  viewer.scene.preRender.addEventListener(() => { for (const [e, f] of items) { const v = !!f(); if (e.show !== v) e.show = v; } });
  return (entity, fn) => { entity.show = !!fn(); items.push([entity, fn]); return entity; };
}
