"""
Runtime config: cache paths. Imports and re-exports all constants so that
existing `from config import ...` calls continue to work unchanged.
"""

import os as _os

from constants import *  # noqa: F401,F403 — re-export for backward compat
from constants import (
    ISOS,
    EIA_BA,
    N,
    ISO_COORDS,
    PHYS,
    L,
    FEAT,
    TOP_K_SOURCES,
    D_IN,
    H1,
    H2,
    EIA_URLS,
    WIND_COL,
    METEO_URL,
)

# Cache locations (same directory as this file)
_CACHE_DIR = _os.path.dirname(_os.path.abspath(__file__))
_CACHE_EIA = _os.path.join(_CACHE_DIR, "cache_eia_2023_2024.npz")
_CACHE_WEATHER = _os.path.join(_CACHE_DIR, "cache_weather_2023_2024.npz")
