/**
 * @file data/default-user/extensions/characteryze/profile-manager.js
 * @stamp {"utc":"2026-04-29T11:30:00.000Z"}
 * @version 1.3.0
 * @architectural-role Stateful — Connection Profile Lifecycle
 * @description
 * Owns the Forge connection profile swap cycle. Manages permasave (the
 * authoritative restore target), swap-in on CTZ open, swap-out on CTZ exit,
 * and the CHAT_LOADED rogue-profile guard.
 *
 * Resolves the target Forge profile name via ConnectionManagerRequestService
 * based on the saved forge_profile_id in extension settings.
 *
 * During Forge sessions, external extension listeners for CHAT_CHANGED (and
 * related events) are suppressed by swapping out their listener arrays on the
 * shared eventSource. This prevents any loaded extension from reacting to
 * character/chat navigation that occurs inside the Forge. Listeners are
 * restored in full before the final pop-to-loading-screen on exit.
 *
 * @api-declaration
 * initProfileManager()   — register CONNECTION_PROFILE_LOADED + CHAT_LOADED listeners
 * ensureForgeProfile()   — idempotently create default Forge profile if absent
 * enterForge()           — capture permasave, suppress external listeners, swap to Forge profile
 * exitForge()            — restore permasave, restore external listeners, pop to loading screen
 * setUiActive(bool)      — set guard-exemption flag (called by index.js on launch/close)
 * isUiActive()           — returns current UI-active state
 * getPermasave()         — returns stored permasave profile name or null
 *
 * @contract
 *   assertions:
 *     purity: Stateful / IO
 *     state_ownership: [_lastKnownProfile, _uiActive, _savedListeners]
 *     external_io: [executeSlashCommandsWithOptions, saveSettingsDebounced,
 *                   extension_settings write, DOM (#rm_button_characters),
 *                   ConnectionManagerRequestService, eventSource.events (direct write)]
 */

import { extension_settings }    from '../../../extensions.js';
import { saveSettingsDebounced } from '../../../../script.js';
import { eventSource, event_types }                  from '../../../../script.js';
import { log, warn, error }                          from './log.js';
import { CTZ_EXT_NAME, CTZ_HOST_CHAR_NAME } from './defaults.js';
import { ConnectionManagerRequestService }           from '../../shared.js';

const TAG = 'Profile';

let _lastKnownProfile = null;
let _uiActive         = false;

// Events whose external listeners are silenced for the duration of a Forge session.
// CHAT_CHANGED is the primary trigger consumed by all sibling extensions.
// CHAT_LOADED is intentionally excluded — Characteryze's own session machinery
// relies on it via eventSource.once() to sequence internal awaits.
const _SUPPRESSED_EVENTS = [
    event_types.CHAT_CHANGED,
];

// Stores the original listener arrays while suppression is active.
// Keyed by event name; value is the array reference taken from eventSource.events.
const _savedListeners = {};

// ─── Listener suppression ─────────────────────────────────────────────────────

function _suppressExternalListeners() {
    for (const ev of _SUPPRESSED_EVENTS) {
        _savedListeners[ev] = eventSource.events[ev] ?? [];
        eventSource.events[ev] = [];
    }
    log(TAG, 'External listeners suppressed');
}

function _restoreExternalListeners() {
    for (const ev of Object.keys(_savedListeners)) {
        eventSource.events[ev] = _savedListeners[ev];
        delete _savedListeners[ev];
    }
    log(TAG, 'External listeners restored');
}

/**
 * Proactively reads the active connection profile name directly from the
 * connection-manager's persisted state. Used as a fallback when the
 * CONNECTION_PROFILE_LOADED event has not fired since page load.
 * Returns null if the state is unavailable or no profile is selected.
 */
function _readActiveProfileName() {
    try {
        const cm = SillyTavern.getContext().extensionSettings.connectionManager;
        if (!cm) return null;
        const selectedId = cm.selectedProfile;
        if (!selectedId) return null;
        const profile = cm.profiles?.find(p => p.id === selectedId);
        return profile?.name ?? null;
    } catch {
        return null;
    }
}

function _readActiveCharacterName() {
    try {
        const ctx = SillyTavern.getContext();
        const idx = ctx.characterId;
        if (idx == null || idx < 0) return null;
        return ctx.characters[idx]?.name ?? null;
    } catch {
        return null;
    }
}

function _readActiveCharacterChat() {
    try {
        const ctx = SillyTavern.getContext();
        const idx = ctx.characterId;
        if (idx == null || idx < 0) return null;
        return ctx.characters[idx]?.chat ?? null;
    } catch {
        return null;
    }
}

/**
 * Selects the saved character by name and reopens the saved chat file.
 * Falls back to the loading screen if the character is no longer in the roster.
 */
async function _restoreCharacter(name, chatFilename) {
    const ctx = SillyTavern.getContext();
    const idx = ctx.characters.findIndex(c => c.name === name);
    if (idx < 0) {
        warn(TAG, 'exitForge: saved character not found:', name, '— falling back to loading screen');
        _popToLoadingScreen();
        return;
    }
    await new Promise(resolve => {
        eventSource.once(event_types.CHAT_LOADED, resolve);
        ctx.selectCharacterById(idx);
    });
    if (chatFilename) {
        await new Promise(resolve => {
            eventSource.once(event_types.CHAT_LOADED, resolve);
            ctx.openCharacterChat(chatFilename);
        });
    }
    log(TAG, 'Character restored:', name, chatFilename ?? '(last chat)');
}

