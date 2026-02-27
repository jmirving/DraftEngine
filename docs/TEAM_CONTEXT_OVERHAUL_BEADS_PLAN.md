# Team Context Overhaul Plan (Beads-Ready, Long-Running-Agent Safe)

## Summary
This plan overhauls Team Context to reduce cognitive load while preserving its core purpose: controlling draft team context and lead-gated team administration.
It keeps one Team Context page with guided sections, replaces form sprawl with row-based member actions, persists default/active team on the server, and adds upload-based team logos (DB-backed, no URL entry).

## Ground Truth: What Team Context Is Meant To Do
1. Provide `Default Team` and `Active Team` context that directly drives role pools used by Build a Composition.
2. Show active team pool intelligence by role.
3. Provide team CRUD + roster administration, with lead-only mutation controls.
4. Allow non-lead members to view membership/roster data.
5. Stay integrated with profile role pools and workflow slot labeling behavior.

## Target Doc
Create this as: `docs/TEAM_CONTEXT_OVERHAUL_BEADS_PLAN.md`.

## Chosen Defaults (Locked)
1. Overhaul priority: reduce cognitive load first.
2. Page structure: one Team Context page with guided sections.
3. Team metadata: `name` + `tag` required, logo optional.
4. Logo mode: upload-only for new/updated teams (no URL input).
5. Logo storage: DB (`bytea` + mime type), max 512KB, PNG/JPEG/WebP.
6. Legacy `logo_url` behavior: drop old logos (no compatibility rendering).
7. Team preference persistence: server-side (not local-only).
8. Member add identifier: user ID only.
9. Non-lead UX: hide mutation controls, show read-only notice.
10. `/teams` create/update request formats: accept JSON and multipart.
11. Logo removal: explicit `remove_logo=true`.
12. Logo delivery to frontend: inline `logo_data_url` in `/teams` responses.

## Scope
1. Redesign Team Context information architecture and interaction flow.
2. Keep one page, but segment into guided sections with progressive disclosure.
3. Replace ID-heavy mutation forms with member table row actions.
4. Add server persistence for Team Context preferences.
5. Add optional team logo upload support and remove URL-entry workflow.
6. Update backend, frontend, tests, and docs needed for a reliable overhaul.

## Out of Scope
1. Email-based member invitation.
2. External object storage (S3/R2/etc.).
3. Preserving legacy `logo_url` assets.
4. Permission model redesign beyond existing lead/member rules.
5. Multi-machine Beads sync behavior changes.

## Important Changes to Public APIs / Interfaces / Types
1. New endpoint: `GET /me/team-context` returns `{ defaultTeamId, activeTeamId }`.
2. New endpoint: `PUT /me/team-context` accepts `{ defaultTeamId, activeTeamId }` where values are `number | null`.
3. Updated endpoint: `POST /teams`
4. Updated endpoint: `PATCH /teams/:id`
5. `POST/PATCH /teams*` accepts:
6. `application/json` with `name`, `tag`, optional `remove_logo` (patch only).
7. `multipart/form-data` with `name`, `tag`, optional `logo` file, optional `remove_logo`.
8. Team response shape changes:
9. Remove write/read dependency on `logo_url`.
10. Add `logo_data_url: string | null`.
11. Validation changes:
12. Logo file MIME allowed: `image/png`, `image/jpeg`, `image/webp`.
13. Max upload size: 512KB.
14. Add explicit conflict validation: `logo` + `remove_logo=true` is `400`.
15. Frontend state contract:
16. `teamConfig` becomes server-backed source of truth for authenticated users.
17. Add save/loading/error state for team-context preference writes.

## Data Model and Migration Plan
1. Add `teams.logo_blob BYTEA NULL`.
2. Add `teams.logo_mime_type TEXT NULL`.
3. Drop `teams.logo_url`.
4. Add `users.default_team_id BIGINT NULL REFERENCES teams(id) ON DELETE SET NULL`.
5. Add `users.active_team_id BIGINT NULL REFERENCES teams(id) ON DELETE SET NULL`.
6. Add/adjust migration tests:
7. Verify new columns and FK behavior.
8. Verify dropped `logo_url` in forward migration.
9. Verify down migration restores previous schema safely.

## UX / IA Spec (Decision Complete)
1. Team Context keeps one page and uses three explicit sections:
2. Section 1: `Draft Context`.
3. Controls: `Default Team`, `Active Team`.
4. Inline impact summary and pool-size summary.
5. Save state indicator for server persistence.
6. Section 2: `Team Workspace`.
7. Team picker and refresh.
8. Team details editor: name, tag, optional logo upload, remove-logo toggle.
9. Team creation form: name, tag, optional logo upload.
10. Members table with row actions (role/team-role update, remove).
11. Add-member strip: `user_id`, `role`, `team_role`, single add action.
12. Non-lead behavior: show roster table + read-only notice; mutation controls hidden.
13. Section 3: `Pool Insight`.
14. Active-team role cards with counts and champion list preview.
15. Maintain existing workflow integration:
16. Builder `Active Team` stays synchronized with Team Context `Active Team`.
17. Team slot labels continue showing player labels when applicable.
18. Accessibility requirements:
19. Every input has a label.
20. Feedback/status uses `aria-live`.
21. Row actions fully keyboard reachable.
22. Mobile behavior:
23. Sections stack vertically.
24. Member table collapses to card rows on narrow widths.

