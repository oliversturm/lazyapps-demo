#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.e2e-llm.yml"
ENV_FILE="$SCRIPT_DIR/../../packages/llm-demo/.env"

# Source LLM credentials from .env
if [ -f "$ENV_FILE" ]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

LOG_DIR="$SCRIPT_DIR/test-results"
mkdir -p "$LOG_DIR"

cleanup() {
  echo "--- Capturing container logs ---"
  docker compose -f "$COMPOSE_FILE" logs --no-color > "$LOG_DIR/containers.log" 2>&1 || true
  echo "Container logs saved to $LOG_DIR/containers.log"
  docker compose -f "$COMPOSE_FILE" down -v --remove-orphans
}
trap cleanup EXIT

docker compose -f "$COMPOSE_FILE" build
docker compose -f "$COMPOSE_FILE" up -d --wait \
  frontend
docker compose -f "$COMPOSE_FILE" run playwright npx playwright test "$@"
