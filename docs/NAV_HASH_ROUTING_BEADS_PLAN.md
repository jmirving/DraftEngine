# NAV-Hash Routing Plan (Beads-Ready, Async-Agent Safe)

## Summary
This plan implements in-app browser Back/Forward behavior for DraftEngine tab navigation using URL hash routes (`#workflow`, `#team-config`, `#player-config`, `#explorer`).
It is intentionally scoped to avoid server fallback changes and preserve current API 404 behavior.
Execution is split into gated Beads with explicit anti-loop controls so long-running agents can prove real progress.

## Target Doc
Create this document as: `docs/NAV_HASH_ROUTING_BEADS_PLAN.md`.

## Chosen Defaults
1. Route mode: `Hash Routes`.
2. Delivery style: `Phased + Gates`.
3. No clean-path (`/workflow`) routing in this workstream.
4. No server route fallback changes in this workstream.

## Scope
1. Add URL-hash-driven tab routing in the frontend.
2. Sync UI tab changes to browser history.
3. Handle `hashchange` for Back/Forward.
4. Preserve auth-gate behavior and post-login routing rules.
5. Add focused tests and quality gates.
6. Update docs to reflect new navigation behavior.

## Out of Scope
1. Path-based SPA routing.
2. Express fallback-to-index for unknown non-API paths.
3. Any redesign of tab IA or page layout.

## Public Interface Changes
1. URL contract added:
   - `#workflow`
   - `#team-config`
   - `#player-config`
   - `#explorer`
2. Deep link behavior:
   - Authenticated: hash selects tab.
   - Unauthenticated: app forces `workflow` and normalizes hash to `#workflow`.
3. Unknown hash behavior:
   - Normalize to `#workflow` using replace semantics to avoid history pollution.
4. No API endpoint changes.
5. No DB/schema changes.

## Execution Model
1. Phase A (linear): `NAV-00`, `NAV-01`.
2. Phase B (limited parallel): `NAV-02` and `NAV-04`.
3. Phase C (linear): `NAV-03`, `NAV-05`.
4. A bead can close only after its required validation tier passes.

## Beads Backlog

### NAV-00: Baseline and issue scaffolding
Purpose: lock scope, create Beads, and capture baseline behavior before code edits.

Dependencies: none.

Implementation:
1. Create epic and task Beads with this plan linked in notes.
2. Capture baseline command outputs for:
   - `npm test`
   - current tab behavior summary from existing UI tests.
3. Post baseline note in epic.

Validation options:
1. Quick: `bd_safe list` shows epic/tasks open with clear titles.
2. Standard: baseline `npm test` passes.
3. Full: baseline + short note proving no existing hash/history router code.

Positive progress signals:
1. Epic + all task Beads exist.
2. Baseline test status recorded in Beads note.

Loop guard:
1. If Beads creation naming is revised more than once, freeze naming and proceed.
2. No code edits allowed in this bead.

Done criteria:
1. Beads created and statuses set.
2. Baseline evidence captured in notes.

---

### NAV-01: Router contract and helper layer in frontend
Purpose: add deterministic tab<->hash parsing/normalization primitives.

Dependencies: `NAV-00`.

Implementation:
1. In `public/app/app.js`, define tab route constants and hash parser.
2. Add helper functions for:
   - parse hash to tab
   - build hash from tab
   - normalize invalid/missing hash to workflow
3. Keep behavior pure and side-effect-free at this stage.
4. Ensure auth constraints are represented in a route resolution helper.

Validation options:
1. Quick: `rg -n "hash|workflow|team-config|player-config|explorer" public/app/app.js`.
2. Standard: targeted UI tests still pass.
3. Full: full `npm test`.

Positive progress signals:
1. Single source-of-truth tab list exists.
2. No duplicate tab-validation logic remains in multiple places.

Loop guard:
1. Max 3 refactor attempts.
2. If helper names churn without test delta, stop and mark blocked.

Done criteria:
1. Router helpers exist and are referenced by `setTab` flow plan.
2. No behavior regressions in current tests.

---

### NAV-02: History wiring and event integration
Purpose: connect tab clicks and app init to hash/history updates.

Dependencies: `NAV-01`.

Implementation:
1. Update tab click handlers to call `setTab` with routing intent metadata (`ui` vs `history`).
2. On app init, read hash and set initial tab.
3. Add `hashchange` listener to drive in-app navigation on Back/Forward.
4. Prevent history spam by no-oping when requested tab equals current tab.
5. Use replace semantics for normalization paths.

Validation options:
1. Quick: static grep confirms `hashchange` listener + hash reads.
2. Standard: run targeted new routing tests plus existing workflow/auth UI tests.
3. Full: `npm test`.

Positive progress signals:
1. New routing tests fail before wiring and pass after wiring.
2. Back/Forward scenario assertions pass in jsdom.

Loop guard:
1. If same assertion fails twice with no changed failure text, mark blocked.
2. If edits spread outside expected files, stop and reassess.

Done criteria:
1. Hash drives initial tab.
2. Back/Forward traverses tabs in-app.
3. No regression in existing tab behavior.

---

### NAV-03: Auth guard and post-login/logout routing correctness
Purpose: preserve current auth gating while hash routing is active.

Dependencies: `NAV-02`.

Implementation:
1. Enforce unauthenticated route normalization to `workflow`.
2. Preserve existing “no defined roles => player-config after login” rule.
3. Ensure logout rewrites tab to `workflow` and normalizes hash.
4. Handle invalid hash + auth transitions deterministically.

