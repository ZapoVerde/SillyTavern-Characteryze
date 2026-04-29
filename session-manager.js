/**
 * @file data/default-user/extensions/characteryze/session-manager.js
 * @stamp {"utc":"2026-04-28T00:00:00.000Z"}
 * @version 1.0.0
 * @architectural-role Stateful — Forge Session Lifecycle
 * @description
 * Owns the active workspace object and the known_sessions index. Handles
 * first-load internal character creation, new session creation, session
 * loading, and draft state persistence.
 *
 * Sessions are indexed in extension_settings.characteryze.known_sessions by
 * chat filename. Draft state for each session persists in draft_states[filename]
 * so it survives browser refreshes without committing to ST's native files.
 *
 * @api-declaration
 * ensureInternalCharacter()             — import character asset on first run (idempotent)
 * newForgeSession(canvasType, name?)    — create new chat, record session; returns entry
 * loadForgeSession(filename)            — open existing session chat
 * listSessions()                        — returns known_sessions array (copy)
 * pruneOldSessions()                    — trim to max_saved limit
 * getWorkspace()                        — returns current workspace snapshot
 * setWorkspaceCanvas(canvasType)        — update canvas type
 * setWorkspaceTarget(target)            — update target entity
 * getDraftState(filename)               — returns draft fields for session
 * setDraftField(filename, fieldId, val) — persist one staged field
 * clearDraftState(filename)             — flush draft on commit
 *
 * @contract
 *   assertions:
 *     purity: Stateful / IO
 *     state_ownership: [_workspace]
 *     external_io: [fetch /api/characters/import, SillyTavern context,
 *                   extension_settings write, saveSettingsDebounced, toastr]
 */

import { extension_settings }    from '../../../extensions.js';
import { saveSettingsDebounced } from '../../../../script.js';
import { eventSource, event_types, doNewChat }        from '../../../../script.js';
import { log, warn, error }                           from './log.js';
import {
    CTZ_EXT_NAME,
    CTZ_INTERNAL_CHAR_FILENAME,
    INTERNAL_CHARACTER_CARD,
} from './defaults.js';

const TAG = 'Session';

let _workspace = {
    filename:    null,
    canvas_type: null,
    target:      null,
};

// ─── Internal character ───────────────────────────────────────────────────────

export async function ensureInternalCharacter() {
    const ctx = SillyTavern.getContext();
    if (ctx.characters.some(c => c.avatar === CTZ_INTERNAL_CHAR_FILENAME)) return;

    log(TAG, 'Importing internal character for first-time setup');
    try {
        const cardJson = JSON.stringify(INTERNAL_CHARACTER_CARD);

        const formData = new FormData();
        formData.append(
            'char_import_file',
            new Blob([cardJson], { type: 'application/json' }),
            'characteryze_internal.json',
        );
        formData.append('preserved_name', CTZ_INTERNAL_CHAR_FILENAME);

        const importResp = await fetch('/api/characters/import', {
            method:  'POST',
            headers: ctx.getRequestHeaders(),
            body:    formData,
        });
        if (!importResp.ok) throw new Error(`Import failed: ${importResp.status}`);

        log(TAG, 'Internal character imported');
        toastr.info(
            'Characteryze: first-time setup complete. Please click Launch again.',
            '',
            { timeOut: 6000 },
        );
        // Signal to caller that a page-state reload is needed
        return 'needs_reload';
    } catch (err) {
        error(TAG, 'ensureInternalCharacter failed', err);
        throw err;
    }
}

// ─── Session lifecycle ────────────────────────────────────────────────────────

