# MVP Decisions Snapshot

## Current Repo Inventory

### Language and Runtime
- Runtime: browser-first JavaScript (ESM), static-site delivery.
- Tooling: Node.js package for tests only (`vitest`, `jsdom`), no backend runtime yet.
- Current app boot path: `public/index.html` -> `public/app/main.js` -> `initApp()` in `public/app/app.js`.

### Current Data Flow
- Runtime currently fetches local files from `public/data/`:
  - `/public/data/champions.csv`
  - `/public/data/team_pools.csv`
  - `/public/data/config.json`
- Parsing and validation happen in shared modules:
  - `src/data/csv.js`
  - `src/data/loaders.js`
- Domain + engine logic are pure in-memory functions under `src/`.
- There is no database, auth layer, or server API in the current architecture.

### Existing External API Surface
- None. The app is a static client and does not currently expose HTTP API routes.

## MVP Productization Decisions

### Architecture Direction
- Keep a monolith in this repository.
- Add a minimal Node.js API service (ESM) as the server-authoritative backend.
- Keep frontend working, but move data/auth mutation and protected state to backend endpoints.

### Authentication Choice
- JWT access tokens signed with `JWT_SECRET` (HS256).
- Token claim shape: `{ sub: <user_id> }` (string user id).
- Password hashing: bcrypt (`password_hash` persisted in DB).
- No refresh token flow in MVP (YAGNI).

### Database and Migration Choice
- Database: PostgreSQL via `DATABASE_URL`.
- Driver/query layer: `pg`.
- Migrations: SQL-first with `node-pg-migrate` for simple, explicit, versioned schema changes.
- Seed pipeline: explicit command to import champions from CSV into DB, idempotent by unique keys.

### Config Strategy
- Single config module for environment parsing/validation.
- Required env vars for app boot:
  - `DATABASE_URL`
  - `JWT_SECRET`
- Optional:
  - `PORT` (default `3000`)
  - `NODE_ENV` (default `development`)

## Rough Endpoint Mapping (MVP)

### Auth
- `POST /auth/register`
- `POST /auth/login`

### Champions and Tags
- `GET /champions`
- `GET /champions/:id`
- `GET /tags`
- `PUT /champions/:id/tags` (replace-all semantics, authenticated)

### User Pools (isolated)
- `GET /me/pools`
- `POST /me/pools`
- `PUT /me/pools/:id`
- `DELETE /me/pools/:id`
- `POST /me/pools/:id/champions`
- `DELETE /me/pools/:id/champions/:champion_id`

### Ops
- `GET /health` (deployment readiness)

## DB Schema Targets (MVP)

- `users`
- `champions`
- `tags`
- `champion_tags`
- `user_champion_pools`
- `user_pool_champions`

Constraints required:
- Foreign keys on relationship tables.
- Unique constraints for:
  - user email
  - champion name
  - tag name
  - `(champion_id, tag_id)`
  - `(pool_id, champion_id)`

## Runtime Data Policy After Productization

- CSV is seed input only.
- API runtime reads/writes Postgres only.
- Request paths must not parse/read CSV files.

## Deferred (Not MVP)

- Admin-only tag writes.
- Optimistic concurrency for global tag edits.
- Refresh tokens/session revocation.
- Analytics/history/worker architecture.
