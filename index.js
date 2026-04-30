/**
 * @file data/default-user/extensions/characteryze/index.js
 * @stamp {"utc":"2026-04-29T10:20:00.000Z"}
 * @version 1.1.0
 * @architectural-role IO — Extension Entry Point
 * @description
 * Bootstraps Characteryze. Registers the settings panel in the ST extensions
 * drawer, initialises extension_settings, and wires the Launch / Close buttons.
 *
 * The launch sequence now requires a manually created Host character to be 
 * present in the user's roster, enforcing session isolation without 
 * programmatic character injection.
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
import { saveSettingsDebounced, eventSource, event_types } from '../../../../script.js';
import { log, error, setVerbose }             from './log.js';
import { escapeMacros }                       from './macro-escape.js';
import { CTZ_EXT_NAME, CTZ_HOST_CHAR_NAME, DEFAULT_SETTINGS }     from './defaults.js';
import {
    initProfileManager,
    enterForge,
    exitForge,
    setUiActive,
    isUiActive,
} from './profile-manager.js';
import {
    pruneOldSessions,
} from './session-manager.js';
import {
    initTabBar,
    registerPanel,
    registerTabActivate,
    showOverlay,
    hideOverlay,
    activateTab,
} from './tab-bar.js';
import { mountPanel as mountHome }      from './home-panel.js';
import { mountPanel as mountForge }     from './forge-panel.js';
import { mountPanel as mountWorkbench, refreshPanel as refreshWorkbench } from './workbench-panel.js';
import { mountPanel as mountPortrait }  from './portrait-panel.js';
import { mountPanel as mountRulesets }  from './rulesets-panel.js';
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
    _injectDrawer();
    _wireDrawerButtons();
    eventSource.on(event_types.GENERATION_AFTER_COMMANDS, _onGenerationAfterCommands);
    log(TAG, 'Extension loaded');
});

// ─── Macro escape hook ────────────────────────────────────────────────────────

// Fires inside Generate() after slash-command processing, before the textarea
// is read and passed to sendMessageAsUser(). We transform \{{ → {ZWS{ here so
// substituteParams never sees a bare {{ to replace.
function _onGenerationAfterCommands(_type, _opts, dryRun) {
    if (!isUiActive() || dryRun) return;
    const textarea = document.querySelector('#send_textarea');
    if (!textarea) return;
    const escaped = escapeMacros(textarea.value);
    if (escaped !== textarea.value) textarea.value = escaped;
}

// ─── Drawer button wiring ─────────────────────────────────────────────────────

function _wireDrawerButtons() {
    $(document).on('click', '#ctz-launch-btn', _onLaunch);
    $(document).on('click', '#ctz-close-btn',  _onClose);
}

// ─── Launch sequence ──────────────────────────────────────────────────────────

async function _onLaunch() {
    log(TAG, 'Launch');
    try {
        const ctx = SillyTavern.getContext();
        const hostExists = ctx.characters.some(c => c.name === CTZ_HOST_CHAR_NAME);

        if (!hostExists) {
            toastr.error(
                `Host character "${CTZ_HOST_CHAR_NAME}" not found. ` +
                `Please create an empty character with this name first.`,
                'Characteryze',
                { timeOut: 10000 }
            );
            return;
        }

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
        await exitForge();
    } catch (err) {
        error(TAG, 'Close sequence error', err);
        // exitForge sets _uiActive false in its finally block, but if it
        // throws before reaching that point, clear the flag here as a fallback.
        setUiActive(false);
    }
}

// ─── Panel mounting ───────────────────────────────────────────────────────────

function _mountPanels() {
    registerPanel('home', container => mountHome(container, {
        activateTab,
        onEnterForge: () => {
            // Switch to forge tab
            activateTab('forge');
        },
    }));
    registerPanel('forge',     container => mountForge(container));
    registerPanel('workbench', container => mountWorkbench(container));
    registerTabActivate('workbench', refreshWorkbench);
    registerPanel('portrait',  container => mountPortrait(container));
    registerPanel('rulesets',  container => mountRulesets(container));
    registerPanel('settings',  container => mountSettings(container, 'ctz'));
}

// ─── Drawer HTML + settings injection ────────────────────────────────────────

function _injectDrawer() {
    const wrapper = document.createElement('div');
    wrapper.id        = 'ctz-settings-block';
    wrapper.className = 'extension-settings';
    wrapper.innerHTML = `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Characteryze</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <div style="display:flex;gap:6px;margin-bottom:10px;">
                    <button id="ctz-launch-btn" class="menu_button">
                        <i class="fa-solid fa-wand-magic-sparkles"></i> Launch
                    </button>
                    <button id="ctz-close-btn" class="menu_button">
                        <i class="fa-solid fa-right-from-bracket"></i> Close
                    </button>
                </div>
                <div id="ctz-drawer-settings"></div>
            </div>
        </div>
    `;
    document.getElementById('extensions_settings')?.appendChild(wrapper);

    // Mount settings panel into drawer with 'ctzd' prefix (drawer instance)
    const drawerSlot = document.getElementById('ctz-drawer-settings');
    if (drawerSlot) mountSettings(drawerSlot, 'ctzd');
}