// Mars reference body and geodesy. Pure JS — shared by the browser app, the data generator and tests.
// CRS: IAU 2000 Mars (a = 3396.19 km, b = 3376.20 km), planetocentric latitude, east-positive longitude.
// NOTE: the oblate spheroid is used for distances; over the <10 km demo route the planetocentric /
// planetographic latitude difference changes distances by < 0.01 %, see ASSUMPTIONS.md.
export const MARS = { a: 3396190.0, b: 3376200.0 };
MARS.f = (MARS.a - MARS.b) / MARS.a;
MARS.e2 = 1 - (MARS.b * MARS.b) / (MARS.a * MARS.a);

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
export const toRad = rad;
export const toDeg = deg;
export const lon360 = (lon) => ((lon % 360) + 360) % 360;
export const lon180 = (lon) => { const l = lon360(lon); return l > 180 ? l - 360 : l; };

/** Vincenty inverse geodesic on the Mars spheroid. Returns { distance (m), bearing (deg, initial) }. */
export function geodesic(lat1, lon1, lat2, lon2) {
  const { a, b, f } = MARS;
  const L = rad(lon2 - lon1);
  const U1 = Math.atan((1 - f) * Math.tan(rad(lat1)));
  const U2 = Math.atan((1 - f) * Math.tan(rad(lat2)));
  const sU1 = Math.sin(U1), cU1 = Math.cos(U1), sU2 = Math.sin(U2), cU2 = Math.cos(U2);
  let lam = L, sinS = 0, cosS = 1, sig = 0, cos2A = 1, cos2Sm = 0, sinLam = 0, cosLam = 1;
  for (let i = 0; i < 200; i++) {
    sinLam = Math.sin(lam); cosLam = Math.cos(lam);
    sinS = Math.hypot(cU2 * sinLam, cU1 * sU2 - sU1 * cU2 * cosLam);
    if (sinS === 0) return { distance: 0, bearing: 0 };
    cosS = sU1 * sU2 + cU1 * cU2 * cosLam;
    sig = Math.atan2(sinS, cosS);
    const sinA = (cU1 * cU2 * sinLam) / sinS;
    cos2A = 1 - sinA * sinA;
    cos2Sm = cos2A === 0 ? 0 : cosS - (2 * sU1 * sU2) / cos2A;
    const C = (f / 16) * cos2A * (4 + f * (4 - 3 * cos2A));
    const prev = lam;
    lam = L + (1 - C) * f * sinA * (sig + C * sinS * (cos2Sm + C * cosS * (-1 + 2 * cos2Sm * cos2Sm)));
    if (Math.abs(lam - prev) < 1e-12) break;
  }
  const u2 = (cos2A * (a * a - b * b)) / (b * b);
  const A = 1 + (u2 / 16384) * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)));
  const B = (u2 / 1024) * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
  const dS = B * sinS * (cos2Sm + (B / 4) * (cosS * (-1 + 2 * cos2Sm * cos2Sm) -
    (B / 6) * cos2Sm * (-3 + 4 * sinS * sinS) * (-3 + 4 * cos2Sm * cos2Sm)));
  const distance = b * A * (sig - dS);
  const bearing = (deg(Math.atan2(cU2 * sinLam, cU1 * sU2 - sU1 * cU2 * cosLam)) + 360) % 360;
  return { distance, bearing };
}

/** Metres per degree of latitude / longitude at a latitude (spheroid radii of curvature). */
export function metresPerDegree(lat) {
  const s = Math.sin(rad(lat)), w = Math.sqrt(1 - MARS.e2 * s * s);
  const M = (MARS.a * (1 - MARS.e2)) / (w * w * w), N = MARS.a / w;
  return { lat: rad(1) * M, lon: rad(1) * N * Math.cos(rad(lat)) };
}

/** Offset a position by local east/north metres (valid for offsets ≪ planet radius). */
export function offset(lat, lon, east, north) {
  const m = metresPerDegree(lat);
  return { lat: lat + north / m.lat, lon: lon + east / m.lon };
}

/** Local east/north metres of point 2 relative to point 1. */
export function localEN(lat1, lon1, lat2, lon2) {
  const m = metresPerDegree(lat1);
  return { e: (lon2 - lon1) * m.lon, n: (lat2 - lat1) * m.lat };
}

/** Pre-computed route geometry: cumulative geodesic distances and lookup by distance. */
export function buildTrack(points /* [{lat, lon, elev?}] */) {
  const cum = [0], brg = [];
  for (let i = 1; i < points.length; i++) {
    const g = geodesic(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon);
    cum.push(cum[i - 1] + g.distance); brg.push(g.bearing);
  }
  const total = cum[cum.length - 1];
  function at(s) {
    s = Math.max(0, Math.min(total, s));
    let i = 0; while (i < cum.length - 2 && cum[i + 1] < s) i++;
    const seg = cum[i + 1] - cum[i], k = seg ? (s - cum[i]) / seg : 0;
    const p = points[i], q = points[i + 1];
    return {
      lat: p.lat + (q.lat - p.lat) * k, lon: p.lon + (q.lon - p.lon) * k,
      elev: p.elev != null && q.elev != null ? p.elev + (q.elev - p.elev) * k : null,
      heading: brg[i], seg: i, slopeDeg: p.elev != null && q.elev != null && seg ? deg(Math.atan((q.elev - p.elev) / seg)) : 0,
    };
  }
  return { points, cum, total, at };
}

/** Deterministic PRNG (mulberry32) + Gaussian. */
export function rng(seed) {
  let a = seed >>> 0;
  const u = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const gauss = () => { let x = 0; while (x === 0) x = u(); return Math.sqrt(-2 * Math.log(x)) * Math.cos(2 * Math.PI * u()); };
  return { u, gauss };
}

/** 30 cm is interpreted as the 95 % horizontal error radius → per-axis σ = r95 / sqrt(-2 ln 0.05). */
export const LOC_R95_M = 0.30;
export const LOC_SIGMA_M = LOC_R95_M / Math.sqrt(-2 * Math.log(0.05)); // 0.1226 m
