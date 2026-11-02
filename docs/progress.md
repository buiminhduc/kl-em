# Progress

Implementation follows the approved design in [system-design.md](system-design.md).

## Slice 1 — scaffold, schema, constraint tests (done, 30 Oct 2026)

**What exists**

- NestJS + TypeScript project, modular monolith: `platform` (config, Kysely client, pino JSON logs with request id, `GET /health`), `directory` and `scheduling` (empty shells; filled in slices 2–3).
- `docker-compose.yml`: Postgres 16 on host port 5433.
- `src/db/migrations/0001_schema.ts` (Kysely migration with `up`/`down`; schema builder for tables, keys and simple checks, raw `sql` for `btree_gist`, the exclusion constraints and the `blocked_until` check): all tables from the domain model, composite FKs, check constraints, `blocked_until` as a stored column pinned by `appointments_buffer_matches_end`, and the three `btree_gist` exclusion constraints (`appointments_bay_no_overlap`, `appointments_technician_no_overlap`, `appointments_vehicle_no_overlap`) over `[start_at, blocked_until)` where `status <> 'cancelled'`.
- Migrations run with Kysely's native `Migrator` + `FileMigrationProvider` (`src/db/migrator.ts`, imported from `kysely/migration`), used by `npm run db:migrate`, by the app at startup, and by the integration-test setup. Kysely tracks applied migrations in `kysely_migration` and serialises runners with `kysely_migration_lock`. Migration files are loaded with `require` via the provider's `import` option, so the same code works under ts-node (`.ts`), Jest (`.ts`) and the built `dist` (`.js`). Handwritten Kysely types in `src/db/types.ts`.
- `npm run db:seed`: Northbridge sample world with fixed UUIDs (`src/db/seed-data.ts`).
- Named SQLSTATE constants in `src/db/pg-errors.ts` (`PG_EXCLUSION_VIOLATION = '23P01'`, etc.).
- Integration tests (`test/integration/`) insert rows directly and prove: bay overlap → `23P01` naming `appointments_bay_no_overlap`; 15-minute buffer (job ends 10:00 → 10:14 rejected, 10:15 allowed); technician and vehicle overlap each rejected by their own constraint; cancelled rows free the slot; a wrong `blocked_until` fails the check (`23514`); `GET /health` returns `{status: ok}` and echoes `X-Request-Id`.

**Result (re-verified 31 Oct after the migrator change, dev and test databases recreated from scratch):** `npm test` 2/2 passed, `npm run test:int` 8/8 passed (2 suites), `npm run lint` and `npm run build` clean.

**How to run**

```bash
cp .env.example .env
npm install
docker compose up -d --wait
npm run db:migrate
npm run db:seed
npm test            # unit, no database
npm run test:int    # integration, recreates scheduler_test on the compose Postgres
npm run build && npm start   # applies migrations, listens on PORT (3100 in .env.example)
curl http://localhost:3100/health
```

**Deviations from the design (slice 1)**

- Integration tests use the docker-compose Postgres (a separate `scheduler_test` database recreated per run) instead of Testcontainers. The design names Compose as the fallback; this keeps slice 1 to one container. Revisit in slice 4.
- `docker compose up` currently starts Postgres only; the app container is added in slice 4.
- Jest runs with `--experimental-vm-modules` because NestJS 12 and Kysely 0.29 ship as ES modules.

## API documentation (Swagger / OpenAPI, added 31 Oct 2026)

- `@nestjs/swagger` with `DocumentBuilder` + `SwaggerModule.setup` (`src/platform/swagger.ts`): UI at `/docs`; raw JSON/YAML spec endpoints disabled (`raw: false`), per Đức.
- `GET /health` is documented (`@ApiTags('health')`, `@ApiOkResponse`, `@ApiServiceUnavailableResponse`). Verified: `/docs` returns 200 and shows `/health` with 200 and 503.
- The Swagger CLI plugin is **not** enabled: it only runs through `nest build` (the Nest CLI), and this project builds with plain `tsc`. Decorators are written explicitly instead, which also keeps the contract visible in code review.
- **Rule for every future endpoint:** it must carry Swagger decorators: `@ApiTags`, `@ApiOperation`, request DTO classes with `@ApiProperty`, response DTOs via `@ApiOkResponse` / `@ApiCreatedResponse`, and every error the design lists (`@ApiBadRequestResponse` 400, `@ApiNotFoundResponse` 404, `@ApiConflictResponse` 409, `@ApiUnprocessableEntityResponse` 422), plus `@ApiHeader` for `Idempotency-Key` on `POST /appointments`.

