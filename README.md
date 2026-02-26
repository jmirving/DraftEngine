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
- `PUT /champions/:id/tags` (auth required, replace-all semantics)
- `GET /me/pools` (auth required)
- `POST /me/pools` (auth required)
- `PUT /me/pools/:id` (auth required)
- `DELETE /me/pools/:id` (auth required)
- `POST /me/pools/:id/champions` (auth required, idempotent add)
- `DELETE /me/pools/:id/champions/:champion_id` (auth required, idempotent remove)

Error contract (all API errors):
```json
{
  "error": {
    "code": "SOME_CODE",
    "message": "Human-readable message"
  }
}
```

The app opens on `Workflow` by default. `Team Context`, `User Config`, and `Champion Explorer` are available from the side menu.
Workflow is stage-focused: one guided stage is shown at a time (Setup -> Inspect).
Setup keeps team selection and slot inputs in a single vertical list that follows Node Draft Order.
Feedback is contextual to Setup/Inspect panels (no global status banner).

Frontend API integration:
- `public/index.html` sets `window.DRAFTENGINE_API_BASE_URL` (default points to Render API URL).
- Override `window.DRAFTENGINE_API_BASE_URL` before `public/app/main.js` loads when using a different API host.

Primary surfaces:
- `Workflow` (single mode: Build a Composition)
- `Team Context` (team defaults + role-pool preview)
- `User Config` (personal defaults and preferences)

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

The app loads local assets from `/public/data/`:
- `champions.csv`
- `team_pools.csv`
- `config.json` (optional defaults/weights)

Starter artifacts are sourced from:
- `docs/DraftFlow_champions.csv`
- `docs/DraftFlow_team_pools.csv`
- `docs/DraftFlow_config.json`

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
