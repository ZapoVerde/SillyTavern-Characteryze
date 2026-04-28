/**
 * @file data/default-user/extensions/characteryze/tab-bar.js
 * @stamp {"utc":"2026-04-28T00:00:00.000Z"}
 * @version 1.0.0
 * @architectural-role IO — Tab Bar Overlay
 * @description
 * Renders and manages the CTZ overlay tab bar. Injects the overlay container
 * into the ST DOM, renders tab buttons, and shows/hides panel containers.
 *
 * Each tab has a corresponding panel slot. The Forge tab is special: it puts
 * the overlay into "chat mode" (no full panel — just the tab bar + forge strip
 * remain visible, leaving the ST chat fully accessible).
 *
 * Panel modules are not imported here — callers pass mount functions via
 * registerPanel(). This keeps tab-bar.js decoupled from panel implementations.
 *
 * @api-declaration
 * initTabBar(onExit)              — inject overlay, wire tabs; onExit called when X clicked
 * registerPanel(tabId, mountFn)   — bind a panel mount function to a tab slot
 * showOverlay()                   — make overlay visible
 * hideOverlay()                   — hide full overlay
 * activateTab(tabId)              — programmatically switch active tab
 * getActiveTab()                  — returns current tab id string
 *
 * @contract
 *   assertions:
 *     purity: IO
 *     state_ownership: [_activeTab, _panels]
 *     external_io: [DOM manipulation]
 */

import { log } from './log.js';

const TAG = 'TabBar';

const TABS = [
    { id: 'home',      label: 'Home'      },
    { id: 'forge',     label: 'Forge'     },
    { id: 'workbench', label: 'Workbench' },
    { id: 'portrait',  label: 'Portrait'  },
    { id: 'settings',  label: 'Settings'  },
];

let _activeTab = 'home';
let _panels    = {};     // tabId → mountFn(containerEl)
let _onExit    = null;
let _mounted   = false;

// ─── Init ─────────────────────────────────────────────────────────────────────

export function initTabBar(onExit) {
    _onExit = onExit ?? null;
    if (!_mounted) {
        _injectOverlay();
        _mounted = true;
    }
    log(TAG, 'Tab bar initialised');
}

export function registerPanel(tabId, mountFn) {
    _panels[tabId] = mountFn;
    const slot = document.getElementById(`ctz-panel-${tabId}`);
    if (slot) mountFn(slot);
}

// ─── Public controls ──────────────────────────────────────────────────────────

export function showOverlay() {
    const el = document.getElementById('ctz-overlay');
    if (el) el.classList.remove('ctz-hidden');
}

export function hideOverlay() {
    const el = document.getElementById('ctz-overlay');
    if (el) el.classList.add('ctz-hidden');
}

export function activateTab(tabId) {
    _setActiveTab(tabId);
}

export function getActiveTab() {
    return _activeTab;
}

// ─── DOM construction ─────────────────────────────────────────────────────────

function _injectOverlay() {
    if (document.getElementById('ctz-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id        = 'ctz-overlay';
    overlay.className = 'ctz-overlay ctz-hidden';
    overlay.innerHTML = _buildOverlayHTML();
    document.body.appendChild(overlay);

    // Wire tab buttons
    overlay.querySelectorAll('.ctz-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => _setActiveTab(btn.dataset.tab));
    });

    // Wire exit button
    overlay.querySelector('#ctz-exit-btn')
        ?.addEventListener('click', () => {
            log(TAG, 'Exit button clicked');
            _onExit?.();
        });
}

function _buildOverlayHTML() {
    const tabBtns = TABS.map(t =>
        `<button class="ctz-tab-btn" data-tab="${t.id}">${t.label}</button>`,
    ).join('');

    const panelSlots = TABS.map(t =>
        `<div id="ctz-panel-${t.id}" class="ctz-panel ctz-hidden" data-panel="${t.id}"></div>`,
    ).join('');

    return `
        <div class="ctz-tab-bar">
            <div class="ctz-tabs">${tabBtns}</div>
            <button id="ctz-exit-btn" class="ctz-exit-btn" title="Exit Characteryze">✕</button>
        </div>
        <div class="ctz-panel-area">${panelSlots}</div>
    `;
}

// ─── Internal tab switching ───────────────────────────────────────────────────

function _setActiveTab(tabId) {
    _activeTab = tabId;
    log(TAG, 'Active tab:', tabId);

    // Update tab button states
    document.querySelectorAll('.ctz-tab-btn').forEach(btn => {
        btn.classList.toggle('ctz-tab-active', btn.dataset.tab === tabId);
    });

    // Show/hide panels; forge tab = chat mode (no panel)
    document.querySelectorAll('.ctz-panel').forEach(panel => {
        const isActive = panel.dataset.panel === tabId && tabId !== 'forge';
        panel.classList.toggle('ctz-hidden', !isActive);
    });

    // Overlay shrinks to tab-bar-only height in forge (chat) mode
    const overlay = document.getElementById('ctz-overlay');
    if (overlay) {
        overlay.classList.toggle('ctz-chat-mode', tabId === 'forge');
    }
}
