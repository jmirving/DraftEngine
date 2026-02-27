# DraftEngine

DraftEngine is a static-site app for composition checking and next-pick possibility tree generation.

## Run

1. From repo root, start a static server:
```bash
python3 -m http.server 8000
```
2. Open:
`http://localhost:8000/public/index.html`

### API (MVP Productization)

The API server is now scaffolded for MVP productization work.

Required environment variables:
- `DATABASE_URL`
- `JWT_SECRET`

Optional environment variables:
- `CORS_ORIGIN` (default `*`; set to your frontend URL when deployed separately)

Start API:
```bash
npm run start:api
```

Database checks and migrations:
```bash
npm run db:check
npm run migrate:up
npm run migrate:down
npm run seed:champions
```

MVP API routes:
- `POST /auth/register`
- `POST /auth/login`
- `GET /champions`
- `GET /champions/:id`
- `GET /tags`
- `GET /champions/:id/tags` (auth required; scoped read with `scope=self|team|all`, optional `team_id` for team scope)
- `PUT /champions/:id/tags` (auth required; scoped replace semantics with `scope=self|team|all`, optional `team_id` for team scope)
- `GET /me/pools` (auth required)
- `POST /me/pools` (auth required)
- `PUT /me/pools/:id` (auth required)
- `DELETE /me/pools/:id` (auth required)
- `POST /me/pools/:id/champions` (auth required, idempotent add)
- `DELETE /me/pools/:id/champions/:champion_id` (auth required, idempotent remove)
- `POST /teams` (auth required; creator becomes lead)
- `GET /teams` (auth required)
- `PATCH /teams/:id` (auth + lead required)
- `DELETE /teams/:id` (auth + lead required)
- `GET /teams/:id/members` (auth + team membership required)
- `POST /teams/:id/members` (auth + lead required)
- `DELETE /teams/:id/members/:user_id` (auth + lead required)
- `PUT /teams/:id/members/:user_id/role` (auth + lead required)

Error contract (all API errors):
```json
{
  "error": {
    "code": "SOME_CODE",
    "message": "Human-readable message"
  }
}
```

The app opens on `Build a Composition` by default. `Team Context`, `User Config`, and `Champion Explorer` are available from the side menu.
Build a Composition is stage-focused: one guided stage is shown at a time (Setup -> Inspect).
Setup keeps team selection and slot inputs in a single vertical list that follows Node Draft Order.
Feedback is contextual to Setup/Inspect panels (no global status banner).

Navigation routing:
- Tab routes are hash-based: `#workflow`, `#team-config`, `#player-config`, `#explorer`.
- Clicking side-menu tabs updates the hash and browser history.
- Browser Back/Forward replays in-app tab navigation.
- For unauthenticated sessions, non-workflow hashes are normalized to `#workflow`.

Troubleshooting:
- If the URL hash is invalid (for example `#unknown`), the app normalizes to `#workflow`.
- If no hash is present, the app sets a hash to the resolved initial tab.

Frontend API integration:
- `public/index.html` sets `window.DRAFTENGINE_API_BASE_URL` (default points to Render API URL).
- Override `window.DRAFTENGINE_API_BASE_URL` before `public/app/main.js` loads when using a different API host.

Primary surfaces:
- `Build a Composition` (single mode)
- `Team Context` (team defaults + role-pool preview)
- `Player Pools` (API-backed pool editing)
- `Champion Tags` (filter + inspect)

## Testing

Run the full suite:
```bash
npm test
```

Run coverage (enforced gate):
```bash
npm run test:coverage
```

Current coverage gates:
- Lines: `>= 70%`
- Branches: `>= 60%`

Test strategy:
- `src/*` is covered with deterministic unit tests.
- `public/app/*-utils.js` is covered with pure utility tests.
- `public/app/app.js` is covered with jsdom integration tests for workflow-critical UI behavior.
- CI runs coverage gates on Node `24` via `.github/workflows/tests.yml`.

## Data Inputs

Runtime data comes from API/DB for auth flows:
- `/champions`
- `/me/pools*`
- `/teams*`

Champion catalog artifacts:
- `docs/champion-catalog/champions.full.csv`
- `docs/champion-catalog/manifest.json`

Refresh full catalog artifact:
```bash
npm run catalog:refresh
```

## Defaults

Requirement toggles default to:
- `requireHardEngage=true`
- `requireFrontline=true`
- `requireWaveclear=true`
- `requireDamageMix=true`
- `requireAntiTank=false`
- `requireDisengage=false`
- `requirePrimaryCarry=true`
- `topMustBeThreat=true`

Tree defaults:
- `maxDepth=4`
- `maxBranch=8`
- `minCandidateScore=1` (UI default)

Tree generation behavior:
- `minCandidateScore` is a preference threshold, not an absolute feasibility gate.
- Candidates are filtered with a strict relative selection window from the best branch score at each node.
- Branch budgets are reduced dynamically once required gaps close to avoid near-`maxBranch` expansion everywhere.
- Candidates that make no required-check progress are penalized in viability scoring.
- If every legal pick at a node falls below the threshold, adaptive fallback still expands the best legal picks and marks them as below-floor candidates.
- Fallback is capped to a small number of branches to preserve output without exploding low-signal paths.
- Summary view reports `pruned low score`, `pruned relative score`, and fallback usage counts in generation stats.

## Current MVP Constraints

- Tree generation is deterministic for identical inputs.
- Candidate scoring does not apply redundancy penalties.
- Tree expansion priority follows configurable Node Draft Order.
- Team configuration supports `None` mode (global role-eligible champion pools).
- Tree view includes both an outline and a visual Tree Map graph.
- `Inspect` drills into that node as the active tree root and exposes a `Back` action to return up the path.
- Excluded champions are filtered from selectors and tree output.
- Candidate generation is constrained by team role pools.
- When tree filters hide all root branches, summary provides one-click recovery actions:
- `Show all branches` (disables `Valid leaves only`)
- `Clear Search` (when search text is active)
- `Lower Min Candidate Score to 0` (returns to setup and clears generated tree)
- In team mode, slot labels include player names when available.
- Data ingestion is schema-validated and fails fast on malformed CSV/JSON.
