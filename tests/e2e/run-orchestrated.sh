#!/usr/bin/env bash
#
# Run orchestrated e2e tests with per-test isolation.
#
# Each test spec runs against a freshly reset environment:
#   1. Drop all MongoDB application databases
#   2. Restart the 4 Node.js application services
#   3. Run the test spec via the Playwright container
#
# Keycloak, Vault, Mongo, Rabbit, Traefik, and the frontends stay up
# throughout — only the stateful application services are cycled.
#
# Usage:
#   ./tests/e2e/run-orchestrated.sh                    # run all tests
#   ./tests/e2e/run-orchestrated.sh small-order        # run one spec
#   ./tests/e2e/run-orchestrated.sh forget-subject react  # run one spec for one frontend

set -euo pipefail

COMPOSE_FILE="packages/orchestrated/compose.yml"
E2E_OVERLAY="tests/e2e/docker-compose.orchestrated.yml"
APP_SERVICES="command-processor readmodel-customers readmodel-orders change-notifier"

# All orchestrated test specs in execution order.
# forget-subject is last because it shreds encryption keys.
ALL_SPECS=(
  health
  small-order
  large-order
  cors
  vault-auth
  encryption
  keycloak-auth
  authorization-ui
  forget-subject
)

# Both frontends are tested for every spec to ensure equal coverage.
spec_frontends() {
  echo "svelte react"
}

# Map frontend name to Playwright project name
project_name() {
  local spec="$1" frontend="$2"
  if [ "$spec" = "forget-subject" ]; then
    echo "orchestrated-${frontend}-forget"
  else
    echo "orchestrated-${frontend}"
  fi
}

reset_environment() {
  echo "  ↻ Dropping MongoDB databases..."
  docker compose -f "$COMPOSE_FILE" exec -T mongo \
    mongosh --quiet --eval '
      db.getSiblingDB("events").dropDatabase();
      db.getSiblingDB("readmodel-customers").dropDatabase();
      db.getSiblingDB("readmodel-orders").dropDatabase();
    ' > /dev/null 2>&1

  echo "  ↻ Restarting application services..."
  docker compose -f "$COMPOSE_FILE" restart $APP_SERVICES > /dev/null 2>&1

  # Brief pause for services to reconnect to Mongo/Rabbit
  sleep 1
}

run_spec() {
  local spec="$1" frontend="$2"
  local project
  project=$(project_name "$spec" "$frontend")

  echo ""
  echo "━━━ ${spec} (${frontend}) ━━━"
  reset_environment

  echo "  ▶ Running tests..."
  docker compose -f "$COMPOSE_FILE" -f "$E2E_OVERLAY" \
    run --rm -T playwright \
    npx playwright test \
      --project="$project" \
      "tests/${spec}.spec.js"
}

# --- Main ---

# Resolve Traefik's container IP for Playwright's host-resolver-rules.
# This avoids hardcoding a fixed subnet and allows multiple compose stacks
# to run simultaneously without network collisions.
echo "Resolving Traefik IP..."
TRAEFIK_IP=$(docker compose -f "$COMPOSE_FILE" exec -T traefik hostname -i | tr -d '[:space:]')
if [ -z "$TRAEFIK_IP" ]; then
  echo "ERROR: Could not resolve Traefik IP. Is the stack running?"
  echo "Start it with: docker compose -f $COMPOSE_FILE up -d"
  exit 1
fi
export TRAEFIK_IP
echo "  Traefik IP: $TRAEFIK_IP"

# Build the Playwright container once
echo "Building Playwright container..."
docker compose -f "$COMPOSE_FILE" -f "$E2E_OVERLAY" build playwright 2>&1 | tail -1

# Determine which specs to run
if [ $# -ge 1 ]; then
  SPECS=("$1")
  if [ $# -ge 2 ]; then
    FRONTENDS=("$2")
  else
    FRONTENDS=($(spec_frontends "$1"))
  fi
else
  SPECS=("${ALL_SPECS[@]}")
  FRONTENDS=()  # will be set per-spec
fi

PASSED=0
FAILED=0
FAILURES=()

for spec in "${SPECS[@]}"; do
  if [ ${#FRONTENDS[@]} -gt 0 ]; then
    frontends=("${FRONTENDS[@]}")
  else
    frontends=($(spec_frontends "$spec"))
  fi

  for frontend in "${frontends[@]}"; do
    if run_spec "$spec" "$frontend"; then
      PASSED=$((PASSED + 1))
    else
      FAILED=$((FAILED + 1))
      FAILURES+=("${spec}:${frontend}")
    fi
  done
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Results: ${PASSED} passed, ${FAILED} failed"
if [ ${#FAILURES[@]} -gt 0 ]; then
  echo "Failures:"
  for f in "${FAILURES[@]}"; do
    echo "  ✗ $f"
  done
  exit 1
fi
