/**
 * @file data/default-user/extensions/characteryze/field-mapper.js
 * @stamp {"utc":"2026-04-28T00:00:00.000Z"}
 * @version 1.0.0
 * @architectural-role Pure (reads) / IO (commits)
 * @description
 * Provides field list derivation (pure), live state reads (pure reads from
 * ST data), and draft commit execution (IO writes to ST native save).
 *
 * Commit for character_card: POST to /api/characters/edit.
 * Commit for system_prompt: write to oai_settings fields, saveSettingsDebounced.
 * Commit for ruleset: create/update prompt manager entry.
 * Portrait field is skipped here — portrait-studio.js owns image commits.
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
 *                   promptManager write, saveSettingsDebounced]
 */

import { oai_settings, promptManager, saveSettingsDebounced as saveOaiDebounced }
    from '../../../../scripts/openai.js';
import { saveSettingsDebounced } from '../../../extensions.js';
import { log, error }            from './log.js';
import { CANVAS_TYPES, FIELD_MAPS } from './defaults.js';

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
    if (!promptManager) return '';
    // V2: deeper promptManager introspection for multi-ruleset management
    const entry = promptManager.serviceSettings?.prompts
        ?.find(p => p.name === rulesetName);
    if (!entry) return fieldId === 'name' ? (rulesetName ?? '') : '';
    return fieldId === 'name' ? (entry.name ?? '') : (entry.content ?? '');
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
            _commitRuleset(target, draft);
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
    // portrait field intentionally excluded — portrait-studio.js owns image commits

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
    saveOaiDebounced();
    log(TAG, 'System prompt fields committed');
}

function _commitRuleset(rulesetName, draft) {
    if (!promptManager) {
        error(TAG, 'promptManager unavailable — ruleset commit skipped');
        return;
    }
    const prompts  = promptManager.serviceSettings?.prompts ?? [];
    const existing = prompts.find(p => p.name === rulesetName);

    if (existing) {
        if (draft.name)    existing.name    = draft.name;
        if (draft.content) existing.content = draft.content;
    } else {
        const id = `ctz_ruleset_${Date.now()}`;
        promptManager.addPrompt(
            { identifier: id, name: draft.name ?? rulesetName, content: draft.content ?? '', role: 'system', enabled: true },
            id,
        );
    }
    promptManager.saveServiceSettings();
    log(TAG, 'Ruleset committed:', rulesetName);
}
