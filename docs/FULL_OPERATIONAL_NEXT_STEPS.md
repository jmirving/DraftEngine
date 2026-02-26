# DraftEngine: Full Operational Runbook

Last updated: 2026-02-26

This document is written so an AI agent can execute each workstream end-to-end with objective completion gates.

## Scope and Current State

Current deployed service behavior:
1. UI is served at `/`.
2. API is served from the same service (`/health`, `/auth/*`, `/champions`, `/me/pools/*`, etc.).
3. Champion reads are API-backed in frontend.
4. Runtime frontend app path does not fetch `team_pools.csv` or `config.json`; authenticated pool/team state is API-backed.

Policy decisions:
1. Champion tag edits remain allowed for any authenticated user.
2. Team administration must be lead-gated (one or more leads per team).

## Completion Snapshot (2026-02-26)

1. Workstream 1: Complete in code + tests.
2. Workstream 2: Complete in code + tests.
3. Workstream 3: Complete in code + tests.
4. Workstream 4: Complete in code + tests (artifact + manifest committed).
5. Workstream 5: Complete in code + static checks.
6. Workstream 6: Render smoke gate requires post-push deploy verification (tracked via Beads).

## Global Preconditions

Before starting any workstream:
1. `npm ci` succeeds.
2. `npm test` passes.
3. API starts locally with valid env:
   - `DATABASE_URL`
   - `JWT_SECRET`
4. No completed end result may require changing deploy build/start commands:
   - Build must remain: `npm ci && npm run migrate:up`
   - Start must remain: `npm run start:api`

## Global Done Rules

A workstream is only complete when all are true:
1. Relevant tests exist and pass.
2. Manual API checks in this doc pass with expected status/body shape.
3. Any related Bead status is updated.
4. This file is updated to reflect new current state.

## Workstream 1: Auth UX + Session (BEAD-11 / draftflow-72)

Status: Completed on 2026-02-26.

Goal:
1. A user can register, login, persist session, logout, and access protected API operations from UI.

Required backend contract (already implemented, must remain true):
1. `POST /auth/register` with `{email,password}` -> `201` and `{token,user}`.
2. `POST /auth/login` with `{email,password}` -> `200` and `{token,user}`.
3. Invalid login -> `401` with `{error:{code:"UNAUTHORIZED"}}`.

Frontend deliverables:
1. Register/Login/Logout controls in UI.
2. JWT persisted (MVP acceptable: `localStorage`).
3. Protected API calls include `Authorization: Bearer <token>`.
4. Token failure path clears session and returns user to auth state.

Validation commands:
```bash
# Register
curl -s -X POST "$BASE_URL/auth/register" \
  -H "content-type: application/json" \
  -d '{"email":"user1@example.com","password":"strong-pass-123"}'

# Login
curl -s -X POST "$BASE_URL/auth/login" \
  -H "content-type: application/json" \
  -d '{"email":"user1@example.com","password":"strong-pass-123"}'
```

Automated test expectations:
1. `tests/server/app.api.test.mjs` auth tests remain passing.
2. UI test coverage for auth session behavior is added (new or existing test file).

Implemented coverage:
1. `tests/ui/app.auth-pools-teams.test.mjs` login/session persistence assertions.
2. 401 pool create test verifies automatic session clear path.

Close criteria:
1. Fresh user can register/login from UI.
2. Page refresh keeps session.
3. Logout removes token and protected calls fail with `401`.

## Workstream 2: Team Context + Player Pools on API (BEAD-12 / draftflow-70)

Status: Completed on 2026-02-26.

Goal:
1. Team Context and Player Pools no longer rely on local runtime CSV mutations for authenticated user state.

Required backend contract (already implemented, must remain true):
1. `GET /me/pools` -> `200`.
2. `POST /me/pools` -> `201`.
3. `PUT /me/pools/:id` -> `200`.
4. `DELETE /me/pools/:id` -> `204`.
5. `POST /me/pools/:id/champions` -> `200`.
6. `DELETE /me/pools/:id/champions/:champion_id` -> `200`.
7. Cross-user pool mutation -> `403`.

Frontend deliverables:
1. CRUD operations in Team Context/Player Pools wired to `/me/pools*`.
2. UI handles `401` and `403` explicitly.
3. Local CSV is not used as authority for authenticated pool state.

Validation commands:
```bash
# Requires TOKEN from login
curl -s "$BASE_URL/me/pools" -H "Authorization: Bearer $TOKEN"
curl -s -X POST "$BASE_URL/me/pools" -H "Authorization: Bearer $TOKEN" \
  -H "content-type: application/json" -d '{"name":"Main"}'
```

Automated test expectations:
1. `tests/server/app.api.test.mjs` pool isolation tests remain passing.
2. UI integration tests cover pool CRUD wiring and auth errors.

Implemented coverage:
1. `tests/ui/app.auth-pools-teams.test.mjs` pool create + auth header + 401 handling.
2. Frontend pool edit path syncs `/me/pools/:id/champions*`.

Close criteria:
1. A logged-in user can manage only their own pools end-to-end in UI.
2. Cross-user attempts are denied with `403`.

## Workstream 3: Team-Lead Governance (BEAD-15/16/17 / draftflow-76/74/75)

Status: Completed on 2026-02-26.

Goal:
1. Team admin actions are restricted to team leads, with support for multiple leads per team.

