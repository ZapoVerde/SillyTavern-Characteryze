/**
 * @file data/default-user/extensions/characteryze/session-manager.js
 * @stamp {"utc":"2026-04-29T10:30:00.000Z"}
 * @version 1.1.1
 * @architectural-role Stateful — Forge Session Lifecycle
 * @description
 * Owns the active workspace object and the known_sessions index. Handles
 * session creation, loading, and draft state persistence.
 *
 * Isolation is achieved by hosting all Forge sessions under a specific 
 * character defined by CTZ_HOST_CHAR_NAME. This character must be created 
 * manually by the user.
 *
 * @api-declaration
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
 *     external_io: [SillyTavern context, extension_settings write, 
 *                   saveSettingsDebounced, toastr]
 */

import { extension_settings }    from '../../../extensions.js';
import { saveSettingsDebounced } from '../../../../script.js';
import { eventSource, event_types, doNewChat }        from '../../../../script.js';
import { log, error }                                 from './log.js';
import {
    CTZ_EXT_NAME,
    CTZ_HOST_CHAR_NAME,
} from './defaults.js';

const TAG = 'Session';

let _workspace = {
    filename:    null,
    canvas_type: null,
    target:      null,
};

// ─── Session lifecycle ────────────────────────────────────────────────────────

/**
 * Creates a new chat session for the Forge.
 * Requires the Host character to exist in the user's roster.
 */
export async function newForgeSession(canvasType, sessionName = null) {
    const charIdx = _findInternalCharIdx();
    if (charIdx === -1) {
        throw new Error(`Host character "${CTZ_HOST_CHAR_NAME}" not found.`);
    }

    const ctx = SillyTavern.getContext();

    // Switch to host character (triggers CHAT_LOADED for its last chat)
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

/**
 * Loads an existing Forge session chat.
 */
export async function loadForgeSession(filename) {
    const charIdx = _findInternalCharIdx();
    if (charIdx === -1) {
        throw new Error(`Host character "${CTZ_HOST_CHAR_NAME}" not found.`);
    }

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
        .findIndex(c => c.name === CTZ_HOST_CHAR_NAME);
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