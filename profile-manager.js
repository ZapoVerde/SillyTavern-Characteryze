/**
 * @file data/default-user/extensions/characteryze/profile-manager.js
 * @stamp {"utc":"2026-04-29T10:35:00.000Z"}
 * @version 1.1.1
 * @architectural-role Stateful — Connection Profile Lifecycle
 * @description
 * Owns the Forge connection profile swap cycle. Manages permasave (the
 * authoritative restore target), swap-in on CTZ open, swap-out on CTZ exit,
 * and the CHAT_LOADED rogue-profile guard.
 *
 * @api-declaration
 * initProfileManager()   — register CONNECTION_PROFILE_LOADED + CHAT_LOADED listeners
 * ensureForgeProfile()   — idempotently create Forge profile if absent
 * enterForge()           — capture permasave, swap to Forge profile
 * exitForge()            — restore permasave, pop to loading screen
 * setUiActive(bool)      — set guard-exemption flag (called by index.js on launch/close)
 * isUiActive()           — returns current UI-active state
 * getPermasave()         — returns stored permasave profile name or null
 *
 * @contract
 *   assertions:
 *     purity: Stateful / IO
 *     state_ownership: [_lastKnownProfile, _uiActive]
 *     external_io: [executeSlashCommandsWithOptions, saveSettingsDebounced,
 *                   extension_settings write, DOM (#rm_button_characters)]
 */

import { extension_settings }    from '../../../extensions.js';
import { saveSettingsDebounced } from '../../../../script.js';
import { eventSource, event_types }                  from '../../../../script.js';
import { log, warn, error }                          from './log.js';
import { CTZ_EXT_NAME, CTZ_FORGE_PROFILE_NAME }      from './defaults.js';

const TAG = 'Profile';

let _lastKnownProfile = null;
let _uiActive         = false;

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
    if (_lastKnownProfile !== CTZ_FORGE_PROFILE_NAME) return;

    const permasave = extension_settings[CTZ_EXT_NAME]?.permasave_profile;
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
 * Idempotently ensures the Forge profile exists.
 * Robust check against connection-manager settings to avoid duplicate toasts.
 */
export async function ensureForgeProfile() {
    if (_lastKnownProfile === CTZ_FORGE_PROFILE_NAME) return;

    const cm = extension_settings['connection-manager'];
    const profiles = cm?.profiles ?? {};
    
    // Support both object-based and array-based profile storage in ST
    const exists = Array.isArray(profiles)
        ? profiles.some(p => p === CTZ_FORGE_PROFILE_NAME || p.name === CTZ_FORGE_PROFILE_NAME)
        : (profiles[CTZ_FORGE_PROFILE_NAME] !== undefined || Object.prototype.hasOwnProperty.call(profiles, CTZ_FORGE_PROFILE_NAME));

    if (!exists) {
        log(TAG, 'Creating Forge profile:', CTZ_FORGE_PROFILE_NAME);
        const { executeSlashCommandsWithOptions } = SillyTavern.getContext();
        await executeSlashCommandsWithOptions(`/profile-create ${CTZ_FORGE_PROFILE_NAME}`);
    } else {
        log(TAG, 'Forge profile verified');
    }
}

export async function enterForge() {
    const settings = extension_settings[CTZ_EXT_NAME];

    if (_lastKnownProfile && _lastKnownProfile !== CTZ_FORGE_PROFILE_NAME) {
        settings.permasave_profile = _lastKnownProfile;
        saveSettingsDebounced();
        log(TAG, 'Permasave written:', _lastKnownProfile);
    }

    _uiActive = true;
    await _applyProfile(CTZ_FORGE_PROFILE_NAME);
}

export async function exitForge() {
    _uiActive = false;
    const permasave = extension_settings[CTZ_EXT_NAME]?.permasave_profile;

    if (permasave) {
        await _applyProfile(permasave);
    } else {
        warn(TAG, 'exitForge: no permasave — profile not restored');
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

async function _applyProfile(name) {
    const { executeSlashCommandsWithOptions } = SillyTavern.getContext();
    log(TAG, 'Applying profile:', name);
    await executeSlashCommandsWithOptions(`/profile ${name}`);
}

function _popToLoadingScreen() {
    log(TAG, 'Popping to loading screen');
    $('#rm_button_characters').trigger('click');
}