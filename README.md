# Unified Service Scheduler

Backend for Keyloop's **Scenario A**: a customer books a vehicle in for a service at a dealership and a desired time. The API assigns a free **service bay** and a **qualified technician** for the whole job, holds them (and the vehicle) for the work plus a turnaround buffer, and guarantees that nothing is ever double-booked, even under concurrent requests.

Stack: Node.js 24, TypeScript, NestJS, Kysely, PostgreSQL 16, pino. One modular-monolith process (`platform`, `directory`, `scheduling`) and one database. The full design is in [docs/system-design.md](docs/system-design.md).

## Quick start

### Docker Compose (reviewer path)

```bash
docker compose up --build -d --wait                       # Postgres + app (applies migrations on start) + one-shot seed
curl http://localhost:3200/health                         # {"status":"ok"}
open http://localhost:3200/docs                           # Swagger UI
```

A one-shot `seed` service loads the Northbridge sample world once the app is healthy, then exits 0. It uses `INSERT … ON CONFLICT DO NOTHING` on fixed ids, so it is idempotent: every `up` reruns it and running it again (`docker compose run --rm seed`) changes nothing.

The containerised app listens on host port **3200** (container port 3000). Port 3100 is left for `npm run start:dev`, so a local dev server and the container can run side by side against the same database. Postgres is published on host port **5433**, not 5432, to avoid clashing with a local Postgres. Both ports are bound to `127.0.0.1`, so neither is reachable from the network. The Postgres password defaults to `scheduler`; set `POSTGRES_PASSWORD` (shell or `.env`) to change it. Compose uses the same variable for the app's `DATABASE_URL`. Postgres only applies it when the volume is first created, so run `docker compose down -v` after changing it.

### Local (Node 22+)

```bash
cp .env.example .env
npm install
docker compose up -d postgres
npm run db:migrate && npm run db:seed
npm run start:dev                                         # http://localhost:3100, Swagger at /docs
```

Configuration is `DATABASE_URL` and `PORT`, plus optional `LOG_LEVEL` and `SWAGGER_ENABLED`. `SWAGGER_ENABLED` defaults to `true`, or `false` when `NODE_ENV=production`. The image sets `NODE_ENV=production`, and compose turns Swagger back on explicitly for the demo.

HTTP hardening: [helmet](https://helmetjs.github.io/) security headers with a Content-Security-Policy that still allows Swagger UI (same-origin scripts only), no `X-Powered-By`, and a 100 kB JSON body limit. Every response carries `X-Request-Id`, including 400 "Malformed JSON body" and 413 "Request body too large".

## Tests

```bash
npm test          # unit: window and opening-hours rules, pair ordering, retry loop, idempotency, availability
npm run test:int  # integration against the compose Postgres (recreates a separate scheduler_test database)
npm run lint && npm run build
```

Integration tests run the real Nest app in-process against real Postgres. They cover:

- each exclusion constraint on its own, including the 15-minute buffer boundary (10:14 rejected, 10:15 accepted);
- opening hours, the soft preference and its fallbacks;
- a scripted race that makes Postgres raise a genuine `23P01`, followed by a successful retry;
- idempotent replay and key mismatch, and cancel then rebook;
- **20 parallel bookings for one free pair: exactly one 201, nineteen 409s, one row**.

## API overview

Examples use the seeded Northbridge ids. Find them with `GET /dealerships` (list) and `GET /dealerships/:id` (opening hours, bays, technicians with skills, service types); the customer and vehicle ids are in `src/db/seed-data.ts`. All times are ISO-8601 instants **with an offset**.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/dealerships` | List dealerships (id, name, timezone). Read-only. |
| `GET` | `/dealerships/:id` | One dealership with opening hours, bays, technicians and their skills, and service types. 404 if unknown. |
| `GET` | `/availability` | Can this service start at this time? Returns ranked free (bay, technician) pairs. Read-only, holds nothing. |
| `POST` | `/appointments` | Book. Optional `Idempotency-Key` header. 201 new, 200 replay. |
| `GET` | `/appointments/:id` | Fetch one appointment. |
| `PATCH` | `/appointments/:id/cancel` | Cancel; frees the slot immediately. Repeating it returns the same row. |
| `GET` | `/health` | `SELECT 1` against Postgres; 503 when unreachable. |

```bash
curl http://localhost:3200/dealerships                    # → Northbridge, id …001
curl http://localhost:3200/dealerships/00000000-0000-4000-8000-000000000001   # bays, technicians, service types

D=00000000-0000-4000-8000-000000000001   # Northbridge
FS=00000000-0000-4000-8000-000000000301  # Full service, 90 min, needs full_service (only Sam)
PRIYA=00000000-0000-4000-8000-000000000202

curl "http://localhost:3200/availability?dealershipId=$D&serviceTypeId=$FS&startAt=2030-01-08T09:00:00Z&preferredTechnicianId=$PRIYA"
# 200 {"available":true,"preferenceHonored":false,...,"blockedUntil":"2030-01-08T10:45:00.000Z","candidates":[{"bayId":"…101","technicianId":"…201"},…]}

curl -X POST http://localhost:3200/appointments \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: demo-1' \
  -d '{"dealershipId":"'$D'","customerId":"00000000-0000-4000-8000-000000000401",
       "vehicleId":"00000000-0000-4000-8000-000000000501","serviceTypeId":"'$FS'",
       "startAt":"2030-01-08T09:00:00Z","preferredTechnicianId":"'$PRIYA'"}'
