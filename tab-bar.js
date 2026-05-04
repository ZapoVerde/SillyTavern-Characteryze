/**
 * @file data/default-user/extensions/characteryze/tab-bar.js
 * @stamp {"utc":"2026-05-04T12:05:00.000Z"}
 * @version 3.1.0
 * @architectural-role IO — Sidebar UI
 * @description
 * Renders and manages the Characteryze Sidebar. Injects the fixed sidebar container
 * into the ST DOM, renders tab buttons, and shows/hides panel containers.
 *
 * Includes "click away to close" logic: clicks outside the sidebar (and not on
 * the FAB) will trigger the sidebar to hide.
 *
 * @api-declaration
 * initTabBar(onExit)              — inject sidebar, wire tabs; onExit called when X clicked
 * registerPanel(tabId, mountFn)   — bind a panel mount function to a tab slot
 * showSidebar()                   — make sidebar visible
 * hideSidebar()                   — hide sidebar
 * toggleSidebar()                 — toggle sidebar visibility
 * activateTab(tabId)              — programmatically switch active tab (forge = hide sidebar)
 * getActiveTab()                  — returns current tab id string
 *
 * @contract
 *   assertions:
 *     purity: IO
 *     state_ownership: [_activeTab, _panels]
 *     external_io: [DOM manipulation, session-manager read, document click listener]
 */

import { log }          from './log.js';
import { getWorkspace } from './session-manager.js';

const TAG = 'TabBar';

const TABS = [
    { id: 'home',      label: 'Home'      },
    { id: 'workbench', label: 'Workbench' },
    { id: 'portrait',  label: 'Portrait'  },
    { id: 'rulesets',  label: 'Rulesets'  },
    { id: 'settings',  label: 'Settings'  },
];

let _activeTab         = 'home';
let _panels            = {};     // tabId → mountFn(containerEl)
let _activateCallbacks = {};     // tabId → fn()
let _onExit            = null;
let _mounted           = false;

// ─── Init ─────────────────────────────────────────────────────────────────────

export function initTabBar(onExit) {
    _onExit = onExit ?? null;
    if (!_mounted) {
        _injectSidebar();
        _mounted = true;
    }
    log(TAG, 'Sidebar initialised');
}

export function registerPanel(tabId, mountFn) {
    _panels[tabId] = mountFn;
    const slot = document.getElementById(`ctz-panel-${tabId}`);
    if (slot) mountFn(slot);
}

export function registerTabActivate(tabId, fn) {
    _activateCallbacks[tabId] = fn;
}

// ─── Public controls ──────────────────────────────────────────────────────────

export function showSidebar() {
    const el = document.getElementById('ctz-sidebar');
    if (el) el.classList.remove('ctz-hidden');
}

export function hideSidebar() {
    const el = document.getElementById('ctz-sidebar');
    if (el) el.classList.add('ctz-hidden');
}

export function toggleSidebar() {
    const el = document.getElementById('ctz-sidebar');
    if (el) el.classList.toggle('ctz-hidden');
}

export function activateTab(tabId) {
    if (tabId === 'forge') {
        hideSidebar();
        return;
    }
    _setActiveTab(tabId);
}

export function getActiveTab() {
    return _activeTab;
}

// ─── DOM construction ─────────────────────────────────────────────────────────

function _injectSidebar() {
    if (document.getElementById('ctz-sidebar')) return;

    const sidebar = document.createElement('div');
    sidebar.id        = 'ctz-sidebar';
    sidebar.className = 'ctz-sidebar ctz-hidden';
    sidebar.innerHTML = _buildSidebarHTML();
    document.body.appendChild(sidebar);

    // Wire tab buttons
    sidebar.querySelectorAll('.ctz-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.dataset.tab;

            // Guard: no panel navigation until a session is active
            if (tabId !== 'home' && !getWorkspace().filename) {
                toastr.info('Enter the Forge first to access this panel.', 'Characteryze');
                return;
            }

            _setActiveTab(tabId);
        });
    });

    // Wire exit button
    sidebar.querySelector('#ctz-exit-btn')
        ?.addEventListener('click', () => {
            log(TAG, 'Exit button clicked');
            _onExit?.();
        });
        
    // Prevent clicks inside the sidebar from bleeding through to SillyTavern
    sidebar.addEventListener('click', e => e.stopPropagation());

    // Click away to close: Listen for clicks on the document
    // Clicks inside the sidebar are stopped by stopPropagation above.
    document.addEventListener('click', (e) => {
        const sidebarEl = document.getElementById('ctz-sidebar');
        const fabEl     = document.getElementById('ctz-fab');

        // Only act if the sidebar is currently open
        if (sidebarEl && !sidebarEl.classList.contains('ctz-hidden')) {
            // Do not close if the user clicked the FAB (it has its own toggle logic)
            if (fabEl && fabEl.contains(e.target)) {
                return;
            }
            log(TAG, 'Outside click detected, hiding sidebar');
            hideSidebar();
        }
    });
}

function _buildSidebarHTML() {
    const makeBtns = () => TABS.map(t =>
        `<button class="ctz-tab-btn" data-tab="${t.id}">${t.label}</button>`,
    ).join('');

    const panelSlots = TABS
        .map(t => `<div id="ctz-panel-${t.id}" class="ctz-panel ctz-hidden" data-panel="${t.id}"></div>`)
        .join('');

    return `
        <div class="ctz-sidebar-header">
            <span style="font-weight: 600; color: var(--ctz-accent);">Characteryze</span>
            <button id="ctz-exit-btn" class="ctz-exit-btn" title="Exit Characteryze">✕</button>
        </div>
        
        <div id="ctz-panel-forge"></div>
        
        <div class="ctz-tabs">
            ${makeBtns()}
        </div>
        
        <div class="ctz-panel-area">
            ${panelSlots}
        </div>
    `;
}

// ─── Internal tab switching ───────────────────────────────────────────────────

function _setActiveTab(tabId) {
    if (!tabId) return;
    _activeTab = tabId;
    log(TAG, 'Active tab:', tabId);

    // Update tab button states
    document.querySelectorAll('.ctz-tab-btn').forEach(btn => {
        btn.classList.toggle('ctz-tab-active', btn.dataset.tab === tabId);
    });

    // Show/hide panel slots
    document.querySelectorAll('.ctz-panel').forEach(panel => {
        panel.classList.toggle('ctz-hidden', panel.dataset.panel !== tabId);
    });

    _activateCallbacks[tabId]?.();
}