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
 *                   ruleset-library write, promptManager.saveServiceSettings]
 */

import { promptManager }         from '../../../../scripts/openai.js';

import { log, error }            from './log.js';
import { CANVAS_TYPES, FIELD_MAPS } from './defaults.js';
import { getRulesetContent, saveRuleset } from './ruleset-library.js';
import { setWorkspaceTarget }    from './session-manager.js';

const TAG = 'FieldMapper';

// ─── Pure: field lists ────────────────────────────────────────────────────────

export function getFieldList(canvasType) {
    if (canvasType === CANVAS_TYPES.SYSTEM_PROMPT) {
        return (promptManager?.serviceSettings?.prompts ?? []).map(p => ({
            id:    p.identifier,
            label: p.name,
            hint:  p.identifier,
        }));
    }
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
    const prompts = promptManager?.serviceSettings?.prompts ?? [];
    return prompts.find(p => p.identifier === fieldId)?.content ?? '';
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
        return target;
    }
    log(TAG, 'Committing draft', { canvasType, target, fields: Object.keys(draft) });

    switch (canvasType) {
        case CANVAS_TYPES.CHARACTER_CARD:
            return await _commitCharCard(target, draft);
        case CANVAS_TYPES.SYSTEM_PROMPT:
            _commitSysPrompt(draft);
            return target;
        case CANVAS_TYPES.RULESET:
            await _commitRuleset(target, draft);
            return target;
        default:
            error(TAG, 'commitDraftState: unknown canvas type', canvasType);
            return target;
    }
}

async function _commitCharCard(avatarFilename, draft) {
    if (!avatarFilename) {
        return await _createCharCard(draft);
    }

    const ctx  = SillyTavern.getContext();
    const char = ctx.characters.find(c => c.avatar === avatarFilename);
    if (!char) {
        error(TAG, 'Character not found for commit:', avatarFilename);
        return avatarFilename;
    }

    const payload = {
        avatar_url:  avatarFilename,
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
    return avatarFilename;
}

async function _createCharCard(draft) {
    if (!draft.name?.trim()) {
        const err = 'Cannot forge character: a name is required.';
        error(TAG, err);
        throw new Error(err);
    }

    const ctx  = SillyTavern.getContext();
    const resp = await fetch('/api/characters/create', {
        method:  'POST',
        headers: { ...ctx.getRequestHeaders(), 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ch_name: draft.name.trim() }),
    });

    if (!resp.ok) {
        error(TAG, 'Character creation failed:', resp.status);
        throw new Error(`Character creation failed: ${resp.status}`);
    }

    const newAvatar = (await resp.text()).trim();

    if (!newAvatar) {
        throw new Error('Character creation succeeded but server returned no identifier.');
    }
    log(TAG, 'New character created:', newAvatar);

    // Apply any remaining drafted fields to the freshly created card
    const remainingDraft = Object.fromEntries(
        Object.entries(draft).filter(([k]) => k !== 'name'),
    );
    if (Object.keys(remainingDraft).length > 0) {
        await _commitCharCard(newAvatar, remainingDraft);
    }

    return newAvatar;
}

function _commitSysPrompt(draft) {
    const pm = promptManager;
    if (!pm) return;
    const prompts = pm.serviceSettings?.prompts ?? [];
    for (const [identifier, value] of Object.entries(draft)) {
        const prompt = prompts.find(p => p.identifier === identifier);
        if (prompt) prompt.content = value;
    }
    pm.saveServiceSettings();
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