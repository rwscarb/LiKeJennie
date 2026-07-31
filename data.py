"""
Data loading: EIA 930 wind generation, Open-Meteo weather, optional MISO hub-height.
"""
import csv
import io
import json
import os
import urllib.request
from collections import defaultdict
from datetime import datetime

import numpy as np

from config import (
    ISOS,
    EIA_BA,
    N,
    ISO_COORDS,
    EIA_URL,
    WIND_COL,
    METEO_URL,
    _CACHE_EIA,
    _CACHE_WEATHER,
)


def _parse_dt(s):
    for fmt in ("%m/%d/%Y %I:%M:%S %p", "%m/%d/%Y %H:%M:%S"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            pass
    raise ValueError(f"Unrecognised EIA timestamp: {s!r}")


def fetch_eia_wind(url=EIA_URL, verbose=True):
    """
    Download EIA hourly grid balance CSV and extract wind generation for the 8
    target BAs. Returns (X [T, N], cap_lo, cap_hi, utc_sorted). Missing values
    are forward-filled; results are normalised to [0, 1] and cached.
    """
    if os.path.exists(_CACHE_EIA):
        if verbose:
            print(f"  Loading EIA 930 data from cache ({_CACHE_EIA}) ...")
        d = np.load(_CACHE_EIA, allow_pickle=True)
        X, cap_lo, cap_hi = d["X"], d["cap_lo"], d["cap_hi"]
        utc_sorted = list(d["utc_sorted"])
        if verbose:
            print(f"  Loaded {len(utc_sorted)} hourly observations per ISO")
            print(f"  Date range: {utc_sorted[0]}  →  {utc_sorted[-1]}")
        return X, cap_lo, cap_hi, utc_sorted

    if verbose:
        print(f"  Downloading EIA 930 data (Jul-Dec 2024) ...")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        raw = r.read().decode("utf-8", errors="replace")

    ba_idx = {ba: i for i, ba in enumerate(EIA_BA)}
    reader = csv.reader(io.StringIO(raw))
    headers = [h.strip().strip('"') for h in next(reader)]

    ba_col = headers.index("Balancing Authority")
    utc_col = headers.index("UTC Time at End of Hour")
    wind_col = headers.index(WIND_COL)

    data = defaultdict(dict)
    for row in reader:
        if len(row) <= max(ba_col, utc_col, wind_col):
            continue
        ba = row[ba_col].strip().strip('"')
        if ba not in ba_idx:
            continue
        utc = row[utc_col].strip().strip('"')
        val = row[wind_col].strip().strip('"')
        try:
            mw = float(val)
        except ValueError:
            mw = np.nan
        data[utc][ba_idx[ba]] = mw

    utc_sorted = sorted(data.keys(), key=_parse_dt)
    T = len(utc_sorted)
    X = np.full((T, N), np.nan, dtype=np.float32)
    for t, utc in enumerate(utc_sorted):
        for i, mw in data[utc].items():
            X[t, i] = mw

    for i in range(N):
        for t in range(1, T):
            if np.isnan(X[t, i]):
                X[t, i] = X[t - 1, i]
    X = np.nan_to_num(X, nan=0.0)

    X = np.clip(X, 0, None)
    lo, hi = X.min(0), X.max(0)
    X = ((X - lo) / (hi - lo + 1e-8)).astype(np.float32)

    if verbose:
        print(f"  Loaded {T} hourly observations per ISO")
        print(f"  Date range: {utc_sorted[0]}  →  {utc_sorted[-1]}")
    np.savez(_CACHE_EIA, X=X, cap_lo=lo, cap_hi=hi, utc_sorted=np.array(utc_sorted))
    return X, lo, hi, utc_sorted


def fetch_weather(utc_sorted, verbose=True):
    """
    Pull hourly wind speed + direction from Open-Meteo for each ISO's representative
    point, aligned to EIA UTC timestamps. Returns W [T, N, 3]:
      0 — normalised wind speed, 1 — cos(dir), 2 — sin(dir).
    Cached to _CACHE_WEATHER.
    """
    if os.path.exists(_CACHE_WEATHER):
        if verbose:
            print(f"  Loading weather from cache ({_CACHE_WEATHER}) ...")
        return np.load(_CACHE_WEATHER)["W"]

    eia_dt = [_parse_dt(ts) for ts in utc_sorted]
    dt2idx = {dt: i for i, dt in enumerate(eia_dt)}
    T = len(utc_sorted)

    start_date = eia_dt[0].strftime("%Y-%m-%d")
    end_date = eia_dt[-1].strftime("%Y-%m-%d")

    if verbose:
        print(f"  Fetching Open-Meteo weather ({start_date} → {end_date}) ...")

    W = np.zeros((T, N, 3), dtype=np.float32)
    for i, (lat, lon) in enumerate(ISO_COORDS):
        url = (
            f"{METEO_URL}?latitude={lat}&longitude={lon}"
            f"&start_date={start_date}&end_date={end_date}"
            f"&hourly=wind_speed_10m,wind_direction_10m"
            f"&timezone=UTC&wind_speed_unit=ms"
        )
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=60) as r:
            d = json.loads(r.read())
        times = d["hourly"]["time"]
        spd = np.array(d["hourly"]["wind_speed_10m"], dtype=np.float32)
        dirs = np.array(d["hourly"]["wind_direction_10m"], dtype=np.float32)
        matched = 0
        for j, ts in enumerate(times):
            dt = datetime.strptime(ts, "%Y-%m-%dT%H:%M")
            if dt not in dt2idx:
                continue
            idx = dt2idx[dt]
            s = 0.0 if np.isnan(spd[j]) else float(spd[j])
            dg = 0.0 if np.isnan(dirs[j]) else float(dirs[j])
            rad = np.deg2rad(dg)
            W[idx, i, 0] = s
            W[idx, i, 1] = np.cos(rad)
            W[idx, i, 2] = np.sin(rad)
            matched += 1
        if verbose:
            print(
                f"    {ISOS[i]:>8}: {matched}/{T} hours matched  "
                f"speed_mean={W[:, i, 0].mean():.2f} m/s"
            )

    lo = W[:, :, 0].min(0)
    hi = W[:, :, 0].max(0)
    W[:, :, 0] = (W[:, :, 0] - lo) / (hi - lo + 1e-8)
    np.savez(_CACHE_WEATHER, W=W)
    return W