export async function newForgeSession(canvasType, sessionName = null) {
    const charIdx = _findInternalCharIdx();
    if (charIdx === -1) throw new Error('Internal character not found');

    const ctx = SillyTavern.getContext();

    // Switch to internal character (triggers CHAT_LOADED for its last chat)
    await _selectCharAndWait(ctx, charIdx);

    // Create a new chat for that character
    const filename = await _doNewChatAndWait();
    if (!filename) throw new Error('Could not determine new chat filename');

    const name  = sessionName ?? _timestampName();
    const entry = {
        filename,
        canvas_type:  canvasType,
        session_name: name,
        created_at:   new Date().toISOString(),
    };

    _recordSession(entry);
    _workspace = { filename, canvas_type: canvasType, target: null };
    log(TAG, 'New session:', filename);
    return entry;
}

export async function loadForgeSession(filename) {
    const charIdx = _findInternalCharIdx();
    if (charIdx === -1) throw new Error('Internal character not found');

    const ctx = SillyTavern.getContext();

    if (ctx.characterId !== charIdx) {
        await _selectCharAndWait(ctx, charIdx);
    }

    await new Promise(resolve => {
        eventSource.once(event_types.CHAT_LOADED, resolve);
        ctx.openCharacterChat(filename);
    });

    const session   = _getSession(filename);
    _workspace = {
        filename,
        canvas_type: session?.canvas_type ?? null,
        target:      null,
    };
    log(TAG, 'Session loaded:', filename);
}

export function listSessions() {
    return [...(extension_settings[CTZ_EXT_NAME]?.known_sessions ?? [])];
}

export function pruneOldSessions() {
    const settings = extension_settings[CTZ_EXT_NAME];
    const max      = settings.sessions?.max_saved ?? 50;
    if (settings.known_sessions.length > max) {
        settings.known_sessions = settings.known_sessions.slice(-max);
        saveSettingsDebounced();
        log(TAG, `Pruned to ${max} sessions`);
    }
}

// ─── Workspace ────────────────────────────────────────────────────────────────

export function getWorkspace() {
    return { ..._workspace };
}

export function setWorkspaceCanvas(canvasType) {
    _workspace.canvas_type = canvasType;
}

export function setWorkspaceTarget(target) {
    _workspace.target = target;
}

// ─── Draft state ──────────────────────────────────────────────────────────────

export function getDraftState(filename) {
    return { ...(extension_settings[CTZ_EXT_NAME]?.draft_states?.[filename] ?? {}) };
}

export function setDraftField(filename, fieldId, value) {
    const settings = extension_settings[CTZ_EXT_NAME];
    if (!settings.draft_states[filename]) settings.draft_states[filename] = {};
    settings.draft_states[filename][fieldId] = value;
    saveSettingsDebounced();
}

export function clearDraftState(filename) {
    const settings = extension_settings[CTZ_EXT_NAME];
    delete settings.draft_states[filename];
    saveSettingsDebounced();
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function _findInternalCharIdx() {
    return SillyTavern.getContext().characters
        .findIndex(c => c.avatar === CTZ_INTERNAL_CHAR_FILENAME);
}

function _selectCharAndWait(ctx, charIdx) {
    return new Promise(resolve => {
        eventSource.once(event_types.CHAT_LOADED, resolve);
        ctx.selectCharacterById(charIdx);
    });
}

function _doNewChatAndWait() {
    return new Promise(resolve => {
        eventSource.once(event_types.CHAT_LOADED, () => {
            const c = SillyTavern.getContext();
            resolve(c.characters[c.characterId]?.chat ?? null);
        });
        doNewChat();
    });
}

function _recordSession(entry) {
    const settings = extension_settings[CTZ_EXT_NAME];
    const idx      = settings.known_sessions.findIndex(s => s.filename === entry.filename);
    if (idx >= 0) {
        settings.known_sessions[idx] = entry;
    } else {
        settings.known_sessions.push(entry);
    }
    saveSettingsDebounced();
}

function _getSession(filename) {
    return extension_settings[CTZ_EXT_NAME]?.known_sessions
        .find(s => s.filename === filename) ?? null;
}

function _timestampName() {
    return `Session ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
}
