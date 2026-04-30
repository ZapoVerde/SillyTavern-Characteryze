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
 * Displays the active canvas type and target. Updated by workbench-panel via
 * refreshStrip() when the user switches ruleset targets or commits.
 *
 * @api-declaration
 * mountPanel(container, deps) — inject strip HTML; deps provides { getWorkspace }
 * refreshStrip()              — re-render ruleset tick list in-place
 *
 * @contract
 *   assertions:
 *     purity: IO
 *     state_ownership: []
 *     external_io: [DOM, SillyTavern context]
 */

import { log }          from './log.js';
import { getWorkspace } from './session-manager.js';

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
    const target  = ws.target === '__new__' ? '< New Ruleset >' : (ws.target ?? (canvas === 'character_card' ? 'New Character' : '—'));

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
        </div>
    `;
}

function _wire() { /* no interactive elements in the strip */ }

function _shortFilename(filename) {
    if (!filename || filename === '—') return '—';
    return filename.replace(/\.jsonl?$/, '').slice(-24);
}

function _esc(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}