## Execution Model
1. Phase A (linear): `TCX-00`, `TCX-01`, `TCX-02`, `TCX-03`.
2. Phase B (linear): `TCX-04`, `TCX-05`.
3. Phase C (linear): `TCX-06`, `TCX-07`.
4. A bead closes only after required validation tier passes.

## Beads Backlog

### TCX-00: Baseline and Beads Scaffolding
Purpose: lock scope, create epic/tasks, capture baseline test status.

Dependencies: none.

Implementation:
1. Create epic + child tasks in Beads with this doc linked.
2. Record baseline `npm test` result in epic notes.
3. Record baseline Team Context behavior summary from current UI tests.

Validation:
1. `bd_safe list` shows epic/tasks with clear mapping.
2. `npm test` baseline result logged.

Done criteria:
1. Beads created and statuses set.
2. Baseline evidence added to Beads.

---

### TCX-01: Schema Migration for Logos and Team Context Preferences
Purpose: establish DB support for upload logos + server-persisted team preferences.

Dependencies: `TCX-00`.

Implementation:
1. Add migration for `teams.logo_blob`, `teams.logo_mime_type`, drop `teams.logo_url`.
2. Add migration for `users.default_team_id`, `users.active_team_id` with FK `ON DELETE SET NULL`.
3. Update migration tests.

Validation:
1. Targeted migration tests pass.
2. `npm test` passes.

Done criteria:
1. Schema changes are forward/down compatible in tests.
2. No failing migration-related tests.

---

### TCX-02: Teams API Upload Contract + Repository Updates
Purpose: implement upload-capable team create/update and new logo response contract.

Dependencies: `TCX-01`.

Implementation:
1. Add multipart parsing middleware (memory storage).
2. Update `/teams` POST/PATCH to support JSON + multipart.
3. Enforce logo validation and explicit remove behavior.
4. Update teams repository create/list/update mappings for blob/mime.
5. Serialize `logo_data_url` inline in team payloads.
6. Remove `logo_url` contract usage in routes/tests.

Validation:
1. Server API tests for:
2. JSON create/update without logo.
3. Multipart create/update with logo.
4. Invalid type/size rejection.
5. `remove_logo=true` behavior.
6. `logo` + `remove_logo=true` conflict.
7. Full `npm test`.

Done criteria:
1. Teams API contract fully updated and tested.
2. No frontend/runtime dependency on `logo_url`.

---

### TCX-03: Team Context Preference API
Purpose: persist default/active team on server profile context.

Dependencies: `TCX-01`.

Implementation:
1. Add `/me/team-context` GET and PUT routes.
2. Add repository methods on users or profile storage layer.
3. Validate provided team IDs are either `null` or teams where user is a member.
4. Define fallback behavior when referenced team becomes invalid.
5. Add API tests for auth, validation, and persistence behavior.

Validation:
1. New `/me/team-context` tests pass.
2. Existing `/me/profile` tests remain green.
3. Full `npm test`.

Done criteria:
1. Team context preferences are server-backed and validated.
2. All relevant server tests pass.

---

### TCX-04: Team Context Markup and Style Overhaul
Purpose: restructure Team Context page into guided, lower-load sections.

Dependencies: `TCX-02`, `TCX-03`.

Implementation:
1. Rewrite Team Context section markup in `public/index.html`.
2. Replace logo URL inputs with file inputs + remove toggle.
3. Add member table container for row actions.
4. Add non-lead read-only message block.
5. Update styles in `public/app/styles.css` for new layout and responsive behavior.

Validation:
1. Static checks for expected IDs/sections.
2. UI test snapshot/selector assertions updated.
3. `npm test`.

Done criteria:
1. New IA structure rendered correctly on desktop/mobile.
2. Team Context no longer presents multi-form sprawl.

---

### TCX-05: Frontend State and Behavior Wiring
Purpose: wire new UI to APIs and preserve workflow integration invariants.

Dependencies: `TCX-04`.

Implementation:
1. Update `public/app/app.js` for:
2. `/me/team-context` load/save flow.
3. Team create/update with JSON/multipart + optional file.
4. Logo preview/render from `logo_data_url`.
5. Member table row actions with existing team member endpoints.
6. Non-lead hidden mutations.
7. Error + saving states.
8. Remove local-storage authority for team context in authenticated flow.
9. Keep builder active team synchronized with team context active team.

Validation:
1. Targeted UI tests for team-context behavior.
2. Existing workflow/team regression tests.
3. Full `npm test`.

Done criteria:
1. End-to-end Team Context behaviors work with new API contracts.
2. Builder/team sync invariants remain intact.

---

### TCX-06: Test Expansion and Regression Matrix Closure
Purpose: lock durability and prevent regressions.

Dependencies: `TCX-05`.

