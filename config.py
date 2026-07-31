"""
Shared constants: grid topology, feature dimensions, cache paths.
"""

import os as _os

ISOS = ["CAISO", "ERCOT", "SPP", "MISO", "PJM", "NYISO", "ISO-NE", "BPA"]
EIA_BA = ["CISO", "ERCO", "SWPP", "MISO", "PJM", "NYIS", "ISNE", "BPAT"]
N = len(ISOS)

# Representative lat/lon for the dominant wind generation zone in each ISO
ISO_COORDS = [
    (35.1, -118.4),  # CAISO  — Tehachapi Pass
    (31.5, -99.5),  # ERCOT  — West Texas wind belt
    (37.5, -98.0),  # SPP    — Kansas corridor
    (42.0, -93.5),  # MISO   — Central Iowa
    (39.5, -79.0),  # PJM    — Allegheny Front
    (43.7, -75.4),  # NYISO  — Tug Hill Plateau
    (44.5, -69.5),  # ISO-NE — Central Maine
    (45.7, -119.5),  # BPA    — Columbia River Gorge
]

# Physical AC/DC interconnect edges (fixed topology)
PHYS = [(0, 7), (1, 2), (2, 3), (3, 4), (4, 5), (5, 6)]

# Feature engineering
L = 6  # lookback hours
FEAT = 4  # own features per step: generation, wind_speed, cos(dir), sin(dir)
TOP_K_SOURCES = 3  # directed upwind sources per node

D_IN = L * FEAT + TOP_K_SOURCES * 3  # 24 own + 9 directed cross-ISO = 33
H1, H2 = 32, 16

# Data sources — all six-month EIA balance files to include (chronological order)
_EIA_BASE = "https://www.eia.gov/electricity/gridmonitor/sixMonthFiles/"
EIA_URLS = [
    _EIA_BASE + "EIA930_BALANCE_2023_Jan_Jun.csv",
    _EIA_BASE + "EIA930_BALANCE_2023_Jul_Dec.csv",
    _EIA_BASE + "EIA930_BALANCE_2024_Jan_Jun.csv",
    _EIA_BASE + "EIA930_BALANCE_2024_Jul_Dec.csv",
]
WIND_COL = "Net Generation (MW) from Wind without Integrated Battery Storage"
METEO_URL = "https://archive-api.open-meteo.com/v1/archive"

# Cache locations (same directory as this file)
_CACHE_DIR = _os.path.dirname(_os.path.abspath(__file__))
_CACHE_EIA = _os.path.join(_CACHE_DIR, "cache_eia_2023_2024.npz")
_CACHE_WEATHER = _os.path.join(_CACHE_DIR, "cache_weather_2023_2024.npz")