def load_miso_site_weather(utc_sorted, verbose=True):
    """
    Load per-site hub-height wind from data/miso/{generators,wind}.csv and aggregate
    to capacity-weighted ISO-level features aligned with utc_sorted.
    Returns W_miso [T, 3] or None if files are missing.
    """
    base = os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", "data", "miso"
    )
    gen_path = os.path.join(base, "generators.csv")
    wind_path = os.path.join(base, "wind.csv")
    if not (os.path.exists(gen_path) and os.path.exists(wind_path)):
        return None

    cap = {}
    with open(gen_path) as f:
        for row in csv.DictReader(f):
            if row.get("Status") == "Online":
                try:
                    cap[int(row["site_id"])] = float(row["Total_Capacity"])
                except (ValueError, KeyError):
                    pass

    hourly = {}
    with open(wind_path) as f:
        for row in csv.DictReader(f):
            try:
                sid = int(row["site_id"])
                if sid not in cap:
                    continue
                c = cap[sid]
                spd = float(row["wind_speed"])
                rad = np.deg2rad(float(row["wind_dir"]))
                dt = datetime.strptime(row["forecast_timestamp"], "%Y-%m-%d %H:%M:%S")
            except (ValueError, KeyError):
                continue
            if dt not in hourly:
                hourly[dt] = [0.0, 0.0, 0.0, 0.0]
            hourly[dt][0] += c * spd
            hourly[dt][1] += c
            hourly[dt][2] += c * np.cos(rad)
            hourly[dt][3] += c * np.sin(rad)

    eia_dts = [_parse_dt(ts) for ts in utc_sorted]
    T = len(utc_sorted)
    W_miso = np.zeros((T, 3), dtype=np.float32)
    matched, raw_speeds = 0, []
    for t, dt in enumerate(eia_dts):
        if dt not in hourly:
            continue
        cs, c_tot, cc, cs2 = hourly[dt]
        if c_tot <= 0:
            continue
        spd = cs / c_tot
        W_miso[t, 0] = spd
        W_miso[t, 1] = cc / c_tot
        W_miso[t, 2] = cs2 / c_tot
        raw_speeds.append(spd)
        matched += 1

    if not raw_speeds:
        if verbose:
            print("    MISO site data: no timestamps matched — check UTC assumption")
        return None

    lo, hi = min(raw_speeds), max(raw_speeds)
    W_miso[:, 0] = (W_miso[:, 0] - lo) / (hi - lo + 1e-8)
    if verbose:
        print(
            f"    MISO site data: {matched}/{T} hours matched  "
            f"speed_mean={float(np.mean(raw_speeds)):.2f} m/s (hub-height)  "
            f"{len(cap)} sites"
        )
    return W_miso