Implementation:
1. Add dedicated UI tests for:
2. Lead vs non-lead Team Context visibility.
3. Row action updates for role/team-role.
4. Create/update with optional logo upload.
5. Remove logo behavior.
6. Server-persisted default/active team across reload.
7. Add/extend server tests for new contracts.
8. Update existing tests expecting `logo_url`.

Validation:
1. Run targeted test files.
2. Run full `npm test`.
3. Repeat full run twice to guard flaky behavior.

Done criteria:
1. Scenario matrix covered.
2. All tests pass consistently.

---

### TCX-07: Documentation and Operational Handoff
Purpose: close execution with reproducible evidence and handoff clarity.

Dependencies: `TCX-06`.

Implementation:
1. Update README API and Team Context sections.
2. Add/refresh docs describing Team Context behaviors and constraints.
3. Add Beads closure notes with command evidence.
4. Add follow-up bead for optional future enhancements only if deferred scope remains.

Validation:
1. Docs match shipped behavior.
2. Beads statuses and notes complete.
3. Final full test run before close/push.

Done criteria:
1. Documentation aligns with implementation.
2. Beads closed with evidence.
3. Session closeout checklist completed.

## Validation Tiers (Global)
1. Quick:
2. Targeted tests for current bead.
3. Static grep checks.
4. Standard:
5. All affected UI + server tests for current workstream.
6. Full:
7. `npm test`.
8. Required before closing each bead and before final push.

## Test Cases and Scenarios
1. Team Context loads with server-saved `defaultTeamId` and `activeTeamId`.
2. Changing default/active team persists via `/me/team-context`.
3. Builder active team reflects Team Context active team.
4. Team create succeeds with JSON metadata only (`name`, `tag`).
5. Team create/update succeeds with multipart logo upload.
6. Invalid logo type rejected with `400`.
7. Oversized logo rejected with `400`.
8. `remove_logo=true` clears existing logo.
9. `remove_logo=true` + uploaded file rejected with `400`.
10. Non-lead cannot see mutation controls and still sees roster.
11. Lead can add member, update role/team-role inline, and remove member.
12. Last-lead invariant remains enforced.
13. Existing tests for workflow tree behavior and profile flows remain green.

## Anti-Loop Protocol (Mandatory)
1. Every attempt logs: hypothesis, files changed, validation command, result delta.
2. A retry is valid only if at least one failing assertion changes meaningfully.
3. Same failure twice with no delta marks bead `blocked`.
4. More than 3 implementation attempts on one bead marks bead `blocked`.
5. On blocked:
6. Add Beads note with failing assertion and last two change summaries.
7. Split scope into focused follow-up bead if needed.

## Rollout and Failure Handling
1. Apply DB migrations before deploying frontend changes.
2. Deploy backend API changes before frontend behavior depending on them.
3. If release regression appears:
4. Roll back app version.
5. Roll back migration only if safe and data-loss implications are acceptable.
6. Verify auth + teams + profile endpoints in smoke checks after rollback.

## Manual API Smoke Commands
1. Create team without logo:
2. `curl -s -X POST "$BASE_URL/teams" -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" -d '{"name":"Team X","tag":"TX"}'`
3. Create team with logo upload:
4. `curl -s -X POST "$BASE_URL/teams" -H "Authorization: Bearer $TOKEN" -F "name=Team X" -F "tag=TX" -F "logo=@/tmp/logo.png"`
5. Remove logo:
6. `curl -s -X PATCH "$BASE_URL/teams/1" -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" -d '{"name":"Team X","tag":"TX","remove_logo":true}'`
7. Team context prefs:
8. `curl -s "$BASE_URL/me/team-context" -H "Authorization: Bearer $TOKEN"`
9. `curl -s -X PUT "$BASE_URL/me/team-context" -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" -d '{"defaultTeamId":1,"activeTeamId":1}'`

## Beads Command Template
1. Create epic/task:
2. `bd_safe create "<title>" -t epic -p 1 --description "<summary>"`
3. `bd_safe create "<title>" -t task -p 1 --description "<acceptance>"`
4. Start:
5. `bd_safe update <id> --status in_progress`
6. Checkpoint:
7. `bd_safe note <id> "Attempt N: <hypothesis> | Validation: <cmd> | Result: <delta>"`
8. Block:
9. `bd_safe update <id> --status blocked`
10. `bd_safe note <id> "Blocked: <reason>"`
11. Close:
12. `bd_safe close <id> --reason "Acceptance checks passed; evidence: <tests/commands>"`

## Final Session Closeout (Execution Phase)
1. Run quality gates (`npm test` minimum).
2. Update/close Beads with notes.
3. `git_net pull --rebase`
4. `git_net push`
5. `git_local status -sb` must show up to date with origin.
6. Ensure no stranded local changes remain.

## Assumptions and Defaults
1. App remains a monolith and keeps current auth model.
2. Team Context remains a single page in navigation.
3. Member add continues to use numeric `user_id`.
4. Legacy URL logos are intentionally dropped by product decision.
5. Server-persisted team context is authoritative for authenticated users.
6. UI keeps existing lead/member permission semantics.
