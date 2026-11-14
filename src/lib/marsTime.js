// Mars24 algorithm — Allison & McEwen (2000), with the published Mars24 updates.
// https://www.giss.nasa.gov/tools/mars24/help/algorithm.html   Provenance: COMPUTED.
const rad = (d) => (d * Math.PI) / 180;
const LEAP = [ // [UTC ms from which it applies, TT-UTC seconds]
  [Date.UTC(2017, 0, 1), 69.184], [Date.UTC(2015, 6, 1), 68.184], [Date.UTC(2012, 6, 1), 67.184],
  [Date.UTC(2009, 0, 1), 66.184], [Date.UTC(2006, 0, 1), 65.184], [Date.UTC(1999, 0, 1), 64.184],
];
const ttMinusUtc = (ms) => (LEAP.find((l) => ms >= l[0]) || LEAP[LEAP.length - 1])[1];
const PBS = [[0.0071, 2.2353, 49.409], [0.0057, 2.7543, 168.173], [0.0039, 1.1177, 191.837],
  [0.0037, 15.7866, 21.736], [0.0021, 2.1354, 15.704], [0.0020, 2.4694, 95.528], [0.0018, 32.8493, 49.095]];
const mod = (x, n) => ((x % n) + n) % n;

/** @param {number} ms UTC epoch milliseconds  @param {number} lonE east longitude, degrees */
export function marsTime(ms, lonE = 0, latN = 0) {
  const jdUT = 2440587.5 + ms / 86400000;
  const jdTT = jdUT + ttMinusUtc(ms) / 86400;
  const dt = jdTT - 2451545.0;
  const M = 19.3871 + 0.52402073 * dt;
  const aFMS = 270.3871 + 0.524038496 * dt;
  let pbs = 0; for (const [A, tau, phi] of PBS) pbs += A * Math.cos(rad((0.985626 * dt) / tau + phi));
  const Mr = rad(M);
  const nuM = (10.691 + 3.0e-7 * dt) * Math.sin(Mr) + 0.623 * Math.sin(2 * Mr) + 0.050 * Math.sin(3 * Mr) +
    0.005 * Math.sin(4 * Mr) + 0.0005 * Math.sin(5 * Mr) + pbs;
  const ls = mod(aFMS + nuM, 360);
  const eotDeg = 2.861 * Math.sin(rad(2 * ls)) - 0.071 * Math.sin(rad(4 * ls)) + 0.002 * Math.sin(rad(6 * ls)) - nuM;
  const msd = (dt - 4.5) / 1.0274912517 + 44796.0 - 0.0009626;
  const mtc = mod(24 * msd, 24);
  const lmst = mod(mtc + lonE / 15, 24);
  const ltst = mod(lmst + eotDeg / 15, 24);
  // Sun elevation at the site (planetographic subtleties ignored; < 0.3° effect).
  const decl = Math.asin(Math.sin(rad(25.19)) * Math.sin(rad(ls)));
  const h = rad(15 * (ltst - 12));
  const sinEl = Math.sin(rad(latN)) * Math.sin(decl) + Math.cos(rad(latN)) * Math.cos(decl) * Math.cos(h);
  // Mars Year (Clancy et al. convention: MY 1 starts 1955-04-11, Ls = 0).  MY 36 began 2021-02-07.
  const MSD_MY36 = 52293.39; // MSD of Ls = 0, MY 36 (COMPUTED with this same algorithm, ±0.1 sol)
  const my = 36 + Math.floor((msd - MSD_MY36) / 668.5921);
  return { msd, mtc, lmst, ltst, ls, eotDeg, sunElevDeg: (Math.asin(sinEl) * 180) / Math.PI, marsYear: my };
}

export function hms(hours, withSeconds = true) {
  const t = Math.round(mod(hours, 24) * 3600) % 86400;
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(t / 3600))}:${p(Math.floor(t / 60) % 60)}${withSeconds ? ':' + p(t % 60) : ''}`;
}
