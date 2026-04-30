Here is the completely revised Phase 1 Specification, incorporating the "Virtual Library" (JSON settings blob) strategy and all the gap fixes we identified.

---

# Specification: Phase 1 — Virtual Library & Bridge Foundation

## Preamble: The Macro Project Scope
The current ruleset subsystem relies on managing SillyTavern’s native Prompt Manager directly. It identifies user-created rulesets using a fragile regex heuristic (looking for numbers in the prompt ID) and requires a rigid, one-to-one mapping between a Forge session and a specific target ruleset. 

To improve robustness, data portability, and user experience, we are transitioning to a **Sync-to-Bridge Architecture** coupled with a **Librarian Workbench**.

*   **The Source of Truth (Virtual Library):** To avoid the high friction of server plugins and messy internal file paths, rulesets will be stored natively inside the extension’s global settings JSON blob (`extension_settings.characteryze.ruleset_library`).
*   **The Bridge:** Characteryze will no longer litter the host application with multiple prompt entries. Instead, it will manage one single entry in SillyTavern’s Prompt Manager. 
*   **The Librarian Flow:** The Workbench will behave like a multi-document editor. Users can seamlessly switch between editing different rulesets via a dropdown without leaving their current Forge chat.
*   **The Publishing Flow:** When a user toggles rulesets on or off, the extension concatenates the text of all active rulesets from the Virtual Library and pushes that massive string into the single Bridge slot. SillyTavern handles the token-counting and AI injection naturally.

This specification covers **Phase 1**: Establishing the data layer (the Virtual Library) and the ST injection hook (the Bridge). No UI panels will be modified in this phase.

---

## 1. Modifications to Defaults (`defaults.js`)
We must update the schema to support the new data structures.

*   Add constants:
    *   `CTZ_BRIDGE_PROMPT_ID = 'ctz_bridge_prompt'`
    *   `CTZ_BRIDGE_PROMPT_NAME = 'Characteryze Rulesets'`
*   Update `DEFAULT_SETTINGS`: Add the following keys:
    *   `ruleset_library: {}` (Dictionary of `{"Ruleset Name": "Ruleset Content Text"}`)
    *   `active_rulesets: []` (Array of strings matching names in the library)

## 2. Frontend IO Adapter (`ruleset-library.js`)
This is a new module. It isolates all reads and writes to the Virtual Library, ensuring that other modules do not mutate the `extension_settings` object directly.

*   **Architectural Role:** Stateful (reads) / IO (writes)
*   **Responsibilities:** Acts as the CRUD interface for rulesets stored in the settings JSON.
*   **Public API:**
    *   `getRulesetList()`: Pure. Returns `Object.keys(extension_settings[CTZ_EXT_NAME].ruleset_library)`.
    *   `getRulesetContent(name)`: Pure. Returns the string content of the requested ruleset, or an empty string if it does not exist.
    *   `saveRuleset(name, content)`: IO. Sets `ruleset_library[name] = content`. Calls `saveSettingsDebounced()` to persist the JSON blob to disk.
    *   `deleteRuleset(name)`: IO. Removes the key from the dictionary and calls `saveSettingsDebounced()`.

## 3. The Native Bridge (`prompt-bridge.js`)
This is a new module. It is the *only* file allowed to touch SillyTavern's Prompt Manager regarding rulesets.

*   **Architectural Role:** Pure (Formatting) / IO (Mutation of ST State)
*   **Responsibilities:** Managing the `ctz_bridge_prompt` slot in the host application.
*   **Private API:**
    *   `_ensureBridgeExists()`: Scans SillyTavern's `promptManager` configuration. Looks for the `CTZ_BRIDGE_PROMPT_ID`. If it does not exist, it constructs a valid Prompt Manager object (Role: System, Enabled: True, Name: `CTZ_BRIDGE_PROMPT_NAME`, Content: "") and injects it.
*   **Public API:**
    *   `publishToBridge(concatenatedString)`: 
        1. Checks if `promptManager` is available. If null, throws an Error: *"Rulesets require a Chat Completion backend."*
        2. Calls `_ensureBridgeExists()`.
        3. Locates the bridge entry in the `promptManager` and overwrites its `content` property with the provided string.
        4. Calls `promptManager.saveServiceSettings()` to persist the prompt change to disk. *(Crucial: Do not call `saveSettingsDebounced` here; the Prompt Manager manages its own disk writes).*

---

## Technical & Lifecycle Notices

**Lifecycle of `_ensureBridgeExists`**
This function is deliberately kept private and is executed *only* when `publishToBridge` is called. It must not be called during extension initialization (`index.js`). This ensures that if a user boots SillyTavern on a Text Completion backend (where `promptManager` is null), the extension does not crash at startup.

**Migration Notice: No Automated Data Transfer**
Existing rulesets (created by prior versions with identifiers like `ctz_ruleset_1234567890`) currently live inside ST's Prompt Manager. Phase 1 does not touch them. No automated migration script will be written. Users who wish to transition existing rulesets into the new Virtual Library will manually copy-paste them using the Librarian Workbench once Phase 2 is complete. 

**Known Intermediate State: `rulesets-panel.js` Goes Stale**
`rulesets-panel.js` is intentionally left unmodified in Phase 1. 
*   It will continue to display legacy promptManager rulesets (because they pass the `/\d/` identifier filter). 
*   Newly created rulesets saved to the Virtual Library will *not* appear in the panel yet. 
*   The Bridge slot (`ctz_bridge_prompt`) will safely remain hidden from the panel because its identifier contains no digits. 
*   The panel will remain functionally stale for new content until it is completely rewritten in Phase 3.

---

## Execution & Testing Strategy
Because Phase 1 contains no UI updates, validation will be performed entirely via the browser's developer console.

1.  **Verify Virtual Library Save:** From the console, call `ruleset-library.saveRuleset('Test Rule', 'This is a test.')`. Verify no errors are thrown.
2.  **Verify Virtual Library Read:** Refresh the page. Call `ruleset-library.getRulesetContent('Test Rule')` and verify the text persists.
3.  **Verify Bridge Creation & Publishing:** Ensure a Chat Completion API is selected in ST. Call `prompt-bridge.publishToBridge('Bridge Test Text')`. 
4.  **Verify ST State:** Open SillyTavern's native prompt UI (the "A" icon). Verify `Characteryze Rulesets` appears in the list, is enabled, and contains the text `Bridge Test Text`. Ensure ST did not throw a save error.