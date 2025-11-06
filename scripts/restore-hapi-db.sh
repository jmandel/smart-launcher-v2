#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

COMPOSE_CMD=${COMPOSE_CMD:-docker compose}
COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.yml}
COMPOSE_ENV_FILE=${COMPOSE_ENV_FILE:-}
HAPI_SERVICE=${HAPI_SERVICE:-hapi}
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

if [[ ! -f "$SNAPSHOT_PATH" ]]; then
    echo "Snapshot not found at $SNAPSHOT_PATH" >&2
    exit 1
fi

compose_args=(-f "$COMPOSE_FILE")
if [[ -n "$COMPOSE_ENV_FILE" ]]; then
    compose_args+=(--env-file "$COMPOSE_ENV_FILE")
fi

echo "Stopping ${HAPI_SERVICE}..."
$COMPOSE_CMD "${compose_args[@]}" stop "$HAPI_SERVICE" >/dev/null || true

echo "Ensuring ${POSTGRES_SERVICE} is running..."
$COMPOSE_CMD "${compose_args[@]}" up -d "$POSTGRES_SERVICE" >/dev/null

echo "Waiting for ${POSTGRES_SERVICE} to accept connections..."
until $COMPOSE_CMD "${compose_args[@]}" exec -T "$POSTGRES_SERVICE" pg_isready -U "$POSTGRES_USER" -d postgres >/dev/null 2>&1; do
    sleep 1
done

echo "Dropping and recreating database ${POSTGRES_DB}..."
$COMPOSE_CMD "${compose_args[@]}" exec -T "$POSTGRES_SERVICE" psql -U "$POSTGRES_USER" -d postgres <<SQL
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$POSTGRES_DB' AND pid <> pg_backend_pid();
DROP DATABASE IF EXISTS $POSTGRES_DB;
CREATE DATABASE $POSTGRES_DB OWNER $POSTGRES_USER;
SQL

echo "Restoring ${POSTGRES_DB} from ${SNAPSHOT_PATH}..."
$COMPOSE_CMD "${compose_args[@]}" exec -T "$POSTGRES_SERVICE" pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" < "$SNAPSHOT_PATH"

echo "Restarting ${HAPI_SERVICE}..."
$COMPOSE_CMD "${compose_args[@]}" up -d "$HAPI_SERVICE" >/dev/null

echo "Restore complete."
