# Team Context Operational Handoff (TCX-07)

Last updated: 2026-02-27

## Scope Closed
This handoff closes the Team Context overhaul execution track:
1. `draftflow-104` TCX-00 baseline/scaffold.
2. `draftflow-105` TCX-01 schema migration for logos + team-context prefs.
3. `draftflow-106` TCX-02 Teams API upload contract/repository updates.
4. `draftflow-107` TCX-03 Team-context preference API.
5. `draftflow-108` TCX-04 Team Context markup/style overhaul.
6. `draftflow-109` TCX-05 frontend state/behavior wiring.
7. `draftflow-110` TCX-06 regression matrix closure.
8. `draftflow-111` TCX-07 docs + operational handoff.

## Shipped Behavior

### Team Context UI
1. Team Context remains a single page (`#team-config`) with guided sections:
   - Draft Context (`#team-config-active-team`)
   - Team Workspace (Create/Manage tabs)
   - Pool Insight
2. Non-lead users can view roster context but cannot perform team mutations.
3. Lead users can create/update/delete teams, upload or remove logos, and manage members/roles.
4. Builder active team remains synchronized with Team Context active team for authenticated flows.

### API Contracts (Relevant to Team Context)
1. `GET /me/team-context` -> `{ teamContext: { defaultTeamId, activeTeamId } }`.
2. `PUT /me/team-context` validates provided team IDs are `null` or a team where caller is a member.
3. `POST /teams` and `PATCH /teams/:id` accept JSON or multipart payloads.
4. Logo constraints:
   - allowed MIME: `image/png`, `image/jpeg`, `image/webp`
   - max size: `512KB`
   - `remove_logo=true` supported on patch
   - `logo` + `remove_logo=true` rejected (`400`)
5. Team member admin endpoints:
   - `POST /teams/:id/members`
   - `DELETE /teams/:id/members/:user_id`
   - `PUT /teams/:id/members/:user_id/role`
   - `PUT /teams/:id/members/:user_id/team-role`
6. Last-lead invariant is enforced: removing/demoting final lead is rejected.

## Validation Evidence
Automated verification was completed with:
```bash
npm test
```
Result at handoff close:
1. `19` test files passed.
2. `111` tests passed.
3. Includes Team Context regression coverage in:
   - `tests/ui/app.auth-pools-teams.test.mjs`
   - `tests/server/app.api.test.mjs`
   - migration tests for team-context/logo and scoped tag schemas.

## Operational Runbook

### Deploy-Time Sequence
1. Apply migrations before serving updated frontend paths:
```bash
npm run migrate:up
```
2. Start API:
```bash
npm run start:api
```

### Manual Smoke Checks
```bash
# Team context read
curl -s "$BASE_URL/me/team-context" -H "Authorization: Bearer $TOKEN"

# Team context save
curl -s -X PUT "$BASE_URL/me/team-context" \
  -H "Authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"defaultTeamId":null,"activeTeamId":1}'

# Team create (JSON)
curl -s -X POST "$BASE_URL/teams" \
  -H "Authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"name":"Team X","tag":"TX"}'

# Team update (multipart with logo)
curl -s -X PATCH "$BASE_URL/teams/1" \
  -H "Authorization: Bearer $TOKEN" \
  -F "name=Team X" \
  -F "tag=TX" \
  -F "logo=@/tmp/logo.png"

# Team role update (lead only)
curl -s -X PUT "$BASE_URL/teams/1/members/2/team-role" \
  -H "Authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"team_role":"primary"}'
```

## Known Constraints
1. Team member add remains `user_id`-based (no invite/email flow).
2. Team-context API supports both `defaultTeamId` and `activeTeamId`; current authenticated UI path persists `activeTeamId` and sends `defaultTeamId: null`.
3. Team logo storage remains DB-backed inline data-url response (no external object storage).
