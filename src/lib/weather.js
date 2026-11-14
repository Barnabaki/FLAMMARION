// Jezero diurnal weather for the mission season.
//
// HISTORIC channels — air temperature, ground temperature, pressure, wind speed, UV — are real Perseverance/MEDA
// measurements from NASA PDS (sols 44–51, Ls ≈ 26–30°, MY 36), averaged per local-true-solar-time hour
// (weatherTable.js, generated from data/source/weather/weather_historic.json). They are replayed by local time and
// are never presented as live. Wind retrievals are sparse at night (1–3 sols per hour bin; see wind_ms_n_sols).
//
// MODELLED channels — wind direction, relative humidity, dust optical depth, vortex rate, total solar flux — were
// not part of the data pull; they are a parametric model shaped to ranges published from MEDA
// (Rodriguez-Manfredi et al. 2023, Nat. Geosci. 16, 19–28; Newman et al. 2022, Sci. Adv. 8, eabn3783).
import { MEDA_TABLE, REMS_TABLE } from './weatherTable.js';

export { REMS_TABLE };
export const SOL_TABLE = {
  site: MEDA_TABLE.site, instrument: MEDA_TABLE.instrument, pds: MEDA_TABLE.pds, sols: MEDA_TABLE.sols, ls: 28, ls_range: [26, 30], marsYear: 36,
  time_axis: 'LTST hour bins [h, h+1), value placed at h + 0.5',
  provenance: { air_temp_c: 'HISTORIC', ground_temp_c: 'HISTORIC', pressure_pa: 'HISTORIC', wind_ms: 'HISTORIC', uv_wm2: 'HISTORIC',
    wind_dir_deg: 'MODELLED', rh_pct: 'MODELLED', vortex_per_h: 'MODELLED', tau: 'MODELLED', solar_flux_wm2: 'MODELLED' },
  hours: [...Array(24).keys()],
  air_temp_c: MEDA_TABLE.air_temp_c, ground_temp_c: MEDA_TABLE.ground_temp_c, pressure_pa: MEDA_TABLE.pressure_pa, wind_ms: MEDA_TABLE.wind_ms, uv_wm2: MEDA_TABLE.uv_wm2,
  wind_ms_n_sols: MEDA_TABLE.wind_ms_n_sols,
  wind_dir_deg:  [290, 290, 285, 285, 280, 280, 270, 200, 130, 115, 110, 105, 105, 110, 110, 115, 120, 140, 220, 270, 285, 290, 290, 290],
  rh_pct:        [14, 16, 18, 20, 21, 22, 20, 8, 2, 0.6, 0.3, 0.2, 0.1, 0.1, 0.1, 0.1, 0.2, 0.4, 1.5, 4, 7, 9, 11, 13],
  vortex_per_h:  [0, 0, 0, 0, 0, 0, 0, 0, 0.05, 0.2, 0.5, 0.9, 1.3, 1.3, 1.0, 0.6, 0.25, 0.05, 0, 0, 0, 0, 0, 0],
  tau: 0.45,
};

const lerpArr = (arr, h) => {
  const x = (((h - 0.5) % 24) + 24) % 24, i = Math.floor(x), k = x - i; // bin means sit at the bin centre
  return arr[i] + (arr[(i + 1) % 24] - arr[i]) * k;
};
const lerpDir = (arr, h) => {
  const x = (((h - 0.5) % 24) + 24) % 24, i = Math.floor(x), k = x - i;
  const d = ((arr[(i + 1) % 24] - arr[i] + 540) % 360) - 180;
  return (arr[i] + d * k + 360) % 360;
};

/** Conditions at a local TRUE solar time (hours). sunElevDeg comes from marsTime(). */
export function weatherAt(table, ltst, sunElevDeg) {
  const mu = Math.max(0, Math.sin((sunElevDeg * Math.PI) / 180));
  return {
    air_temp_c: lerpArr(table.air_temp_c, ltst), ground_temp_c: lerpArr(table.ground_temp_c, ltst), pressure_pa: lerpArr(table.pressure_pa, ltst),
    wind_ms: lerpArr(table.wind_ms, ltst), uv_wm2: Math.max(0, lerpArr(table.uv_wm2, ltst)),
    wind_dir_deg: lerpDir(table.wind_dir_deg, ltst), rh_pct: lerpArr(table.rh_pct, ltst), vortex_per_h: lerpArr(table.vortex_per_h, ltst), tau: table.tau,
    solar_flux_wm2: mu > 0 ? 500 * mu * Math.exp((-0.25 * table.tau) / Math.max(mu, 0.08)) : 0,
  };
}
/** Curiosity/REMS (Gale) reference values for the same local hour — supplementary only. */
export function remsAt(ltst) {
  const o = {}; for (const k of ['air_temp_c', 'ground_temp_c', 'pressure_pa', 'wind_ms']) o[k] = REMS_TABLE[k][Math.floor(((ltst % 24) + 24) % 24)];
  return o;
}
