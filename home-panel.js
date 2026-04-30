/**
 * @file data/default-user/extensions/characteryze/home-panel.js
 * @stamp {"utc":"2026-04-30T00:00:00.000Z"}
 * @version 2.1.0
 * @architectural-role IO — Home Panel UI (Ignition Panel)
 * @description
 * Renders the Home tab as a decoupled Ignition Panel: an independent
 * Session dropdown and a Focus section (Canvas + Target) that update
 * workspace state immediately on change.
 *
 * Session and Focus are orthogonal: any canvas/target combo can be used
 * with any historical session, or a brand-new one.
 *
 * @api-declaration
 * mountPanel(container, deps) — mount panel; deps provides { activateTab, onEnterForge }
 * refreshPanel()              — re-render in place
 *
 * @contract
 *   assertions:
 *     purity: IO
 *     state_ownership: []
 *     external_io: [DOM, session-manager calls, SillyTavern context]
 */

import { log, error }        from './log.js';
import { CANVAS_TYPES }      from './defaults.js';
import {
    listSessions,
    newForgeSession,
    loadForgeSession,
    renameSession,
    deleteSession,
    setWorkspaceCanvas,
    setWorkspaceTarget,
} from './session-manager.js';

const TAG = 'HomePanel';

let _container    = null;
let _activateTab  = null;
let _onEnterForge = null;

// ─── Mount ────────────────────────────────────────────────────────────────────

export function mountPanel(container, deps = {}) {
    _container    = container;
    _activateTab  = deps.activateTab  ?? null;
    _onEnterForge = deps.onEnterForge ?? null;
    _render();
    log(TAG, 'Mounted');
}

