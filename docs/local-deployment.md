## Local SMART + HAPI Stack

This project now bundles a Docker Compose stack that runs the SMART launcher in
front of a dedicated HAPI FHIR R4 server backed by PostgreSQL. Everything runs
locally by default, but the services can be exposed behind any reverse proxy and
configured to advertise public URLs.

### Prerequisites

- Docker Engine + Docker Compose V2
- Node.js 16+ (only required for the helper scripts)
- Network access to download Docker images and sample patient data

### First-Time Setup

1. Install project dependencies and download fixtures:

   ```bash
   npm install
   npm run fixtures:download
   ```

   The fixtures live in `./fixtures/` and currently contain `$everything` bundles
   for ten patients from the SMART sandbox.

2. Launch the stack (the repo ships with `env/local.env` for convenience):

   ```bash
   docker compose --env-file env/local.env up -d
   ```

   Ports (override via environment variables as needed):

   - `8080` – HAPI FHIR (`HAPI_PORT`)
   - `8081` – SMART launcher (`LAUNCHER_PORT`)
   - `5432` – PostgreSQL for debugging (`POSTGRES_PORT`)

3. Load the fixtures into HAPI (idempotent):

   ```bash
   npm run fixtures:load
   ```

   The loader waits for HAPI to respond and then PUTs each resource so the
   database starts with a clean set of sample data.

   The helper `scripts/reset-hapi-db.sh` wraps the full drop-and-reseed flow and
  will be used for daily resets (see below).

### Daily Reset Workflow

The reset script swaps in a fresh schema to avoid carrying forward resource
history:

```bash
./scripts/reset-hapi-db.sh
```

It performs the following steps:

1. Stops the HAPI container so the database can be modified safely.
2. Drops and recreates the `public` schema in PostgreSQL (no history retained).
3. Restarts HAPI.
4. Reloads fixtures via the FHIR API.

Schedule this script with cron or systemd timers to execute once per day. For
example, using cron:

```cron
0 3 * * * cd /home/ubuntu/smart-launcher-exp && ./scripts/reset-hapi-db.sh >> /var/log/smart-launcher-reset.log 2>&1
```

### Database snapshots

When the dataset becomes large it is faster to capture a Postgres snapshot than
to replay all fixtures. Two helper scripts manage gzip-compressed dumps in
`./snapshots/`:

- `./scripts/snapshot-hapi-db.sh` – dumps the current database state (defaults to
  `snapshots/hapi-baseline.dump`)
- `./scripts/restore-hapi-db.sh` – stops HAPI, drops the database, recreates it,
  and restores from the chosen dump

By default the scripts talk to the services defined in `docker-compose.yml`.
Supply alternative env files by setting `COMPOSE_ENV_FILE`, e.g.:

```bash
COMPOSE_ENV_FILE=env/prod.env ./scripts/snapshot-hapi-db.sh
COMPOSE_ENV_FILE=env/prod.env ./scripts/restore-hapi-db.sh
```

### Configuring Public URLs

If the stack sits behind a public hostname, drop the overrides into an env file
and pass it to Docker Compose. Anything set in the env file wins over the values
in `env/local.env`.

- `HAPI_PUBLIC_BASE_URL`: Canonical base URL that HAPI should embed in bundles
  (e.g., `https://launch.example.org/fhir`).
- `LAUNCHER_FHIR_SERVER_R4`: URL the launcher proxies to (defaults to
  `http://hapi:8080/fhir` for the internal network).

Example:

```bash
cp env/local.env env/prod.env
sed -i 's#http://smartlauncher.localhost:8888/fhir#https://launch.example.org/fhir#g' env/prod.env
echo "LAUNCHER_PORT=80" >> env/prod.env
docker compose --env-file env/prod.env up -d
```

When reverse-proxying, forward the `X-Forwarded-Proto` and `X-Forwarded-Host`
headers so HAPI generates the expected absolute links.

### Rebuilding the bundled patient browser

The SMART patient picker runs locally from the `submodules/patient-browser`
submodule. Every build of the launcher automatically runs:

```bash
npm run build:patient-browser
```

which invokes Vite with `--base=/patient-browser/` and copies the resulting
assets into `public/patient-browser/`. Re-run the command whenever the submodule
is updated or you need to regenerate assets.

### Useful Commands

- Tail launcher logs: `docker compose logs -f launcher`
- Tail HAPI logs: `docker compose logs -f hapi`
- Connect to PostgreSQL: `psql postgres://hapi:hapi@localhost:5432/hapi`
- Tear everything down (retains Postgres volume): `docker compose down`
- Start from scratch (deletes database volume): `docker compose down -v`
