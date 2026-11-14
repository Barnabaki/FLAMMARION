// Copies Cesium's runtime assets (workers, widget CSS, images) into public/cesiumStatic so Vite serves them as-is.
import { cpSync, existsSync, rmSync } from 'node:fs';
const src = new URL('../node_modules/cesium/Build/Cesium/', import.meta.url).pathname;
const dst = new URL('../public/cesiumStatic/', import.meta.url).pathname;
if (existsSync(src)) {
  rmSync(dst, { recursive: true, force: true });
  for (const d of ['ThirdParty', 'Workers', 'Assets', 'Widgets']) cpSync(src + d, dst + d, { recursive: true });
  console.log('Cesium static assets → public/cesiumStatic');
}
