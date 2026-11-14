import json, os, glob, sys
import numpy as np, rasterio
O = sys.argv[1]
w = json.load(open(f"{O}/weather_historic.json"))
assert all(r["provenance_tag"] == "HISTORIC" for r in w)
assert all(r["source_dataset_id"] for r in w)
meda = [r for r in w if r["source_instrument"].startswith("MEDA")]; rems = [r for r in w if r["source_instrument"].startswith("REMS")]
print(f"weather records: {len(w)}  (MEDA/Jezero {len(meda)}, REMS/Gale {len(rems)})")
for r in [x for x in meda if x["sol"] == 45 and x["ltst"] in ("05:00:00", "14:00:00")] + [rems[14]]:
    print(json.dumps({k: r[k] for k in ("source_instrument","source_dataset_id","provenance_tag","site","sol","ltst","ambient_temp_c","ground_temp_c","pressure_pa","wind_speed_ms","uv_250_400nm_wm2")}))
for f in sorted(glob.glob(f"{O}/jezero_dem_clipped_*.tif")):
    with rasterio.open(f) as d:
        a = d.read(1); print(os.path.basename(f), d.crs.to_wkt()[:60], d.shape, "min", round(float(np.nanmin(a)),1), "max", round(float(np.nanmax(a)),1), "std", round(float(np.nanstd(a)),1), "flat?", bool(np.nanstd(a) < 1))
for f in sorted(glob.glob(f"{O}/jezero_elevation_grid_*.json")):
    g = json.load(open(f)); a = np.array(g["elevations"], float)
    print(os.path.basename(f), a.shape, g["min_elev_m"], g["max_elev_m"], g["provenance_tag"], g["source_product"])
