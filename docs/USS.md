# Unified Site Styling (USS) — DraftEngine Design System

## CSS Variables (Theme)

| Variable          | Value     | Purpose                    |
|-------------------|-----------|----------------------------|
| `--bg`            | `#f5f2e9` | Page background            |
| `--surface`       | `#fffdf7` | Card/panel background      |
| `--surface-strong`| `#f7f1e5` | Emphasized surface (footers, headers) |
| `--accent`        | `#cc5b34` | Primary action color       |
| `--accent-soft`   | `#f7d8ce` | Hover highlight, soft accent |
| `--warn`          | `#9c3f1e` | Destructive/negative actions |
| `--border`        | `#d6d0c0` | Borders, separators        |
| `--muted`         | `#5b6a71` | Secondary text             |
| `--ink`           | `#1a2730` | Primary text               |

All new UI must use these variables. No dark themes. No monospace fonts outside code blocks.

## Typography

- Primary font: system font stack (no custom font imports)
- All UI text uses the inherited font; no monospace outside code contexts

## Button Set Rules

### Orientation
- Buttons align to the **lower-right corner** of their containing section/element.
- **Right button**: primary/affirm action (accent color) — Accept, Save, Stay, Update
- **Left button**: secondary/cancel action (ghost style) — Cancel, Leave, Discard

### Three or More Buttons
- Use color-to-logic mapping
- Destructive/negative buttons go to the **far left**, separated from the positive group by a visual gap separator (`.composer-btn-separator`)
- Positive actions grouped together on the right

### Destructive Actions
- Use `var(--warn)` color styling
- Ghost button base with warn text color
- Hover: solid warn background with white text
- Class: `.composer-btn-destructive` for sticky bar, inline `style.color = "var(--warn)"` for modals

### Sticky Bar (`.composer-bottom-bar`)
- Layout: Clear Draft (destructive, far left) | separator | Start Draft, Save Draft, Load Draft (right group)
- Background: `var(--bg)` with `border-top: 1px solid var(--border)`
- Fixed to bottom, responsive flex-wrap on small screens (separator hidden)

## Confirmation Modal (USS Confirm)

Never use browser `confirm()` or `alert()`. Use the in-app USS styled confirmation modal.

### Structure
- Overlay: `.nav-warning-toast` (full-screen backdrop)
- Box: `.nav-warning-box` (centered dialog)
- Title: `.nav-warning-title`
- Body: `.nav-warning-body`
- Buttons: `.button-row` (flex, gap, right-aligned)

### Button Order in Confirmation Modals
- **Left**: destructive/affirm action (ghost + `var(--warn)` text) — "Leave Anyway", "Discard"
- **Right**: safe/cancel action (primary/accent) — "Stay", "Keep Editing"

### Reusable Function
```javascript
showUSSConfirm({
  title: "Unsaved Changes",
  body: "You have unsaved changes. Leaving now will discard them.",
  affirmLabel: "Leave Anyway",
  cancelLabel: "Stay",
  destructive: true
})
// Returns Promise<boolean> — true = affirm (leave), false = cancel (stay)
```

## Scope Panel Pattern

### Inline Header
All scope panels use the "Editing [dropdown] Scope (i)" inline pattern:
- `<span class="ced-scope-inline">` wrapping: label text, `<select>` dropdown, "Scope" text, info icon
- Used in: Champion Editor, Tags, Requirements, Compositions, Advanced Controls

### Advanced Controls Variant
- Uses "Using [dropdown] Scope" (not "Editing")
- Pencil icon button (`.advanced-scope-edit-btn`) opens the Configure Custom Scopes modal
- Scoring section in same column, pushed to bottom with `margin-top: auto`

## Modal Pattern (`.draft-modal`)

### Structure
- Overlay: `.draft-modal-overlay`
- Dialog: `.draft-modal` (centered, max-width, max-height with overflow scroll)
- Header: `.draft-modal-header` — title (`h3`, single-line with ellipsis) + close button
- Body: scrollable content area
- Footer: `.draft-modal-footer` — right-aligned buttons, `var(--surface-strong)` background

### Close Button
- Always visible red background (`var(--warn)`)
- White "X" text, 2rem square
- Hover darkens to `#7a2f14`
- Class: `.draft-modal-close`

### Snapshot/Draft Pattern (for editable modals)
- On open: deep-clone current state as snapshot
- Modal edits a working copy (draft)
- Cancel: revert to snapshot (with USS confirm if dirty)
- Update/Save: apply draft to state

## Pencil Edit Icon

### Standard Pattern
- SVG pencil icon (inline `innerHTML`)
- Default: `color: var(--accent); border-color: var(--accent-soft); background: #fff4ef`
- Hover: same styling (the "card edit hover" is the default)
- Used on champion cards (`.champ-card-edit-btn`) and advanced scope (`.advanced-scope-edit-btn`)

## Card Grid

- `.card-grid` with `max-height: 40rem; overflow-y: auto` for scrollable 3-row display
- Champion cards use consistent border-radius and surface background

## Filter Pattern

### Collapsible Filter Section
- Toggle button shows/hides filter body
- Active filter pills rendered below toggle
- Individual clear buttons per filter field (inline `×` in `.filter-label-header`)
- "Clear All Filters" row at bottom

### Filter Labels
- `border: 1px solid var(--border); border-radius: 12px; background: #fffefa; padding: 0.5rem 0.6rem`

### Checkbox-Multi Dropdowns
- Absolute positioning with `z-index: 80`
- Parent section gets `position: relative; z-index: 5` to keep dropdowns above cards
