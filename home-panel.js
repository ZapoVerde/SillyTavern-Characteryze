/**
 * @file data/default-user/extensions/characteryze/home-panel.js
 * @stamp {"utc":"2026-04-28T00:00:00.000Z"}
 * @version 1.0.0
 * @architectural-role IO — Home Panel UI
 * @description
 * Renders the Home tab: session list, new-session flow, canvas type selector,
 * and target picker. The Enter Forge button completes workspace configuration
 * and switches to the Forge tab so the user can chat.
 *
 * Delegates session creation/loading to session-manager. Delegates tab
 * switching to the activateTab callback passed to mountPanel().
 *
 * @api-declaration
 * mountPanel(container, deps) — mount panel HTML into container; deps provides
 *                               { activateTab, onEnterForge }
 * refreshPanel()              — re-render session list and target picker in-place
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
    setWorkspaceCanvas,
    setWorkspaceTarget,
} from './session-manager.js';

const TAG = 'HomePanel';

let _container  = null;
let _activateTab = null;
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
    const sessions   = listSessions();
    const sessionRows = sessions.length
        ? sessions.map(s => `
            <div class="ctz-session-row" data-filename="${_esc(s.filename)}">
                <span class="ctz-session-name">${_esc(s.session_name)}</span>
                <span class="ctz-session-meta">${_esc(s.canvas_type)} · ${s.created_at.slice(0, 10)}</span>
                <button class="ctz-btn ctz-btn-sm ctz-load-session-btn"
                        data-filename="${_esc(s.filename)}">Load</button>
            </div>`).join('')
        : '<p class="ctz-muted">No sessions yet. Start one below.</p>';

    const ctx        = SillyTavern.getContext();
    const charOptions = ctx.characters.map((c, i) =>
        `<option value="${_esc(c.avatar)}">${_esc(c.name)}</option>`,
    ).join('');

    return `
        <div class="ctz-home-panel">
            <section class="ctz-section">
                <h3 class="ctz-section-title">Sessions</h3>
                <div id="ctz-session-list" class="ctz-session-list">${sessionRows}</div>
            </section>

            <section class="ctz-section">
                <h3 class="ctz-section-title">New Session</h3>
                <div class="ctz-form-row">
                    <label class="ctz-label">Canvas Type</label>
                    <select id="ctz-canvas-select" class="ctz-select">
                        <option value="${CANVAS_TYPES.CHARACTER_CARD}">Character Card</option>
                        <option value="${CANVAS_TYPES.SYSTEM_PROMPT}">System Prompt</option>
                        <option value="${CANVAS_TYPES.RULESET}">Ruleset</option>
                    </select>
                </div>
                <div class="ctz-form-row" id="ctz-target-row">
                    <label class="ctz-label" id="ctz-target-label">Target Character</label>
                    <div class="ctz-target-controls">
                        <select id="ctz-target-char" class="ctz-select">
                            <option value="__new__">— Create New —</option>
                            ${charOptions}
                        </select>
                        <input id="ctz-target-ruleset" class="ctz-input ctz-hidden"
                               placeholder="Ruleset name…" />
                    </div>
                </div>
                <button id="ctz-new-session-btn" class="ctz-btn ctz-btn-primary">
                    New Session → Enter Forge
                </button>
            </section>
        </div>
    `;
}

function _wire() {
    // Load existing session
    _container.querySelectorAll('.ctz-load-session-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const filename = btn.dataset.filename;
            try {
                await loadForgeSession(filename);
                _activateTab?.('forge');
                _onEnterForge?.();
            } catch (err) {
                error(TAG, 'Load session failed', err);
                toastr.error('Failed to load session.');
            }
        });
    });

    // Canvas type changes target picker visibility
    const canvasSelect = _container.querySelector('#ctz-canvas-select');
    const charSelect   = _container.querySelector('#ctz-target-char');
    const rulesetInput = _container.querySelector('#ctz-target-ruleset');
    const targetLabel  = _container.querySelector('#ctz-target-label');

    canvasSelect?.addEventListener('change', () => {
        const isRuleset = canvasSelect.value === CANVAS_TYPES.RULESET;
        charSelect?.classList.toggle('ctz-hidden', isRuleset);
        rulesetInput?.classList.toggle('ctz-hidden', !isRuleset);
        if (targetLabel) targetLabel.textContent = isRuleset ? 'Ruleset Name' : 'Target Character';
    });

    // New session + enter forge
    _container.querySelector('#ctz-new-session-btn')?.addEventListener('click', async () => {
        const canvasType = canvasSelect?.value ?? CANVAS_TYPES.CHARACTER_CARD;
        const isRuleset  = canvasType === CANVAS_TYPES.RULESET;
        const target     = isRuleset
            ? (rulesetInput?.value.trim() || 'New Ruleset')
            : (charSelect?.value ?? '__new__');

        try {
            setWorkspaceCanvas(canvasType);
            setWorkspaceTarget(target === '__new__' ? null : target);
            await newForgeSession(canvasType);
            _activateTab?.('forge');
            _onEnterForge?.();
            log(TAG, 'New session started, entering Forge');
        } catch (err) {
            error(TAG, 'New session failed', err);
            toastr.error('Failed to create session.');
        }
    });
}

function _esc(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}
