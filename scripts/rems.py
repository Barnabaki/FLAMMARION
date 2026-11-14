"""Fetch Curiosity REMS MODRDR (RMD) tables and aggregate to hourly LTST bins.
Site is GALE CRATER (Curiosity), not Jezero — tagged accordingly.
Usage: rems.py <dldir> <ca_bundle> <out.json> sol [sol...]
"""
import os, re, sys, json, requests
import pandas as pd, numpy as np

ROOT = "https://atmos.nmsu.edu/PDS/data/mslrem_1001"
COLS = ["TIMESTAMP","LMST","LTST","HORIZONTAL_WIND_SPEED","VERTICAL_WIND_SPEED","WIND_DIRECTION",
 "WS_CONFIDENCE_LEVEL","BRIGHTNESS_TEMP","BT_LT_UNC","BT_ST_UNC","GTS_CONFIDENCE_LEVEL",
 "BOOM1_LOCAL_AIR_TEMP","ATS_BOOM1_CL","BOOM2_LOCAL_AIR_TEMP","ATS_BOOM2_CL","AMBIENT_TEMP",
 "AMBIENT_TEMP_CL","UV_A","UV_B","UV_C","UV_ABC","UV_D","UV_E","UVA_U","UVB_U","UVC_U","UVABC_U",
 "UVD_U","UVE_U","UVS_CL","RH","HS_TEMP","RH_U","VMR","VMR_U","HS_CL","PS_CONFIGURATION",
 "PRESSURE","PRESSURE_UNCERTAINTY","PS_CONFIDENCE_LEVEL"]

def main(dldir, ca, out, sols):
    s = requests.Session(); s.trust_env = False; s.verify = ca
    s.proxies = {"https": os.environ["HTTPS_PROXY"]}
    top = s.get(ROOT + "/DATA/", timeout=60).text
    ranges = [(int(a), int(b)) for a, b in re.findall(r'SOL_(\d{5})_(\d{5})/', top)]
    recs, manifest = [], []
    for sol in sols:
        a, b = next(r for r in ranges if r[0] <= sol <= r[1])
        url = f"{ROOT}/DATA/SOL_{a:05d}_{b:05d}/SOL{sol:05d}/"
        names = sorted(set(re.findall(r'href="(RME_\w+RMD\w+\.TAB)"', s.get(url, timeout=60).text)))
        name = names[-1]
        dst = os.path.join(dldir, name)
        if not os.path.exists(dst):
            r = s.get(url + name, timeout=300); r.raise_for_status(); open(dst, "wb").write(r.content)
        manifest.append({"sol": sol, "url": url + name, "bytes": os.path.getsize(dst)})
        df = pd.read_csv(dst, header=None, names=COLS, skipinitialspace=True, low_memory=False)
        for c in ["HORIZONTAL_WIND_SPEED","BRIGHTNESS_TEMP","AMBIENT_TEMP","PRESSURE"]:
            df[c] = pd.to_numeric(df[c], errors="coerce").where(lambda v: v > -900)
        p = df["LTST"].str.strip().str.split(" ", expand=True)
        df["lsol"] = p[0].astype(int); df["hour"] = p[1].str.slice(0, 2).astype(int)
        g = df[df["lsol"] == sol].groupby("hour")
        t = g[["AMBIENT_TEMP","BRIGHTNESS_TEMP","PRESSURE","HORIZONTAL_WIND_SPEED"]].mean()
        n = g[["AMBIENT_TEMP","BRIGHTNESS_TEMP","PRESSURE","HORIZONTAL_WIND_SPEED"]].count()
        r2 = lambda v: None if pd.isna(v) else round(float(v), 2)
        for h, row in t.iterrows():
            recs.append({
                "source_instrument": "REMS (MSL Curiosity)",
                "source_dataset_id": name,
                "pds_volume": "MSLREM_1001 (MODRDR)",
                "provenance_tag": "HISTORIC",
                "site": "Gale Crater (Curiosity) — NOT Jezero",
                "sol": sol,
                "ltst": f"{h:02d}:00:00",
                "ltst_bin": f"{h:02d}:00-{h:02d}:59 (hourly mean)",
                "ambient_temp_k": r2(row.AMBIENT_TEMP),
                "ambient_temp_c": r2(row.AMBIENT_TEMP - 273.15),
                "ground_temp_c": r2(row.BRIGHTNESS_TEMP - 273.15),
                "pressure_pa": r2(row.PRESSURE),
                "wind_speed_ms": r2(row.HORIZONTAL_WIND_SPEED),
                "uv_250_400nm_wm2": None,
                "n_samples": {k: int(v) for k, v in n.loc[h].items()},
            })
    json.dump(recs, open(out, "w"), indent=1)
    json.dump(manifest, open(os.path.join(dldir, "manifest.json"), "w"), indent=1)
    d = pd.DataFrame(recs)
    print(d.groupby("sol").agg(h=("ltst","count"), t=("ambient_temp_c","count"), g=("ground_temp_c","count"),
          p=("pressure_pa","count"), w=("wind_speed_ms","count"), tmin=("ambient_temp_c","min"),
          tmax=("ambient_temp_c","max"), pmean=("pressure_pa","mean")).to_string())

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3], [int(x) for x in sys.argv[4:]])
