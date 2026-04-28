/**
 * @file data/default-user/extensions/characteryze/settings-panel.js
 * @stamp {"utc":"2026-04-28T00:00:00.000Z"}
 * @version 1.0.0
 * @architectural-role IO — Settings Panel UI
 * @description
 * Renders the Settings tab: image gen engine picker, prompt template editor,
 * autosave toggle, max saved sessions, and verbose logging toggle.
 *
 * All writes go directly to extension_settings.characteryze via the standard
 * saveSettingsDebounced pathway. No state is held here.
 *
 * @api-declaration
 * mountPanel(container) — inject settings HTML into container and wire inputs
 *
 * @contract
 *   assertions:
 *     purity: IO
 *     state_ownership: []
 *     external_io: [DOM, extension_settings write, saveSettingsDebounced, setVerbose]
 */

import { extension_settings, saveSettingsDebounced } from '../../../extensions.js';
import { log }                                        from './log.js';
import { setVerbose, isVerbose }                      from './log.js';
import { CTZ_EXT_NAME, DEFAULT_PORTRAIT_PROMPT_TEMPLATE } from './defaults.js';

const TAG = 'Settings';

// ─── Mount ────────────────────────────────────────────────────────────────────

export function mountPanel(container) {
    container.innerHTML = _buildHTML();
    _wire(container);
    log(TAG, 'Mounted');
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function _buildHTML() {
    const s      = extension_settings[CTZ_EXT_NAME] ?? {};
    const ig     = s.image_gen   ?? {};
    const sess   = s.sessions    ?? {};
    const engine = ig.engine     ?? 'pollinations';
    const tmpl   = ig.prompt_template ?? DEFAULT_PORTRAIT_PROMPT_TEMPLATE;

    return `
        <div class="ctz-settings-panel">
            <section class="ctz-section">
                <h3 class="ctz-section-title">Image Generation</h3>
                <div class="ctz-form-row">
                    <label class="ctz-label" for="ctz-ig-engine">Engine</label>
                    <select id="ctz-ig-engine" class="ctz-select">
                        <option value="pollinations" ${engine === 'pollinations' ? 'selected' : ''}>
                            Pollinations (built-in)
                        </option>
                        <option value="custom" ${engine === 'custom' ? 'selected' : ''}>
                            Custom Endpoint
                        </option>
                    </select>
                </div>
                <div class="ctz-form-row" id="ctz-ig-endpoint-row"
                     style="${engine !== 'custom' ? 'display:none' : ''}">
                    <label class="ctz-label" for="ctz-ig-endpoint">Endpoint URL</label>
                    <input id="ctz-ig-endpoint" class="ctz-input"
                           value="${_esc(ig.endpoint ?? '')}"
                           placeholder="https://…" />
                </div>
                <div class="ctz-form-row">
                    <label class="ctz-label" for="ctz-ig-template">Prompt Template</label>
                    <textarea id="ctz-ig-template" class="ctz-input ctz-textarea"
                              rows="3">${_esc(tmpl)}</textarea>
                    <small class="ctz-hint">Use <code>{{prompt}}</code> as placeholder.</small>
                </div>
            </section>

            <section class="ctz-section">
                <h3 class="ctz-section-title">Sessions</h3>
                <div class="ctz-form-row">
                    <label class="ctz-label" for="ctz-autosave">Autosave</label>
                    <input type="checkbox" id="ctz-autosave" class="ctz-checkbox"
                           ${sess.autosave !== false ? 'checked' : ''} />
                </div>
                <div class="ctz-form-row">
                    <label class="ctz-label" for="ctz-max-saved">Max saved sessions</label>
                    <input type="number" id="ctz-max-saved" class="ctz-input ctz-input-sm"
                           value="${sess.max_saved ?? 50}" min="1" max="500" />
                </div>
            </section>

            <section class="ctz-section">
                <h3 class="ctz-section-title">Diagnostics</h3>
                <div class="ctz-form-row">
                    <label class="ctz-label" for="ctz-verbose">Verbose logging</label>
                    <input type="checkbox" id="ctz-verbose" class="ctz-checkbox"
                           ${isVerbose() ? 'checked' : ''} />
                </div>
            </section>

            <section class="ctz-section">
                <h3 class="ctz-section-title">Forge Profile</h3>
                <div class="ctz-form-row">
                    <label class="ctz-label">Permasave (restore target)</label>
                    <span class="ctz-muted" id="ctz-permasave-display">
                        ${_esc(extension_settings[CTZ_EXT_NAME]?.permasave_profile ?? '—')}
                    </span>
                </div>
            </section>
        </div>
    `;
}

// ─── Wiring ───────────────────────────────────────────────────────────────────

function _wire(container) {
    const s = () => extension_settings[CTZ_EXT_NAME];

    const engineSel   = container.querySelector('#ctz-ig-engine');
    const endpointRow = container.querySelector('#ctz-ig-endpoint-row');
    const endpointIn  = container.querySelector('#ctz-ig-endpoint');
    const templateTA  = container.querySelector('#ctz-ig-template');
    const autosaveCb  = container.querySelector('#ctz-autosave');
    const maxSavedIn  = container.querySelector('#ctz-max-saved');
    const verboseCb   = container.querySelector('#ctz-verbose');

    engineSel?.addEventListener('change', () => {
        const isCustom = engineSel.value === 'custom';
        if (endpointRow) endpointRow.style.display = isCustom ? '' : 'none';
        s().image_gen.engine = engineSel.value;
        saveSettingsDebounced();
    });

    endpointIn?.addEventListener('input', () => {
        s().image_gen.endpoint = endpointIn.value.trim();
        saveSettingsDebounced();
    });

    templateTA?.addEventListener('input', () => {
        s().image_gen.prompt_template = templateTA.value;
        saveSettingsDebounced();
    });

    autosaveCb?.addEventListener('change', () => {
        s().sessions.autosave = autosaveCb.checked;
        saveSettingsDebounced();
    });

    maxSavedIn?.addEventListener('change', () => {
        const val = parseInt(maxSavedIn.value, 10);
        if (!isNaN(val) && val > 0) {
            s().sessions.max_saved = val;
            saveSettingsDebounced();
        }
    });

    verboseCb?.addEventListener('change', () => {
        setVerbose(verboseCb.checked);
        s().verbose = verboseCb.checked;
        saveSettingsDebounced();
        log(TAG, 'Verbose mode:', verboseCb.checked);
    });
}

function _esc(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}
