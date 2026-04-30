/**
 * @file data/default-user/extensions/characteryze/prompt-bridge.js
 * @stamp {"utc":"2026-04-29T13:20:00.000Z"}
 * @version 1.0.0
 * @architectural-role IO — Native Prompt Bridge Hook
 * @description
 * Handles surgical injection and synchronization of the Characteryze Bridge 
 * slot within SillyTavern's native Prompt Manager. Responsible for 
 * "publishing" the internal library to the LLM context.
 *
 * @api-declaration
 * publishToBridge(concatenatedString) — pushes ruleset text to the ST bridge
 *
 * @contract
 *   assertions:
 *     purity: IO
 *     state_ownership: []
 *     external_io: [promptManager mutation, saveServiceSettings, SillyTavern context]
 */

import { promptManager } from '../../../../scripts/openai.js';
import { log, error }      from './log.js';
import {
    CTZ_BRIDGE_PROMPT_ID,
    CTZ_BRIDGE_PROMPT_NAME
} from './defaults.js';
import { escapeMacros }    from './macro-escape.js';

const TAG = 'Bridge';

// ─── Private Logic ────────────────────────────────────────────────────────────

/**
 * Ensures the bridge prompt exists in the global list and is present in 
 * the active character's prompt order.
 */
function _ensureBridgeExists() {
    const pm = promptManager;
    const prompts = pm.serviceSettings?.prompts ?? [];
    const exists = prompts.some(p => p.identifier === CTZ_BRIDGE_PROMPT_ID);

    if (!exists) {
        log(TAG, 'Creating Bridge slot:', CTZ_BRIDGE_PROMPT_ID);
        const payload = {
            identifier: CTZ_BRIDGE_PROMPT_ID,
            name:       CTZ_BRIDGE_PROMPT_NAME,
            content:    '',
            role:       'system',
            enabled:    true,
        };
        pm.addPrompt(payload, CTZ_BRIDGE_PROMPT_ID);
    }

    // Ensure it is in the character's active prompt order so it actually fires
    const ctx    = SillyTavern.getContext();
    const charId = ctx.characterId;
    if (charId != null && charId >= 0) {
        const order = pm.getPromptOrderForCharacter(charId);
        const inOrder = order.some(o => o.identifier === CTZ_BRIDGE_PROMPT_ID);
        
        if (!inOrder) {
            log(TAG, 'Wiring Bridge to character prompt order');
            order.push({ identifier: CTZ_BRIDGE_PROMPT_ID, enabled: true });
        }
    }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Overwrites the content of the Characteryze Bridge slot and persists 
 * the change to SillyTavern's native prompt settings.
 * @param {string} concatenatedString 
 */
export function publishToBridge(concatenatedString) {
    const pm = promptManager;
    if (!pm) {
        const msg = 'Rulesets require a Chat Completion backend.';
        error(TAG, msg);
        throw new Error(msg);
    }

    _ensureBridgeExists();

    const prompt = pm.serviceSettings.prompts.find(p => p.identifier === CTZ_BRIDGE_PROMPT_ID);
    if (!prompt) {
        error(TAG, 'Bridge slot not found after attempted creation.');
        return;
    }

    log(TAG, 'Publishing to Bridge slot');
    prompt.content = escapeMacros(concatenatedString);
    pm.saveServiceSettings();
}

