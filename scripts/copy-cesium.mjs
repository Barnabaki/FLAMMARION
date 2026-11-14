// Copies Cesium's runtime assets (workers, widget CSS, images) into public/cesiumStatic so Vite serves them as-is.
import { cpSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const src = fileURLToPath(new URL('../node_modules/cesium/Build/Cesium/', import.meta.url));
const dst = fileURLToPath(new URL('../public/cesiumStatic/', import.meta.url));
if (existsSync(src)) {
  rmSync(dst, { recursive: true, force: true });
  for (const d of ['ThirdParty', 'Workers', 'Assets', 'Widgets']) cpSync(src + d, dst + d, { recursive: true });
  console.log('Cesium static assets → public/cesiumStatic');
}
