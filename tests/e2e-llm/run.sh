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

cleanup() {
  docker compose -f "$COMPOSE_FILE" down -v --remove-orphans
}
trap cleanup EXIT

docker compose -f "$COMPOSE_FILE" build
docker compose -f "$COMPOSE_FILE" up -d --wait \
  frontend
docker compose -f "$COMPOSE_FILE" run --rm playwright npx playwright test "$@"
