"""Download MEDA (Mars 2020) calibrated/derived CSVs for given sols from PDS Atmospheres.

TLS verification stays ON: atmos.nmsu.edu chains to "emSign Root CA - G1", which is in
Mozilla's bundle but missing from some system stores. Pass a CA bundle containing it.
"""
import os, re, sys, json, requests

BASE = "https://atmos.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda"
RANGES = [(0, 89), (90, 179), (180, 299), (300, 419)]
WANT = {  # (collection, product key)
    ("data_calibrated_env", "CAL_ATS"),
    ("data_calibrated_env", "CAL_TIRS"),
    ("data_calibrated_env", "CAL_RDS"),
    ("data_derived_env", "DER_PS"),
    ("data_derived_env", "DER_WS"),
}

def sol_dir(coll, sol):
    for a, b in RANGES:
        if a <= sol <= b:
            return f"{BASE}/{coll}/sol_{a:04d}_{b:04d}/sol_{sol:04d}/"
    raise ValueError(sol)

def main(outdir, ca, sols):
    s = requests.Session(); s.trust_env = False; s.verify = ca; s.proxies = {"https": os.environ["HTTPS_PROXY"]}
    manifest = []
    for sol in sols:
        for coll in sorted({c for c, _ in WANT}):
            url = sol_dir(coll, sol)
            r = s.get(url, timeout=60); r.raise_for_status()
            names = sorted(set(re.findall(r'href="(WE__[^"]+\.CSV)"', r.text)))
            for coll2, key in WANT:
                if coll2 != coll: continue
                hits = [n for n in names if f"_{key}_" in n]
                if not hits:
                    print(f"sol {sol}: missing {key}"); continue
                name = hits[-1]  # highest product version
                dst = os.path.join(outdir, f"{sol:04d}", name)
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                if not os.path.exists(dst):
                    with s.get(url + name, timeout=300, stream=True) as g:
                        g.raise_for_status()
                        with open(dst, "wb") as f:
                            for ch in g.iter_content(1 << 20): f.write(ch)
                manifest.append({"sol": sol, "product": key, "url": url + name,
                                 "path": dst, "bytes": os.path.getsize(dst)})
    with open(os.path.join(outdir, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=1)

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], [int(x) for x in sys.argv[3:]])
