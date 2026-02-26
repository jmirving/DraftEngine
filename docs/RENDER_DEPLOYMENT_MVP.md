# Render Deployment (MVP)

## Required Environment Variables

- `DATABASE_URL`
- `JWT_SECRET`
- `PORT` (Render supplies this at runtime)
- `NODE_ENV=production`
- `CORS_ORIGIN` (set to your deployed frontend origin when frontend is separate)

## Build and Start Commands

- Build: no separate build step required for API runtime.
- Start: `npm run start:api`

## Migration Strategy

Run migrations before serving traffic:

```bash
npm run migrate:up
```

Rollback command (if required):

```bash
npm run migrate:down
```

## Seed Strategy (One-time / Controlled Re-run)

Seed champions from CSV artifact:

```bash
npm run seed:champions -- --csv public/data/champions.csv
```

The seed is idempotent for champions by `name` (`ON CONFLICT DO UPDATE`).

## Health Check

- Endpoint: `GET /health`
- Expected response:

```json
{ "ok": true }
```

## Frontend Base URL

If frontend is deployed separately, configure it to call the API base URL on Render.
Current MVP backend routes are rooted at `/`.
Default frontend config uses:

```html
window.DRAFTENGINE_API_BASE_URL = "https://draftengine-0ee8.onrender.com";
```

## Cold Deploy Checklist

1. Provision Postgres and set `DATABASE_URL`.
2. Set `JWT_SECRET`.
3. Deploy API with `npm run start:api`.
4. Run `npm run migrate:up`.
5. Run `npm run seed:champions -- --csv public/data/champions.csv`.
6. Verify `GET /health`.
7. Verify auth flow (`POST /auth/register`, `POST /auth/login`).
8. Verify protected route with token (`GET /me/pools`).
