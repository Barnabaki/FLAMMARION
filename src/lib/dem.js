// Elevation lookup on the native 20 m crop of the Mars 2020 CTX DEM mosaic around the route (see demRoute.js).
// Provenance: SATELLITE (orbital stereo DEM). Elevations are relative to the source DEM's datum (MOLA areoid).
import { DEM_ROUTE as D } from './demRoute.js';

const dLon = (D.east - D.west) / D.width, dLat = (D.north - D.south) / D.height;
/** Bilinear elevation in metres at (lat, lon); null outside the crop. */
export function elevAt(lat, lon) {
  const x = (lon - D.west) / dLon - 0.5, y = (D.north - lat) / dLat - 0.5; // cell-centre coordinates
  if (x < 0 || y < 0 || x > D.width - 1 || y > D.height - 1) return null;
  const c = Math.min(D.width - 2, Math.floor(x)), r = Math.min(D.height - 2, Math.floor(y)), fx = x - c, fy = y - r, i = r * D.width + c;
  return ((D.data[i] * (1 - fx) + D.data[i + 1] * fx) * (1 - fy) + (D.data[i + D.width] * (1 - fx) + D.data[i + D.width + 1] * fx) * fy) / 10;
}
export const DEM_INFO = { product: D.source_product, lid: D.source_pds_lid, cell_m: D.cell_m, datum: D.vertical_datum };
