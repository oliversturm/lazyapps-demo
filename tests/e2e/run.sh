#!/bin/bash
set -e

COMPOSE_FILE="tests/e2e/docker-compose.e2e.yml"

cleanup() {
  docker compose -f "$COMPOSE_FILE" down -v --remove-orphans
}
trap cleanup EXIT

# Build all images (including playwright)
docker compose -f "$COMPOSE_FILE" build

# Start app services (not playwright)
docker compose -f "$COMPOSE_FILE" up -d --wait \
  monolith frontend-svelte frontend-react

# Run playwright (exits with test result code)
docker compose -f "$COMPOSE_FILE" run --rm playwright npx playwright test "$@"
