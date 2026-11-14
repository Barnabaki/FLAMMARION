// USGS Mars Chart (MC) 1:5,000,000 quadrangle series — MC-01 … MC-30.
// Boundaries are the official latitude/longitude limits of each chart (USGS Astrogeology), expressed in the
// app CRS (planetocentric latitude, east-positive longitude 0–360°E). They are NOT an invented grid:
// polar caps 65–90°, mid-latitude bands 30–65° in 60° sheets, equatorial bands 0–30° in 45° sheets.
const band = (first, names, south, north, width, west0) => names.map((name, i) => ({
  id: `MC-${String(first + i).padStart(2, '0')}`, name, south, north,
  west: (west0 + i * width) % 360, east: ((west0 + (i + 1) * width - 1e-9) % 360) + 1e-9,
}));
export const QUADRANGLES = [
  { id: 'MC-01', name: 'Mare Boreum', south: 65, north: 90, west: 0, east: 360 },
  ...band(2, ['Diacria', 'Arcadia', 'Mare Acidalium', 'Ismenius Lacus', 'Casius', 'Cebrenia'], 30, 65, 60, 180),
  ...band(8, ['Amazonis', 'Tharsis', 'Lunae Palus', 'Oxia Palus', 'Arabia', 'Syrtis Major', 'Amenthes', 'Elysium'], 0, 30, 45, 180),
  ...band(16, ['Memnonia', 'Phoenicis Lacus', 'Coprates', 'Margaritifer Sinus', 'Sinus Sabaeus', 'Iapygia', 'Mare Tyrrhenum', 'Aeolis'], -30, 0, 45, 180),
  ...band(24, ['Phaethontis', 'Thaumasia', 'Argyre', 'Noachis', 'Hellas', 'Eridania'], -65, -30, 60, 180),
  { id: 'MC-30', name: 'Mare Australe', south: -90, north: -65, west: 0, east: 360 },
].map((q) => ({ ...q, west: Math.round(q.west), east: Math.round(q.east) || 360 }));

/** 1:2,000,000 quadrant subdivision of a quadrangle (NW / NE / SW / SE). */
export function quadrants(q) {
  const midLat = (q.south + q.north) / 2, midLon = (q.west + q.east) / 2;
  return [
    { id: `${q.id} NW`, key: 'NW', south: midLat, north: q.north, west: q.west, east: midLon },
    { id: `${q.id} NE`, key: 'NE', south: midLat, north: q.north, west: midLon, east: q.east },
    { id: `${q.id} SW`, key: 'SW', south: q.south, north: midLat, west: q.west, east: midLon },
    { id: `${q.id} SE`, key: 'SE', south: q.south, north: midLat, west: midLon, east: q.east },
  ].map((s) => ({ ...s, name: `${q.name} ${s.key}`, parent: q.id }));
}

export const contains = (q, lat, lon) => {
  const l = ((lon % 360) + 360) % 360;
  return lat >= q.south && lat <= q.north && l >= q.west && l <= q.east;
};
export const findQuadrangle = (lat, lon) => QUADRANGLES.find((q) => contains(q, lat, lon));
export const centre = (q) => ({ lat: Math.abs(q.north) === 90 || Math.abs(q.south) === 90 ? (q.north > 0 ? 78 : -78) : (q.south + q.north) / 2, lon: (q.west + q.east) / 2 });

// IAU-approved named features inside MC-13 NE, from the IAU/USGS Gazetteer of Planetary Nomenclature
// (retrieved via the NASA Mars Trek nomenclature index, 2026-11-14). Planetocentric, east-positive.
export const JEZERO = { name: 'Jezero', type: 'Crater', lat: 18.4082, lon: 77.6873, diameterKm: 47.5 };
export const FEATURES_MC13_NE = [
  JEZERO,
  { name: 'Nili Fossae', type: 'Fossae', lat: 22.0182, lon: 76.6948 },
  { name: 'Hargraves', type: 'Crater', lat: 20.7371, lon: 75.7436 },
  { name: 'Koshoba', type: 'Crater', lat: 22.9271, lon: 77.0034 },
  { name: 'Toro', type: 'Crater', lat: 17.0354, lon: 71.8151 },
  { name: 'Arena Colles', type: 'Colles', lat: 24.6276, lon: 82.9305 },
  { name: 'Peridier', type: 'Crater', lat: 25.5101, lon: 83.9134 },
];
