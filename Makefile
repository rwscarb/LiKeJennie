WIND_DIR   := src/experiments/wind
UI_DIR     := src/ui
S3_BUCKET  := s3://hak4
CF_DIST_ID := ETGRAW2YE5AZA

# Load .env (RUNPOD_API_KEY, RUNPOD_POD_ID) — ignored if missing
-include .env
export RUNPOD_API_KEY
RUNPOD_SSH_KEY  ?= $(HOME)/.runpod/keys/runpod_id_ed25519
RUNPOD_SSH_HOST  = $(RUNPOD_POD_ID)-22.proxy.runpod.net
RUNPOD_SSH       = ssh -i $(RUNPOD_SSH_KEY) -o StrictHostKeyChecking=no root@$(RUNPOD_SSH_HOST)
RUNPOD_DEST     := /root

.PHONY: all help test test-py test-py-unit test-py-e2e test-js test-js-e2e \
        lint format format-check sync install train optuna dev build deploy \
        runpod-start runpod-stop runpod-sync runpod-train runpod-optuna runpod-logs \
        clean clean-cache

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
	@echo "    deploy           build → s3://hak4 → CloudFront invalidation"
	@echo ""
	@echo "  RunPod  (requires RUNPOD_API_KEY + RUNPOD_POD_ID in .env)"
	@echo "    runpod-start     start the pod"
	@echo "    runpod-stop      stop the pod"
	@echo "    runpod-sync      rsync wind/ source to pod"
	@echo "    runpod-train     sync + run train in tmux (logs → /root/train.log)"
	@echo "    runpod-optuna    sync + run 40-trial HPO in tmux"
	@echo "    runpod-logs      tail /root/train.log on pod"
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

deploy: build
	aws s3 cp --recursive $(UI_DIR)/dist/ $(S3_BUCKET)/
	aws cloudfront create-invalidation --distribution-id $(CF_DIST_ID) --paths '/*'

# ── RunPod ─────────────────────────────────────────────────────────────────────
runpod-start:
	runpodctl start pod $(RUNPOD_POD_ID)

runpod-stop:
	runpodctl stop pod $(RUNPOD_POD_ID)

runpod-sync:
	rsync -avz \
	    --exclude='.venv' --exclude='__pycache__' --exclude='*.pyc' \
	    --exclude='cache_*.npz' --exclude='train.log' \
	    -e "ssh -i $(RUNPOD_SSH_KEY) -o StrictHostKeyChecking=no" \
	    $(WIND_DIR)/ root@$(RUNPOD_SSH_HOST):$(RUNPOD_DEST)/

runpod-train: runpod-sync
	$(RUNPOD_SSH) "tmux kill-session -t run 2>/dev/null; \
	    tmux new-session -d -s run \
	    'cd $(RUNPOD_DEST) && python -u iso_wind_rgnn.py -v 2>&1 | tee train.log'"
	@echo "  training running in tmux session 'run' — tail with: make runpod-logs"

runpod-optuna: runpod-sync
	$(RUNPOD_SSH) "tmux kill-session -t run 2>/dev/null; \
	    tmux new-session -d -s run \
	    'cd $(RUNPOD_DEST) && python -u iso_wind_rgnn.py --optuna --n-trials 40 -v 2>&1 | tee train.log'"
	@echo "  optuna running in tmux session 'run' — tail with: make runpod-logs"

runpod-logs:
	$(RUNPOD_SSH) "tail -f $(RUNPOD_DEST)/train.log"

# ── Cleanup ─────────────────────────────────────────────────────────────────────
clean:
	find $(WIND_DIR) -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	find $(WIND_DIR) -name "*.pyc" -delete 2>/dev/null || true
	rm -f $(WIND_DIR)/train.log

clean-cache:
	rm -f $(WIND_DIR)/cache_*.npz
