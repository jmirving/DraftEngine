# Champion Generated Tags Plan

## Goal

Keep `champion_core` as the raw imported source of truth and add a generated tag layer in DraftEngine for stable, sortable champion dimensions derived from core data.

## Ownership

- `champion_core` stays processor-owned and replaceable on import.
- DraftEngine owns the generated projection layer built from `champion_core`.
- Manual exceptions apply as overrides to generated output, not edits to `champion_core`.

## Proposed Schema Additions

### `generated_tag_dimensions`

Stores the fixed generated dimensions.

Examples:

- `range`
- `range_band`
- `riot_class`
- `riot_difficulty`
- `resource_model`
- `resource_type`
- `riot_attack_rating`
- `riot_defense_rating`
- `riot_magic_rating`

Suggested fields:

- `key`
- `label`
- `cardinality` (`one` or `many`)
- `sort_order`
- `is_active`

### `generated_tag_values`

Stores the allowed values for each dimension.

Suggested fields:

- `dimension_key`
- `value_key`
- `display_label`
- `sort_value`
- `metadata_json`

Notes:

- `sort_value` keeps values stable and sortable.
- `metadata_json` can hold numeric bounds for bucketed values.

### `champion_generated_tags`

Stores generated champion assignments.

Suggested fields:

- `champion_id`
- `dimension_key`
- `value_key`
- `display_label`
- `sort_value`
- `raw_numeric_value` nullable
- `source_field`
- `source_version`
- `is_override`
- `generated_at`

Notes:

- `raw_numeric_value` keeps Riot scores visible even when the display label is bucketed.
- Multi-value dimensions like `riot_class` would have one row per assigned value.

### `champion_generated_tag_overrides`

Stores manual exceptions that win over generated defaults.

Suggested fields:

- `champion_id`
- `dimension_key`
- `override_value_key`
- `reason`
- `created_by`
- `created_at`
- `updated_at`

Primary use case:

- `range` / `range_band` hybrid exceptions for champions that are melee sometimes and ranged sometimes.

### `champion_core_versions`

Tracks which imported core dataset produced the generated layer.

Suggested fields:

- `source_version`
- `source_identifier`
- `imported_at`
- `sha256`

If equivalent import metadata already exists elsewhere, reuse it instead of adding a new table.

## Generated Dimensions

### `range`

- Cardinality: `one`
- Source: `attackrange`
- Values:
  - `melee`
  - `hybrid`
  - `ranged`

Default rule:

- `<= 225` => `melee`
- `>= 300` => `ranged`
- manual override => `hybrid`

### `range_band`

- Cardinality: `one`
- Source: `attackrange`
- Values:
  - `melee`
  - `hybrid`
  - `short_ranged`
  - `standard_ranged`
  - `long_ranged`

Default rule:

- `<= 225` => `melee`
- `300-499` => `short_ranged`
- `500-574` => `standard_ranged`
- `>= 575` => `long_ranged`
- manual override => `hybrid`

### `riot_class`

- Cardinality: `many`
- Source: `riot_tags`
- Atomic values:
  - `assassin`
  - `fighter`
  - `mage`
  - `marksman`
  - `support`
  - `tank`

Rule:

- Split the pipe-delimited Riot class field into atomic assignments.

### `riot_difficulty`

- Cardinality: `one`
- Source: `info_difficulty`
- Raw scale: `0-10`
- Store both:
  - bucketed value
  - raw numeric score

Bucket values:

- `unknown`
- `low`
- `medium`
- `high`
- `very_high`

Bucket rule:

- `0` => `unknown`
- `1-3` => `low`
- `4-6` => `medium`
- `7-8` => `high`
- `9-10` => `very_high`

### `resource_model`

- Cardinality: `one`
- Source: `partype`
- Values:
  - `mana`
  - `energy`
  - `resourceless`
  - `special`

Rule:

- `Mana` => `mana`
- `Energy` => `energy`
- `None` or blank => `resourceless`
- everything else => `special`

### `resource_type`

- Cardinality: `one`
- Source: `partype`
- Values are normalized exact source types from the CSV.

Observed values in `docs/champion-core-example.csv`:

- `unknown`
- `blood_well`
- `courage`
- `crimson_rush`
- `energy`
- `ferocity`
- `flow`
- `fury`
- `grit`
- `heat`
- `mana`
- `none`
- `rage`
- `shield`

### Riot Rating Buckets

- `riot_attack_rating`
- `riot_defense_rating`
- `riot_magic_rating`

For each:

- Cardinality: `one`
- Source: corresponding `info_*` field
- Raw scale: `0-10`
- Store both bucket and raw numeric score
- Use the same value set as `riot_difficulty`:
  - `unknown`
  - `low`
  - `medium`
  - `high`
  - `very_high`

Suggested bucket rule:

- `0` => `unknown`
- `1-3` => `low`
- `4-6` => `medium`
- `7-8` => `high`
- `9-10` => `very_high`

## Static Code Definitions

Keep the dimension list, allowed values, sort order, and bucket thresholds in versioned code constants rather than only in database rows.

Benefits:

- makes scale boundaries explicit
- keeps comparisons stable
- avoids ambiguity such as whether Riot difficulty is out of `4`, `5`, or `10`

Database rows should store assignments and lookup data, but code should own the generation rules.

## Generation Flow

1. Import or refresh `champion_core`.
2. Resolve the current core source version.
3. Generate default assignments from static rules.
4. Apply manual overrides.
5. Upsert `champion_generated_tags`.
6. Expose the generated layer through repository/API read models.

## Read Path

DraftEngine should read:

- raw imported facts from `champion_core`
- generated preset dimensions from `champion_generated_tags`
- editable draft metadata from existing champion metadata/tag systems

The generated layer should stay separate from editable scoped tags so users cannot accidentally mutate processor-derived values.

## Implementation Scope

- add schema for generated dimensions, values, assignments, overrides, and version tracking
- add static constants for preset dimensions and bucket definitions
- add a rebuild script that regenerates assignments after core updates
- add repository and API support for reading generated tags
- add override support for hybrid range exceptions
- add tests for generation rules, sorting, rebuild behavior, and override precedence
