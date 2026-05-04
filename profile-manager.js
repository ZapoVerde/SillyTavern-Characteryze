/**
 * @file data/default-user/extensions/characteryze/profile-manager.js
 * @stamp {"utc":"2026-05-04T13:10:00.000Z"}
 * @version 2.1.0
 * @architectural-role Stateful — Connection Profile Lifecycle
 * @description
 * Owns the Forge connection profile swap cycle. Manages the "Permasave" 
 * (the authoritative restore target). On launch, it captures the current 
 * active profile and swaps to the user-selected Forge Engine.
 *
 * Updated to trigger session cleanup on exit, automatically deleting
 * empty Forge chats.
 *
 * @api-declaration
 * initProfileManager()   — register CONNECTION_PROFILE_LOADED + CHAT_LOADED listeners
 * enterForge()           — capture permasave, suppress external listeners, swap to Forge profile
 * exitForge()            — restore permasave, restore external listeners, pop to loading screen
 * setUiActive(bool)      — set guard-exemption flag
 * isUiActive()           — returns current UI-active state
 * getPermasave()         — returns stored permasave profile name or null
 *
 * @contract
 *   assertions:
 *     purity: Stateful / IO
 *     state_ownership: [_lastKnownProfile, _uiActive, _savedListeners]
 *     external_io: [executeSlashCommandsWithOptions, saveSettingsDebounced,
 *                   extension_settings write, ConnectionManagerRequestService, 
 *                   eventSource.events (direct mutation), cleanupCurrentSessionIfEmpty]
 */

import { extension_settings }    from '../../../extensions.js';
import { saveSettingsDebounced } from '../../../../script.js';
import { eventSource, event_types }                  from '../../../../script.js';
import { log, warn, error }                          from './log.js';
import { CTZ_EXT_NAME }                              from './defaults.js';
import { ConnectionManagerRequestService }           from '../../shared.js';
import { cleanupCurrentSessionIfEmpty }              from './session-manager.js';

const TAG = 'Profile';

let _lastKnownProfile = null;
let _uiActive         = false;

// Events whose external listeners are silenced for the duration of a Forge session.
const _SUPPRESSED_EVENTS = [
    event_types.CHAT_CHANGED,
];

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
 * Reads the active connection profile name from connection-manager.
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

// ─── Init ─────────────────────────────────────────────────────────────────────

export function initProfileManager() {
    eventSource.on(event_types.CONNECTION_PROFILE_LOADED, _onProfileLoaded);
    eventSource.on(event_types.CHAT_LOADED, _onChatLoaded);
    log(TAG, 'Profile Manager Initialized');
}

// ─── Internal listeners ───────────────────────────────────────────────────────

function _onProfileLoaded(payload) {
    const name = typeof payload === 'string' ? payload : (payload?.name ?? null);
    if (name) {
        _lastKnownProfile = name;
        log(TAG, 'Profile load detected:', name);
    }
}

async function _onChatLoaded() {
    if (_uiActive) return;
    
    const settings = extension_settings[CTZ_EXT_NAME];
    const targetName = _resolveTargetProfileName(settings);

    // If the Forge profile is active but the extension is NOT, trigger restoration.
    if (targetName && _lastKnownProfile === targetName) {
        const permasave = settings?.permasave_profile;
        if (!permasave) return;

        error(TAG, 'Guard: Forge profile active outside session — restoring:', permasave);
        await _applyProfile(permasave);
        _popToLoadingScreen();
    }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Capture current state and swap to Forge Engine.
 */
export async function enterForge() {
    const settings   = extension_settings[CTZ_EXT_NAME];
    const targetName = _resolveTargetProfileName(settings);

    if (!targetName) {
        throw new Error(
            'Forge Engine not configured. Please select a connection profile ' +
            'in Characteryze Settings first.'
        );
    }

    const currentProfile = _lastKnownProfile ?? _readActiveProfileName();

    if (!currentProfile) {
        throw new Error('Could not identify current connection profile for restoration.');
    }

    // Only set permasave if we aren't already on the target (prevents overwriting restoration target)
    if (currentProfile !== targetName) {
        settings.permasave_profile = currentProfile;
        saveSettingsDebounced();
        log(TAG, 'Permasave captured:', currentProfile);
    }

    _uiActive = true;
    _suppressExternalListeners();

    try {
        if (currentProfile !== targetName) {
            await _applyProfile(targetName);
        }
    } catch (err) {
        _restoreExternalListeners();
        _uiActive = false;
        throw err;
    }
}

/**
 * Exit Forge and restore Permasave profile.
 */
export async function exitForge() {
    const settings  = extension_settings[CTZ_EXT_NAME];
    const permasave = settings?.permasave_profile;

    try {
        // Cleanup empty sessions while still in Forge profile context
        await cleanupCurrentSessionIfEmpty();

        if (permasave) {
            log(TAG, 'Exiting Forge: restoring profile:', permasave);
            await _applyProfile(permasave);
        }
    } finally {
        _uiActive = false;
        _restoreExternalListeners();
    }

    _popToLoadingScreen();
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
 * Resolves the profile name for the Forge from extension settings.
 */
function _resolveTargetProfileName(settings) {
    const selectedId = settings?.forge_profile_id;
    if (selectedId) {
        try {
            const profile = ConnectionManagerRequestService.getProfile(selectedId);
            if (profile?.name) return profile.name;
        } catch (err) {
            warn(TAG, 'Could not resolve Forge profile for ID:', selectedId);
        }
    }
    return null;
}

async function _applyProfile(name) {
    const { executeSlashCommandsWithOptions } = SillyTavern.getContext();
    log(TAG, 'Switching profile to:', name);
    await executeSlashCommandsWithOptions(`/profile ${name}`);
}

function _popToLoadingScreen() {
    log(TAG, 'Refreshing UI state');
    $('#rm_button_characters').trigger('click');
}