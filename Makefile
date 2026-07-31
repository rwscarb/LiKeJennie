WIND_DIR := src/experiments/wind
UI_DIR   := src/ui

.PHONY: all help test test-py test-py-unit test-py-e2e test-js test-js-e2e \
        lint format format-check sync install train optuna dev build clean clean-cache

# ── Default ────────────────────────────────────────────────────────────────────
all: help

help:
	@echo ""
	@echo "  jennie21"
	@echo ""
	@echo "  Setup"
	@echo "    sync / install   uv sync (python) + npm install (ui)"
	@echo ""
	@echo "  Testing"
	@echo "    test             run all python + js tests"
	@echo "    test-py          pytest (all)"
	@echo "    test-py-unit     pytest (skip e2e pipeline)"
	@echo "    test-py-e2e      pytest (pipeline only)"
	@echo "    test-js          vitest unit tests"
	@echo "    test-js-e2e      playwright e2e"
	@echo ""
	@echo "  Code quality"
	@echo "    format           black (python)"
	@echo "    format-check     black --check"
	@echo "    lint             flake8 (python)"
	@echo ""
	@echo "  Training"
	@echo "    train            run iso_wind_rgnn.py -v  (logs → train.log)"
	@echo "    optuna           run 40-trial HPO         (logs → train.log)"
	@echo ""
	@echo "  UI"
	@echo "    dev              vite dev server"
	@echo "    build            vite build"
	@echo ""
	@echo "  Cleanup"
	@echo "    clean            remove __pycache__ + train.log"
	@echo "    clean-cache      remove EIA/weather npz caches"
	@echo ""

# ── Tests ──────────────────────────────────────────────────────────────────────
test: test-py test-js

test-py:
	cd $(WIND_DIR) && uv run pytest tests/ -v

test-py-unit:
	cd $(WIND_DIR) && uv run pytest tests/ -v -k "not pipeline"

test-py-e2e:
	cd $(WIND_DIR) && uv run pytest tests/test_pipeline.py -v

test-js:
	cd $(UI_DIR) && npm test

test-js-e2e:
	cd $(UI_DIR) && npm run test:e2e

# ── Code quality ───────────────────────────────────────────────────────────────
lint:
	cd $(WIND_DIR) && uv run flake8 --max-line-length=100 --exclude=tests .

format:
	cd $(WIND_DIR) && uv run black .

format-check:
	cd $(WIND_DIR) && uv run black --check .

# ── Install / sync ─────────────────────────────────────────────────────────────
sync:
	cd $(WIND_DIR) && uv sync --extra dev
	cd $(UI_DIR) && npm install

install: sync

# ── Training ───────────────────────────────────────────────────────────────────
train:
	cd $(WIND_DIR) && uv run python -u iso_wind_rgnn.py -v 2>&1 | tee train.log

optuna:
	cd $(WIND_DIR) && uv run python -u iso_wind_rgnn.py --optuna --n-trials 40 -v 2>&1 | tee train.log

# ── UI ─────────────────────────────────────────────────────────────────────────
dev:
	cd $(UI_DIR) && npm run dev

build:
	cd $(UI_DIR) && npm run build

# ── Cleanup ────────────────────────────────────────────────────────────────────
clean:
	find $(WIND_DIR) -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	find $(WIND_DIR) -name "*.pyc" -delete 2>/dev/null || true
	rm -f $(WIND_DIR)/train.log

clean-cache:
	rm -f $(WIND_DIR)/cache_*.npz
