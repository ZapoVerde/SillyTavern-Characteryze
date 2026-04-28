/**
 * @file data/default-user/extensions/characteryze/index.js
 * @stamp {"utc":"2026-04-28T00:00:00.000Z"}
 * @version 1.0.0
 * @architectural-role IO — Extension Entry Point
 * @description
 * Bootstraps Characteryze. Registers the settings panel in the ST extensions
 * drawer, initialises extension_settings, and wires the Launch / Close buttons.
 *
 * The entry point owns the top-level launch and exit sequences. It delegates
 * all profile lifecycle work to profile-manager and all session lifecycle work
 * to session-manager. It does not hold business logic.
 *
 * @api-declaration
 * (none — module-level side-effects only, executed on ST load)
 *
 * @contract
 *   assertions:
 *     purity: IO
 *     state_ownership: []
 *     external_io: [DOM, extension_settings init, ST event bindings,
 *                   saveSettingsDebounced, toastr]
 */

import { extension_settings } from '../../../extensions.js';
import { saveSettingsDebounced }                            from '../../../../script.js';
import { eventSource, event_types }           from '../../../../script.js';
import { log, error, setVerbose }             from './log.js';
import { CTZ_EXT_NAME, DEFAULT_SETTINGS }     from './defaults.js';
import {
    initProfileManager,
    ensureForgeProfile,
    enterForge,
    exitForge,
    setUiActive,
} from './profile-manager.js';
import {
    ensureInternalCharacter,
    pruneOldSessions,
} from './session-manager.js';
import {
    initTabBar,
    registerPanel,
    showOverlay,
    hideOverlay,
    activateTab,
} from './tab-bar.js';
import { mountPanel as mountHome }      from './home-panel.js';
import { mountPanel as mountForge }     from './forge-panel.js';
import { mountPanel as mountWorkbench } from './workbench-panel.js';
import { mountPanel as mountPortrait }  from './portrait-panel.js';
import { mountPanel as mountSettings }  from './settings-panel.js';

const TAG = 'Index';

// ─── Settings init ────────────────────────────────────────────────────────────

function _initSettings() {
    if (!extension_settings[CTZ_EXT_NAME]) {
        extension_settings[CTZ_EXT_NAME] = structuredClone(DEFAULT_SETTINGS);
        saveSettingsDebounced();
        log(TAG, 'Default settings written');
    } else {
        // Backfill any keys missing from older installs
        const d = DEFAULT_SETTINGS;
        const s = extension_settings[CTZ_EXT_NAME];
        let dirty = false;
        for (const [k, v] of Object.entries(d)) {
            if (!(k in s)) { s[k] = structuredClone(v); dirty = true; }
        }
        if (dirty) saveSettingsDebounced();
    }

    // Apply persisted verbose setting
    setVerbose(extension_settings[CTZ_EXT_NAME].verbose === true);
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

jQuery(() => {
    _initSettings();
    initProfileManager();

    // Inject the extensions drawer entry
    $('#extensions_settings').append(_buildFallbackSettingsHtml());

    _wireDrawerButtons();
    log(TAG, 'Extension loaded');
});

// ─── Drawer button wiring ─────────────────────────────────────────────────────

function _wireDrawerButtons() {
    $(document).on('click', '#ctz-launch-btn', _onLaunch);
    $(document).on('click', '#ctz-close-btn',  _onClose);
}

// ─── Launch sequence ──────────────────────────────────────────────────────────

async function _onLaunch() {
    log(TAG, 'Launch');
    try {
        const result = await ensureInternalCharacter();
        if (result === 'needs_reload') return;  // toastr shown by ensureInternalCharacter

        await ensureForgeProfile();
        pruneOldSessions();

        // Build tab bar once; subsequent launches reuse it
        initTabBar(_onClose);
        _mountPanels();

        setUiActive(true);
        await enterForge();
        showOverlay();
        activateTab('home');
        log(TAG, 'Overlay active');
    } catch (err) {
        error(TAG, 'Launch failed', err);
        toastr.error('Characteryze failed to launch.');
        setUiActive(false);
    }
}

// ─── Exit sequence ────────────────────────────────────────────────────────────

async function _onClose() {
    log(TAG, 'Close');
    try {
        hideOverlay();
        setUiActive(false);
        await exitForge();
    } catch (err) {
        error(TAG, 'Close sequence error', err);
    }
}

// ─── Panel mounting ───────────────────────────────────────────────────────────

function _mountPanels() {
    registerPanel('home', container => mountHome(container, {
        activateTab,
        onEnterForge: () => {
            // Refresh forge strip whenever we enter the forge tab
            activateTab('forge');
        },
    }));
    registerPanel('forge',     container => mountForge(container));
    registerPanel('workbench', container => mountWorkbench(container));
    registerPanel('portrait',  container => mountPortrait(container));
    registerPanel('settings',  container => mountSettings(container));
}

// ─── Fallback settings HTML ───────────────────────────────────────────────────

function _buildFallbackSettingsHtml() {
    return `
        <div id="ctz-settings-block" class="extension-settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>Characteryze</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <button id="ctz-launch-btn" class="menu_button">Launch</button>
                    <button id="ctz-close-btn"  class="menu_button">Close</button>
                </div>
            </div>
        </div>
    `;
}
