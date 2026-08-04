UI_DIR     := src/ui
S3_BUCKET  := s3://hak4
CF_DIST_ID := ETGRAW2YE5AZA

-include .env

.PHONY: all help sync install dev build deploy test test-js test-js-e2e clean

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
	@printf "    $(GREEN)sync / install$(RESET)   npm install (ui)\n"
	@printf "\n"
	@printf "  $(BOLD)Testing$(RESET)\n"
	@printf "    $(GREEN)test$(RESET)             run all js tests\n"
	@printf "    $(GREEN)test-js$(RESET)          vitest unit tests\n"
	@printf "    $(GREEN)test-js-e2e$(RESET)      playwright e2e\n"
	@printf "\n"
	@printf "  $(BOLD)UI$(RESET)\n"
	@printf "    $(GREEN)dev$(RESET)              vite dev server\n"
	@printf "    $(GREEN)build$(RESET)            vite build\n"
	@printf "    $(GREEN)deploy$(RESET)           build → s3://hak4 → CloudFront invalidation\n"
	@printf "\n"
	@printf "  $(BOLD)Cleanup$(RESET)\n"
	@printf "    $(GREEN)clean$(RESET)            remove build artifacts + __pycache__\n"
	@printf "\n"

# ── Install / sync ─────────────────────────────────────────────────────────────
sync:
	cd $(UI_DIR) && npm install

install: sync

# ── Tests ──────────────────────────────────────────────────────────────────────
test: test-js

test-js:
	cd $(UI_DIR) && npm test

test-js-e2e:
	cd $(UI_DIR) && npm run test:e2e

# ── UI ─────────────────────────────────────────────────────────────────────────
dev:
	cd $(UI_DIR) && npm run dev

build:
	cd $(UI_DIR) && npm run build

deploy: build
	aws s3 sync $(UI_DIR)/dist/ $(S3_BUCKET)/
	aws cloudfront create-invalidation --distribution-id $(CF_DIST_ID) --paths '/*'

# ── Cleanup ────────────────────────────────────────────────────────────────────
clean:
	find src/experiments -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	find src/experiments -name "*.pyc" -delete 2>/dev/null || true
