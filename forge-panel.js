/**
 * @file data/default-user/extensions/characteryze/forge-panel.js
 * @stamp {"utc":"2026-04-28T00:00:00.000Z"}
 * @version 1.0.0
 * @architectural-role IO — Forge Tab Strip
 * @description
 * Renders the Forge tab strip: a compact bar docked above the ST chat area
 * that shows the active session/target info and the ruleset tickable dropdown.
 * The strip is visible only when the Forge tab is active; it does not replace
 * the chat surface.
 *
 * The ruleset dropdown maps directly to promptManager toggle calls — no custom
 * injection. Only available on CC backends (guard against null promptManager).
 *
 * @api-declaration
 * mountPanel(container, deps) — inject strip HTML; deps provides { getWorkspace }
 * refreshStrip()              — re-render ruleset tick list in-place
 *
 * @contract
 *   assertions:
 *     purity: IO
 *     state_ownership: []
 *     external_io: [DOM, promptManager toggle, SillyTavern context]
 */

import { log, warn }    from './log.js';
import { getWorkspace } from './session-manager.js';
import { promptManager } from '../../../../scripts/openai.js';

const TAG = 'ForgePanel';

let _container = null;

// ─── Mount ────────────────────────────────────────────────────────────────────

export function mountPanel(container) {
    _container = container;
    _render();
    log(TAG, 'Mounted');
}

export function refreshStrip() {
    if (_container) _render();
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function _render() {
    _container.innerHTML = _buildHTML();
    _wire();
}

function _buildHTML() {
    const ws      = getWorkspace();
    const session = ws.filename ?? '—';
    const canvas  = ws.canvas_type ?? '—';
    const target  = ws.target ?? (canvas === 'character_card' ? 'New Character' : '—');

    return `
        <div class="ctz-forge-strip">
            <div class="ctz-forge-info">
                <span class="ctz-forge-meta">
                    <span class="ctz-label-sm">Canvas:</span>
                    <strong>${_esc(canvas)}</strong>
                </span>
                <span class="ctz-forge-meta">
                    <span class="ctz-label-sm">Target:</span>
                    <strong>${_esc(String(target))}</strong>
                </span>
                <span class="ctz-forge-meta ctz-muted" title="${_esc(session)}" id="ctz-forge-session-name">
                    ${_esc(_shortFilename(session))}
                </span>
            </div>
            <div class="ctz-ruleset-wrap">
                ${_buildRulesetDropdown()}
            </div>
        </div>
    `;
}

function _buildRulesetDropdown() {
    // V2: promptManager not always exported — guard required
    const ctx = SillyTavern.getContext();
    const pm  = _getPromptManager();

    if (!pm) {
        return '<span class="ctz-muted ctz-label-sm">Rulesets: unavailable (non-CC backend)</span>';
    }

    const prompts = pm.serviceSettings?.prompts ?? [];
    const order   = pm.getPromptOrderForCharacter?.(ctx.characterId) ?? [];

    if (prompts.length === 0) {
        return '<span class="ctz-muted ctz-label-sm">No prompts in stack</span>';
    }

    const items = prompts.map(p => {
        const entry   = order.find(o => o.identifier === p.identifier);
        const enabled = entry ? entry.enabled : false;
        return `
            <label class="ctz-ruleset-item">
                <input type="checkbox"
                       class="ctz-ruleset-toggle"
                       data-identifier="${_esc(p.identifier)}"
                       ${enabled ? 'checked' : ''} />
                ${_esc(p.name)}
            </label>`;
    }).join('');

    return `
        <details class="ctz-ruleset-details">
            <summary class="ctz-ruleset-summary">Rulesets ▾</summary>
            <div class="ctz-ruleset-list">${items}</div>
        </details>
    `;
}

function _wire() {
    _container.querySelectorAll('.ctz-ruleset-toggle').forEach(cb => {
        cb.addEventListener('change', () => _toggleRuleset(cb.dataset.identifier, cb.checked));
    });
}

// ─── Ruleset toggling ─────────────────────────────────────────────────────────

function _toggleRuleset(identifier, enabled) {
    const ctx = SillyTavern.getContext();
    const pm  = _getPromptManager();
    if (!pm) return;

    const order = pm.getPromptOrderForCharacter?.(ctx.characterId);
    if (!order) return;

    const entry = order.find(o => o.identifier === identifier);
    if (entry) {
        entry.enabled = enabled;
        pm.saveServiceSettings();
        log(TAG, `Ruleset "${identifier}" → ${enabled}`);
    } else {
        warn(TAG, 'Ruleset entry not found in order:', identifier);
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _getPromptManager() {
    // promptManager is null on non-CC backends — callers must guard
    return promptManager ?? null;
}

function _shortFilename(filename) {
    if (!filename || filename === '—') return '—';
    return filename.replace(/\.jsonl?$/, '').slice(-24);
}

function _esc(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}
