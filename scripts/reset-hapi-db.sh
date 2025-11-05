#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

COMPOSE_CMD=${COMPOSE_CMD:-docker compose}
COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.yml}
HAPI_SERVICE=${HAPI_SERVICE:-hapi}
POSTGRES_SERVICE=${POSTGRES_SERVICE:-postgres}
POSTGRES_DB=${POSTGRES_DB:-hapi}
POSTGRES_USER=${POSTGRES_USER:-hapi}
HAPI_HOST=${HAPI_HOST:-localhost}
HAPI_PORT=${HAPI_PORT:-8080}
TARGET_FHIR_BASE=${TARGET_FHIR_BASE:-http://${HAPI_HOST}:${HAPI_PORT}/fhir}
FIXTURES_DIR=${FIXTURES_DIR:-"$PROJECT_ROOT/fixtures"}

if [[ ! -f "$COMPOSE_FILE" ]]; then
    echo "Expected compose file $COMPOSE_FILE not found in $PROJECT_ROOT" >&2
    exit 1;
fi

if [[ ! -d "$FIXTURES_DIR" ]]; then
    echo "Fixtures directory $FIXTURES_DIR does not exist" >&2
    exit 1
fi

echo "Stopping ${HAPI_SERVICE} to ensure database connections are closed..."
$COMPOSE_CMD -f "$COMPOSE_FILE" stop "$HAPI_SERVICE" >/dev/null

echo "Ensuring ${POSTGRES_SERVICE} is running..."
$COMPOSE_CMD -f "$COMPOSE_FILE" up -d "$POSTGRES_SERVICE" >/dev/null

echo "Waiting for ${POSTGRES_SERVICE} to accept connections..."
until $COMPOSE_CMD -f "$COMPOSE_FILE" exec -T "$POSTGRES_SERVICE" pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; do
    sleep 1
done

echo "Dropping and recreating schema for ${POSTGRES_DB}..."
$COMPOSE_CMD -f "$COMPOSE_FILE" exec -T "$POSTGRES_SERVICE" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<SQL
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO $POSTGRES_USER;
GRANT ALL ON SCHEMA public TO PUBLIC;
SQL

echo "Starting ${HAPI_SERVICE}..."
$COMPOSE_CMD -f "$COMPOSE_FILE" up -d "$HAPI_SERVICE" >/dev/null

echo "Waiting for HAPI FHIR to boot and loading fixtures from ${FIXTURES_DIR}..."
TARGET_FHIR_BASE="$TARGET_FHIR_BASE" FIXTURES_DIR="$FIXTURES_DIR" node ./scripts/load-fixtures.mjs

echo "Reset complete."
