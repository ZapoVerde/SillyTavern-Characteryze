/**
 * @file data/default-user/extensions/characteryze/field-mapper.js
 * @stamp {"utc":"2026-04-29T14:10:00.000Z"}
 * @version 1.1.0
 * @architectural-role Pure (reads) / IO (commits)
 * @description
 * Provides field list derivation (pure), live state reads (pure reads from
 * ST data), and draft commit execution (IO writes to ST native save).
 *
 * Refactored for Librarian Workbench (Phase 2): Ruleset reads and writes 
 * are now routed to ruleset-library.js instead of SillyTavern's promptManager.
 *
 * @api-declaration
 * getFieldList(canvasType)                       — returns ordered FieldDescriptor[]
 * getLiveValue(canvasType, fieldId, target)       — read current live value from ST
 * commitDraftState(canvasType, target, draft)     — push draft to ST native save
 *
 * @contract
 *   assertions:
 *     purity: Pure (getFieldList, getLiveValue) / IO (commitDraftState)
 *     state_ownership: []
 *     external_io: [fetch /api/characters/edit, oai_settings write,
 *                   ruleset-library write, saveSettingsDebounced]
 */

import { oai_settings }          from '../../../../scripts/openai.js';
import { saveSettingsDebounced } from '../../../../script.js';
import { log, error }            from './log.js';
import { CANVAS_TYPES, FIELD_MAPS } from './defaults.js';
import { getRulesetContent, saveRuleset } from './ruleset-library.js';
import { setWorkspaceTarget }    from './session-manager.js';

const TAG = 'FieldMapper';

// ─── Pure: field lists ────────────────────────────────────────────────────────

export function getFieldList(canvasType) {
    return FIELD_MAPS[canvasType] ?? [];
}

// ─── Pure: live state reads ───────────────────────────────────────────────────

export function getLiveValue(canvasType, fieldId, target) {
    switch (canvasType) {
        case CANVAS_TYPES.CHARACTER_CARD:   return _charLive(fieldId, target);
        case CANVAS_TYPES.SYSTEM_PROMPT:    return _syspromptLive(fieldId);
        case CANVAS_TYPES.RULESET:          return _rulesetLive(fieldId, target);
        default:
            error(TAG, 'getLiveValue: unknown canvas type', canvasType);
            return '';
    }
}

function _charLive(fieldId, avatarFilename) {
    const ctx  = SillyTavern.getContext();
    const char = ctx.characters.find(c => c.avatar === avatarFilename);
    if (!char) return '';
    // V2 card data lives under .data; flat fields kept for backwards compat
    return char.data?.[fieldId] ?? char[fieldId] ?? '';
}

function _syspromptLive(fieldId) {
    // Map Characteryze field IDs to oai_settings keys
    const KEY_MAP = {
        main:      'main_prompt',
        nsfw:      'nsfw_prompt',
        jailbreak: 'jailbreak_prompt',
        an:        'wi_format',
    };
    const key = KEY_MAP[fieldId];
    return key ? (oai_settings[key] ?? '') : '';
}

function _rulesetLive(fieldId, rulesetName) {
    if (fieldId === 'name') {
        return (rulesetName === '__new__' || !rulesetName) ? '' : rulesetName;
    }
    if (fieldId === 'content') {
        return getRulesetContent(rulesetName);
    }
    return '';
}

// ─── IO: commit ───────────────────────────────────────────────────────────────

export async function commitDraftState(canvasType, target, draft) {
    if (!draft || Object.keys(draft).length === 0) {
        log(TAG, 'commitDraftState: nothing to commit');
        return;
    }
    log(TAG, 'Committing draft', { canvasType, target, fields: Object.keys(draft) });

    switch (canvasType) {
        case CANVAS_TYPES.CHARACTER_CARD:
            await _commitCharCard(target, draft);
            break;
        case CANVAS_TYPES.SYSTEM_PROMPT:
            _commitSysPrompt(draft);
            break;
        case CANVAS_TYPES.RULESET:
            await _commitRuleset(target, draft);
            break;
        default:
            error(TAG, 'commitDraftState: unknown canvas type', canvasType);
    }
}

async function _commitCharCard(avatarFilename, draft) {
    const ctx  = SillyTavern.getContext();
    const char = ctx.characters.find(c => c.avatar === avatarFilename);
    if (!char) {
        error(TAG, 'Character not found for commit:', avatarFilename);
        return;
    }

    const payload = {
        avatar:      avatarFilename,
        ch_name:     draft.name        ?? char.data?.name        ?? char.name,
        description: draft.description ?? char.data?.description ?? char.description ?? '',
        personality: draft.personality ?? char.data?.personality ?? char.personality ?? '',
        scenario:    draft.scenario    ?? char.data?.scenario    ?? char.scenario    ?? '',
        first_mes:   draft.first_mes   ?? char.data?.first_mes   ?? char.first_mes   ?? '',
        mes_example: draft.mes_example ?? char.data?.mes_example ?? char.mes_example ?? '',
    };

    const resp = await fetch('/api/characters/edit', {
        method:  'POST',
        headers: { ...ctx.getRequestHeaders(), 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
    });

    if (!resp.ok) {
        error(TAG, 'Character edit failed:', resp.status);
        throw new Error(`Character edit failed: ${resp.status}`);
    }
    log(TAG, 'Character card committed:', avatarFilename);
}

function _commitSysPrompt(draft) {
    const KEY_MAP = {
        main:      'main_prompt',
        nsfw:      'nsfw_prompt',
        jailbreak: 'jailbreak_prompt',
        an:        'wi_format',
    };
    for (const [fieldId, value] of Object.entries(draft)) {
        const key = KEY_MAP[fieldId];
        if (key) oai_settings[key] = value;
    }
    saveSettingsDebounced();
    log(TAG, 'System prompt fields committed');
}

async function _commitRuleset(target, draft) {
    // Resolve name from draft fallback to target (unless target is the 'new' sentinel)
    const name = draft.name ?? (target === '__new__' ? '' : target);
    const content = draft.content ?? getRulesetContent(target);

    // Commit Guard: Reject empty names or the sentinel value
    if (!name || name === '__new__') {
        const err = 'Cannot commit ruleset: A valid name is required.';
        error(TAG, err);
        throw new Error(err);
    }

    log(TAG, 'Ruleset commit (Virtual Library):', name);
    saveRuleset(name, content);

    // If renamed (Save As behavior), sync the workspace target
    if (name !== target) {
        log(TAG, 'Ruleset target updated after rename:', name);
        setWorkspaceTarget(name);
    }
}