export function refreshPanel() {
    if (_container) _render();
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function _render() {
    _container.innerHTML = _buildHTML();
    _wire();
}

function _buildHTML() {
    // Newest first
    const sessions     = listSessions().slice().reverse();
    const sessionOpts  = sessions.map(s =>
        `<option value="${_esc(s.filename)}">${_esc(s.session_name)}</option>`,
    ).join('');

    const ctx         = SillyTavern.getContext();
    const charOptions = ctx.characters
        .map(c => `<option value="${_esc(c.avatar)}">${_esc(c.name)}</option>`)
        .join('');

    return `
        <div class="ctz-home-panel">
            <section class="ctz-section">
                <h3 class="ctz-section-title">Session</h3>
                <div class="ctz-form-row">
                    <label class="ctz-label">Session</label>
                    <select id="ctz-session-select" class="ctz-select">
                        <option value="">+ New Session</option>
                        ${sessionOpts}
                    </select>
                    <button id="ctz-rename-session-btn" class="ctz-icon-btn ctz-rename-btn"
                            title="Rename" disabled>✏</button>
                    <button id="ctz-delete-session-btn" class="ctz-icon-btn ctz-delete-btn"
                            title="Delete" disabled>🗑</button>
                </div>
                <div id="ctz-rename-row" class="ctz-form-row ctz-hidden">
                    <label class="ctz-label"></label>
                    <input id="ctz-rename-input" class="ctz-input" type="text"
                           placeholder="Session name…" />
                    <button id="ctz-rename-confirm-btn" class="ctz-icon-btn" title="Save">✓</button>
                    <button id="ctz-rename-cancel-btn"  class="ctz-icon-btn" title="Cancel">✕</button>
                </div>
            </section>

            <section class="ctz-section">
                <h3 class="ctz-section-title">Focus</h3>
                <div class="ctz-form-row">
                    <label class="ctz-label">Canvas</label>
                    <select id="ctz-canvas-select" class="ctz-select">
                        <option value="${CANVAS_TYPES.CHARACTER_CARD}">Character Card</option>
                        <option value="${CANVAS_TYPES.SYSTEM_PROMPT}">System Prompt</option>
                        <option value="${CANVAS_TYPES.RULESET}">Ruleset</option>
                    </select>
                </div>
                <div class="ctz-form-row" id="ctz-target-row">
                    <label class="ctz-label">Target</label>
                    <select id="ctz-target-char" class="ctz-select">
                        <option value="__new__">— Create New —</option>
                        ${charOptions}
                    </select>
                </div>
            </section>

            <button id="ctz-enter-forge-btn" class="ctz-btn ctz-btn-primary ctz-btn-block">
                Enter Forge
            </button>
        </div>`;
}

// ─── Wiring ───────────────────────────────────────────────────────────────────

function _wire() {
    const sessionSelect = _container.querySelector('#ctz-session-select');
    const renameBtn     = _container.querySelector('#ctz-rename-session-btn');
    const deleteBtn     = _container.querySelector('#ctz-delete-session-btn');
    const renameRow     = _container.querySelector('#ctz-rename-row');
    const renameInput   = _container.querySelector('#ctz-rename-input');
    const renameConfirm = _container.querySelector('#ctz-rename-confirm-btn');
    const renameCancel  = _container.querySelector('#ctz-rename-cancel-btn');
    const canvasSelect  = _container.querySelector('#ctz-canvas-select');
    const charSelect    = _container.querySelector('#ctz-target-char');
    const targetRow     = _container.querySelector('#ctz-target-row');

    // ── Session action button enable/disable ───────────────────────────────────
    function _updateSessionActions() {
        const hasSession = !!sessionSelect.value;
        renameBtn.disabled = !hasSession;
        deleteBtn.disabled = !hasSession;
        if (!hasSession) renameRow.classList.add('ctz-hidden');
    }

    sessionSelect.addEventListener('change', _updateSessionActions);
    _updateSessionActions();

    // ── Rename ─────────────────────────────────────────────────────────────────
    renameBtn.addEventListener('click', () => {
        renameInput.value = sessionSelect.options[sessionSelect.selectedIndex].text;
        renameRow.classList.remove('ctz-hidden');
        renameInput.focus();
        renameInput.select();
    });

    function _commitRename() {
        const filename = sessionSelect.value;
        const newName  = renameInput.value.trim();
        if (newName && filename) {
            renameSession(filename, newName);
            sessionSelect.options[sessionSelect.selectedIndex].text = newName;
        }
        renameRow.classList.add('ctz-hidden');
    }

    renameConfirm.addEventListener('click', _commitRename);
    renameCancel.addEventListener('click', () => renameRow.classList.add('ctz-hidden'));
    renameInput.addEventListener('keydown', e => {
        if (e.key === 'Enter')  { e.preventDefault(); _commitRename(); }
        if (e.key === 'Escape') { renameRow.classList.add('ctz-hidden'); }
    });

    // ── Delete ─────────────────────────────────────────────────────────────────
    deleteBtn.addEventListener('click', () => {
        const filename = sessionSelect.value;
        if (filename) {
            deleteSession(filename);
            refreshPanel();
        }
    });

    // ── Canvas (immediate binding) ─────────────────────────────────────────────
    function _syncCanvas() {
        const canvasType = canvasSelect.value;
        const isCharCard = canvasType === CANVAS_TYPES.CHARACTER_CARD;

        setWorkspaceCanvas(canvasType);

        if (isCharCard) {
            const sel = charSelect?.value;
            setWorkspaceTarget(sel === '__new__' ? null : sel);
        } else if (canvasType === CANVAS_TYPES.RULESET) {
            setWorkspaceTarget('__new__');
        } else {
            setWorkspaceTarget(null); // System Prompt
        }

        targetRow?.classList.toggle('ctz-hidden', !isCharCard);
    }

    canvasSelect?.addEventListener('change', _syncCanvas);
    _syncCanvas(); // initialise workspace state + target row visibility

    // ── Target character (immediate binding) ───────────────────────────────────
    charSelect?.addEventListener('change', () => {
        const sel = charSelect.value;
        setWorkspaceTarget(sel === '__new__' ? null : sel);
    });

    // ── Enter Forge ────────────────────────────────────────────────────────────
    _container.querySelector('#ctz-enter-forge-btn')?.addEventListener('click', async () => {
        const filename = sessionSelect.value;
        try {
            if (filename) {
                await loadForgeSession(filename);
            } else {
                await newForgeSession();
            }
            _activateTab?.('forge');
            _onEnterForge?.();
            log(TAG, filename ? 'Session loaded' : 'New session started', '→ Forge');
        } catch (err) {
            error(TAG, 'Enter Forge failed', err);
            toastr.error('Failed to enter Forge.');
        }
    });
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function _esc(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}
