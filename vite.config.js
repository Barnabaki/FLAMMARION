import { defineConfig } from 'vite';

// Cesium's static assets are copied to public/cesiumStatic by scripts/copy-cesium.mjs (npm postinstall).
export default defineConfig({
  base: './',
  define: { CESIUM_BASE_URL: JSON.stringify('cesiumStatic') },
  build: { chunkSizeWarningLimit: 8000 },
});
