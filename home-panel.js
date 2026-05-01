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

import { log, error }             from './log.js';
import { CANVAS_TYPES, CTZ_EXT_NAME } from './defaults.js';
import { system_prompts }         from '../../../../scripts/sysprompt.js';
import { openai_setting_names }  from '../../../../scripts/openai.js';
import { extension_settings }     from '../../../extensions.js';
import { saveSettingsDebounced }  from '../../../../script.js';
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

    const syspromptOptions = system_prompts
        .map(p => `<option value="${_esc(p.name)}">${_esc(p.name)}</option>`)
        .join('');

    const chatProfileOptions = openai_setting_names
        .map(n => `<option value="${_esc(n)}">${_esc(n)}</option>`)
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
                <div class="ctz-form-row ctz-hidden" id="ctz-sp-mode-row">
                    <label class="ctz-label">Mode</label>
                    <select id="ctz-sp-mode" class="ctz-select">
                        <option value="chat" ${_spMode() === 'chat' ? 'selected' : ''}>Chat Completion</option>
                        <option value="text" ${_spMode() === 'text' ? 'selected' : ''}>Text Completion</option>
                    </select>
                </div>
                <div class="ctz-form-row" id="ctz-target-row">
                    <label class="ctz-label">Target</label>
                    <select id="ctz-target-char" class="ctz-select">
                        <option value="__new__">— Create New —</option>
                        ${charOptions}
                    </select>
                    <select id="ctz-target-sysprompt" class="ctz-select ctz-hidden">
                        ${syspromptOptions}
                    </select>
                    <select id="ctz-target-chat-profile" class="ctz-select ctz-hidden">
                        ${chatProfileOptions}
                    </select>
                </div>
            </section>

            <button id="ctz-enter-forge-btn" class="ctz-btn ctz-btn-primary ctz-btn-block">
                Enter Forge
            </button>

            <button class="ctz-dismiss-handle" title="Return to chat">▲ Return to Chat</button>
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
    const canvasSelect        = _container.querySelector('#ctz-canvas-select');
    const spModeRow           = _container.querySelector('#ctz-sp-mode-row');
    const spModeSelect        = _container.querySelector('#ctz-sp-mode');
    const charSelect          = _container.querySelector('#ctz-target-char');
    const syspromptSelect     = _container.querySelector('#ctz-target-sysprompt');
    const chatProfileSelect   = _container.querySelector('#ctz-target-chat-profile');
    const targetRow           = _container.querySelector('#ctz-target-row');

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

    // ── Canvas / SP-mode (immediate binding) ──────────────────────────────────
    function _syncCanvas() {
        const canvasType  = canvasSelect.value;
        const isCharCard  = canvasType === CANVAS_TYPES.CHARACTER_CARD;
        const isSysPrompt = canvasType === CANVAS_TYPES.SYSTEM_PROMPT;
        const spMode      = spModeSelect?.value ?? 'chat';
        const spText      = isSysPrompt && spMode === 'text';
        const spChat      = isSysPrompt && spMode === 'chat';

        setWorkspaceCanvas(canvasType);

        if (isCharCard) {
            const sel = charSelect?.value;
            setWorkspaceTarget(sel === '__new__' ? null : sel);
        } else if (spText) {
            setWorkspaceTarget(syspromptSelect?.value || null);
        } else if (spChat) {
            setWorkspaceTarget(chatProfileSelect?.value || null);
        } else if (canvasType === CANVAS_TYPES.RULESET) {
            setWorkspaceTarget('__new__');
        } else {
            setWorkspaceTarget(null);
        }

        spModeRow?.classList.toggle('ctz-hidden', !isSysPrompt);
        targetRow?.classList.toggle('ctz-hidden', !isCharCard && !spText && !spChat);
        charSelect?.classList.toggle('ctz-hidden', !isCharCard);
        syspromptSelect?.classList.toggle('ctz-hidden', !spText);
        chatProfileSelect?.classList.toggle('ctz-hidden', !spChat);
    }

    canvasSelect?.addEventListener('change', _syncCanvas);
    spModeSelect?.addEventListener('change', () => {
        extension_settings[CTZ_EXT_NAME].sp_mode = spModeSelect.value;
        saveSettingsDebounced();
        _syncCanvas();
    });
    _syncCanvas(); // initialise workspace state + row visibility

    // ── Target character (immediate binding) ───────────────────────────────────
    charSelect?.addEventListener('change', () => {
        const sel = charSelect.value;
        setWorkspaceTarget(sel === '__new__' ? null : sel);
    });

    // ── Target system prompt (immediate binding) ───────────────────────────────
    syspromptSelect?.addEventListener('change', () => {
        setWorkspaceTarget(syspromptSelect.value || null);
    });

    // ── Target chat profile (immediate binding) ────────────────────────────────
    chatProfileSelect?.addEventListener('change', () => {
        setWorkspaceTarget(chatProfileSelect.value || null);
    });

    // ── Dismiss ────────────────────────────────────────────────────────────────
    _container.querySelector('.ctz-dismiss-handle')
        ?.addEventListener('click', () => _activateTab?.('forge'));

    // ── Enter Forge ────────────────────────────────────────────────────────────
    const enterBtn = _container.querySelector('#ctz-enter-forge-btn');
    enterBtn?.addEventListener('click', async () => {
        const filename = sessionSelect.value;
        const orig = enterBtn.textContent;
        enterBtn.disabled = true;
        enterBtn.textContent = 'Preparing Forge…';
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
            toastr.error(err.message || 'Failed to enter Forge.');
        } finally {
            enterBtn.disabled = false;
            enterBtn.textContent = orig;
        }
    });
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function _spMode() {
    return extension_settings[CTZ_EXT_NAME]?.sp_mode ?? 'chat';
}

function _esc(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}
