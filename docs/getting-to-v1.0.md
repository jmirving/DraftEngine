# DraftEngine -- Getting to v1.0

## Vision for v1.0

Deliver a fully functional, team-aware, tag-driven draft planning system
without Riot API dependency.

Core philosophy: - All composition logic is built from champion tags. -
Requirements are made of tag-based clauses. - Compositions are bundles
of requirements. - Overlay system supports self \> team \> global
customization.

------------------------------------------------------------------------

# Phase 1 -- Composer Correctness & Team Context

**Goal:** Make Composer truthful and structurally correct.

### Backend

-   Create endpoint to fetch resolved team draft context (roster + role
    assignments + role-specific pools).
-   Ensure role → user → pool mapping is deterministic and correct.

### Frontend

-   Fix Pool Snapshot so each role reflects the correct teammate's
    champion pool.
-   Normalize role display: `Role (PlayerName)` for all roles.
-   Remove artificial gating requiring champion selection to unlock
    review.
-   Merge Review functionality directly into Composer layout.

**Definition of Done** - Selecting a team always produces role-correct
pools. - Composer no longer requires fake input to proceed. - Composer
clearly represents constraints → checks → tree flow.

------------------------------------------------------------------------

# Phase 2 -- Tag-Driven Requirements System

**Goal:** Expand composable tag clauses and requirement authoring depth.

### Requirement Model

Each Requirement consists of one or more TagClauses:

TagClause: - `expr` (supports AND / OR / NOT + parentheses) -
`minCount` - optional `maxCount` - optional `roleFilter`

### Evaluation Engine

-   Evaluate each clause against current lineup.
-   Return per-clause pass/fail with explanation.
-   Prepare for tree pruning via:
    -   currentMatches
    -   remainingSlots
    -   maxPossibleMatches

**Definition of Done** - Requirements are fully data-driven. -
Evaluation output is structured and explainable. - No hardcoded
composition booleans remain.

------------------------------------------------------------------------

# Phase 3 -- Compositions (Requirement Bundles)

**Goal:** Bundle Requirements into named Composition profiles.

### Composition Model

-   name
-   description
-   list of requirementIds
-   scope (self / team / global)

### Composer Integration

-   Select active Composition.
-   Display per-requirement evaluation.
-   Tree pruning eliminates impossible branches.

**Definition of Done** - Multiple compositions can exist. - Composer
evaluates based on selected composition. - Valid leaves can be filtered
by composition success.

------------------------------------------------------------------------

# Phase 4 -- Scope & Overlay System

**Goal:** Enable customizable truth layers.

Scopes: - self - team - global

Overlay resolution: - self overrides team overrides global

### Implementation

-   Add self scope for tags, requirements, compositions.
-   Implement effective overlay resolution logic.
-   Clearly indicate editing scope in UI.
-   Enable promotion flow (self → team → global).

**Definition of Done** - Users can customize locally without affecting
global truth. - Teams can maintain shared definitions. - Overlay logic
is deterministic and tested.

------------------------------------------------------------------------

# Phase 5 -- Tagging UX Improvements

**Goal:** Make tagging fast and low-friction.

### Improvements

-   Inline champion tag editor (no scroll reset).
-   Tagging queue mode for batch processing.
-   Autocomplete expression builder.
-   Fast tag filtering and search.

**Definition of Done** - Tagging 20+ champions is frictionless. - No
context loss when editing tags.

------------------------------------------------------------------------

# Phase 6 -- UI & Workflow Polish

**Goal:** Make DraftEngine feel cohesive.

### Improvements

-   Standardized page layout patterns.
-   Reduced instructional copy density.
-   Composer as 2-panel layout (Setup + Evaluation/Tree).
-   Unified toast/status feedback system.

**Definition of Done** - Navigation is intuitive. - Composer is the
clear core workflow.

------------------------------------------------------------------------

# Phase 7 -- v1.0 Hardening

**Goal:** Ship a stable v1.0.

### Stability

-   Tests for:
    -   Overlay resolution
    -   Clause evaluation
    -   Pruning correctness
-   Stable seed scripts and migrations.

### Onboarding Flow

1.  Create account\
2.  Create team\
3.  Assign roles\
4.  Configure pools\
5.  Select composition\
6.  Run composer

**Definition of Done** - Full workflow works without Riot integration. -
System is stable, explainable, and demo-ready.
