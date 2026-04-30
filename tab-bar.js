/**
 * @file data/default-user/extensions/characteryze/tab-bar.js
 * @stamp {"utc":"2026-04-30T00:00:00.000Z"}
 * @version 2.0.0
 * @architectural-role IO — Tab Bar Overlay
 * @description
 * Renders and manages the CTZ overlay tab bar. Injects the overlay container
 * into the ST DOM, renders tab buttons, and shows/hides panel containers.
 *
 * 'forge' is a valid internal navigation target with no corresponding visible
 * button. Activating it applies ctz-chat-mode (collapses the panel area,
 * leaving the ST chat fully accessible). All "dismiss" paths — toggle-click,
 * dismiss handle, click-outside — converge on activateTab('forge').
 *
 * Panel modules are not imported here — callers pass mount functions via
 * registerPanel(). This keeps tab-bar.js decoupled from panel implementations.
 *
 * @api-declaration
 * initTabBar(onExit)              — inject overlay, wire tabs; onExit called when X clicked
 * registerPanel(tabId, mountFn)   — bind a panel mount function to a tab slot
 * showOverlay()                   — make overlay visible
 * hideOverlay()                   — hide full overlay
 * activateTab(tabId)              — programmatically switch active tab (forge = collapse)
 * getActiveTab()                  — returns current tab id string
 *
 * @contract
 *   assertions:
 *     purity: IO
 *     state_ownership: [_activeTab, _panels]
 *     external_io: [DOM manipulation, session-manager read]
 */

import { log }          from './log.js';
import { getWorkspace } from './session-manager.js';

const TAG = 'TabBar';

// 'forge' is intentionally absent: it is a valid internal state (collapse /
// chat mode) but has no visible button. See module description above.
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

export function registerTabActivate(tabId, fn) {
    _activateCallbacks[tabId] = fn;
}

// ─── Public controls ──────────────────────────────────────────────────────────

export function showOverlay() {
    const el = document.getElementById('ctz-overlay');
    if (el) el.classList.remove('ctz-hidden');
}

export function hideOverlay() {
    const el = document.getElementById('ctz-overlay');
    if (el) el.classList.add('ctz-hidden');
    _closeMenu();
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

    // Wire all tab buttons (desktop row + mobile nav)
    overlay.querySelectorAll('.ctz-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.dataset.tab;

            // Toggle: clicking the already-active tab collapses to forge/chat mode
            if (tabId === _activeTab) {
                _setActiveTab('forge');
                _closeMenu();
                return;
            }

            // Guard: no panel navigation until a session is active
            if (tabId !== 'home' && !getWorkspace().filename) {
                toastr.info('Enter the Forge first to access this panel.', 'Characteryze');
                return;
            }

            _setActiveTab(tabId);
            _closeMenu();
        });
    });

    // Hamburger — stopPropagation prevents the document handler from immediately closing
    document.getElementById('ctz-hamburger-btn')
        ?.addEventListener('click', e => {
            e.stopPropagation();
            _toggleMenu();
        });

    // ✕ inside the mobile nav
    document.getElementById('ctz-menu-close-btn')
        ?.addEventListener('click', () => _closeMenu());

    // Click anywhere outside the mobile nav closes it
    document.addEventListener('click', e => {
        const nav = document.getElementById('ctz-mobile-nav');
        if (!nav || nav.classList.contains('ctz-menu-closed')) return;
        if (!nav.contains(e.target)) _closeMenu();
    });

    // Click anywhere outside the overlay collapses the panel area
    document.addEventListener('click', e => {
        const ol = document.getElementById('ctz-overlay');
        if (!ol || ol.classList.contains('ctz-hidden')) return;
        if (_activeTab === 'forge') return;
        if (!ol.contains(e.target)) _setActiveTab('forge');
    });

    // Wire exit button
    overlay.querySelector('#ctz-exit-btn')
        ?.addEventListener('click', () => {
            log(TAG, 'Exit button clicked');
            _onExit?.();
        });
}

function _buildOverlayHTML() {
    const makeBtns = () => TABS.map(t =>
        `<button class="ctz-tab-btn" data-tab="${t.id}">${t.label}</button>`,
    ).join('');

    const panelSlots = TABS
        .map(t => `<div id="ctz-panel-${t.id}" class="ctz-panel ctz-hidden" data-panel="${t.id}"></div>`)
        .join('');

    return `
        <div class="ctz-tab-bar">
            <button class="ctz-hamburger-btn" id="ctz-hamburger-btn" title="Open menu" aria-expanded="false" aria-controls="ctz-mobile-nav">☰</button>
            <span class="ctz-active-label" id="ctz-active-label">Home</span>
            <div class="ctz-tabs">${makeBtns()}</div>
            <button id="ctz-exit-btn" class="ctz-exit-btn" title="Exit Characteryze">✕</button>
        </div>
        <nav class="ctz-mobile-nav ctz-menu-closed" id="ctz-mobile-nav" aria-label="Tab navigation">
            <button class="ctz-menu-close-btn" id="ctz-menu-close-btn" title="Close menu" aria-label="Close navigation menu">✕</button>
            ${makeBtns()}
        </nav>
        <div id="ctz-panel-forge" class="ctz-hidden"></div>
        <div class="ctz-panel-area">${panelSlots}</div>
    `;
}

// ─── Mobile menu ──────────────────────────────────────────────────────────────

function _toggleMenu() {
    const nav = document.getElementById('ctz-mobile-nav');
    if (!nav) return;
    if (nav.classList.contains('ctz-menu-closed')) {
        nav.classList.remove('ctz-menu-closed');
        document.getElementById('ctz-hamburger-btn')?.setAttribute('aria-expanded', 'true');
    } else {
        _closeMenu();
    }
}

function _closeMenu() {
    document.getElementById('ctz-mobile-nav')?.classList.add('ctz-menu-closed');
    document.getElementById('ctz-hamburger-btn')?.setAttribute('aria-expanded', 'false');
}

// ─── Internal tab switching ───────────────────────────────────────────────────

function _setActiveTab(tabId) {
    if (!tabId) return;
    _activeTab = tabId;
    log(TAG, 'Active tab:', tabId);

    // Update mobile active label
    const label = TABS.find(t => t.id === tabId)?.label ?? tabId;
    const activeLabel = document.getElementById('ctz-active-label');
    if (activeLabel) activeLabel.textContent = label;

    // Update tab button states (applies to both desktop row and mobile nav)
    document.querySelectorAll('.ctz-tab-btn').forEach(btn => {
        btn.classList.toggle('ctz-tab-active', btn.dataset.tab === tabId);
    });

    // Show/hide regular panel slots (forge is not in .ctz-panel-area)
    document.querySelectorAll('.ctz-panel').forEach(panel => {
        panel.classList.toggle('ctz-hidden', panel.dataset.panel !== tabId);
    });

    // Forge strip slot lives outside .ctz-panel-area — toggle it separately
    const forgeSlot = document.getElementById('ctz-panel-forge');
    if (forgeSlot) forgeSlot.classList.toggle('ctz-hidden', tabId !== 'forge');

    // Overlay shrinks to tab-bar + forge strip in forge (chat) mode
    const overlay = document.getElementById('ctz-overlay');
    if (overlay) {
        overlay.classList.toggle('ctz-chat-mode', tabId === 'forge');
    }

    _activateCallbacks[tabId]?.();
}
