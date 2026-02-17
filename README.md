# DraftEngine

DraftEngine is a static-site app for composition checking and next-pick possibility tree generation.

## Run

1. From repo root, start a static server:
```bash
python3 -m http.server 8000
```
2. Open:
`http://localhost:8000/public/index.html`

The app opens on `Tree Builder` by default. `Explorer` remains available from the secondary tab.

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
- `topMustBeThreat=true`

Tree defaults:
- `maxDepth=4`
- `maxBranch=8`

## Current MVP Constraints

- Tree generation is deterministic for identical inputs.
- Candidate scoring does not apply redundancy penalties.
- Tree expansion priority follows configurable Node Draft Order.
- Team selector supports `None` mode (global role-eligible champion pools).
- Tree view includes both an outline and a visual Tree Map graph.
- Excluded champions are filtered from selectors and tree output.
- Candidate generation is constrained by team role pools.
- In team mode, slot labels include player names when available.
- Data ingestion is schema-validated and fails fast on malformed CSV/JSON.
