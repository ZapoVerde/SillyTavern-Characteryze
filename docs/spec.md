# Project Specification: Characteryze
**SillyTavern Integrated Content & Prompt Generator**

---

## 1. Core Philosophy

Characteryze is a native SillyTavern extension designed to eliminate the friction of external prompt engineering by implementing a **Granular Mapping Workflow**.

The system operates on four principles:

1. **Iterative Focus:** AI performs best when given small, highly specific tasks. Users generate content section-by-section.
2. **State Isolation:** The AI operates in a sandboxed "Draft State." It can never overwrite live SillyTavern data until the user explicitly maps and commits the changes.
3. **Native Harmony:** Characteryze reuses ST's generation pipeline, streaming UI, swipes, stop button, message editing, chat JSONL format, connection profiles, prompt manager, and preset system. It layers a tab interface and workbench on top of existing machinery rather than replacing it.
4. **Task-Scoped Sessions:** Each Forge session is a discrete ST chat tagged as a Characteryze session. Sessions and targets are decoupled — a saved session can be loaded against any canvas target at any time.

---

## 2. Canvas Types

The user selects a canvas type when starting a new session. Each type routes through the same workflow (Forge → Workbench) but populates different target fields in the Workbench.

- **Character Card** (New or Existing)
- **System Prompt Profile** (Advanced Formatting)
- **Ruleset** (Prompt manager entry — see Section 5)

Rulesets are a first-class canvas type, not a separate management system. They are created and edited through the same Forge → Workbench pipeline as any other content.

---

## 3. Launch & Entry Point

Characteryze is launched from the CTZ (Extensions) menu:

1. Open Extensions panel
2. Expand Characteryze entry
3. Click Launch

On launch, the tab interface overlays ST's existing UI. On exit (CTZ menu close), ST pops to the loading screen and the previous connection profile is restored.

---

## 4. The Interface

### 4.1 Tab Bar

A tab bar overlays above the ST interface, providing three views:

- **Forge** — ST's native chat UI operating under the Forge connection profile
- **Workbench** — the codeblock source navigator and field diff engine
- **Settings** — image generation config and session management

### 4.2 The Forge

The Forge is ST's native chat interface operating under the Characteryze Forge connection profile. No custom chat surface is built. ST's full generation pipeline is used as-is — streaming, swipes, stop button, and message editing all work natively.

- **Session Selector:** On opening, the user either starts a fresh Forge session (a new ST chat tagged as Characteryze) or loads a previously saved Forge session from the Projects list. The selected session loads as ST's active chat.
- **Canvas & Target Selector:** Selects the canvas type (Character Card, System Prompt Profile, Ruleset) and specific target. For Character Cards, a searchable dropdown defaults to "Create New" and lists all existing characters.
- **Ruleset Selector:** Rulesets are named prompt entries in ST's prompt manager stack, toggled on/off exactly like any other prompt entry. The Characteryze UI provides a dynamic tickable dropdown that maps directly to toggling these entries — no custom injection logic is required. ST's prompt manager handles concatenation and ordering natively.
- **Generation:** ST's native Generate() pipeline runs against the active Forge session chat under the Forge connection profile.

### 4.3 The Codeblock Scraper

A background processor monitoring every completed AI reply via ST's generation events. Any text inside a codeblock (delimited by ` ``` `) is scraped by pure heuristic — no AI instruction required. Each harvested block is timestamped and stored for the Workbench source navigator. The codeblock language tag (e.g., ` ```scenario `, ` ```portrait-prompt `) is read as free metadata for Workbench target suggestions.

Harvested blocks are derived on demand from the active Forge session JSONL — they are not maintained as a separate persistent data structure. The scraper re-derives the block list from the chat whenever the Workbench is opened.

### 4.4 The Workbench

The switchboard where raw generated blocks are mapped to SillyTavern database fields. The diff editor UI follows the **Vistalyze editor pattern** exactly — the same two-pane layout, staging action, and dirty-field tracking used across the extension suite.

- **Contextual Field Dropdown:** Populates based on the active canvas type.
  - Character Card: *Name, Description, Personality, Scenario, First Message, Avatar/Portrait, etc.*
  - System Prompt Profile: *Main Prompt, NSFW Prompt, Jailbreak, Author's Note.*
  - Ruleset: *Name, Content.*
- **Source Navigator:** A scrollable list of every codeblock scraped from the current Forge session, with timestamps and language tag hints.
- **Diff View Engine (Vistalyze pattern):**
  - *Left Pane (Live State):* The current text of the selected target field. Read-only.
  - *Right Pane (Draft State):* The text of the selected harvested codeblock. Fully editable before staging.
- **Stage Action:** Aligns a harvested block with a target field. The UI marks that field as "Dirty" (pending commit).
- **Final Commit:** Pushes the entire staged Draft State to disk using ST's native save functions. Flushes Draft State on completion.

### 4.5 Settings

See Section 7.

---

## 5. The Modular Ruleset Engine

Rulesets are instruction manuals for the AI — not boilerplate content. They define *how* the AI should structure and format its output.

Rulesets are named entries in ST's prompt manager stack inside the Forge connection profile. They are toggled on and off via the Characteryze UI's tickable dropdown, which maps directly to ST's native prompt toggling. No custom injection, concatenation, or storage logic is required — ST's prompt manager handles all of it.

**Creation:** Via the Ruleset canvas type, through the same Forge → Workbench pipeline as any other content. A committed ruleset becomes a new named prompt entry in the Forge profile's prompt stack.

**Discovery Loop:** Strong Forge sessions surface effective patterns. The user codifies these into a new ruleset entry so future sessions start from that baseline.

---

## 6. The Integrated Portrait Studio

