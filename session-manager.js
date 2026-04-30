/**
 * @file data/default-user/extensions/characteryze/session-manager.js
 * @stamp {"utc":"2026-04-30T00:00:00.000Z"}
 * @architectural-role Stateful — Forge Session Lifecycle
 * @description
 * Owns the active workspace object and the known_sessions index. Handles
 * session creation, loading, and draft state persistence.
 *
 * Decoupled (Phase 3): sessions no longer own a canvas type. Canvas and
 * target are independent workspace state set by the Home panel directly.
 * All canvas types now use composite draft keys (filename::canvas::target).
 *
 * @api-declaration
 * newForgeSession(name?)                — create new chat, record session; returns entry
 * loadForgeSession(filename)            — open existing session chat (filename only)
 * listSessions()                        — returns known_sessions array (copy)
 * pruneOldSessions()                    — trim to max_saved limit
 * renameSession(filename, newName)      — update session_name in known_sessions
 * deleteSession(filename)               — remove session record from known_sessions
 * getWorkspace()                        — returns current workspace snapshot
 * setWorkspaceCanvas(canvasType)        — update canvas type
 * setWorkspaceTarget(target)            — update target entity
 * getDraftState(filename)               — returns draft fields for current workspace
 * setDraftField(filename, fieldId, val) — persist one staged field
 * clearDraftState(filename, target?)    — flush draft; pass pre-commit target for Save As safety
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
import { log }                                          from './log.js';
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
 * Canvas and target are already set on _workspace by the Home panel before
 * this is called; this function only handles the ST chat lifecycle.
 */
export async function newForgeSession(sessionName = null) {
    const charIdx = _findInternalCharIdx();
    if (charIdx === -1) {
        throw new Error(`Host character "${CTZ_HOST_CHAR_NAME}" not found.`);
    }

    const ctx = SillyTavern.getContext();

    const hostName = ctx.characters[charIdx].name;

    if (ctx.characterId !== charIdx) {
        await _selectCharAndWait(hostName);
    }

    const filename = await _doNewChatAndWait();
    if (!filename) throw new Error('Could not determine new chat filename');

    const name  = sessionName ?? _timestampName();
    const entry = {
        filename,
        session_name: name,
        created_at:   new Date().toISOString(),
    };

    _recordSession(entry);
    _workspace.filename = filename;
    log(TAG, 'New session:', filename);
    return entry;
}

/**
 * Loads an existing Forge session chat.
 * Only updates _workspace.filename — canvas and target remain as configured
 * by the Home panel dropdowns.
 */
export async function loadForgeSession(filename) {
    const charIdx = _findInternalCharIdx();
    if (charIdx === -1) {
        throw new Error(`Host character "${CTZ_HOST_CHAR_NAME}" not found.`);
    }

    const ctx = SillyTavern.getContext();
    const hostName = ctx.characters[charIdx].name;

    if (ctx.characterId !== charIdx) {
        await _selectCharAndWait(hostName);
    }

    await _openChatAndWait(filename);
    _workspace.filename = filename;
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

export function renameSession(filename, newName) {
    const settings = extension_settings[CTZ_EXT_NAME];
    const session  = settings.known_sessions.find(s => s.filename === filename);
    if (session) {
        session.session_name = newName;
        saveSettingsDebounced();
    }
}

export function deleteSession(filename) {
    const settings = extension_settings[CTZ_EXT_NAME];
    settings.known_sessions = settings.known_sessions.filter(s => s.filename !== filename);
    saveSettingsDebounced();
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

/**
 * Composite key for all canvas types so switching targets within a session
 * never overwrites a different target's draft.
 * explicitTarget is passed by clearDraftState for Save-As safety (ruleset rename).
 */
function _getDraftKey(filename, explicitTarget) {
    const canvas = _workspace.canvas_type ?? 'unknown';
    const target = explicitTarget !== undefined
        ? String(explicitTarget)
        : String(_workspace.target ?? 'null');
    return `${filename}::${canvas}::${target}`;
}

export function getDraftState(filename) {
    const key = _getDraftKey(filename);
    return { ...(extension_settings[CTZ_EXT_NAME]?.draft_states?.[key] ?? {}) };
}

export function setDraftField(filename, fieldId, value) {
    const settings = extension_settings[CTZ_EXT_NAME];
    const key = _getDraftKey(filename);
    
    if (!settings.draft_states[key]) settings.draft_states[key] = {};
    settings.draft_states[key][fieldId] = value;
    saveSettingsDebounced();
}

export function clearDraftState(filename, explicitTarget) {
    const settings = extension_settings[CTZ_EXT_NAME];
    const key = _getDraftKey(filename, explicitTarget);
    delete settings.draft_states[key];
    saveSettingsDebounced();
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function _findInternalCharIdx() {
    return SillyTavern.getContext().characters
        .findIndex(c => c.name === CTZ_HOST_CHAR_NAME);
}

function _timeout(ms, label) {
    return new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    );
}

function _selectCharAndWait(hostName) {
    const { executeSlashCommandsWithOptions } = SillyTavern.getContext();
    return Promise.race([
        new Promise((resolve, reject) => {
            eventSource.once(event_types.CHAT_LOADED, resolve);
            executeSlashCommandsWithOptions(`/go "${hostName}"`).catch(reject);
        }),
        _timeout(12_000, 'Character select'),
    ]);
}

function _doNewChatAndWait() {
    const ctx = SillyTavern.getContext();
    if (ctx.menuType === 'create') {
        return Promise.reject(new Error('Close the character creation form before entering Forge.'));
    }
    return Promise.race([
        new Promise((resolve, reject) => {
            eventSource.once(event_types.CHAT_LOADED, () => {
                const c = SillyTavern.getContext();
                resolve(c.characters[c.characterId]?.chat ?? null);
            });
            doNewChat().catch(reject);
        }),
        _timeout(12_000, 'New chat'),
    ]);
}

function _openChatAndWait(filename) {
    const ctx = SillyTavern.getContext();
    return Promise.race([
        new Promise((resolve, reject) => {
            eventSource.once(event_types.CHAT_LOADED, resolve);
            ctx.openCharacterChat(filename).catch(reject);
        }),
        _timeout(12_000, 'Chat load'),
    ]);
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

function _timestampName() {
    return `Session ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
}