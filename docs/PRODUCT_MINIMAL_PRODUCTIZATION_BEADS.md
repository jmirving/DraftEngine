# DraftEngine --- Minimal Productization (Beads-Ready MVP Plan)

Goal: **MVP product quality** with **login + per-user pools + global
champion tagging**, backed by Postgres.

Principles: - **Smallest surface area that ships** - **Server
authoritative** - **Monolith** - **DB-backed** - **No net-new "feature"
scope beyond identity + persistence + isolation**

------------------------------------------------------------------------

## Execution Mode

-   **Linear until the MVP "platform spine" is in place** (DB + auth +
    middleware).
-   Then **parallelize** pools vs tagging endpoints & UI wiring.
-   Each bead includes:
    -   **Inputs**
    -   **Outputs**
    -   **Acceptance**
    -   **Dependencies**
    -   **Human Gate** (explicit pause points)

------------------------------------------------------------------------

# Bead Index (MVP)

## Spine (Linear)

-   **BEAD-00** Repo inventory + decisions snapshot
-   **BEAD-01** Env/config scaffold
-   **BEAD-02** DB + migrations framework
-   **BEAD-03** Schema migrations (users/champions/tags/pools)
-   **BEAD-04** Seed pipeline (CSV → DB) + idempotency
-   **BEAD-05** Auth (register/login) + password hashing
-   **BEAD-06** Auth middleware + request context + error format

## MVP Features (Parallel after BEAD-06)

-   **BEAD-07A** Champion + Tag read endpoints
-   **BEAD-07B** Champion tagging write endpoint (global)
-   **BEAD-08A** User pools CRUD (isolated)
-   **BEAD-08B** Pool champions add/remove (isolated)
-   **BEAD-09** Remove CSV runtime dependence (seed-only)
-   **BEAD-10** Deployment hardening checklist (Render-ready)

------------------------------------------------------------------------

# BEADS

## BEAD-00 --- Repo Inventory + Decisions Snapshot

**Purpose:** Create a small, committed snapshot so subsequent beads
don't thrash.

**Inputs** - Current repo state (routes, data loading, existing CSV
usage, existing UI expectations)

**Outputs** - `docs/MVP_DECISIONS.md` containing: - language/runtime
(Node/Python/etc.) - current entrypoints - current data flow (where CSV
is read) - chosen auth approach (JWT + bcrypt) - chosen DB migration
approach - rough endpoint mapping

**Acceptance** - `docs/MVP_DECISIONS.md` exists and is accurate enough
to guide implementation.

**Dependencies** - None

**Human Gate** - ✅ Review `docs/MVP_DECISIONS.md` for correctness
before BEAD-01.

------------------------------------------------------------------------

## BEAD-01 --- Env/Config Scaffold

**Inputs** - Repo - Target env vars: `DATABASE_URL`, `JWT_SECRET`,
optional `PORT`, `NODE_ENV`/`ENV`

**Outputs** - Config module / loader with: - required var validation -
safe defaults where appropriate - single source of truth for config

**Acceptance** - App boots locally and fails fast with clear error if
`DATABASE_URL` or `JWT_SECRET` missing.

**Dependencies** - BEAD-00

**Human Gate** - ✅ Confirm env var names match Render conventions you
intend to use.

------------------------------------------------------------------------

## BEAD-02 --- DB Connection + Migration Framework

**Inputs** - Config scaffold - Chosen DB library + migration tool (per
BEAD-00)

**Outputs** - DB connection module - Migration runner (CLI or npm script
/ make target) - Folder(s): `/migrations` (and `/db` if desired)

**Acceptance** - `migrate up` works against a fresh local DB. -
`migrate down` exists if your tooling supports it (optional). -
Connection errors are readable.

**Dependencies** - BEAD-01

**Human Gate** - ✅ Run migrations locally once; verify tooling
ergonomics.

------------------------------------------------------------------------

## BEAD-03 --- Schema Migrations (MVP Tables)

**Inputs** - Migration framework - MVP schema definitions

**Outputs** Migrations for tables (names flexible): - `users`: id, email
unique, password_hash, created_at - `champions`: id, name unique, role,
metadata_json nullable - `tags`: id, name unique, category -
`champion_tags`: champion_id fk, tag_id fk, uniqueness on (champion_id,
tag_id) - `user_champion_pools`: id, user_id fk, name -
`user_pool_champions`: pool_id fk, champion_id fk, uniqueness on
(pool_id, champion_id)

**Acceptance** - Migrating from empty DB results in all tables +
indexes + constraints. - FK constraints enforced. - Unique constraints
enforced.

**Dependencies** - BEAD-02

**Human Gate** - ✅ Quick sanity check: does schema support "multiple
pools per user" and "global tags"?

------------------------------------------------------------------------

## BEAD-04 --- Seed Pipeline (CSV → DB, Idempotent)

**Inputs** - Existing champions CSV path - Schema in place

**Outputs** - Seed script/command: - imports champions into DB -
optional: seeds initial tags set if you have one - safe to run multiple
times (idempotent)

**Acceptance** - After seed, `GET /champions` (once implemented) would
return full champion list. - Re-running seed does not duplicate rows or
error.

**Dependencies** - BEAD-03

**Human Gate** - ✅ Verify seeded champion identifiers match how
DraftEngine expects to reference champions.

------------------------------------------------------------------------

## BEAD-05 --- Authentication (Register/Login)

