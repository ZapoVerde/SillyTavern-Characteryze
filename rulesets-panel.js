/**
 * @file data/default-user/extensions/characteryze/rulesets-panel.js
 * @stamp {"utc":"2026-04-29T15:00:00.000Z"}
 * @version 2.0.0
 * @architectural-role IO — Rulesets Toggle & Publishing Panel
 * @description
 * Displays all ruleset documents stored in the Characteryze Virtual Library.
 * Toggling a ruleset updates the active_rulesets array, concatenates the text
 * of all active documents, and publishes the combined string to the single 
 * Characteryze Bridge slot in SillyTavern's native prompt manager.
 *
 * Reverts toggles gracefully if the user is not on a compatible Chat backend.
 *
 * @api-declaration
 * mountPanel(container) — mount panel HTML into container
 * refreshPanel()        — re-render in-place
 *
 * @contract
 *   assertions:
 *     purity: IO
 *     state_ownership: []
 *     external_io: [DOM, ruleset-library reads, extension_settings write, 
 *                   saveSettingsDebounced, publishToBridge, toastr]
 */

import { extension_settings }             from '../../../extensions.js';
import { saveSettingsDebounced }          from '../../../../script.js';
import { log, error }                     from './log.js';
import { getRulesetList, getRulesetContent } from './ruleset-library.js';
import { publishToBridge }                from './prompt-bridge.js';
import { CTZ_EXT_NAME }                   from './defaults.js';

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
    const list = getRulesetList();
    
    if (list.length === 0) {
        return `
            <div class="ctz-section">
                <h3 class="ctz-section-title">Rulesets</h3>
                <p class="ctz-muted">No rulesets found. Create one via the Workbench.</p>
            </div>
        `;
    }

    const activeList = extension_settings[CTZ_EXT_NAME]?.active_rulesets ?? [];

    const rows = list.map(name => {
        const enabled = activeList.includes(name);
        return `
            <label class="ctz-session-row" style="cursor:pointer;">
                <input type="checkbox"
                       class="ctz-checkbox ctz-ruleset-toggle"
                       data-name="${_esc(name)}"
                       ${enabled ? 'checked' : ''} />
                <span class="ctz-session-name">${_esc(name)}</span>
            </label>`;
    }).join('');

    return `
        <div class="ctz-section">
            <h3 class="ctz-section-title">Rulesets</h3>
            <p class="ctz-muted" style="margin-bottom: 8px; font-size: 11px;">
                Checked rulesets are combined and injected into the LLM prompt.
            </p>
            <div class="ctz-session-list">${rows}</div>
        </div>
    `;
}

// ─── Wiring & Publishing ──────────────────────────────────────────────────────

function _wire() {
    _container.querySelectorAll('.ctz-ruleset-toggle').forEach(cb => {
        cb.addEventListener('change', () => {
            const name      = cb.dataset.name;
            const isChecked = cb.checked;
            
            // 1. Update State
            const settings = extension_settings[CTZ_EXT_NAME];
            if (!settings.active_rulesets) settings.active_rulesets = [];
            
            if (isChecked && !settings.active_rulesets.includes(name)) {
                settings.active_rulesets.push(name);
            } else if (!isChecked) {
                settings.active_rulesets = settings.active_rulesets.filter(n => n !== name);
            }
            saveSettingsDebounced();

            // 2. Concatenate
            const concatenatedText = settings.active_rulesets
                .map(activeName => getRulesetContent(activeName))
                .filter(content => content && content.trim() !== '') // Drop empties/orphans
                .join('\n\n');

            // 3. Publish
            try {
                // publishToBridge is synchronous, but we wrap in a try/catch in case it 
                // throws an error regarding Text Completion backend incompatibility.
                publishToBridge(concatenatedText);
                log(TAG, `Published Library state (${settings.active_rulesets.length} active)`);
            } catch (err) {
                // 4. Revert on failure
                error(TAG, 'Publish failed, reverting toggle:', err.message);
                cb.checked = !isChecked; // UI revert
                
                // State revert
                if (isChecked) {
                    settings.active_rulesets = settings.active_rulesets.filter(n => n !== name);
                } else {
                    settings.active_rulesets.push(name);
                }
                saveSettingsDebounced();
                
                toastr.warning(err.message || 'Failed to apply ruleset.');
            }
        });
    });
}

function _esc(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}