# 201 {"id":"…","technicianId":"…201","bayId":"…101","preferenceHonored":false,
#      "endAt":"2030-01-08T10:30:00.000Z","blockedUntil":"2030-01-08T10:45:00.000Z","status":"confirmed",…}
# Same request + same key again → 200 with the same body. Same key, different body → 409.

curl http://localhost:3200/appointments/<id>
curl -X PATCH http://localhost:3200/appointments/<id>/cancel
```

Errors always use `{statusCode, error, message, requestId}`, and every response echoes `X-Request-Id`.

| Status | Meaning |
| --- | --- |
| 400 | Malformed body or query, non-UUID id, or `startAt` without an offset |
| 404 | Unknown dealership, service type, customer, vehicle, technician or appointment |
| 409 | No free bay + qualified technician pair (after up to 3 insert attempts), or an `Idempotency-Key` reused with a different body |
| 422 | Work outside opening hours, start in the past, or the vehicle does not belong to the customer |

The full contract, with examples for every error, is in Swagger at `/docs`.

## Key design decisions

Details and alternatives are in [docs/system-design.md](docs/system-design.md).

- **The database is the lock.** Three Postgres exclusion constraints (`appointments_bay_no_overlap`, `appointments_technician_no_overlap`, `appointments_vehicle_no_overlap`) forbid two non-cancelled appointments that share a bay, a technician or a vehicle from having overlapping `[start_at, blocked_until)` ranges. `btree_gist` lets one GiST index combine `=` on the id with `&&` (overlap) on the time range. Because the rule lives in the schema, it holds across replicas and across any future code path. See [Concurrency](docs/system-design.md#concurrency).
- **No deadlocks under a burst.** An exclusion-constraint INSERT can wait on another in-flight overlapping INSERT, and two such inserts deadlock (SQLSTATE `40P01`, broken by Postgres only after 1 s). The INSERT therefore runs in a short transaction that first takes `pg_advisory_xact_lock` on the bay, technician and vehicle ids in sorted order; overlapping inserts queue for milliseconds and the loser gets a clean `23P01`. The lock is held for the INSERT only, never across the availability read, and the constraints still decide. See [Concurrency](docs/system-design.md#concurrency).
- **Optimistic insert, retry on `23P01`.** Booking reads the free pairs, then INSERTs the best one. `23P01` is Postgres's SQLSTATE for `exclusion_violation`. It is raised when the row overlaps an existing one, and the error names the constraint. The code (`PG_EXCLUSION_VIOLATION` in `src/db/pg-errors.ts`) drops that bay, technician or vehicle and tries the next pair, with at most 3 inserts, then 409. Pessimistic `SELECT … FOR UPDATE` was rejected because a free slot has no row to lock (the phantom problem).
- **Turnaround buffer.** Each dealership has `buffer_minutes` (15 at Northbridge). It is copied onto the appointment and stored as `blocked_until = end_at + buffer`. That is a plain column pinned by a `CHECK`, not a generated column, because `timestamptz + interval` is not immutable and Postgres only allows immutable expressions in indexes and generated columns. A job ending at 10:00 holds its resources until 10:15. The work must fit in opening hours (dealership timezone, via Luxon), but the buffer may run past close. See [Turnaround buffer](docs/system-design.md#turnaround-buffer).
- **Soft preferred technician.** A preferred technician who is free and qualified is tried first. If they are busy, unqualified, inactive or at another site, the booking falls back to another qualified technician. `preferenceHonored` (`true`/`false`/`null`) says what happened. An unknown technician id is 404.
- **Idempotency.** `Idempotency-Key` is stored on the appointment together with a SHA-256 of the canonical body, in the same INSERT. A replay returns the original appointment with 200, and a different body returns 409. The race between two retries of the same key is handled inside the `23P01` path, so a client never gets a 409 for a booking that actually exists.
- **One rule path.** `GET /availability` and `POST /appointments` share `CandidateFinder` (window, hours, skills, ordering), so availability cannot disagree with booking.

## Trade-offs and known limitations

- **Deterministic pair order** (preferred technician, then lowest bay id, then lowest technician id) keeps retries predictable and tests deterministic. The cost is that it fills the lowest bay first; spreading load across bays would be the first change once a diary view exists.
- **Availability is a hint, not a hold.** Two clients can both see a slot as free; the INSERT decides, and the loser gets 409.
- **Integration tests use the Compose Postgres** (a separate `scheduler_test` database), not Testcontainers. This keeps one container for local and CI. Testcontainers is the upgrade if CI cannot share a database.
- **Not built (out of scope for v1):**
  - authentication and authorisation (`customerId` is a body field, not an identity), and rate limiting;
  - technician shifts, multi-skill jobs, bay capabilities, rescheduling as one operation;
  - notifications, metrics and tracing;
  - **create/update/delete APIs for master data** (dealerships, opening hours, bays, technicians, skills, service types, customers, vehicles). This data comes from the seed; v1 exposes it read-only through `GET /dealerships` and `GET /dealerships/:id` so a client can discover ids. Writes belong in a later Directory/admin module behind authentication and role-based authorisation, or would be synced from the dealer management system (DMS).
- **SLOs in the design are assumed targets.** No load test has been run.

## Assumptions

Summarised from [Assumptions](docs/system-design.md#assumptions):

- **Durations, buffer and hours:**
  - Duration comes from the service type, and the client never sends an end time.
  - The buffer is 15 minutes per dealership.
  - Availability follows dealership opening hours only; there are no technician shifts.
- **Resources and identity:**
  - Each service type requires exactly one skill.
  - Bays are interchangeable.
  - The vehicle must belong to the customer.
- **Booking rules:**
  - The vehicle constraint is kept on purpose, beyond the brief: one car cannot be in two appointments at once.
  - A start more than one minute in the past is rejected.
  - There is no fixed slot grid; any minute is a legal start.
  - Statuses are `confirmed` and `cancelled` only. Cancelling frees the slot at once and keeps the row.

## Evolution path

The system stays one process because the invariant needs one database. The next pieces to split out would be notifications and DMS sync, via a transactional outbox and a broker. See [Evolution path](docs/system-design.md#evolution-path).

## AI collaboration

I used an AI coding assistant (Cursor) throughout. I set the direction and made the decisions; the AI drafted the design, code, tests and docs, and I reviewed every change. The dated record is in [docs/ai-collaboration-log.md](docs/ai-collaboration-log.md), and the design-stage detail is in [GenAI in design](docs/system-design.md#genai-in-design).

**How I directed it**

- **Design first, code second.** When the AI started writing code before the design was reviewed, I stopped it and asked for the design document only. Code began after I approved the design, and then in slices (schema, booking, availability/cancel, container/docs), each approved before the next.
- **Fixed constraints up front:** Scenario A, backend only; NestJS + TypeScript + Kysely + PostgreSQL; no bay, technician or vehicle double-booked; correctness enforced in the database, not in application memory.
- **The AI never commits or pushes.** It may stage files when I ask; I commit every change myself.
- **Verify by running, not by claiming.** Each slice was reported with the actual test counts, curl output and compose state.

**What I changed or rejected**

- **Concurrency.** The AI's first proposal was pessimistic `SELECT … FOR UPDATE`. I replaced it with optimistic insert, retry on `23P01` (max 3 inserts, then 409), and exclusion constraints as the lock, because `FOR UPDATE` cannot lock a slot that has no row yet.
- **Assumptions I decided:** a 15-minute buffer per dealership, the preferred technician as a soft preference with fallback, opening hours only, and keeping the vehicle constraint beyond the brief.
- **Use each library natively.** I rejected the AI's custom runner for `.sql` migrations: having chosen Kysely, the project uses Kysely's own `Migrator` and TypeScript migrations.
- **Swagger.** I required Swagger docs for every endpoint, and had the raw `/docs-json` route turned off as unnecessary.
- **Scope.** I asked how a reviewer gets the ids. I accepted the AI's advice to add read-only `GET /dealerships` endpoints and an auto-seed instead of CRUD APIs for master data.
- **Security pass.** I asked the AI to attack the API as a hacker would, looking for leaked configuration. It found no secrets, and I had the low-severity findings fixed (localhost-only ports, helmet/CSP, `SWAGGER_ENABLED`, no `X-Powered-By`, body limits).
- **Writing.** Generic justifications were replaced with concrete reasons, and codes like `23P01` are explained where they first appear.

**A flaky test, not accepted as flaky**

The 20-parallel-bookings test hung in about one run in four. The AI's first guess (connection handling) was wrong. It traced the hang, from `pg_stat_activity` and the Postgres log, to `40P01` deadlocks: two overlapping INSERTs each wait on the other's uncommitted row during the exclusion-constraint check. A retry-only fix was measured and made things worse. The kept fix takes a transaction-scoped `pg_advisory_xact_lock` on the bay, technician and vehicle just around the INSERT, while the constraints still decide the winner. It passed 80 runs in a row with no deadlocks logged.

**What I verified myself**

- I read the design document against the brief before any code was written, had it restructured (C4, explicit FR/NFR/SLO sections, traceability) and approved it only then. Each implementation slice was reviewed and approved before the next one started.
- I checked the Postgres facts the design rests on: a `btree_gist` exclusion constraint can combine `=` on a uuid with `&&` on a range, a half-open range lets a booking start exactly at the previous `blocked_until`, and `timestamptz + interval` is not immutable, which is why `blocked_until` is a stored column pinned by a check.
- I reviewed the concurrency path: optimistic insert, `23P01` mapped to "try the next pair", at most three inserts, then 409. I also reviewed the deadlock fix, to confirm the exclusion constraints still decide the winner and the advisory lock covers only the INSERT. I asked for the 20-parallel test to be re-run after the fix rather than trusting the first result: 30 more isolated runs passed, with no `40P01` in the Postgres log.
- I checked that the API is documented in Swagger at `/docs`, and that reviewers can find every id through `GET /dealerships` and the seed.
- I asked for the "attack it like a hacker" probe of configuration leaks and decided which findings to fix.
- I reviewed the staged changes before committing them myself.

**Where AI helped most, and where it needed correcting**

The AI was fastest at the volume work: scaffolding the NestJS project, writing the Kysely queries and migration, Swagger decorators and examples, the unit and integration tests, and first drafts of the docs. It also earned its keep on the flaky test. It read `pg_stat_activity` and the Postgres log, found the real cause, and measured a fix that did not work before settling on one that did.

It needed correcting on judgement more than on syntax. It started writing code before the design was agreed. Its first concurrency idea was `SELECT … FOR UPDATE`, which cannot lock a slot that has no row yet. It built a custom migration runner instead of using Kysely's own `Migrator`. Its first guess about the flaky test (connection handling) was wrong. It also tended to report work as done before running it, so I made "verify by running it first" a standing rule.
