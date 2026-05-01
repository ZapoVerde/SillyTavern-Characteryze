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

import { log, error, table, isVerbose } from './log.js';
import { CANVAS_TYPES, FIELD_MAPS } from './defaults.js';
import { getRulesetContent, saveRuleset } from './ruleset-library.js';
import { setWorkspaceTarget }    from './session-manager.js';

const TAG = 'FieldMapper';

// ─── Pure: field lists ────────────────────────────────────────────────────────

export function getFieldList(canvasType, target) {
    if (canvasType === CANVAS_TYPES.SYSTEM_PROMPT) {
        const all = (promptManager?.serviceSettings?.prompts ?? []).map(p => ({
            id:    p.identifier,
            label: p.name,
            hint:  p.identifier,
        }));
        return target ? all.filter(f => f.id === target) : all;
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

// ─── Debug helpers ────────────────────────────────────────────────────────────

function _charSnapshot(char) {
    const d = char.data ?? {};
    const ext = d.extensions ?? {};
    return {
        name:                      d.name                      ?? char.name                      ?? '',
        description:               d.description               ?? char.description               ?? '',
        personality:               d.personality               ?? char.personality               ?? '',
        scenario:                  d.scenario                  ?? char.scenario                  ?? '',
        first_mes:                 d.first_mes                 ?? char.first_mes                 ?? '',
        mes_example:               d.mes_example               ?? char.mes_example               ?? '',
        creator_notes:             d.creator_notes             ?? char.creatorcomment             ?? '',
        system_prompt:             d.system_prompt             ?? '',
        post_history_instructions: d.post_history_instructions ?? '',
        tags:                      d.tags                      ?? char.tags                      ?? [],
        creator:                   d.creator                   ?? '',
        character_version:         d.character_version         ?? '',
        alternate_greetings:       d.alternate_greetings       ?? [],
        talkativeness:             ext.talkativeness           ?? char.talkativeness             ?? 0.5,
        fav:                       ext.fav                     ?? char.fav                       ?? false,
        world:                     ext.world                   ?? char.world                     ?? '',
    };
}

// ─── IO: commit ───────────────────────────────────────────────────────────────

export async function commitDraftState(canvasType, target, draft) {
    if (!draft || Object.keys(draft).length === 0) {
        log(TAG, 'commitDraftState: nothing to commit');
        return target;
    }
    log(TAG, 'Committing draft', { canvasType, target, draft });

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

    const ctx = SillyTavern.getContext();

    // Fresh fetch — do not trust ctx.characters cache, which may not reflect the
    // last commit if getOneCharacter failed silently (avatar mismatch, etc.).
    const charResp = await fetch('/api/characters/get', {
        method:  'POST',
        headers: { ...ctx.getRequestHeaders(), 'Content-Type': 'application/json' },
        body:    JSON.stringify({ avatar_url: avatarFilename }),
    });
    if (!charResp.ok) {
        error(TAG, 'Failed to fetch fresh character data for commit:', charResp.status);
        throw new Error('Could not verify current character state before saving.');
    }
    const char = await charResp.json();
    const pre  = isVerbose() ? _charSnapshot(char) : null;

    // ST has no per-field update — /edit always writes the full character object.
    // staged() simulates a patch: a draft value only wins if it is non-empty.
    // '' in the draft (e.g. a field that was auto-staged before the user typed)
    // defers to the fresh card value so it is never accidentally cleared.
    const staged = (draftVal, cardVal) => (draftVal != null && draftVal !== '') ? draftVal : cardVal;

    // charaFormatData on the server starts from tryParse(json_data) || {} and then
    // explicitly overwrites every V2 field with '' / [] if it isn't in the payload.
    // We must pass the existing character's full JSON as json_data (so nothing is
    // silently wiped) and echo back every field that charaFormatData touches so
    // it receives the existing value rather than an empty-string fallback.
    const payload = {
        avatar_url:   avatarFilename,
        json_data:    char.json_data ?? '',
        // Core narrative fields — non-empty draft wins; empty draft defers to card
        ch_name:      staged(draft.name,        char.data?.name        ?? char.name),
        description:  staged(draft.description, char.data?.description ?? char.description ?? ''),
        personality:  staged(draft.personality, char.data?.personality ?? char.personality ?? ''),
        scenario:     staged(draft.scenario,    char.data?.scenario    ?? char.scenario    ?? ''),
        first_mes:    staged(draft.first_mes,   char.data?.first_mes   ?? char.first_mes   ?? ''),
        mes_example:  staged(draft.mes_example, char.data?.mes_example ?? char.mes_example ?? ''),
        // Lifecycle fields — must be echoed or the server overwrites with undefined
        chat:              char.chat        ?? '',
        create_date:       char.create_date ?? '',
        // V2 metadata — server always overwrites these; pass existing values
        creator_notes:     char.data?.creator_notes             ?? char.creatorcomment ?? '',
        system_prompt:     char.data?.system_prompt             ?? '',
        post_history_instructions: char.data?.post_history_instructions ?? '',
        tags:              char.data?.tags                       ?? char.tags ?? [],
        creator:           char.data?.creator                   ?? '',
        character_version: char.data?.character_version         ?? '',
        alternate_greetings: char.data?.alternate_greetings     ?? [],
        // ST extension fields — charaFormatData uses string comparison for fav
        talkativeness:  char.data?.extensions?.talkativeness ?? char.talkativeness ?? 0.5,
        fav:            String(char.data?.extensions?.fav    ?? char.fav ?? false),
        world:          char.data?.extensions?.world         ?? char.world ?? '',
        depth_prompt_prompt: char.data?.extensions?.depth_prompt?.prompt ?? '',
        depth_prompt_depth:  char.data?.extensions?.depth_prompt?.depth  ?? 4,
        depth_prompt_role:   char.data?.extensions?.depth_prompt?.role   ?? 'system',
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

    if (isVerbose()) {
        const postResp = await fetch('/api/characters/get', {
            method:  'POST',
            headers: { ...ctx.getRequestHeaders(), 'Content-Type': 'application/json' },
            body:    JSON.stringify({ avatar_url: avatarFilename }),
        });
        if (postResp.ok) {
            const post = _charSnapshot(await postResp.json());
            table(TAG, `commit diff · ${avatarFilename}`,
                Object.keys(pre).map(f => ({ field: f, before: pre[f], after: post[f] }))
            );
        }
    }

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

function _syspromptSnapshot(prompts, identifiers) {
    return Object.fromEntries(
        identifiers.map(id => [id, prompts.find(p => p.identifier === id)?.content ?? ''])
    );
}

function _commitSysPrompt(draft) {
    const pm = promptManager;
    if (!pm) return;
    const prompts = pm.serviceSettings?.prompts ?? [];

    const identifiers = Object.keys(draft);
    const pre = isVerbose() ? _syspromptSnapshot(prompts, identifiers) : null;

    for (const [identifier, value] of Object.entries(draft)) {
        const prompt = prompts.find(p => p.identifier === identifier);
        if (prompt) prompt.content = value;
    }
    pm.saveServiceSettings();
    log(TAG, 'System prompt fields committed');

    if (isVerbose()) {
        const post = _syspromptSnapshot(prompts, identifiers);
        table(TAG, 'commit diff · system prompts',
            identifiers.map(id => ({ field: id, before: pre[id], after: post[id] }))
        );
    }
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