// ─── Init ─────────────────────────────────────────────────────────────────────

export function initProfileManager() {
    eventSource.on(event_types.CONNECTION_PROFILE_LOADED, _onProfileLoaded);
    eventSource.on(event_types.CHAT_LOADED, _onChatLoaded);
    log(TAG, 'Listeners registered');
}

// ─── Internal listeners ───────────────────────────────────────────────────────

function _onProfileLoaded(payload) {
    const name = typeof payload === 'string' ? payload : (payload?.name ?? null);
    if (name) {
        _lastKnownProfile = name;
        log(TAG, 'Profile loaded:', name);
    }
}

async function _onChatLoaded() {
    if (_uiActive) return;
    
    const settings = extension_settings[CTZ_EXT_NAME];
    const targetName = _resolveTargetProfileName(settings);

    if (_lastKnownProfile !== targetName) return;

    const permasave = settings?.permasave_profile;
    if (!permasave) {
        warn(TAG, 'Guard: Forge profile active without CTZ UI — no permasave to restore');
        return;
    }

    error(TAG, 'Guard: Forge profile active outside CTZ — restoring', permasave);
    await _applyProfile(permasave);
    _popToLoadingScreen();
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Idempotently ensures the default Forge profile exists.
 */
export async function enterForge() {
    const settings   = extension_settings[CTZ_EXT_NAME];
    const targetName = _resolveTargetProfileName(settings);

    if (!targetName) {
        throw new Error(
            'Characteryze: no Forge engine is configured. ' +
            'Select a connection profile in CTZ Settings → Forge Engine.'
        );
    }

    // Prefer the event-updated cache; fall back to a direct settings read.
    const currentProfile = _lastKnownProfile ?? _readActiveProfileName();

    if (!currentProfile) {
        throw new Error(
            'Characteryze: current connection profile is unknown. ' +
            'Load a connection profile and try again.'
        );
    }

    if (currentProfile === targetName) {
        // Two distinct causes — handle them separately.
        const existingPermasave = settings.permasave_profile;

        if (existingPermasave && existingPermasave !== targetName) {
            // Crash recovery: a previous session ended without restoring the
            // profile. Auto-restore from the saved permasave and continue.
            log(TAG, 'Forge profile left active from prior session — auto-restoring:', existingPermasave);
            await _applyProfile(existingPermasave);
            currentProfile = existingPermasave;
        } else {
            // Misconfiguration: forge_profile_id is set to the user's current
            // profile, so there is no safe restore target.
            throw new Error(
                `Characteryze: the connection "${currentProfile}" is configured as both your ` +
                `current profile and the Forge engine. ` +
                `Select a different profile as the Forge engine in CTZ Settings.`
            );
        }
    }

    // ── Character capture ──────────────────────────────────────────────────────
    const currentCharacter = _readActiveCharacterName();
    const currentChat      = _readActiveCharacterChat();

    if (currentCharacter === CTZ_HOST_CHAR_NAME) {
        throw new Error(
            'Characteryze: the Host character is already active. ' +
            'Switch to your original character first.'
        );
    }

    settings.permasave_profile   = currentProfile;
    settings.permasave_character = currentCharacter;
    settings.permasave_chat      = currentChat;
    saveSettingsDebounced();
    log(TAG, 'Permasave written — profile:', currentProfile, '| character:', currentCharacter, '| chat:', currentChat ?? '(none)');

    _uiActive = true;
    _suppressExternalListeners();
    try {
        await _applyProfile(targetName);
    } catch (err) {
        _restoreExternalListeners();
        throw err;
    }
}

export async function exitForge() {
    // Keep _uiActive true while the profile swap is in progress so that any
    // CHAT_LOADED events fired by the switch do not trigger the rogue-profile
    // guard before the restore has completed.
    const settings        = extension_settings[CTZ_EXT_NAME];
    const permasave       = settings?.permasave_profile;
    const permasaveChar   = settings?.permasave_character ?? null;
    const permasaveChat   = settings?.permasave_chat      ?? null;

    try {
        if (permasave) {
            await _applyProfile(permasave);
        } else {
            warn(TAG, 'exitForge: no permasave — profile not restored');
        }
    } finally {
        _uiActive = false;
        _restoreExternalListeners();
    }

    if (permasaveChar) {
        await _restoreCharacter(permasaveChar, permasaveChat);
    } else {
        warn(TAG, 'exitForge: no permasave character — popping to loading screen');
        _popToLoadingScreen();
    }
}

export function setUiActive(active) {
    _uiActive = !!active;
}

export function isUiActive() {
    return _uiActive;
}

export function getPermasave() {
    return extension_settings[CTZ_EXT_NAME]?.permasave_profile ?? null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolves the profile name to use for the Forge.
 * Checks for a selected ID first, then falls back to default name.
 */
function _resolveTargetProfileName(settings) {
    const selectedId = settings?.forge_profile_id;
    if (selectedId) {
        try {
            const profile = ConnectionManagerRequestService.getProfile(selectedId);
            if (profile?.name) return profile.name;
        } catch (err) {
            warn(TAG, 'Could not resolve profile name for ID:', selectedId);
        }
    }
    return null;
}

async function _applyProfile(name) {
    const { executeSlashCommandsWithOptions } = SillyTavern.getContext();
    log(TAG, 'Applying profile:', name);
    await executeSlashCommandsWithOptions(`/profile ${name}`);
}

function _popToLoadingScreen() {
    log(TAG, 'Popping to loading screen');
    $('#rm_button_characters').trigger('click');
}