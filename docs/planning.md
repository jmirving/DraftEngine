# DraftEngine Planning & Backlog

## Recently Completed
| Item | Bead | Notes |
|---|---|---|
| Phase 1: Composer Correctness & Team Context | draft-engine-67o | Draft context endpoint, pool snapshot fix, stage gating removed |
| Password reset for registered accounts | draft-engine-2ly | Token-based, SHA-256 hashed, 1-hour TTL, single-use |
| Fix draft context discarded due to teamId type mismatch | draft-engine-tnv | `===` comparison between string and number |
| Fetch draft context on page load | — | Was only triggered on team dropdown change |
| Add `getMemberForSlot` helper | — | Single source of truth for Role (PlayerName) across Pool Snapshot, Player Slots, Node Draft Order |
| Add `team_members.lane` column + backfill from accepted invitations | — | Fixes team-specific position (e.g. SnomJuice → Top) without relying on profile primary role |

---

## Needs Action
| Item | Who | Notes |
|---|---|---|
| Run `npm run migrate:up` on hosted server | Server admin | Required for lane backfill — fixes existing TTT members and enables lane storage for future invitation accepts |
| Verify Pool Snapshot card names show Role (PlayerName) after migration + hard refresh | Tyler | Confirm 5080271 is working end-to-end |

---

## Roadmap

### Phase 2 — Tag-Driven Requirements System
**Bead:** draft-engine-rdb | **Priority:** High

Replace toggle-based checks with composable tag clauses.

- Requirement model: TagClause with `expr` (AND/OR/NOT), `minCount`, optional `maxCount`, optional `roleFilter`
- Evaluation engine: per-clause pass/fail with explanation
- Prepare tree pruning via `currentMatches`, `remainingSlots`, `maxPossibleMatches`

**Done when:** Requirements are fully data-driven. No hardcoded composition booleans remain.

---

### Phase 3 — Compositions (Requirement Bundles)
**Bead:** draft-engine-rsd | **Priority:** High

Bundle Requirements into named Composition profiles.

- Composition model: name, description, list of requirementIds, scope (self/team/global)
- Composer integration: select active Composition, display per-requirement evaluation, tree pruning eliminates impossible branches

**Done when:** Multiple compositions can exist. Composer evaluates based on selected composition.

---

### Phase 4 — Scope & Overlay System
**Bead:** draft-engine-1h2 | **Priority:** Medium

Enable customizable truth layers: self > team > global.

- Add self scope for tags, requirements, compositions
- Implement overlay resolution logic
- Enable promotion flow (self → team → global)

**Done when:** Users can customize locally without affecting global truth. Overlay logic is deterministic and tested.

---

### Phase 5 — Tagging UX Improvements
**Bead:** draft-engine-0j7 | **Priority:** Medium

Make tagging fast and low-friction.

- Inline champion tag editor (no scroll reset)
- Tagging queue mode for batch processing
- Autocomplete expression builder
- Fast tag filtering and search

**Done when:** Tagging 20+ champions is frictionless. No context loss when editing tags.

---

### Phase 6 — UI & Workflow Polish
**Bead:** draft-engine-8py | **Priority:** Medium

Make DraftEngine feel cohesive.

- Standardized page layout patterns
- Reduced instructional copy density
- Composer as 2-panel layout (Setup + Evaluation/Tree)
- Unified toast/status feedback system

**Done when:** Navigation is intuitive. Composer is the clear core workflow.

---

### Phase 7 — v1.0 Hardening
**Bead:** draft-engine-cm5 | **Priority:** High

Ship a stable v1.0.

- Tests for overlay resolution, clause evaluation, pruning correctness
- Stable seed scripts and migrations
- Full onboarding flow: Create account → Create team → Assign roles → Configure pools → Select composition → Run composer

**Done when:** Full workflow works without Riot integration. System is stable, explainable, and demo-ready.
