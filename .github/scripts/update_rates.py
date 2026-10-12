#!/usr/bin/env python3
"""Build rates.json for the Buy-Borrow-Die tool: lender rates kept live.

Benchmark products (Interactive Brokers margin, Schwab Pledged Asset Line) are priced
as a published benchmark plus the firm's spread. The benchmark is pulled fresh from FRED
on every run (EFFR = fed funds effective, SOFR = secured overnight financing rate), so
those rates move the day the benchmark does. Base-rate products (Fidelity and Schwab
margin) are the firm's own posted rate from lenders.json, shown with the date they
were last checked by hand. The page tells the reader which is which.

    python3 update_rates.py [lenders.json] [rates.json]   # defaults: assets/ next to this file

Leaves the existing rates.json untouched if a benchmark can't be fetched.
Runs in build.py and in the live site's scheduled GitHub Action, like update_cpi.py.
"""
import csv
import io
import json
import shutil
import subprocess
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).parent


def fred_latest(series):
    url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={series}"
    text = None
    if shutil.which("curl"):  # curl first: FRED's CDN stalls old Python TLS builds
        r = subprocess.run(["curl", "-sfL", "-m", "30", url], capture_output=True, text=True)
        if r.returncode == 0 and r.stdout.startswith("observation_date"):
            text = r.stdout
    if text is None:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; stephendugger.com rates updater)"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            text = resp.read().decode("utf-8")
    rows = [r for r in list(csv.reader(io.StringIO(text)))[1:] if len(r) == 2 and r[1].strip() not in ("", ".")]
    date, value = rows[-1]
    return {"value": float(value), "date": date}


def main():
    lenders = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / "assets" / "lenders.json"
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else HERE / "assets" / "rates.json"
    cfg = json.loads(lenders.read_text())
    try:
        bench = {s: fred_latest(s) for s in ("EFFR", "SOFR")}
    except Exception as e:
        print(f"Rates not updated ({e}); keeping {out}", file=sys.stderr)
        sys.exit(1)
    products = []
    for p in cfg["products"]:
        q = {k: p[k] for k in ("id", "firm", "product", "type", "source_url", "verified", "confidence", "note")}
        if p["type"] == "benchmark":
            b = bench[p["benchmark"]]
            q.update(rate=round(b["value"] + p["spread"], 3), benchmark=p["benchmark"], benchmark_value=b["value"],
                     benchmark_date=b["date"], spread=p["spread"])
        else:
            q.update(rate=p["rate"])
        products.append(q)
    data = {
        "benchmarks": bench,
        "products": products,
        "built_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
    }
    old = json.loads(out.read_text()) if out.exists() else {}
    if old.get("benchmarks") == data["benchmarks"] and old.get("products") == data["products"]:
        print("Rates unchanged")
        return
    out.write_text(json.dumps(data, indent=2) + "\n")
    print(f"Rates updated: EFFR {bench['EFFR']['value']}% ({bench['EFFR']['date']}), SOFR {bench['SOFR']['value']}% ({bench['SOFR']['date']})")


if __name__ == "__main__":
    main()
