

## What ST Gives Us Free

- Chat surface, streaming, swipes, stop, editing
- JSONL persistence and autosave
- Prompt manager (ruleset toggling)
- Connection profile system
- Character picker, save functions
- Image gen API calls (Portrait Studio)
- Preset system

---

## What We Build

### Infrastructure

**`profile-manager.js`** — The core mechanical job.
- First-load profile generation from defaults
- Permasave read/write
- Swap in / swap out
- Guard (CHAT_LOADED listener)
- `< 300 LOC`

**`defaults.js`** — Static config object.
- Default profile name
- Default prompt stack entries
- Default connection shape
- Seed data only, never mutated at runtime
- `< 100 LOC`

**`logger.js`** — Messaging utility.
- Toggleable verbose / error-only modes
- All modules route through here, no raw `console.log` anywhere
- Follows PLZ forensic principle — structured entries, not strings
- `< 100 LOC`

---

### UI Layer

**`tab-bar.js`** — Overlay tab switcher.
- Forge / Workbench / Settings tabs
- Show/hide logic for each panel
- CTZ menu launch and exit hooks
- `< 150 LOC`

**`forge-panel.js`** — Forge tab UI.
- Session selector (Projects list — filtered JSONL scan for `characteryze` extra tag)
- Canvas type selector
- Character picker (searchable dropdown, "Create New" default)
- Ruleset tickable dropdown (maps to prompt manager toggles)
- Session name generation (one-shot LLM call, async after first response)
- `< 300 LOC`

**`workbench-panel.js`** — Workbench tab UI.
- Source navigator (codeblock list from scraper)
- Field dropdown (populated by canvas type)
- Diff view — Vistalyze editor pattern, left pane live state, right pane draft
- Stage action and dirty field tracking
- Commit action via ST native save
- `< 300 LOC`

**`settings-panel.js`** — Settings tab UI.
- Image gen engine picker
- Image gen prompt + PLZ style import
- Autosave toggle
- Max saved sessions
- Session name generation toggle
- `< 200 LOC`

---

### Core Logic

**`scraper.js`** — Codeblock harvester.
- Listens on ST generation complete event
- Regex scan for ` ``` ` delimiters
- Extracts language tag as metadata
- Timestamps each block
- Derives block list from active JSONL on Workbench open
- `< 150 LOC`

**`session-manager.js`** — Forge session lifecycle.
- New session creation (writes characteryze extra tag to first message)
- Projects list derivation (scans ST chat history for tag)
- Session load (sets active ST chat)
- Workspace object management (canvas type, target, draft state)
- `< 200 LOC`

**`field-mapper.js`** — Workbench field logic.
- Canvas type → field list mapping
- Live state reads (pulls current value from ST character/prompt object)
- Draft state writes (stage action)
- Commit executor (pushes draft state to ST native save)
- `< 200 LOC`

**`portrait-studio.js`** — Image gen integration.
- Detects `portrait-prompt` language tag in Workbench
- Triggers ST's image gen API call
- Previews result in Workbench right pane
- On commit, attaches image to character card
- `< 150 LOC`

---

### Principles Applied

Following PLZ's three kinds of code strictly:

- **Pure:** `defaults.js`, `field-mapper.js` (read/derive only), `scraper.js` (parse only)
- **Stateful:** `session-manager.js`, `profile-manager.js` (own their state domains)
- **IO:** `portrait-studio.js`, commit logic in `field-mapper.js`, LLM calls in `forge-panel.js`

No module mixes categories. Logger routes all output. Nothing exceeds 300 LOC.

