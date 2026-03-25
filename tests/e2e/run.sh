#!/bin/bash

COMPOSE_FILE="tests/e2e/docker-compose.e2e.yml"

cleanup() {
  docker compose -f "$COMPOSE_FILE" down -v --remove-orphans
}
trap cleanup EXIT

set -e

# Build all images (including playwright)
docker compose -f "$COMPOSE_FILE" build

# Start app services (not playwright)
docker compose -f "$COMPOSE_FILE" up -d --wait \
  monolith frontend-svelte frontend-react admin-ui

set +e

# Run playwright — capture exit code to report later
docker compose -f "$COMPOSE_FILE" run --rm playwright npx playwright test "$@"
PASS1=$?

set -e

# Run dev-mode tests: restart services with DEVELOPMENT_MODE=true and
# run only the admin-devmode spec (skipped tests will now be enabled)
echo ""
echo "=== Running dev-mode tests ==="
docker compose -f "$COMPOSE_FILE" down -v --remove-orphans
DEVELOPMENT_MODE=true docker compose -f "$COMPOSE_FILE" up -d --wait \
  monolith frontend-svelte frontend-react admin-ui

set +e

DEVELOPMENT_MODE=true docker compose -f "$COMPOSE_FILE" run --rm playwright \
  npx playwright test admin-devmode "$@"
PASS2=$?

# Exit with failure if either pass failed
echo ""
echo "=== Test results: pass1=$PASS1 pass2=$PASS2 ==="
if [ "$PASS1" -ne 0 ] || [ "$PASS2" -ne 0 ]; then
  exit 1
fi
