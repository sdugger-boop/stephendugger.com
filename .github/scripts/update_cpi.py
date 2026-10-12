#!/usr/bin/env python3
"""Fetch the latest official CPI and write it as JSON for the Your Inflation tool.

Source: BLS CPI-U, all items, not seasonally adjusted (the series behind the
"prices rose X% over the last 12 months" headline), read from FRED's public CSV
(series CPIAUCNS, no API key needed). The 12-month change is latest month vs the
same month a year earlier, rounded to one decimal, which is how BLS reports it.

    python3 update_cpi.py [output.json]     # default: assets/cpi.json next to this file

Exits non-zero and leaves the existing file untouched if the fetch or parse fails,
so a bad network day never blanks the number on the site.
Runs in two places: build.py (every build), and the public site repo's scheduled
GitHub Action (.github/workflows/cpi.yml), so the live site updates itself after each release.
Stdlib only, on purpose.
"""
import csv
import io
import json
import shutil
import subprocess
import sys
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

SERIES = "CPIAUCNS"
URL = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={SERIES}"
MONTHS = ["January", "February", "March", "April", "May", "June", "July",
          "August", "September", "October", "November", "December"]


def download():
    """curl first: FRED's CDN stalls the TLS handshake from older Python builds
    (macOS system Python ships LibreSSL 2.8.3), while curl gets through. urllib is the fallback."""
    if shutil.which("curl"):
        r = subprocess.run(["curl", "-sfL", "-m", "30", URL], capture_output=True, text=True)
        if r.returncode == 0 and r.stdout.startswith("observation_date"):
            return r.stdout
    req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0 (compatible; stephendugger.com CPI updater)"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8")


def fetch():
    text = download()
    values = {}
    for row in list(csv.reader(io.StringIO(text)))[1:]:
        if len(row) == 2 and row[1].strip() not in ("", "."):
            values[date.fromisoformat(row[0])] = float(row[1])
    latest = max(values)
    prior = date(latest.year - 1, latest.month, 1)
    if prior not in values:
        raise ValueError(f"no value for {prior}, can't compute a 12-month change")
    yoy = round((values[latest] / values[prior] - 1) * 100, 1)
    return {
        "yoy": yoy,
        "month": latest.strftime("%Y-%m"),
        "label": f"{MONTHS[latest.month - 1]} {latest.year}",
        "series": "BLS CPI-U, all items, not seasonally adjusted (FRED CPIAUCNS)",
        "source_url": f"https://fred.stlouisfed.org/series/{SERIES}",
        "fetched_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
    }


def main():
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent / "assets" / "cpi.json"
    try:
        data = fetch()
    except Exception as e:  # network, format, missing month
        print(f"CPI not updated ({e}); keeping {out}", file=sys.stderr)
        sys.exit(1)
    old = json.loads(out.read_text()) if out.exists() else {}
    if old.get("month") == data["month"] and old.get("yoy") == data["yoy"]:
        print(f"CPI unchanged: {data['label']} {data['yoy']}%")
        return
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, indent=2) + "\n")
    print(f"CPI updated: {data['label']} {data['yoy']}%")


if __name__ == "__main__":
    main()
