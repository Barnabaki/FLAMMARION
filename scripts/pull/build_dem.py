"""Build Jezero DEM deliverables.

Primary source : JPL/USGS Mars 2020 Science Investigation CTX DEM mosaic, 20 m
                 (urn:nasa:pds:mars2020_ctx_basemap_2021:data:m20_ctxdem_mosaic)
Cross-check    : USGS HRSC-MOLA Blended DEM Global 200 m v2 (windowed HTTP range read, no full download)

Outputs (per bbox): GeoTIFF in Mars 2000 sphere geographic coords, 512x512 grid JSON, 16-bit PNG heightmap.
"""
import json, os, sys
import numpy as np, rasterio
from rasterio.warp import reproject, Resampling, transform as warp_tx
from rasterio.transform import from_bounds
from rasterio.windows import from_bounds as win_from_bounds
from PIL import Image

CTX_LOCAL = sys.argv[1]
OUT = sys.argv[2]
CTX_ID = "M20_JezeroCrater_CTXDEM_20m.tif"
CTX_URL = "https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/mars2020_trn/CTX/ScienceInvestigationMaps_JPL/" + CTX_ID
HRSC_ID = "Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif"
HRSC_URL = "https://planetarymaps.usgs.gov/mosaic/Mars/HRSC_MOLA_Blend/" + HRSC_ID
HRSC_VSI = "/vsicurl/https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars/HRSC_MOLA_Blend/" + HRSC_ID

BBOXES = {  # (west, south, east, north) deg, planetocentric, east-positive
    "requested": (77.25, 18.15, 77.95, 18.65),
    "fullcrater": (77.10, 17.95, 78.05, 18.85),
}
LANDING = ("Octavia E. Butler landing site", 18.4447, 77.4508)
GRID_N = 512
RES_DEG = 20.0 / (3396190 * np.pi / 180)  # ~20 m in latitude

def geo_crs():
    with rasterio.open(HRSC_VSI) as d:
        return d.crs  # GCS_Mars_2000_Sphere (R = 3,396,190 m)

def warp_ctx(bbox, crs, out_shape, resampling):
    w, s, e, n = bbox
    dst = np.full(out_shape, np.nan, np.float32)
    with rasterio.open(CTX_LOCAL) as src:
        reproject(rasterio.band(src, 1), dst, src_nodata=src.nodata, dst_nodata=np.nan,
                  dst_transform=from_bounds(w, s, e, n, out_shape[1], out_shape[0]), dst_crs=crs,
                  resampling=resampling)
    return dst

def sample_ctx(lat, lon):
    with rasterio.open(CTX_LOCAL) as src:
        xs, ys = warp_tx(geo_crs_cached, src.crs, [lon], [lat])
        v = next(src.sample([(xs[0], ys[0])]))[0]
        return float(v)

def sample_hrsc(lat, lon):
    with rasterio.open(HRSC_VSI) as d:
        return float(next(d.sample([(lon, lat)]))[0])

def main():
    global geo_crs_cached
    os.makedirs(OUT, exist_ok=True)
    crs = geo_crs_cached = geo_crs()
    report = {}
    for name, bbox in BBOXES.items():
        w, s, e, n = bbox
        # full-res geographic GeoTIFF
        H = int(round((n - s) / RES_DEG)); W = int(round((e - w) / RES_DEG))
        full = warp_ctx(bbox, crs, (H, W), Resampling.bilinear)
        tif = os.path.join(OUT, f"jezero_dem_clipped_{name}.tif")
        with rasterio.open(tif, "w", driver="GTiff", height=H, width=W, count=1, dtype="float32",
                           crs=crs, transform=from_bounds(w, s, e, n, W, H), nodata=np.nan,
                           compress="deflate", predictor=3, tiled=True) as d:
            d.write(full, 1)
            d.update_tags(provenance_tag="HISTORIC_ORBITAL_DEM", source_product=CTX_ID, source_url=CTX_URL,
                          units="m relative to Mars datum of source DEM")
        # 512x512 mesh grid (area-average from 20 m source)
        g = warp_ctx(bbox, crs, (GRID_N, GRID_N), Resampling.average)
        # HRSC-MOLA cross-check over same bbox (windowed range read)
        with rasterio.open(HRSC_VSI) as d:
            win = win_from_bounds(w, s, e, n, d.transform).round_offsets().round_lengths()
            h = d.read(1, window=win).astype(np.float32); h[h == d.nodata] = np.nan
        valid = np.isfinite(g)
        gmin, gmax = float(np.nanmin(g)), float(np.nanmax(g))
        lat_c = (s + n) / 2
        cell_lat_m = (n - s) / GRID_N * np.pi / 180 * 3396190
        cell_lon_m = (e - w) / GRID_N * np.pi / 180 * 3396190 * np.cos(np.radians(lat_c))
        grid = {
            "provenance_tag": "HISTORIC_ORBITAL_DEM",
            "source_product": CTX_ID,
            "source_pds_lid": "urn:nasa:pds:mars2020_ctx_basemap_2021:data:m20_ctxdem_mosaic",
            "source_url": CTX_URL,
            "source_reference": "Mangold et al. 2021, Science, doi:10.1126/science.abl4051",
            "crs": "Mars 2000 sphere (R=3396190 m), planetocentric lat, east-positive lon",
            "units": "meters",
            "bbox": {"west_lon": w, "south_lat": s, "east_lon": e, "north_lat": n},
            "width": GRID_N, "height": GRID_N,
            "row_order": "north_to_south", "col_order": "west_to_east",
            "cell_center_convention": "value[r][c] at lat = north - (r+0.5)*dlat, lon = west + (c+0.5)*dlon",
            "cell_size_m": {"lon": round(cell_lon_m, 2), "lat": round(cell_lat_m, 2)},
            "resampling": "area average from 20 m source",
            "min_elev_m": round(gmin, 2), "max_elev_m": round(gmax, 2),
            "nodata_cells": int((~valid).sum()),
            "elevations": [[None if not np.isfinite(v) else round(float(v), 1) for v in row] for row in g],
        }
        json.dump(grid, open(os.path.join(OUT, f"jezero_elevation_grid_{name}.json"), "w"))
        norm = np.where(valid, (g - gmin) / (gmax - gmin), 0)
        Image.fromarray((norm * 65535).astype(np.uint16)).save(os.path.join(OUT, f"jezero_heightmap_{name}.png"))
        report[name] = {
            "bbox": bbox, "tif_shape": [H, W],
            "ctx20m_full_min": round(float(np.nanmin(full)), 1), "ctx20m_full_max": round(float(np.nanmax(full)), 1),
            "grid512_min": round(gmin, 1), "grid512_max": round(gmax, 1), "grid512_std": round(float(np.nanstd(g)), 1),
            "grid512_p02_p98": [round(float(x), 1) for x in np.nanpercentile(g, [2, 98])],
            "hrsc200m_min": round(float(np.nanmin(h)), 1), "hrsc200m_max": round(float(np.nanmax(h)), 1),
            "nodata_frac_full": round(float(np.isnan(full).mean()), 4),
        }
    nm, lat, lon = LANDING
    report["landing_site_check"] = {"name": nm, "lat": lat, "lon": lon,
                                    "ctx20m_m": round(sample_ctx(lat, lon), 1),
                                    "hrsc_mola200m_m": round(sample_hrsc(lat, lon), 1)}
    json.dump(report, open(os.path.join(OUT, "dem_report.json"), "w"), indent=1)
    print(json.dumps(report, indent=1))

if __name__ == "__main__":
    main()