Validation options:
1. Quick: grep for auth/session clear flows and route normalization calls.
2. Standard: targeted auth UI tests + new navigation-auth tests.
3. Full: full `npm test`.

Positive progress signals:
1. Unauthenticated deep-link tests pass.
2. Existing post-login role-routing tests remain green.

Loop guard:
1. Max 2 retries for auth-flow regressions before blocked state.
2. Must add/adjust tests before each retry, not blind code churn.

Done criteria:
1. Auth + routing invariants all pass.
2. No login/logout UX regression.

---

### NAV-04: Test suite expansion for navigation history
Purpose: add durable, explicit tests that prevent regressions and guide agents.

Dependencies: `NAV-01` for contract; can run parallel with `NAV-02` implementation.

Implementation:
1. Add `tests/ui/app.navigation-history.test.mjs` for route-centric scenarios.
2. Add/extend assertions in existing UI tests only where shared behavior changed.
3. Keep tests deterministic with jsdom URL and explicit `hashchange` events.

Required scenarios:
1. Initial hash selects correct tab when authenticated.
2. Invalid hash normalizes to workflow.
3. Unauthenticated `#explorer` normalizes to workflow.
4. Clicking tabs updates hash.
5. Back/Forward updates active tab classes and visible panel.
6. Login without roles still lands on `player-config`.
7. Logout always lands on `workflow`.

Validation options:
1. Quick: run only new test file.
2. Standard: run all UI test files.
3. Full: `npm test`.

Positive progress signals:
1. At least one new route regression test fails before code change and passes after.
2. Existing UI suite remains green.

Loop guard:
1. No test disabling/skipping allowed.
2. If flaky behavior appears, block and document deterministic fix plan.

Done criteria:
1. Scenario matrix covered.
2. UI tests pass in stable order across 2 consecutive runs.

---

### NAV-05: Documentation and operational handoff
Purpose: update project docs and provide async-agent runbook closure.

Dependencies: `NAV-03`, `NAV-04`.

Implementation:
1. Update README navigation section to document hash routes and Back/Forward behavior.
2. Add short troubleshooting section for invalid hash normalization.
3. Add Beads closure notes summarizing commands run and outcomes.
4. Create follow-up wishlist bead for optional path-routing phase.

Validation options:
1. Quick: docs mention all four hash routes.
2. Standard: verify references match implemented behavior.
3. Full: final full test run before close/push workflow.

Positive progress signals:
1. Docs and code behavior match.
2. Follow-up bead exists for deferred path-routing work.

Loop guard:
1. One doc pass only unless behavior changed after review.
2. Avoid speculative future architecture in docs.

Done criteria:
1. README reflects shipped behavior.
2. Epic and child Beads updated/closed with evidence links.

## Validation Tiers (global)
1. Quick:
   - Static grep checks.
   - Single test file for current bead.
   - Use for fast iteration.
2. Standard:
   - All UI tests relevant to routing/auth.
   - Use before marking bead “ready for review”.
3. Full:
   - `npm test`.
   - Required before closing each bead and before final push.

## Anti-Loop Protocol (mandatory for long-running agents)
1. Each attempt must log:
   - hypothesis
   - exact changed files
   - validation command
   - result delta
2. Progress is valid only if one of these is true:
   - a previously failing assertion now passes
   - failure count decreases
   - a required acceptance check is newly satisfied
3. Stall detection:
   - same failing assertion twice with no delta => mark bead `blocked`
   - more than 3 implementation attempts on one bead => mark `blocked`
   - unrelated file churn detected => revert that attempt and note cause
4. Recovery action when blocked:
   - add bead note with failing assertion and last two diffs summary
   - open a focused follow-up bead if scope split is needed
   - do not continue blind retries

## Test and Acceptance Matrix
1. Functional:
   - tab click updates active panel
   - URL hash matches active tab
   - Back returns to prior in-app tab
   - Forward replays in-app tab
2. Auth:
   - unauth deep links normalize to workflow
   - logout normalizes to workflow
   - no-role user post-login lands on player-config
3. Robustness:
   - invalid hash normalization uses replace semantics
   - no duplicate history entries for same tab selection
4. Regression:
   - existing workflow/tree UI tests remain green
   - server API 404 test for unknown routes remains green

## Beads Command Template (for execution)
1. Create epic/task:
   - `bd_safe create "<title>" -t epic -p 1 --description "<summary>"`
   - `bd_safe create "<title>" -t task -p 1 --description "<acceptance>"`
2. Start bead:
   - `bd_safe update <id> --status in_progress`
3. Log checkpoint:
   - `bd_safe note <id> "Attempt N: <hypothesis> | Validation: <cmd> | Result: <delta>"`
4. Block on stall:
   - `bd_safe update <id> --status blocked`
   - `bd_safe note <id> "Blocked: <repeated failure>"`
5. Complete:
   - `bd_safe close <id> --reason "Acceptance checks passed; evidence: <tests/commands>"`

## Final Session Closeout (when executing later)
1. Run required quality gates.
2. Update Beads statuses and notes.
3. `git_net pull --rebase`
4. `git_net push`
5. `git_local status -sb` must show up-to-date with origin.
6. Ensure no stranded local work.

## Assumptions
1. Primary UI entry remains `public/index.html`.
2. Tab IDs stay: `workflow`, `team-config`, `player-config`, `explorer`.
3. Existing API and server route contracts must not change in this phase.
4. jsdom-based UI tests remain the primary automated validation for routing behavior.