- The user asks the AI in the Forge to generate a physical description and portrait prompt.
- The AI outputs a ` ```portrait-prompt ` codeblock. The scraper captures it automatically.
- In the Workbench, the user maps this block to the "Avatar/Portrait" target field.
- This triggers an asynchronous call to ST's configured Image Generation API (Stable Diffusion, Pollinations, etc.).
- The resulting image is previewed in the Workbench right pane.
- On Final Commit, the image is attached as the `.png` or `.webp` for the Character Card.
- Image gen prompt templates integrate PLZ-style style selectors, imported from SillyTavern-Personalyze rather than reimplemented.

---

## 7. Connection Profile Management

### 7.1 First Load

On first launch, Characteryze generates and saves the Forge connection profile from a shipped defaults file. The defaults file specifies:

- Profile name ("Characteryze Forge")
- API connection settings (endpoint, model, api_type) — sourced from the connection saved in `extension_settings`
- Default prompt stack (base instructions, one or two example ruleset entries)

The defaults file seeds the profile once and is not referenced again. The profile is thereafter owned by ST's native profile system.

### 7.2 Permasave

Characteryze permanently stores the user's last known non-Forge connection profile in `extension_settings` as `permasave_profile`. This is the authoritative answer to "what profile should be restored" at all times.

- **Written:** Every time Characteryze opens, the current active profile is written to `permasave_profile` before swapping to the Forge profile.
- **Never cleared:** Overwritten only on a clean Characteryze open. Self-healing — if the user changes their normal profile between sessions, the permasave updates correctly on next open.

### 7.3 Profile Swap Sequence

**On Characteryze open:**
1. Write current active profile name to `permasave_profile`
2. Swap to Forge connection profile
3. Load selected Forge session as active chat

**On Characteryze exit (CTZ menu close):**
1. Swap to `permasave_profile`
2. Pop ST to the loading screen

### 7.4 Guard — Rogue Profile Detection

Fires on every `CHAT_LOADED` event:

- Is the active connection profile the Forge profile?
- AND is the Characteryze UI not active?
- If both true → swap to `permasave_profile`, pop to loading screen

This guard handles the one failure mode the swap architecture cannot prevent: the user loading a new chat while the Forge profile is active outside of Characteryze. The guard is exempted during normal Characteryze operation by the UI-active check.

---

## 8. Session & Project Model

### 8.1 Sessions and Targets are Decoupled

A Forge session (the ST chat JSONL) is independent of any canvas target. A session of strong writing can be loaded against multiple different targets — mining it for different characters or rulesets without regenerating.

### 8.2 Session Identification

Forge sessions are standard ST chat JSONL files identified by a metadata tag on the first message's `extra` field:

```json
{
  "extra": {
    "characteryze": {
      "canvas_type": "character_card",
      "session_name": "Sci-Fi Prison Warden"
    }
  }
}
```

The Projects list is a filtered view over ST's existing chat history — all chats carrying a `characteryze` tag are surfaced as Forge sessions. No separate file store is required.

### 8.3 Autosave & Session Naming

Sessions autosave via ST's native autosave machinery. A lightweight one-shot LLM call generates a human-readable session name from the first user message(s), fired asynchronously after the first response completes. Session naming can be toggled off in Settings, falling back to a timestamp.

### 8.4 Active Workspace Object

Ephemeral working state for the current session — lives in memory, not persisted:

```javascript
active_workspace {
  session_id:  "uuid",
  canvas_type: "character_card" | "system_prompt" | "ruleset",
  target:      {},          // the ST entity being edited
  draft_state: {}           // staged field mappings, flushed on Commit
}
```

---

## 9. Extension Settings

```javascript
extension_settings.characteryze {
  permasave_profile:  "My Normal Profile",  // always current
  forge_profile_name: "Characteryze Forge",
  connection: {                              // used to seed first-load profile
    api_type:  "...",
    endpoint:  "...",
    model:     "..."
  },
  image_gen: {
    engine:   "pollinations" | "sd" | "...",
    endpoint: "...",
    prompt:   "..."
  },
  sessions: {
    autosave:      true,
    max_saved:     50,
    name_generate: true
  }
}
```

---

## 10. Settings Tab

| Setting | Description |
|---|---|
| **Image Gen Engine** | Picker for image generation backend (Pollinations, Stable Diffusion, etc.) |
| **Image Gen Prompt** | Default prompt template. Integrates PLZ-style style selectors from SillyTavern-Personalyze. |
| **Autosave** | Toggle. On by default. Delegates to ST's native autosave. |
| **Max Saved Sessions** | Integer limit. Oldest sessions pruned when limit is hit. |
| **Session Name Generation** | Toggle LLM-generated session names. Falls back to timestamp if off. |

---

## 11. What Characteryze Is

**Infrastructure layer:** Profile handler — swap, permasave, guard, first-load generation.

**Product layer:**
- Tab UI overlay (Forge / Workbench / Settings)
- Codeblock scraper (generation event listener, source navigator)
- Field diff engine (Vistalyze pattern — live state left pane, draft state right pane, stage, commit)

---

## 12. What Characteryze Does Not Do

- **No custom chat surface.** The Forge is ST's native chat UI.
- **No payload interception.** No GENERATE_AFTER_DATA mutation.
- **No custom streaming.** ST's StreamingProcessor handles all token rendering.
- **No custom ruleset storage.** Rulesets are prompt manager entries in the Forge profile.
- **No Clipboard Array.** Harvested blocks are derived on demand from the session JSONL.
- **No RAG or cross-session retrieval.** Strong patterns get promoted to ruleset entries.
- **No duplicate generation controls.** Parameters live in the Forge connection profile and ST's preset system.
- **No mandatory system prompt.** The prompt stack is whatever entries the user has enabled. Empty selection means empty system prompt.