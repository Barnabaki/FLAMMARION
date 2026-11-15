// One persistent Cesium scene for the whole app (spatial continuity A → B → C).
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';

Cesium.Ellipsoid.default = Cesium.Ellipsoid.MARS; // IAU 2000 Mars: 3396.19 km equatorial, 3376.20 km polar
export { Cesium };

const TREK = 'https://trek.nasa.gov/tiles/Mars/EQ';
export const LAYERS = [
  { id: 'viking', label: 'Viking MDIM 2.1 colour mosaic (232 m/px)', product: 'Mars_Viking_MDIM21_ClrMosaic_global_232m', ext: 'jpg', max: 7, credit: 'NASA / JPL / USGS — Viking Orbiter MDIM 2.1' },
  { id: 'mola', label: 'MGS MOLA colour shaded relief (463 m/px)', product: 'Mars_MGS_MOLA_ClrShade_merge_global_463m', ext: 'jpg', max: 7, credit: 'NASA / MGS MOLA Science Team / USGS' },
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
  // Natural Martian tones: a little more saturation and contrast, no hue shift.
  layers.viking.saturation = 1.38; layers.viking.contrast = 1.14; layers.viking.gamma = 0.94; layers.viking.hue = 0.09;
  layers.mola.show = false;
  for (const k of ['ctx_regional', 'ctx', 'hirise']) { layers[k].colorToAlpha = Cesium.Color.BLACK; layers[k].colorToAlphaThreshold = 0.002; }
  // Soft limb haze (no neon): Cesium's sky atmosphere on the Mars ellipsoid, shifted from blue to dusty orange.
  try { const sky = new Cesium.SkyAtmosphere(Cesium.Ellipsoid.MARS); sky.hueShift = 0.47; sky.saturationShift = 0.15; sky.brightnessShift = -0.05; scene.skyAtmosphere = sky; } catch { /* optional */ }
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

// ---- Terrain: Mars 2020 CTX DEM mosaic (20 m source, 40 m mesh grid) over Jezero. Elsewhere the surface is the
// reference spheroid (height 0); the DEM edge is tapered to 0 over 0.6° so there is no cliff at its boundary.
export let groundH = () => 0;
/** Position at `h` metres above the terrain surface. */
export const gdeg = (lon, lat, h = 0) => Cesium.Cartesian3.fromDegrees(lon, lat, groundH(lat, lon) + h);

export async function loadTerrain(viewer) {
  const meta = await (await fetch('./data/terrain/jezero_dem_40m.json')).json();
  const bmp = await createImageBitmap(await (await fetch('./data/terrain/jezero_dem_40m.png')).blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
  const ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.drawImage(bmp, 0, 0);
  const px = ctx.getImageData(0, 0, bmp.width, bmp.height).data, W = meta.width, H = meta.height, grid = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) grid[i] = (px[4 * i] * 256 + px[4 * i + 1]) / 10 - 3000;
  const dLon = (meta.east - meta.west) / W, dLat = (meta.north - meta.south) / H, TAPER = 0.6;
  groundH = (lat, lon) => {
    const x = Math.max(0, Math.min(W - 1, (lon - meta.west) / dLon - 0.5)), y = Math.max(0, Math.min(H - 1, (meta.north - lat) / dLat - 0.5));
    const c = Math.min(W - 2, Math.floor(x)), r = Math.min(H - 2, Math.floor(y)), fx = x - c, fy = y - r, i = r * W + c;
    const v = (grid[i] * (1 - fx) + grid[i + 1] * fx) * (1 - fy) + (grid[i + W] * (1 - fx) + grid[i + W + 1] * fx) * fy;
    const d = Math.hypot(Math.max(meta.west - lon, 0, lon - meta.east), Math.max(meta.south - lat, 0, lat - meta.north));
    if (d <= 0) return v; if (d >= TAPER) return 0;
    const k = 1 - d / TAPER; return v * k * k * (3 - 2 * k);
  };
  const N = 33, ZERO = new Float32Array(N * N), scheme = new Cesium.GeographicTilingScheme({ ellipsoid: Cesium.Ellipsoid.MARS }), D = Cesium.Math.toDegrees;
  viewer.terrainProvider = new Cesium.CustomHeightmapTerrainProvider({ width: N, height: N, tilingScheme: scheme, ellipsoid: Cesium.Ellipsoid.MARS,
    credit: 'Mars 2020 CTX DEM mosaic (JPL/USGS)',
    callback: (x, y, level) => {
      const r = scheme.tileXYToRectangle(x, y, level), w = D(r.west), e = D(r.east), s = D(r.south), n = D(r.north);
      if (e < meta.west - TAPER || w > meta.east + TAPER || n < meta.south - TAPER || s > meta.north + TAPER) return ZERO;
      const out = new Float32Array(N * N);
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) out[j * N + i] = groundH(n - ((n - s) * j) / (N - 1), w + ((e - w) * i) / (N - 1));
      return out;
    } });
  viewer.scene.globe.depthTestAgainstTerrain = false;
  return { meta, heightAt: groundH };
}
