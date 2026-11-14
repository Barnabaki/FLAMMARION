"""Aggregate MEDA 1-2 Hz rows into hourly LTST bins (real recorded values, mean per bin).

Outputs weather_historic.json — one record per (sol, LTST hour) with provenance.
Air temp  = mean of ATS_LOCAL_TEMP1..3 (RSM mast sensors, ~1.45 m), K -> degC
Ground    = CAL_TIRS GROUND_TEMP (K -> degC)
Pressure  = DER_PS PRESSURE (Pa)
Wind      = DER_WS HORIZONTAL_WIND_SPEED (m/s); 999999999 = no valid retrieval
UV        = CAL_RDS RDS_TOP_3 (250-400 nm photodiode, W/m2 integrated over FOV)
"""
import sys, json, glob, os
import pandas as pd, numpy as np

MISSING = 999999999

def load(path, cols):
    df = pd.read_csv(path, usecols=["LTST"] + cols, low_memory=False)
    df = df.replace(MISSING, np.nan)
    # LTST like "0050 13:05:21" -> sol, hour (rows before local midnight belong to prev sol)
    parts = df["LTST"].str.strip().str.split(" ", expand=True)
    df["ltst_sol"] = parts[0].astype(int)
    df["hour"] = parts[1].str.slice(0, 2).astype(int)
    for c in cols: df[c] = pd.to_numeric(df[c], errors="coerce")
    return df

def agg(df, col, how="mean"):
    g = df.groupby(["ltst_sol", "hour"])[col]
    return pd.DataFrame({col: g.mean(), col + "_n": g.count()})

def main(dldir, out):
    man = json.load(open(os.path.join(dldir, "manifest.json")))
    byfile = {(m["sol"], m["product"]): m for m in man}
    records = []
    for sol in sorted({m["sol"] for m in man}):
        f = lambda k: byfile.get((sol, k))
        parts, ids = [], {}
        if f("CAL_ATS"):
            d = load(f("CAL_ATS")["path"], ["ATS_LOCAL_TEMP1", "ATS_LOCAL_TEMP2", "ATS_LOCAL_TEMP3"])
            d["air_k"] = d[["ATS_LOCAL_TEMP1", "ATS_LOCAL_TEMP2", "ATS_LOCAL_TEMP3"]].mean(axis=1)
            parts.append(agg(d, "air_k")); ids["air"] = os.path.basename(f("CAL_ATS")["path"])
        if f("CAL_TIRS"):
            d = load(f("CAL_TIRS")["path"], ["GROUND_TEMP"]); parts.append(agg(d, "GROUND_TEMP"))
            ids["ground"] = os.path.basename(f("CAL_TIRS")["path"])
        if f("DER_PS"):
            d = load(f("DER_PS")["path"], ["PRESSURE"]); parts.append(agg(d, "PRESSURE"))
            ids["pressure"] = os.path.basename(f("DER_PS")["path"])
        if f("DER_WS"):
            d = load(f("DER_WS")["path"], ["HORIZONTAL_WIND_SPEED"]); parts.append(agg(d, "HORIZONTAL_WIND_SPEED"))
            ids["wind"] = os.path.basename(f("DER_WS")["path"])
        if f("CAL_RDS"):
            d = load(f("CAL_RDS")["path"], ["RDS_TOP_3"]); parts.append(agg(d, "RDS_TOP_3"))
            ids["uv"] = os.path.basename(f("CAL_RDS")["path"])
        t = pd.concat(parts, axis=1).reset_index()
        t = t[t["ltst_sol"] == sol]  # keep only rows in this sol's local day
        r2 = lambda v, n=2: None if pd.isna(v) else round(float(v), n)
        for _, row in t.iterrows():
            records.append({
                "source_instrument": "MEDA (Mars 2020 Perseverance)",
                "source_dataset_id": ids,
                "pds_bundle": "urn:nasa:pds:mars2020_meda",
                "provenance_tag": "HISTORIC",
                "site": "Jezero Crater",
                "sol": int(sol),
                "ltst": f"{int(row['hour']):02d}:00:00",
                "ltst_bin": f"{int(row['hour']):02d}:00-{int(row['hour']):02d}:59 (hourly mean)",
                "ambient_temp_k": r2(row.get("air_k")),
                "ambient_temp_c": r2(row.get("air_k") - 273.15) if pd.notna(row.get("air_k")) else None,
                "ground_temp_c": r2(row.get("GROUND_TEMP") - 273.15) if pd.notna(row.get("GROUND_TEMP")) else None,
                "pressure_pa": r2(row.get("PRESSURE")),
                "wind_speed_ms": r2(row.get("HORIZONTAL_WIND_SPEED")),
                "uv_250_400nm_wm2": r2(row.get("RDS_TOP_3"), 4),
                "n_samples": {k: int(row[k]) for k in row.index if str(k).endswith("_n") and pd.notna(row[k])},
            })
    json.dump(records, open(out, "w"), indent=1)
    df = pd.DataFrame(records)
    cov = df.groupby("sol").agg(hours=("ltst", "count"),
                                temp_h=("ambient_temp_c", "count"),
                                ground_h=("ground_temp_c", "count"),
                                p_h=("pressure_pa", "count"),
                                wind_h=("wind_speed_ms", "count"),
                                tmin=("ambient_temp_c", "min"), tmax=("ambient_temp_c", "max"))
    print(cov.to_string())

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
