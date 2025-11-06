## SMART Launcher Local Stack – Engineering Notes

This branch turns the launcher repository into a self-contained stack that can
be run entirely on a workstation. It layers the SMART launcher UI/API in front
of a HAPI FHIR R4 server and bundles all helper tooling needed to seed and
refresh the database. The highlights below capture what was built and how to
operate it.

### Containers and wiring

- `docker-compose.yml` now defines a three-service stack:
  - `postgres` (16-alpine) – persistent storage for HAPI.
  - `hapi` (`hapiproject/hapi:v7.6.0`) – configured for PostgreSQL, R4, and a
    canonical base URL provided by the `HAPI_PUBLIC_BASE_URL` environment
    variable.
  - `launcher` – built from this repository and exposes the SMART launcher on
    port 80 inside the container. It reads `FHIR_SERVER_R4` for the public FHIR
    URL and `FHIR_SERVER_R4_INTERNAL` for the internal Docker-network target
    (default `http://hapi:8080/fhir`).
- The Compose file is deliberately lean so it can be steered with env files. The
  repo ships with `env/local.env`, and additional files can be created for other
  environments. Launch with:
  ```bash
  docker compose --env-file env/local.env up -d
  ```

### Fixture management

Three scripts live in `scripts/` to fetch, load, and reset data:

1. `npm run fixtures:download` (`scripts/download-fixtures.mjs`)
   - Paginates through the SMART sandbox (defaults to `https://r4.smarthealthit.org`)
     and downloads `$everything` bundles for each patient.
   - Accepts `SOURCE_BASE`, `PATIENT_COUNT`, `PATIENT_COUNT=all`, and similar
     env vars. The default run grabs the full patient set from the SMART launch
     simulation server.
   - Also fetches `Practitioner`, `PractitionerRole`, and `RelatedPerson`
     bundles so the launcher’s login screens and pickers are populated.

2. `npm run fixtures:load` (`scripts/load-fixtures.mjs`)
   - Waits for HAPI to become available then `PUT`s every resource from the
     fixture directory.
   - Sanitises edge cases encountered in the public data (non-base64
     `Attachment.data`, `MedicationAdministration.status="not-taken"`) so the
     import succeeds against stock HAPI.

3. `./scripts/reset-hapi-db.sh`
   - Stops HAPI, drops and recreates the Postgres schema, restarts HAPI,
     and invokes the loader with `TARGET_FHIR_BASE` derived from
     `HAPI_PUBLIC_BASE_URL`.
   - Suitable for daily cron jobs to guarantee a clean set of fixture data.

4. `./scripts/snapshot-hapi-db.sh` / `./scripts/restore-hapi-db.sh`
   - `snapshot` writes a compressed `pg_dump -Fc` file to `./snapshots`.
   - `restore` stops HAPI, recreates the database, and pipes the dump through
     `pg_restore`. This is the fastest way to reset to a known baseline when
     the fixture load becomes large.

### Patient browser submodule

- The SMART patient picker is vendored as a git submodule in
  `submodules/patient-browser`.
- `npm run build:patient-browser` wraps `npm install` (on first run) and
  `npm run build -- --base=/patient-browser/`, copying the resulting `dist/`
  into `public/patient-browser/`.
- The launcher defaults `PICKER_ORIGIN=/patient-browser` so the picker iframe
  lives entirely on the local host and doesn’t reach out to
  `patient-browser.smarthealthit.org`.
- The iframe origin is detected from the computed URL so `postMessage`
  negotiations succeed, ensuring the picker uses the stack’s local FHIR base
  instead of the sandbox default.

### Launcher + HAPI configuration tweaks

- `backend/config.ts` loads `FHIR_SERVER_R4` from the environment; if
  `FHIR_SERVER_R4_INTERNAL` is provided it’s used for direct proxy calls so the
  launcher never loops back on itself.
- `backend/index.ts` serves the built patient browser and emits the correct
  `PICKER_ORIGIN` through `env.js`.
- HAPI relies on PostgreSQL. Its `application.yaml` (under `docker/hapi/`)
  enables `client_id_strategy: ANY`, disables referential integrity checks
  (because the fixtures are stitched together from external sources), and uses
  `server_address=${HAPI_PUBLIC_BASE_URL}` so bundle links stay consistent.

### Operations quick reference

| Task | Command |
| --- | --- |
| Bootstrap dependencies | `npm install` |
| Download fixtures | `PATIENT_COUNT=all npm run fixtures:download` |
| Load fixtures | `npm run fixtures:load` |
| Reset HAPI daily | `./scripts/reset-hapi-db.sh` |
| Snapshot database | `./scripts/snapshot-hapi-db.sh` |
| Restore database | `./scripts/restore-hapi-db.sh` |
| Build patient browser | `npm run build:patient-browser` |
| Bring stack up | `docker compose --env-file env/local.env up -d` |
| Update patient-browser submodule | `git submodule update --remote --merge submodules/patient-browser` |

### Known behaviours and mitigations

- SMART patient picker needed explicit origin matching; the launcher now uses
  the iframe URL’s origin when negotiating configuration.
- Public sandbox fixtures return `Attachment.data` as free text and use
  `MedicationAdministration.status=not-taken`. The loader sanitises both before
  PUTing resources into HAPI.
- Paging `$everything` for the entire dataset is time-consuming (~31k resources).
  Plan reset windows accordingly; the loader runs with configurable concurrency
  (`CONCURRENCY=8 npm run fixtures:load`).

With these pieces in place the repository is self-sufficient: clone, install,
download fixtures, and bring the stack up with a single Compose command. All
assets, data, and supporting tooling live inside the repo, making it easy to
share or deploy to additional environments just by adjusting env files.