**Inputs** - `users` table - bcrypt (or equivalent) + JWT library

**Outputs** Endpoints: - `POST /auth/register` - `POST /auth/login`

Behavior: - register: creates user if email unused - login: verifies
password, returns JWT

**Acceptance** - Passwords are hashed (bcrypt). - JWT contains `sub` or
`user_id`. - Invalid login returns consistent error (no detail leaks). -
Duplicate email returns 409 (or consistent equivalent).

**Dependencies** - BEAD-03

**Human Gate** - ✅ Confirm token claims format you want (e.g.,
`{ sub: userId }`).

------------------------------------------------------------------------

## BEAD-06 --- Auth Middleware + Error Contract

**Inputs** - JWT secret - Auth endpoints

**Outputs** - `requireAuth` middleware: - validates JWT - attaches
`req.user` / context with `userId` - Global error handler producing
consistent JSON errors, e.g.: - `{ error: { code, message, details? } }`

**Acceptance** - Protected route returns 401 without token. - Returns
403 when authenticated user tries cross-user access (when
implemented). - Error response shape consistent across endpoints.

**Dependencies** - BEAD-05

**Human Gate** - ✅ Freeze error response contract (clients depend on
it).

------------------------------------------------------------------------

# PARALLEL SECTION (after BEAD-06)

## BEAD-07A --- Champion + Tag Read Endpoints

**Inputs** - champions/tags tables seeded - auth middleware (optional
for reads)

**Outputs** Endpoints: - `GET /champions` - `GET /champions/:id` -
`GET /tags`

**Acceptance** - Returns deterministic ordering (or documented
ordering). - 404 for unknown champion id. - No CSV reads at runtime.

**Dependencies** - BEAD-04, BEAD-06

**Human Gate** - ✅ Spot-check champion count matches CSV.

------------------------------------------------------------------------

## BEAD-07B --- Global Champion Tagging Write Endpoint

**Inputs** - `tags`, `champion_tags` - Error contract

**Outputs** Endpoint: - `PUT /champions/:id/tags`

Rules: - "Replace entire set" semantics (atomic replace). - Validate tag
ids exist. - Global write allowed to any authenticated user (per MVP
scope).

**Acceptance** - Setting tags updates DB and is reflected in subsequent
reads. - Invalid tag id rejected with 400. - Unknown champion rejected
with 404.

**Dependencies** - BEAD-07A, BEAD-06

**Human Gate** - ✅ Confirm last-write-wins is acceptable for global
tags in MVP.

------------------------------------------------------------------------

## BEAD-08A --- User Pools CRUD (Isolated)

**Inputs** - `user_champion_pools` - auth middleware

**Outputs** Endpoints (all require auth): - `GET /me/pools` -
`POST /me/pools` - `PUT /me/pools/:id` - `DELETE /me/pools/:id`

Rule: - Derive userId from token only (never accept userId in request).

**Acceptance** - User sees only their pools. - Cross-user access
attempts return 403.

**Dependencies** - BEAD-06, BEAD-03

**Human Gate** - ✅ Decide whether pool names must be unique per user
(optional).

------------------------------------------------------------------------

## BEAD-08B --- Pool Champions Add/Remove (Isolated)

**Inputs** - `user_pool_champions` - pools CRUD

**Outputs** Endpoints (auth required): - `POST /me/pools/:id/champions`
(body: champion_id) - `DELETE /me/pools/:id/champions/:champion_id`

**Acceptance** - Adding same champion twice is idempotent or returns 409
(choose one; document). - Removing non-existent membership is idempotent
or returns 404 (choose one; document). - Cannot modify other users'
pools (403).

**Dependencies** - BEAD-08A, BEAD-07A

**Human Gate** - ✅ Lock in idempotency rules (client UX depends on it).

------------------------------------------------------------------------

## BEAD-09 --- Remove CSV Runtime Dependence (Seed-Only)

**Inputs** - Champion reads from DB working - Seed working

**Outputs** - CSV usage removed from runtime codepaths - CSV kept only
as seed input artifact (or downloaded at build-time)

**Acceptance** - App can run after deleting local CSV (post-seed) OR
clearly documents seed requirement. - No request path reads from
filesystem CSV.

**Dependencies** - BEAD-07A

**Human Gate** - ✅ Confirm no hidden code paths still parse CSV.

------------------------------------------------------------------------

## BEAD-10 --- Deployment Hardening (Render-Ready)

**Inputs** - App runs locally with DB - Migration + seed commands exist

**Outputs** - `docs/RENDER_DEPLOYMENT_MVP.md` with: - required env
vars - how migrations run on deploy - how seed is executed (one-time) -
expected base URL config for frontend - Health endpoint (optional but
recommended): `GET /health`

**Acceptance** - Fresh deploy procedure is documented end-to-end. - No
manual SSH steps required.

**Dependencies** - BEAD-02 through BEAD-09

**Human Gate** - ✅ Final "cold deploy" rehearsal checklist before
calling MVP done.

------------------------------------------------------------------------

# MVP STOP CONDITION

Once BEAD-10 passes acceptance: - Stop. - Do not add roles/admin,
history, analytics, workers, or refactors beyond correctness.

------------------------------------------------------------------------

# Optional Next Beads (Not MVP)

-   Admin role for global tag editing
-   Optimistic concurrency for global tags
-   Draft history persistence
-   Evaluation persistence + dashboards