Schema deliverables:
1. `teams` table.
2. `team_members` table with `(team_id, user_id)` uniqueness.
3. Membership role enum/value set: `lead|member`.
4. Constraint: each team must always have at least one lead (enforced in API logic at minimum; DB enforcement preferred if practical).

API contract to implement:
1. `POST /teams` (auth): create team, creator becomes lead.
2. `GET /teams` (auth): list teams current user belongs to.
3. `PATCH /teams/:id` (auth + lead): update team metadata.
4. `DELETE /teams/:id` (auth + lead): delete team.
5. `GET /teams/:id/members` (auth + membership): list members.
6. `POST /teams/:id/members` (auth + lead): add member.
7. `DELETE /teams/:id/members/:user_id` (auth + lead): remove member.
8. `PUT /teams/:id/members/:user_id/role` (auth + lead): assign `lead|member`.

Authorization rules:
1. Team leads can mutate team admin data.
2. Non-lead members cannot mutate team admin data (`403`).
3. Champion tag writes stay auth-only, not lead-only.

Validation commands:
```bash
# Lead create team
curl -s -X POST "$BASE_URL/teams" -H "Authorization: Bearer $LEAD_TOKEN" \
  -H "content-type: application/json" -d '{"name":"Team Alpha"}'

# Member attempts lead-only action (must fail 403)
curl -s -o /dev/null -w "%{http_code}\n" -X PATCH "$BASE_URL/teams/1" \
  -H "Authorization: Bearer $MEMBER_TOKEN" \
  -H "content-type: application/json" -d '{"name":"Nope"}'
```

Automated test expectations:
1. New API tests for lead/member authorization matrix.
2. Migration tests (or integration assertions) for teams/members schema.
3. Frontend tests for lead-only UI controls and member-restricted behavior.

Implemented coverage:
1. `tests/server/app.api.test.mjs` now includes lead/member auth matrix + least-one-lead invariant checks.
2. `tests/ui/app.auth-pools-teams.test.mjs` verifies lead-only UI gating.

Close criteria:
1. Lead/member permissions are enforceable and tested.
2. At least one lead per team invariant is protected.

## Workstream 4: Full Champion Catalog (BEAD-14 / draftflow-71)

Status: Completed on 2026-02-26.

Goal:
1. Production champions dataset is complete, validated, and repeatably importable.

Deliverables:
1. Canonical source artifact path documented.
2. Seed/import command for full catalog.
3. Manifest file committed with:
   - source identifier
   - expected champion count
   - checksum/hash
4. Import validation ensures required metadata per champion:
   - roles
   - damage type
   - scaling
   - boolean tags

Validation commands:
```bash
# Run import
npm run seed:champions -- --csv <full_catalog_path>

# Verify count in API
curl -s "$BASE_URL/champions"
```

Automated test expectations:
1. Seed command remains idempotent.
2. Validation test fails if required champion metadata fields are missing.

Close criteria:
1. `/champions` count equals manifest expected count.
2. Re-running import does not create duplicates.

## Workstream 5: Remove Runtime CSV Dependence (BEAD-09 / draftflow-68)

Status: Completed on 2026-02-26.

Goal:
1. Runtime request paths use DB/API-backed data only; CSV remains seed/input artifact only.

Hard acceptance checks:
1. No runtime fetches of `/public/data/team_pools.csv` or `/public/data/config.json` in frontend app path.
2. No request-time CSV parsing on server routes.
3. Team/pool/config operational data comes from API/DB.

Validation commands:
```bash
rg -n "/public/data/team_pools.csv|/public/data/config.json" public/app server
rg -n "parseChampionsCsv|parseTeamPoolsCsv" server/routes server/repositories
```

Close criteria:
1. Remaining CSV references are seed/import/test fixtures only.

Validation result:
1. `rg` over `public/app` and `server` shows no runtime fetch/use of `team_pools.csv` or `config.json`.

## Workstream 6: Deployment Hardening and Smoke Gate (BEAD-10 / draftflow-69)

Status: Code complete and ready for deploy verification on 2026-02-26.

Goal:
1. Fresh deploy can be validated without manual shell/DB edits.

Render configuration contract:
1. Build: `npm ci && npm run migrate:up`
2. Start: `npm run start:api`
3. Health check path: `/health`
4. Env vars present:
   - `DATABASE_URL`
   - `JWT_SECRET`
   - `NODE_ENV=production`
   - `CORS_ORIGIN`

Smoke test contract:
1. `GET /health` returns `200` with `{ok:true}`.
2. UI loads at `/`.
3. Register/login works.
4. Pool CRUD works for owner.
5. Champion list endpoint works.
6. Champion tag write works for authenticated non-lead user.
7. Team lead can do team admin mutation; non-lead gets `403`.

Close criteria:
1. All smoke checks pass against live Render URL after a clean deploy.

Current note:
1. Local automated gates pass (`npm test`).
2. Live Render smoke requires post-push deployment confirmation; tracked in Beads.

## Sequencing and Dependencies

Recommended execution order:
1. Workstream 1
2. Workstream 2
3. Workstream 3
4. Workstream 4
5. Workstream 5
6. Workstream 6

If workstream output changes requirements for later steps, update this file in the same commit.
Implemented artifacts:
1. `docs/champion-catalog/champions.full.csv`
2. `docs/champion-catalog/manifest.json`
3. `server/scripts/generate-full-champions-csv.js` + `npm run catalog:refresh`
4. `tests/server/champion-catalog.test.mjs` for checksum/count/metadata validation
5. `server/scripts/seed-champions.js` default now points to full catalog artifact.