## Slice 2 — booking: POST /appointments (done, 31 Oct 2026)

**What exists** (class names follow the design's Level 4 sketch)

- `src/scheduling/`: `AppointmentsController` (`POST /appointments`), `BookingService` (retry loop), `BookingPolicy` (window, opening hours in the dealership timezone via Luxon, one-minute past tolerance), `CandidateSelector` (preferred technician first, then lowest bay id, then lowest technician id; drops the resource named by the violated constraint), `AppointmentRepository` (free-bay / free-technician queries with the same `tstzrange … &&` predicate as the constraints; maps SQLSTATE `23P01` → `SlotUnavailableError` and `23505` on `idempotency_key` → `IdempotencyKeyTakenError`), `BookingHooks` (the design's no-op `afterCandidatesSelected` test seam), domain errors in `errors.ts`, request hash in `request-hash.ts`, DTOs in `dto/`.
- `src/directory/DirectoryReader`: dealership + hours, service type, customer, vehicle, technician read models.
- Platform: global `ValidationPipe` (class-validator DTOs, unknown fields rejected) and `HttpExceptionFilter` producing the design's error body `{statusCode, error, message, requestId}`: 400 validation, 404 unknown ids, 409 no pair / retries exhausted / key reused with a different body, 422 outside hours, start in the past, or vehicle not the customer's.
- Booking: optimistic INSERT, on `23P01` (`exclusion_violation`) drop that bay / technician / vehicle and try the next pair, at most 3 inserts, then 409. Logs `booked` / `retry` / `conflict` with ids only.
- `Idempotency-Key`: SHA-256 of the sorted canonical body (startAt normalised to UTC) stored with the row; same key + same body → 200 with the original appointment, different body → 409. Handled before booking, on the unique violation, and inside the `23P01` path.
- Swagger: request/response DTOs, `@ApiHeader('Idempotency-Key')`, 200/201/400/404/409/422 documented.

**Result:** lint and build clean; `npm test` 19/19 (4 suites); `npm run test:int` 21/21 (3 suites, run 4 times in a row, all green), including the 20-parallel-post test (exactly one 201, nineteen 409, one row).

**Deviations / additions in slice 2**

- The 20-parallel concurrency test and the scripted-`23P01` hook test were planned for slice 4 / the full suite; they are already in slice 2.
- `Idempotency-Key` longer than 255 characters or empty is rejected with 400 (the design does not set a limit).
- A replay is checked by key **before** validation of hours/references as well as in the conflict path, so a replay after commit returns 200 even if, say, the start time is now in the past.
- Unknown fields in the body are rejected with 400 (`forbidNonWhitelisted`); the design only specifies 400 for a malformed body.

## Slice 3 — availability, fetch, cancel (done, 31 Oct 2026)

**What exists**

- `GET /availability?dealershipId&serviceTypeId&startAt[&preferredTechnicianId]` (`AvailabilityService.findFreeSlots`): read-only answer for one proposed start, as the design's API contract specifies: `available`, `preferenceHonored`, `startAt`/`endAt`/`blockedUntil`, `bufferMinutes`, `durationMinutes`, and up to 20 ranked `candidates`. Nobody free → 200 with `available: false`. Outside hours / past → 422; unknown dealership, service type or technician → 404; bad query → 400.
- `CandidateFinder` (new): the single place that loads dealership + service type, checks the preferred technician exists, applies `BookingPolicy` (past, window, opening hours) and ranks free pairs with `CandidateSelector`. Both `BookingService.book` and `AvailabilityService` call it, so availability and booking cannot drift apart.
- `GET /appointments/:id` → 200, 404 unknown, 400 non-UUID (Nest `ParseUUIDPipe`).
- `PATCH /appointments/:id/cancel` → single `UPDATE … WHERE status = 'confirmed'` sets `cancelled` + `cancelled_at = now()`; a repeat cancel returns 200 with the same row and unchanged `cancelledAt`; 404 unknown; 400 non-UUID. Logs `outcome: cancelled`.
- Swagger: query DTO, `AvailabilityResponseDto`, `CandidatePairDto`, `@ApiParam` for ids, 200/400/404/422 documented. Verified via `/docs/swagger-ui-init.js`: all five operations and their response codes are present.

**Result:** lint and build clean; `npm test` 24/24 (5 suites); `npm run test:int` 32/32 (4 suites), run twice, both green. New integration tests: FR-1 availability (pairs, no write), qualified-only + preference false, "reported available → booked with the first candidate → disappears", 15-minute buffer at 10:14 vs 10:15, nobody free → `available: false`, 422/404/400; get by id 200/404/400; cancel → rebook the same bay, technician and vehicle for the same window; repeat cancel unchanged; cancel 404/400.

**Decisions where the design was silent (slice 3)**

- Availability answers **one proposed start** (the design's contract), not a list of slots over a day; there is no slot granularity in the design ("any minute is a legal start"). A day view would be a later endpoint.
- Availability applies the same "not more than a minute in the past" rule as booking (422), because it reuses `CandidateFinder`.
- An appointment in the past can still be cancelled; the design sets no restriction.
- Cancel never returns 409: the design says a repeat cancel returns the same row (200).

## Slice 4 — container, API docs review, README (done, 31 Oct 2026)

**What exists**

- `Dockerfile`: multi-stage on `node:24-alpine` (current LTS line). The build stage compiles with dev dependencies; the runtime stage installs `npm ci --omit=dev` only, copies `dist/`, and runs as the image's unprivileged `node` user (uid 1000). `.dockerignore` keeps `node_modules`, `.git`, `.idea`, `.env`, tests and docs out of the build context.
- `docker-compose.yml`: new `app` service (`kl-em-app`). It waits for Postgres to be healthy (`depends_on: condition: service_healthy`), applies migrations on start (`main.ts` → `migrateToLatest`), and has its own `/health` healthcheck.
- **Port choice:** the container listens on 3000 and is published on host **3200**. 3100 stays free for `npm run start:dev`, so both can run at once against the same database. Host ports 3000–3006 are taken on this Mac (the lab-control-plane container and kubectl port-forwards), and Postgres stays on host 5433. No compose profile is used, so a reviewer's plain `docker compose up --build` starts everything.
- Seed moved from `scripts/seed.ts` to `src/db/seed.ts`, so it is compiled into the image: `docker compose exec app node dist/db/seed.js`. `npm run db:seed` still works locally.
- Swagger review:
  - API description and tag descriptions;
  - examples on every DTO field (seed ids, so "Try it out" works);
  - named error examples for every 400/404/409/422 response (`src/platform/swagger-examples.ts`);
  - the `:id` parameter has an example.
- `README.md` draft for the reviewer. The "AI collaboration" section is a placeholder for Đức.

**Verification (31 Oct)**

- `docker compose build --no-cache app`, then `docker compose up -d --build --wait`: app healthy and running as uid 1000. `/health` returned 200 `{"status":"ok"}`, `POST /appointments` 201, `GET /appointments/:id` 200, `/docs/` 200, `GET /availability` 200.
- From an empty database, using the built image (throwaway `scheduler_scratch` database, dropped afterwards): the container logged `migration 0001_schema: Success`, `/health` was ok, and `node dist/db/seed.js` seeded it.
- `/docs/swagger-ui-init.js` lists all 5 operations with summaries. Error examples per operation:
  - `/availability`: 400 ×1, 404 ×2, 422 ×3;
  - `POST /appointments`: 400 ×1, 404 ×1, 409 ×2, 422 ×3;
  - get by id and cancel: 400 and 404, one each.
- Lint and build clean; `npm test` 24/24; `npm run test:int` 32/32, run twice.

## Security hardening (done, 31 Oct 2026)

Đức asked for an exploratory probe ("could random API calls expose any config?"). It found no secret leaks and no SQL injection. These smaller findings were fixed:

- **Compose ports:** bound to `127.0.0.1` (5433, 3200). The Postgres password comes from `${POSTGRES_PASSWORD:-scheduler}`, which also builds the app's `DATABASE_URL`.
- **Security headers:** helmet adds them, with a CSP that keeps Swagger UI working (same-origin scripts only; inline styles and `data:` images allowed). `X-Powered-By` is removed.
- **Swagger flag:** `SWAGGER_ENABLED` defaults to on, or off when `NODE_ENV=production`. Compose sets it to `true` explicitly for the demo.
- **Request id before body parsing:** `src/platform/http-setup.ts`, with the app created with `bodyParser: false`. Invalid JSON returns 400 "Malformed JSON body" and an oversized body returns 413 "Request body too large". Both carry `requestId` and `X-Request-Id`, and no parser internals are echoed.
- **Logging levels:**
  - HttpExceptions (including the 503 from `/health`) are logged at warn without a stack. Only unexpected 5xx errors are logged at error.
  - The pino-http access line no longer attaches a synthetic error stack.
- **Source maps:** `sourceMap: false` in `tsconfig.build.json`.
- **Extra fix found while probing:** stopping Postgres crashed the app with an unhandled pg Pool `'error'` event (57P01 on an idle connection). The pool now has an error listener (`createDb`), which logs at warn. `/health` returns 503 while the database is down and recovers on its own.

**Verification (31 Oct)**

- Lint and build clean.
- `npm test`: 28/28.
- `npm run test:int`: 36/36, including the new `http-hardening.int-spec.ts`, run 10+ times. There was one earlier flaky failure of the 20-parallel-posts concurrency test that did not reproduce.
- Compose rebuilt:
  - `docker compose ps` shows `127.0.0.1:3200->3000` and `127.0.0.1:5433->5432`; ports are not reachable on the LAN IP.
  - Headers and CSP are present; malformed JSON returns 400 and a 200 kB body returns 413, each with a request id.
  - All `/docs` assets return 200. Headless Chrome renders the Swagger UI with no CSP violations.
  - A Postgres stop/start gives 503, then 200, and the app stays up. Logs are clean.
- Still public while Swagger is on: `/docs/package.json` (swagger-ui-dist 5.34.0) and the full spec in `/docs/swagger-ui-init.js`. This is expected for a docs UI; it is off by default in production.

## Directory read API, compose auto-seed, concurrency deadlock fix (done, 2 Nov 2026)

**What changed**

- `GET /dealerships` and `GET /dealerships/:id` (Directory module, read-only, Swagger-documented) so a client can discover ids. No write API for master data (see README out-of-scope).
- Compose `seed` service: one-shot, runs after the app is healthy (migrations applied), then exits 0.
- **Fixed the flaky "20 parallel posts" test.** Root cause, read from `pg_stat_activity` during a hang and the Postgres log: not connection handling or app close, but **Postgres deadlocks (`40P01` deadlock_detected) between overlapping INSERTs**. Each INSERT writes its row and then checks the exclusion constraint; two in flight each see the other's uncommitted row and wait for each other. Postgres breaks one cycle per `deadlock_timeout` (1 s), so the burst took over the 5 s Jest timeout, and `afterAll` then hung on the in-flight requests. Retrying the `40P01` victim alone was tried and measured worse (10/30 failing). Fix: `AppointmentRepository.insert` runs in a short Kysely transaction that first takes `pg_advisory_xact_lock` on the bay, technician and vehicle ids (sorted order), then INSERTs. The exclusion constraints still decide; `40P01` is also mapped to `InsertDeadlockError` and retried on the same pair within the 3-attempt budget as a backstop. Design doc Concurrency section updated.

**Verification (2 Nov, Asia/Saigon)**

- `docker compose down -v && docker compose up -d --build --wait`: postgres and app healthy, seed exited 0. Row counts: dealerships 1, hours 6, bays 2, technicians 2, technician_skills 4, skills 3, service types 3, customers 1, vehicles 1, appointments 0. Seed run twice more (`docker compose run --rm seed`): counts unchanged.
- `GET /dealerships` and `/dealerships/:id` return Northbridge on 3200; unknown id 404. README demo booking: 201, replay with the same key 200, cancel 200.
- Before the fix: 7/30 and 10/30 isolated runs of the concurrency test failed. After: 80/80 passed (each under 1 s), zero `deadlock detected` lines in the Postgres log during the last 50.
- `npm run test:int` 40/40 three times in a row (6 suites, including `directory.int-spec.ts`); `npm test` 29/29 (new unit test for the `40P01` retry); lint and build clean. Compose app rebuilt with the fix and healthy.

## Status

Slices 1–4, the Directory read API and the concurrency fix are done. Nothing is paused.

**Left for Đức:**

- Write the README "AI collaboration" section.
- Review the README and the design doc's GenAI section in his own voice.
- Commit.
- Record the video.
