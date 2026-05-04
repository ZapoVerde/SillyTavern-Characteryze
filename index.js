/**
 * @file data/default-user/extensions/characteryze/index.js
 * @stamp {"utc":"2026-05-04T21:10:00.000Z"}
 * @version 2.1.0
 * @architectural-role IO — Extension Entry Point
 * @description
 * Bootstraps Characteryze. Injects the persistent Floating Action Button (FAB)
 * into the DOM and registers the settings panel in the ST extensions drawer.
 *
 * Updated: Refactored extension drawer to use a Master Enable toggle instead
 * of Launch/Close buttons. FAB visibility is now tied to this toggle.
 *
 * @api-declaration
 * (none — module-level side-effects only, executed on ST load)
 *
 * @contract
 *   assertions:
 *     purity: IO
 *     state_ownership: []
 *     external_io: [DOM (FAB & drawer injection), extension_settings init, 
 *                   ST event bindings, saveSettingsDebounced, toastr]
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
    showSidebar,
    hideSidebar,
    toggleSidebar,
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
    _injectFAB();
    _injectDrawer();
    _wireDrawerButtons();
    eventSource.on(event_types.GENERATION_AFTER_COMMANDS, _onGenerationAfterCommands);
    log(TAG, 'Extension loaded');
});

// ─── Macro escape hook ────────────────────────────────────────────────────────

function _onGenerationAfterCommands(_type, _opts, dryRun) {
    if (!isUiActive() || dryRun) return;
    const textarea = document.querySelector('#send_textarea');
    if (!textarea) return;
    const escaped = escapeMacros(textarea.value);
    if (escaped !== textarea.value) textarea.value = escaped;
}

// ─── DOM Injection: FAB & Drawer ──────────────────────────────────────────────

function _injectFAB() {
    if (document.getElementById('ctz-fab')) return;

    const fab = document.createElement('button');
    fab.id        = 'ctz-fab';
    fab.className = 'ctz-fab ctz-fab-idle';
    
    // Initial visibility state based on Master Toggle
    if (extension_settings[CTZ_EXT_NAME].isEnabled === false) {
        fab.classList.add('ctz-hidden');
    }

    fab.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i>';
    fab.title     = 'Launch Characteryze';
    
    // Inject into SillyTavern's top-bar so the FAB slides/hides with the menu
    const parent = document.getElementById('top-bar') || document.body;
    parent.appendChild(fab);

    fab.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!isUiActive()) {
            await _onLaunch();
        } else {
            toggleSidebar();
        }
    });
}

function _injectDrawer() {
    const wrapper = document.createElement('div');
    wrapper.id        = 'ctz-settings-block';
    wrapper.className = 'extension-settings';
    
    const isEnabled = extension_settings[CTZ_EXT_NAME].isEnabled !== false;

    wrapper.innerHTML = `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Characteryze</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <div class="ctz-drawer-controls">
                    <label class="ctz-master-toggle">
                        <input type="checkbox" id="ctz-master-enable" ${isEnabled ? 'checked' : ''}>
                        <span>Enable Extension (Show FAB)</span>
                    </label>
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

function _wireDrawerButtons() {
    $(document).on('change', '#ctz-master-enable', async function() {
        const isEnabled = $(this).is(':checked');
        extension_settings[CTZ_EXT_NAME].isEnabled = isEnabled;
        saveSettingsDebounced();
        
        const fab = document.getElementById('ctz-fab');
        if (isEnabled) {
            fab?.classList.remove('ctz-hidden');
            log(TAG, 'Master Toggle: Enabled');
        } else {
            fab?.classList.add('ctz-hidden');
            log(TAG, 'Master Toggle: Disabled — Closing extension');
            if (isUiActive()) {
                await _onClose();
            } else {
                hideSidebar();
            }
        }
    });
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
        showSidebar();
        activateTab('home');

        const fab = document.getElementById('ctz-fab');
        if (fab) {
            fab.classList.remove('ctz-fab-idle');
            fab.classList.add('ctz-fab-active');
            fab.title = 'Toggle Characteryze Sidebar';
        }

        log(TAG, 'Sidebar active');
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
        hideSidebar();
        await exitForge();
    } catch (err) {
        error(TAG, 'Close sequence error', err);
        setUiActive(false);
    } finally {
        const fab = document.getElementById('ctz-fab');
        if (fab) {
            fab.classList.remove('ctz-fab-active');
            fab.classList.add('ctz-fab-idle');
            fab.title = 'Launch Characteryze';
        }
    }
}

// ─── Panel mounting ───────────────────────────────────────────────────────────

function _mountPanels() {
    registerPanel('home', container => mountHome(container, {
        activateTab,
        onEnterForge: () => {
            activateTab('forge');
        },
        onLeaveForge: async () => {
            await _onClose();
        }
    }));
    registerPanel('forge',     container => mountForge(container));
    registerPanel('workbench', container => mountWorkbench(container));
    registerTabActivate('workbench', refreshWorkbench);
    registerPanel('portrait',  container => mountPortrait(container));
    registerPanel('rulesets',  container => mountRulesets(container));
    registerPanel('settings',  container => mountSettings(container, 'ctz'));
}