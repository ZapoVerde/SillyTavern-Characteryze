/**
 * @file data/default-user/extensions/characteryze/home-panel.js
 * @stamp {"utc":"2026-04-30T00:00:00.000Z"}
 * @version 2.0.0
 * @architectural-role IO — Home Panel UI (Ignition Panel)
 * @description
 * Renders the Home tab as a decoupled Ignition Panel: an independent
 * Session picker and a Focus section (Canvas + Target) that update
 * workspace state immediately on change.
 *
 * Session and Focus are orthogonal: any canvas/target combo can be used
 * with any historical session, or a brand-new one.
 *
 * @api-declaration
 * mountPanel(container, deps) — mount panel; deps provides { activateTab, onEnterForge }
 * refreshPanel()              — re-render in place (preserves _selectedFilename)
 *
 * @contract
 *   assertions:
 *     purity: IO
 *     state_ownership: [_selectedFilename]
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

let _container        = null;
let _activateTab      = null;
let _onEnterForge     = null;
let _selectedFilename = null; // null = New Session

// ─── Mount ────────────────────────────────────────────────────────────────────

export function mountPanel(container, deps = {}) {
    _container        = container;
    _activateTab      = deps.activateTab  ?? null;
    _onEnterForge     = deps.onEnterForge ?? null;
    _selectedFilename = null;
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
    const sessions    = listSessions().slice().reverse();
    const ctx         = SillyTavern.getContext();
    const charOptions = ctx.characters
        .map(c => `<option value="${_esc(c.avatar)}">${_esc(c.name)}</option>`)
        .join('');

    const newSel = _selectedFilename === null ? ' ctz-session-item--selected' : '';

    const sessionRows = sessions.map(s => {
        const sel = s.filename === _selectedFilename ? ' ctz-session-item--selected' : '';
        return `
            <div class="ctz-session-item${sel}" data-filename="${_esc(s.filename)}">
                <span class="ctz-session-item__name">${_esc(s.session_name)}</span>
                <span class="ctz-session-item__date">${s.created_at.slice(0, 10)}</span>
                <button class="ctz-icon-btn ctz-rename-btn"
                        data-filename="${_esc(s.filename)}" title="Rename">✏</button>
                <button class="ctz-icon-btn ctz-delete-btn"
                        data-filename="${_esc(s.filename)}" title="Delete">🗑</button>
            </div>`;
    }).join('');

    return `
        <div class="ctz-home-panel">
            <section class="ctz-section">
                <h3 class="ctz-section-title">Session</h3>
                <div class="ctz-session-list" id="ctz-session-list">
                    <div class="ctz-session-item ctz-session-item--new${newSel}" data-filename="">
                        <span class="ctz-session-item__name">+ New Session</span>
                    </div>
                    ${sessionRows}
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
    const canvasSelect = _container.querySelector('#ctz-canvas-select');
    const charSelect   = _container.querySelector('#ctz-target-char');
    const targetRow    = _container.querySelector('#ctz-target-row');

    // ── Session selection ──────────────────────────────────────────────────────
    _container.querySelectorAll('.ctz-session-item').forEach(item => {
        item.addEventListener('click', e => {
            if (e.target.closest('.ctz-icon-btn')) return;
            _container.querySelectorAll('.ctz-session-item')
                .forEach(i => i.classList.remove('ctz-session-item--selected'));
            item.classList.add('ctz-session-item--selected');
            _selectedFilename = item.dataset.filename || null;
        });
    });

    // ── Rename (inline contenteditable) ───────────────────────────────────────
    _container.querySelectorAll('.ctz-rename-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const filename = btn.dataset.filename;
            const row      = [..._container.querySelectorAll('.ctz-session-item')]
                .find(el => el.dataset.filename === filename);
            const nameSpan = row?.querySelector('.ctz-session-item__name');
            if (!nameSpan || nameSpan.contentEditable === 'true') return;

            const original = nameSpan.textContent;
            nameSpan.contentEditable = 'true';
            nameSpan.classList.add('ctz-session-item__name--editing');
            nameSpan.focus();

            const sel   = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(nameSpan);
            sel.removeAllRanges();
            sel.addRange(range);

            const commit = () => {
                nameSpan.contentEditable = 'false';
                nameSpan.classList.remove('ctz-session-item__name--editing');
                const newName = nameSpan.textContent.trim();
                if (newName && newName !== original) {
                    renameSession(filename, newName);
                } else {
                    nameSpan.textContent = original;
                }
            };

            nameSpan.addEventListener('blur', commit, { once: true });
            nameSpan.addEventListener('keydown', ke => {
                if (ke.key === 'Enter') {
                    ke.preventDefault();
                    nameSpan.blur();
                }
                if (ke.key === 'Escape') {
                    nameSpan.removeEventListener('blur', commit);
                    nameSpan.textContent = original;
                    nameSpan.contentEditable = 'false';
                    nameSpan.classList.remove('ctz-session-item__name--editing');
                }
            });
        });
    });

    // ── Delete ─────────────────────────────────────────────────────────────────
    _container.querySelectorAll('.ctz-delete-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const filename = btn.dataset.filename;
            if (_selectedFilename === filename) _selectedFilename = null;
            deleteSession(filename);
            refreshPanel();
        });
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
        try {
            if (_selectedFilename) {
                await loadForgeSession(_selectedFilename);
            } else {
                await newForgeSession();
            }
            _activateTab?.('forge');
            _onEnterForge?.();
            log(TAG, _selectedFilename ? 'Session loaded' : 'New session started', '→ Forge');
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
