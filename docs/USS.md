# Unified Site Styling (USS) — DraftEngine Design System

## Design Checklist (Pre-Commit Gate)

Before presenting work for commit, verify:

- [ ] All colors use CSS variables — no hardcoded hex values
- [ ] No element stretches beyond its content width
- [ ] Popovers/dropdowns don't clip in scrollable containers
- [ ] Render calls audited for redundancy (no duplicate init renders)
- [ ] HTML default text matches JS runtime values (no flash of stale content)
- [ ] Removed elements fully cleaned up (HTML, JS, CSS, element registrations)
- [ ] Hidden elements retain their code intact
- [ ] New patterns documented in this file if reusable
- [ ] What's New / Coming Soon updated in `public/index.html`

## Layout Philosophy

- **No stretch** — Elements should not stretch to fill space. Use fixed/compact sizing. Buttons must never expand to fill available width — they stay compact at their content size. When placing buttons in flex containers, do not use `justify-content: space-between` or `flex: 1` on buttons; keep them inline at natural width.
- **Section-based design** — Pages use nested sections at non-default sizes depending on the page function. Sections create visual hierarchy without full-width stretching.
- **Minimize scrolling** — Display relevant data compactly so the user doesn't have to scroll the main page excessively.
- **Settings in modals** — Configuration and settings go in modals, not inline on the page. Only core functionality and data the user needs to actively reference belongs on the page surface.
- **Modal triggers** — Use small icon buttons (pencil, stats, gear) for compact triggers, or standard buttons when the action needs more visibility. Don't dedicate page real estate to settings that can be accessed on demand.

## CSS Variables (Theme)

| Variable          | Value     | Purpose                    |
|-------------------|-----------|----------------------------|
| `--bg`            | `#f5f2e9` | Page background            |
| `--surface`       | `#fffdf7` | Card/panel background      |
| `--surface-strong`| `#f7f1e5` | Emphasized surface (footers, headers) |
| `--surface-card`  | `#fffefa` | Card/input backgrounds     |
| `--accent`        | `#cc5b34` | Primary action color       |
| `--accent-soft`   | `#f7d8ce` | Hover highlight, soft accent |
| `--good`          | `#236d3f` | Positive/pass text         |
| `--good-bg`       | `#edf7f0` | Pass badge background      |
| `--good-soft`     | `#f0f7f2` | Pass card tint             |
| `--good-border`   | `#b7d3be` | Pass border                |
| `--warn`          | `#9c3f1e` | Destructive/negative actions |
| `--warn-bg`       | `#fff1eb` | Fail badge background      |
| `--warn-soft`     | `#fdf0ec` | Fail card tint             |
| `--warn-border`   | `#e9b4a0` | Fail border                |
| `--border`        | `#d6d0c0` | Borders, separators        |
| `--muted`         | `#5b6a71` | Secondary text             |
| `--ink`           | `#1a2730` | Primary text               |

All new UI must use these variables. Never use hardcoded hex colors — always reference the variable. No dark themes. No monospace fonts outside code blocks.

## Typography

- Primary font: system font stack (no custom font imports)
- All UI text uses the inherited font; no monospace outside code contexts

## Button Set Rules

### Ghost Button Sizing
- Ghost buttons (`button.ghost`) always use `width: auto` — they are compact action buttons, never full-width. This is set globally in CSS and must not be overridden to stretch.
- Primary (solid) buttons use `width: auto` by default — they stay compact at their content size, same as ghost buttons. Use `width: 100%` only when a specific form layout explicitly requires it (e.g. a single full-width submit button).

### Button Sizing in Containers (Modals, Popovers, Footers)
- Buttons in `.draft-modal-footer`, `.button-row`, and `.tour-btn-row` must be `width: auto`, single-line (`white-space: nowrap`), and `margin-top: 0`.
- Button text must be fully visible — if a container is too narrow for the text, the button width expands to fit (this is the one case where width is not strictly compact).
- All button containers use `display: flex; justify-content: flex-end` — buttons align to the **lower-right** of their container, like OK/Cancel on a standard dialog.

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

## Section Header (`.uss-section-header`)

All page sections use the USS section header pattern for consistent layout:

```html
<div class="uss-section-header">
  <h2>Section Title</h2>
  <!-- optional action button (stats icon, pencil, etc.) -->
</div>
```

- Flex row: title left, optional action button(s) right
- Works with `h2` (top-level sections) and `h3` (subsections)
- Title forced to single line (`white-space: nowrap`)
- Action buttons should be compact icons or standard buttons as appropriate

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
- Default: `color: var(--accent); border-color: var(--accent-soft); background: var(--surface-card)`
- Hover: same styling (the "card edit hover" is the default)
- Used on champion cards (`.champ-card-edit-btn`) and advanced scope (`.advanced-scope-edit-btn`)

## Card Grid Section Pattern

All card grids that display collections use a bordered scrollable container:

```css
border: 1px solid var(--border);
border-radius: 8px;
padding: 0.6rem;
max-height: [appropriate value];
overflow-y: auto;
```

- The border creates a visual group boundary for the card collection
- Padding separates cards from the border edge
- `max-height` prevents the grid from pushing the page layout — content scrolls within
- Used by: `.card-grid` (champions), `.req-card-grid` (requirement status), `.comp-card-grid` (compositions/requirements pages)

### Grid Column Sizing
- Champions: `repeat(auto-fit, minmax(320px, 1fr))`
- Requirement status cards: `repeat(auto-fill, minmax(200px, 1fr))`
- Page cards (compositions, requirements): `repeat(auto-fill, minmax(260px, 1fr))`

## Hover Popover Pattern (`.clause-popover`)

Styled card popovers appear on hover to show structured detail. Do NOT use native `title` attribute tooltips for multi-line or structured data.

