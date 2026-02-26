# DraftEngine: Next Steps to Fully Operational

As of 2026-02-25, the same Render service now serves both:
- UI at `/`
- API at `/health`, `/champions`, `/auth/*`, `/me/pools/*`, etc.

Current gap: only champion reads are API-backed in the frontend; other workflow surfaces still rely on local CSV/runtime state.

## 1) User Registration/Login in UI (BEAD-11 / draftflow-72)

1. Add auth UI (register, login, logout) in the frontend.
2. Call `POST /auth/register` and `POST /auth/login` from the UI.
3. Store JWT access token (MVP: `localStorage`), and attach `Authorization: Bearer <token>` on protected requests.
4. Add auth state handling (expired/invalid token -> force relogin).
5. Add integration tests for happy path and auth-failure path.

Definition of done:
- New user can register, login, refresh the page, and remain authenticated.

## 2) Pool Permissions + Pool UX on API (BEAD-12 / draftflow-70)

1. Wire Team Context and Player Pools UI to `/me/pools` endpoints:
   - `GET /me/pools`
   - `POST /me/pools`
   - `PUT /me/pools/:id`
   - `DELETE /me/pools/:id`
   - `POST /me/pools/:id/champions`
   - `DELETE /me/pools/:id/champions/:champion_id`
2. Remove pool mutation dependence on local CSV/runtime-only state for authenticated users.
3. Handle `401` and `403` explicitly in UI.
4. Keep or add backend ownership tests to prove users can modify only their own pools.

Definition of done:
- Logged-in user can only view/edit their own pools end-to-end from UI.

## 3) Team-Lead Governance for Team Administration (BEAD-15/16/17)

1. Add team domain schema:
   - `teams`
   - `team_members` (user_id, team_id, role: `lead|member`)
2. Support one or more leads per team.
3. Add team-management APIs:
   - create/update/delete teams
   - add/remove team members
   - promote/demote lead role
4. Authorization rule:
   - any authenticated user may edit champion tags
   - only team leads can mutate team admin data
5. Update frontend Team Context/Player Pools management UI to surface lead-only actions.
6. Add API tests for lead vs member behavior (`403` for non-lead admin mutations).

Definition of done:
- Team admin operations are lead-gated while champion tag writes remain available to all authenticated users.

## 4) Load Full Champion Catalog (BEAD-14 / draftflow-71)

1. Define canonical source for full champion list.
2. Expand seed/import pipeline from current partial set to full catalog.
3. Validate every imported champion has required metadata used by DraftEngine:
   - role(s)
   - damage type
   - scaling
   - boolean tags
4. Add deterministic import checks (count + schema validation + idempotency).
5. Run one controlled production import and verify `/champions` count matches expectation.

Definition of done:
- `/champions` returns full catalog, and re-import is safe/idempotent.

## 5) Finish Removal of Runtime CSV Dependence (BEAD-09 / draftflow-68)

1. Move remaining runtime reads (`team_pools.csv`, `config.json`) to DB-backed reads/writes or server-managed config.
2. Keep CSV as seed/input artifact only.
3. Update frontend boot path so operational state comes from API, not static files.

Definition of done:
- Request paths read operational data from DB/API only.

## 6) Deployment Hardening Completion (BEAD-10 / draftflow-69)

1. Keep Render build/start:
   - Build: `npm ci && npm run migrate:up`
   - Start: `npm run start:api`
2. Confirm env vars: `DATABASE_URL`, `JWT_SECRET`, `NODE_ENV=production`, `CORS_ORIGIN`.
3. Run a post-deploy smoke suite:
   - `GET /health`
   - register/login
   - authenticated pool CRUD
   - champion list read
   - champion tag write succeeds for authenticated non-lead users
   - team admin mutations are allowed for leads and denied for non-leads

Definition of done:
- Fresh deploy is fully functional without shell/manual DB edits.
