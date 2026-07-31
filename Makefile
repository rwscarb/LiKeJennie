WIND_DIR   := src/experiments/wind
UI_DIR     := src/ui
S3_BUCKET  := s3://hak4
CF_DIST_ID := ETGRAW2YE5AZA

-include .env
RUNPOD_SSH_KEY ?= $(HOME)/.ssh/id_ed25519

.PHONY: all help test test-py test-py-unit test-py-e2e test-js test-js-e2e \
        lint format format-check sync install train optuna dev build deploy \
        runpod-sync clean clean-cache

# ── Default ────────────────────────────────────────────────────────────────────
all: help

BOLD  := \033[1m
CYAN  := \033[36m
GREEN := \033[32m
RESET := \033[0m

help:
	@printf "\n"
	@printf "  $(BOLD)$(CYAN)jennie21$(RESET)\n"
	@printf "\n"
	@printf "  $(BOLD)Setup$(RESET)\n"
	@printf "    $(GREEN)sync / install$(RESET)   uv sync (python) + npm install (ui)\n"
	@printf "\n"
	@printf "  $(BOLD)Testing$(RESET)\n"
	@printf "    $(GREEN)test$(RESET)             run all python + js tests\n"
	@printf "    $(GREEN)test-py$(RESET)          pytest (all)\n"
	@printf "    $(GREEN)test-py-unit$(RESET)     pytest (skip e2e pipeline)\n"
	@printf "    $(GREEN)test-py-e2e$(RESET)      pytest (pipeline only)\n"
	@printf "    $(GREEN)test-js$(RESET)          vitest unit tests\n"
	@printf "    $(GREEN)test-js-e2e$(RESET)      playwright e2e\n"
	@printf "\n"
	@printf "  $(BOLD)Code quality$(RESET)\n"
	@printf "    $(GREEN)format$(RESET)           black (python)\n"
	@printf "    $(GREEN)format-check$(RESET)     black --check\n"
	@printf "    $(GREEN)lint$(RESET)             flake8 (python)\n"
	@printf "\n"
	@printf "  $(BOLD)Training$(RESET)\n"
	@printf "    $(GREEN)train$(RESET)            run iso_wind_rgnn.py -v  (logs → train.log)\n"
	@printf "    $(GREEN)optuna$(RESET)           run 40-trial HPO         (logs → train.log)\n"
	@printf "\n"
	@printf "  $(BOLD)RunPod$(RESET)  $(set RUNPOD_HOST + RUNPOD_PORT in .env)\n"
	@printf "    $(GREEN)runpod-sync$(RESET)      rsync wind/ to pod /root/wind/\n"
	@printf "\n"
	@printf "  $(BOLD)UI$(RESET)\n"
	@printf "    $(GREEN)dev$(RESET)              vite dev server\n"
	@printf "    $(GREEN)build$(RESET)            vite build\n"
	@printf "    $(GREEN)deploy$(RESET)           build → s3://hak4 → CloudFront invalidation\n"
	@printf "\n"
	@printf "  $(BOLD)Cleanup$(RESET)\n"
	@printf "    $(GREEN)clean$(RESET)            remove __pycache__ + train.log\n"
	@printf "    $(GREEN)clean-cache$(RESET)      remove EIA/weather npz caches\n"
	@printf "\n"

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

# ── RunPod ─────────────────────────────────────────────────────────────────────
# Set RUNPOD_HOST and RUNPOD_PORT in .env (changes each pod session)
runpod-sync:
	@test -n "$(RUNPOD_HOST)" || (echo "  ERROR: RUNPOD_HOST not set in .env"; exit 1)
	@test -n "$(RUNPOD_PORT)" || (echo "  ERROR: RUNPOD_PORT not set in .env"; exit 1)
	rsync -avz \
	    --exclude='.venv' --exclude='__pycache__' --exclude='*.pyc' \
	    --exclude='cache_*.npz' --exclude='train.log' \
	    -e "ssh -p $(RUNPOD_PORT) -i $(RUNPOD_SSH_KEY) -o StrictHostKeyChecking=no" \
	    $(WIND_DIR)/ root@$(RUNPOD_HOST):/root/wind/

# ── UI ─────────────────────────────────────────────────────────────────────────
dev:
	cd $(UI_DIR) && npm run dev

build:
	cd $(UI_DIR) && npm run build

deploy: build
	aws s3 cp --recursive $(UI_DIR)/dist/ $(S3_BUCKET)/
	aws cloudfront create-invalidation --distribution-id $(CF_DIST_ID) --paths '/*'

# ── Cleanup ────────────────────────────────────────────────────────────────────
clean:
	find $(WIND_DIR) -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	find $(WIND_DIR) -name "*.pyc" -delete 2>/dev/null || true
	rm -f $(WIND_DIR)/train.log

clean-cache:
	rm -f $(WIND_DIR)/cache_*.npz
