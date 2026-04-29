/**
 * @file data/default-user/extensions/characteryze/rulesets-panel.js
 * @stamp {"utc":"2026-04-29T00:00:00.000Z"}
 * @version 1.0.0
 * @architectural-role IO — Rulesets Panel
 * @description
 * Displays all user-created prompts (identified by a digit in their identifier)
 * as a toggle list. Enables/disables them in the active character's prompt order
 * via promptManager. Replaces the former forge-strip dropdown.
 *
 * @api-declaration
 * mountPanel(container) — mount panel HTML into container
 * refreshPanel()        — re-render in-place
 */

import { log, warn }   from './log.js';
import { promptManager } from '../../../../scripts/openai.js';

const TAG = 'Rulesets';

let _container = null;

// ─── Mount ────────────────────────────────────────────────────────────────────

export function mountPanel(container) {
    _container = container;
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
    const pm = promptManager;

    if (!pm) {
        return '<p class="ctz-muted">Rulesets unavailable — requires a Chat Completion backend.</p>';
    }

    // User-created prompts have a digit in their identifier (timestamp or UUID).
    // ST built-ins are pure alphabetic/underscore strings.
    const ctx     = SillyTavern.getContext();
    const prompts = (pm.serviceSettings?.prompts ?? [])
        .filter(p => p.identifier && /\d/.test(p.identifier));
    const order   = pm.getPromptOrderForCharacter?.(ctx.characterId) ?? [];

    if (prompts.length === 0) {
        return '<p class="ctz-muted">No user-created prompts found.</p>';
    }

    const rows = prompts.map(p => {
        const entry   = order.find(o => o.identifier === p.identifier);
        const enabled = entry?.enabled ?? false;
        return `
            <label class="ctz-session-row" style="cursor:pointer;">
                <input type="checkbox"
                       class="ctz-checkbox ctz-ruleset-toggle"
                       data-identifier="${_esc(p.identifier)}"
                       ${enabled ? 'checked' : ''} />
                <span class="ctz-session-name">${_esc(p.name)}</span>
            </label>`;
    }).join('');

    return `
        <div class="ctz-section">
            <h3 class="ctz-section-title">Rulesets</h3>
            <div class="ctz-session-list">${rows}</div>
        </div>
    `;
}

function _wire() {
    _container.querySelectorAll('.ctz-ruleset-toggle').forEach(cb => {
        cb.addEventListener('change', () => {
            const pm = promptManager;
            if (!pm) return;

            const ctx   = SillyTavern.getContext();
            const order = pm.getPromptOrderForCharacter?.(ctx.characterId);
            if (!order) return;

            const entry = order.find(o => o.identifier === cb.dataset.identifier);
            if (entry) {
                entry.enabled = cb.checked;
                pm.saveServiceSettings();
                log(TAG, `"${cb.dataset.identifier}" → ${cb.checked}`);
            } else {
                warn(TAG, 'Identifier not found in prompt order:', cb.dataset.identifier);
            }
        });
    });
}

function _esc(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}
