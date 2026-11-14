// Jezero diurnal climatology for northern spring (Ls ≈ 45°, MY 36 — Perseverance sols ~80–90).
//
// PROVENANCE: MODELLED. The hourly table below is a parametric reconstruction of the diurnal cycle
// consistent with the ranges PUBLISHED from Perseverance/MEDA measurements (Rodriguez-Manfredi et al. 2023,
// Nat. Geosci. 16, 19–28; Newman et al. 2022, Sci. Adv. 8, eabn3783; Munguira et al. 2023, JGR Planets 128).
// It is NOT a copy of PDS records: the MEDA PDS archive could not be reached from the build environment.
// Replace public/data/weather_sol.json with real MEDA hourly means and set "provenance": "HISTORIC"
// (schema in DATA_SOURCES.md) — the UI badges follow the file.
export const SOL_TABLE = {
  site: 'Jezero crater (Perseverance / MEDA site)', ls: 45, marsYear: 36, provenance: 'MODELLED',
  hours: [...Array(24).keys()],
  air_temp_c:    [-76, -78, -79.5, -81, -82, -83, -82, -74, -62, -50, -40, -32, -27, -24, -23, -25, -30, -39, -52, -61, -66, -70, -72.5, -74.5],
  ground_temp_c: [-82, -84, -86, -87.5, -89, -90, -88, -70, -48, -30, -18, -11, -8, -8, -13, -22, -35, -52, -65, -71, -75, -78, -80, -81],
  wind_ms:       [2.2, 2.4, 2.5, 2.4, 2.2, 2.0, 1.8, 2.0, 2.8, 3.8, 4.8, 5.8, 6.6, 7.0, 7.0, 6.4, 5.4, 4.2, 3.2, 2.8, 2.6, 2.4, 2.3, 2.2],
  wind_dir_deg:  [290, 290, 285, 285, 280, 280, 270, 200, 130, 115, 110, 105, 105, 110, 110, 115, 120, 140, 220, 270, 285, 290, 290, 290],
  rh_pct:        [14, 16, 18, 20, 21, 22, 20, 8, 2, 0.6, 0.3, 0.2, 0.1, 0.1, 0.1, 0.1, 0.2, 0.4, 1.5, 4, 7, 9, 11, 13],
  vortex_per_h:  [0, 0, 0, 0, 0, 0, 0, 0, 0.05, 0.2, 0.5, 0.9, 1.3, 1.3, 1.0, 0.6, 0.25, 0.05, 0, 0, 0, 0, 0, 0],
  tau: 0.45,
};

const lerpArr = (arr, h) => {
  const x = ((h % 24) + 24) % 24, i = Math.floor(x), k = x - i;
  return arr[i] + (arr[(i + 1) % 24] - arr[i]) * k;
};
const lerpDir = (arr, h) => {
  const x = ((h % 24) + 24) % 24, i = Math.floor(x), k = x - i;
  const d = ((arr[(i + 1) % 24] - arr[i] + 540) % 360) - 180;
  return (arr[i] + d * k + 360) % 360;
};

/** Climatological conditions at a local mean solar time (hours). sunElevDeg comes from marsTime(). */
export function weatherAt(table, lmst, sunElevDeg) {
  const mu = Math.max(0, Math.sin((sunElevDeg * Math.PI) / 180));
  return {
    air_temp_c: lerpArr(table.air_temp_c, lmst),
    ground_temp_c: lerpArr(table.ground_temp_c, lmst),
    pressure_pa: 752 + 9 * Math.cos((2 * Math.PI * (lmst - 8)) / 24) + 4 * Math.cos((4 * Math.PI * (lmst - 8.5)) / 24),
    wind_ms: lerpArr(table.wind_ms, lmst),
    wind_dir_deg: lerpDir(table.wind_dir_deg, lmst),
    rh_pct: lerpArr(table.rh_pct, lmst),
    vortex_per_h: lerpArr(table.vortex_per_h, lmst),
    tau: table.tau,
    // Downwelling surface flux: top-of-atmosphere ~500 W/m² at this season (1.62 AU), simple direct+diffuse dust attenuation.
    solar_flux_wm2: mu > 0 ? 500 * mu * Math.exp((-0.25 * table.tau) / Math.max(mu, 0.08)) : 0,
  };
}
