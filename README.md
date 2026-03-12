# DraftEngine

DraftEngine is a static-site app for composition checking and next-pick possibility tree generation.

## Versioning

Project version is tracked in:
- `VERSION`
- `package.json` (`version`)

Keep both values in sync when publishing a new external release.

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
- `NEXUS_API_KEY` (preferred Riot API key env var; enables Riot profile champion-mastery enrichment on `GET /me/profile`)
- `RIOT_API_KEY` (legacy fallback Riot API key env var)
- `RIOT_PLATFORM_ROUTING` (default `na1`)
- `RIOT_ACCOUNT_ROUTING` (optional override; otherwise inferred from platform with regional fallback)
- `RIOT_API_TIMEOUT_MS` (request timeout, clamped to safe range)
- `RIOT_PROFILE_CHAMPION_STATS_LIMIT` (top mastery entries returned, max `20`)

Start API:
```bash
npm run start:api
```

Database checks and migrations:
```bash
npm run db:check
npm run migrate:up
npm run migrate:down
npm run seed:champion-core
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
- `GET /me/profile` (auth required; includes optional `profile.championStats` when Riot integration is enabled)
- `PUT /me/profile` (auth required)
- `GET /me/team-context` (auth required)
- `PUT /me/team-context` (auth required)
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
- `PUT /teams/:id/members/:user_id/team-role` (auth + lead required)
- `GET /admin/champion-core` (auth + admin required)
- `GET /admin/users` (auth + admin required)
- `GET /admin/authorization` (auth + admin required)
- `PUT /admin/users/:id/role` (auth + admin required)
- `PUT /admin/users/:id/riot-id` (auth + admin required)
- `DELETE /admin/users/:id` (auth + admin required)

Team API mutation payloads:
- `POST /teams` and `PATCH /teams/:id` accept `application/json` and `multipart/form-data`.
- Logo uploads are restricted to `image/png`, `image/jpeg`, `image/webp` and `<= 512KB`.
- Team patch supports `remove_logo=true`; supplying both `logo` and `remove_logo=true` is rejected (`400`).

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
- `public/index.html` sets `window.DRAFTENGINE_API_BASE_URL` (defaults to same-origin `window.location.origin`).
- Override `window.DRAFTENGINE_API_BASE_URL` before `public/app/main.js` loads when using a different API host.
- Frontend runtime no longer falls back to `public/data/champions.csv`; champion/tag data is API-backed.

Primary surfaces:
- `Build a Composition` (single mode)
- `Team Context` (server-backed active team context + lead-gated team workspace + role-pool preview)
- `Player Pools` (API-backed pool editing)
- `Champion Tags` (filter + inspect + global tag editing for MVP)

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
- `server/data/champion-core.seed.json`

Refresh full catalog artifact:
```bash
npm run catalog:refresh
```

Seed champion core baseline into Postgres:
```bash
npm run seed:champion-core
```

`champion_core` is populated from the checked-in JSON seed artifact derived once from `docs/champion-core-example.csv`. Runtime/API code does not read the CSV file.

## Defaults

Requirement evaluation defaults to:
- Composition requirements come only from the selected composition bundle.
- If no composition is selected, the review panel reports that no composition is selected.

Tree defaults:
- `maxBranch=8`
- `minCandidateScore=1` (UI default)
- `rankGoal=valid_end_states` (UI default)
- `candidateScoringWeights={ redundancyPenalty:1 }`

Tree generation behavior:
- Tree depth is automatic and always runs to the end of the remaining draft.
- `minCandidateScore` is a preference threshold, not an absolute feasibility gate.
- `rankGoal` can prioritize either downstream valid-end-state outcomes (`valid_end_states`) or immediate candidate score (`candidate_score`).
- Composer Advanced Controls expose `redundancyPenalty` for max-count overflow tuning.
- Candidates are ranked by clause-level minimum coverage progress and redundancy overflow, not only requirement pass/fail flips.
- If every legal pick at a node falls below the threshold, adaptive fallback still expands the best legal picks and marks them as below-floor candidates.
- Fallback is capped to a small number of branches to preserve output without exploding low-signal paths.
- Summary view reports `pruned low score`, `pruned relative score`, and fallback usage counts in generation stats.
- Composer review surfaces per-clause counts, missing coverage, redundancy overflow, and score contributions.

## Current MVP Constraints

- Tree generation is deterministic for identical inputs.
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