```html
<span class="clause-popover-anchor">
  <span class="trigger-text">hover target</span>
  <div class="clause-popover">
    <ul class="clause-popover-list">
      <li class="clause-popover-item">
        <strong>Heading</strong>
        <span class="clause-popover-detail">Detail text</span>
        <span class="clause-popover-constraints">Constraint · list</span>
      </li>
    </ul>
  </div>
</span>
```

- Anchor: `position: relative; display: inline-block`
- Popover: `position: absolute; bottom: calc(100% + 6px)`; hidden by default, shown on `:hover`
- Card items: bordered pills with heading, detail, and constraint rows
- Uses `var(--surface)` background, `var(--shadow)` for elevation, `z-index: 90`
- `pointer-events: none` on popover to prevent flicker

## Requirement Card Grid (`.req-card-grid`)

Compact status cards for requirement evaluation results.

- Grid: `repeat(auto-fill, minmax(200px, 1fr))`, `max-height: 16rem`, scrollable, bordered section
- Cards: green tint (`var(--good-soft)`) for pass, red tint (`var(--warn-soft)`) for fail
- Badge pill: `[✓ Pass]` (good) or `[✗ N fail]` (warn) — Option 3 compact badge style
- Background tint: Option C — color wash for instant scanability
- Definition on hover via `title` attribute
- Click card → Clause Detail Modal

### Clause Detail Modal
- USS modal with close button
- Status badge, definition text, clause breakdown
- Each clause: colored dot (`●` green/red) + match count + status text
- USS pencil icon per clause → opens Clause Editor Modal
- Champion name pills inline for met clauses

### Clause Editor Modal
- Full clause editing UI (conditions, min/max, role filter, separation)
- Snapshot/draft pattern: deep-clone state on open
- Cancel/close with dirty check → `showUSSConfirm()`
- Save validates, updates in-memory definitions, returns to Clause Detail Modal

## Form Input Rules

### Textarea
- All `<textarea>` elements use `resize: none` — users should not manually resize form fields. The developer sets the appropriate size via the `rows` attribute.

### Stacked Form Fields
- When a form has multiple labeled fields (e.g. Name + Definition), stack them vertically rather than side-by-side. Each field gets the full container width.
- Do not use `.grid-2` for label+input pairs inside modals — the two-column layout crowds buttons and wastes vertical space.

## Filter Pattern

### Collapsible Filter Section
- Toggle button shows/hides filter body
- Active filter pills rendered below toggle
- Individual clear buttons per filter field (inline `×` in `.filter-label-header`)
- "Clear All Filters" row at bottom

### Filter Labels
- `border: 1px solid var(--border); border-radius: 12px; background: var(--surface-card); padding: 0.5rem 0.6rem`

### Checkbox-Multi Dropdowns
- Absolute positioning with `z-index: 80`
- Parent section gets `position: relative; z-index: 5` to keep dropdowns above cards

## Guided Tour Pattern

Page-level tours teach users how to complete multi-step workflows (e.g. creating a requirement, building a composition).

### Tour Callout (`.tour-callout`)
A prominent banner displayed on the page to invite the user to start the tour.

```html
<div id="{page}-tour-callout" class="tour-callout">
  <div class="tour-callout-content">
    <strong>New to {Feature}?</strong>
    <span>Learn how to {action description}.</span>
  </div>
  <button id="{page}-tour-btn" type="button" class="tour-callout-btn">Start Tour</button>
  <button id="{page}-tour-dismiss" type="button" class="ghost tour-callout-dismiss" aria-label="Dismiss">&times;</button>
</div>
```

- Placed below the section header, above page content
- Visible when `state.ui.showGettingStarted` is true and session is not dismissed
- Dismiss (`×`) is session-only — callout reappears on next page load
- Profile setting ("Getting Started Guide") controls persistent visibility across sessions

### Tour Popover (`.tour-popover`)
Positioned popovers that highlight each element in sequence during the tour.

- Target element gets `.tour-highlight` (green outline via `var(--good)`)
- Popover shows: step counter, message text, three buttons: Exit Tour, Restart, Next/Finish
- Tour overlay at `z-index: 9998`, popover at `z-index: 10000` — layers above modals (`z-index: 9000`)
- Popover auto-positions below target, flips above if viewport constrained

### Tour Implementation Template
```javascript
function start{Page}Tour() {
  runGuidedTour([
    {
      target: "#{page}-create-btn",        // CSS selector or function returning element
      message: "Description of this step."
    },
    {
      target: () => document.querySelector(".modal .input"),  // Function for dynamic elements
      message: "Description of this step.",
      before: () => {                      // Optional: runs before step renders
        // Open modal, add clause, etc.
      }
    }
  ], {
    onFinish: () => {                      // Optional: runs on Finish or Exit
      closeAllDraftModals();               // Clean up modals opened during tour
    }
  });
}
```

### Tour Step Definition
| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `target` | string or function | Yes | CSS selector or function returning the DOM element to highlight |
| `message` | string | Yes | Instruction text shown in the popover |
| `before` | function | No | Runs before the step renders — use to open modals, add elements, etc. |

### Adding a Tour to a New Page
1. Add `.tour-callout` HTML below the section header
2. Register callout, button, and dismiss elements in `createElements()`
3. Add visibility logic in the page render function: `callout.hidden = !state.ui.showGettingStarted || state.ui.gettingStartedDismissed`
4. Wire click events: tour button calls `start{Page}Tour()`, dismiss sets `state.ui.gettingStartedDismissed = true`
5. Add `renderAllGettingStartedBars()` call in dismiss handler to sync all callouts
6. Define `start{Page}Tour()` with steps array and `onFinish` callback
