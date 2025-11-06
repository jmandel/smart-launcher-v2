#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

COMPOSE_CMD=${COMPOSE_CMD:-docker compose}
COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.yml}
COMPOSE_ENV_FILE=${COMPOSE_ENV_FILE:-}
POSTGRES_SERVICE=${POSTGRES_SERVICE:-postgres}
POSTGRES_DB=${POSTGRES_DB:-hapi}
POSTGRES_USER=${POSTGRES_USER:-hapi}
SNAPSHOT_DIR=${SNAPSHOT_DIR:-"$PROJECT_ROOT/snapshots"}
SNAPSHOT_NAME=${SNAPSHOT_NAME:-hapi-baseline.dump}
SNAPSHOT_PATH=${SNAPSHOT_PATH:-"$SNAPSHOT_DIR/$SNAPSHOT_NAME"}

if [[ ! -f "$COMPOSE_FILE" ]]; then
    echo "Expected compose file $COMPOSE_FILE not found in $PROJECT_ROOT" >&2
    exit 1
fi

mkdir -p "$SNAPSHOT_DIR"

compose_args=(-f "$COMPOSE_FILE")
if [[ -n "$COMPOSE_ENV_FILE" ]]; then
    compose_args+=(--env-file "$COMPOSE_ENV_FILE")
fi

echo "Ensuring ${POSTGRES_SERVICE} is running..."
$COMPOSE_CMD "${compose_args[@]}" up -d "$POSTGRES_SERVICE" >/dev/null

echo "Waiting for ${POSTGRES_SERVICE} to accept connections..."
until $COMPOSE_CMD "${compose_args[@]}" exec -T "$POSTGRES_SERVICE" pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; do
    sleep 1
done

echo "Creating snapshot ${SNAPSHOT_PATH}..."
$COMPOSE_CMD "${compose_args[@]}" exec -T "$POSTGRES_SERVICE" pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB" > "$SNAPSHOT_PATH"

echo "Snapshot written to ${SNAPSHOT_PATH}"
