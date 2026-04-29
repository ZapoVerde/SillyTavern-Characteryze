/**
 * @file data/default-user/extensions/characteryze/settings-panel.js
 * @stamp {"utc":"2026-04-29T10:25:00.000Z"}
 * @version 1.1.0
 * @architectural-role IO — Settings Panel UI
 * @description
 * Renders the Settings tab. Includes configuration for image generation,
 * session limits, and diagnostics. Now features a prominent Setup section 
 * instructing the user to create the mandatory Host character.
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

import { extension_settings }    from '../../../extensions.js';
import { saveSettingsDebounced } from '../../../../script.js';
import { log }                                        from './log.js';
import { setVerbose, isVerbose }                      from './log.js';
import { CTZ_EXT_NAME, CTZ_HOST_CHAR_NAME, DEFAULT_PORTRAIT_PROMPT_TEMPLATE } from './defaults.js';

const TAG = 'Settings';

// ─── Mount ────────────────────────────────────────────────────────────────────

/**
 * @param {HTMLElement} container
 * @param {string} [idPrefix='ctz'] — allows mounting two independent instances
 *                                    (drawer + overlay) without ID collisions
 */
export function mountPanel(container, idPrefix = 'ctz') {
    container.innerHTML = _buildHTML(idPrefix);
    _wire(container, idPrefix);
    log(TAG, 'Mounted', idPrefix);
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function _buildHTML(p) {
    const s      = extension_settings[CTZ_EXT_NAME] ?? {};
    const ig     = s.image_gen   ?? {};
    const sess   = s.sessions    ?? {};
    const engine = ig.engine     ?? 'pollinations';
    const tmpl   = ig.prompt_template ?? DEFAULT_PORTRAIT_PROMPT_TEMPLATE;

    return `
        <div class="ctz-settings-panel">
            <section class="ctz-section" style="background: var(--ctz-surface); padding: 12px; border-radius: var(--ctz-radius); border: 1px solid var(--ctz-accent);">
                <h3 class="ctz-section-title" style="color: var(--ctz-accent);">Required Setup</h3>
                <p class="ctz-muted" style="margin-bottom: 8px;">
                    Characteryze requires an isolated character to host Forge sessions.
                </p>
                <div style="font-size: 13px;">
                    1. Create a new, empty character.<br/>
                    2. Set the Name exactly to: <strong>${_esc(CTZ_HOST_CHAR_NAME)}</strong>
                </div>
                <p class="ctz-hint" style="margin-top: 8px;">
                    This character will store your brainstorming chats, keeping your main character library clean.
                </p>
            </section>

            <section class="ctz-section">
                <h3 class="ctz-section-title">Image Generation</h3>
                <div class="ctz-form-row">
                    <label class="ctz-label" for="${p}-ig-engine">Engine</label>
                    <select id="${p}-ig-engine" class="ctz-select">
                        <option value="pollinations" ${engine === 'pollinations' ? 'selected' : ''}>
                            Pollinations (built-in)
                        </option>
                        <option value="custom" ${engine === 'custom' ? 'selected' : ''}>
                            Custom Endpoint
                        </option>
                    </select>
                </div>
                <div class="ctz-form-row" id="${p}-ig-endpoint-row"
                     style="${engine !== 'custom' ? 'display:none' : ''}">
                    <label class="ctz-label" for="${p}-ig-endpoint">Endpoint URL</label>
                    <input id="${p}-ig-endpoint" class="ctz-input"
                           value="${_esc(ig.endpoint ?? '')}"
                           placeholder="https://…" />
                </div>
                <div class="ctz-form-row">
                    <label class="ctz-label" for="${p}-ig-template">Prompt Template</label>
                    <textarea id="${p}-ig-template" class="ctz-input ctz-textarea"
                              rows="3">${_esc(tmpl)}</textarea>
                    <small class="ctz-hint">Use <code>{{prompt}}</code> as placeholder.</small>
                </div>
            </section>

            <section class="ctz-section">
                <h3 class="ctz-section-title">Sessions</h3>
                <div class="ctz-form-row">
                    <label class="ctz-label" for="${p}-autosave">Autosave</label>
                    <input type="checkbox" id="${p}-autosave" class="ctz-checkbox"
                           ${sess.autosave !== false ? 'checked' : ''} />
                </div>
                <div class="ctz-form-row">
                    <label class="ctz-label" for="${p}-max-saved">Max saved sessions</label>
                    <input type="number" id="${p}-max-saved" class="ctz-input ctz-input-sm"
                           value="${sess.max_saved ?? 50}" min="1" max="500" />
                </div>
            </section>

            <section class="ctz-section">
                <h3 class="ctz-section-title">Diagnostics</h3>
                <div class="ctz-form-row">
                    <label class="ctz-label" for="${p}-verbose">Verbose logging</label>
                    <input type="checkbox" id="${p}-verbose" class="ctz-checkbox"
                           ${isVerbose() ? 'checked' : ''} />
                </div>
            </section>

            <section class="ctz-section">
                <h3 class="ctz-section-title">Forge Profile</h3>
                <div class="ctz-form-row">
                    <label class="ctz-label">Permasave (restore target)</label>
                    <span class="ctz-muted">
                        ${_esc(s.permasave_profile ?? '—')}
                    </span>
                </div>
            </section>
        </div>
    `;
}

// ─── Wiring ───────────────────────────────────────────────────────────────────

function _wire(container, p) {
    const s = () => extension_settings[CTZ_EXT_NAME];

    const engineSel   = container.querySelector(`#${p}-ig-engine`);
    const endpointRow = container.querySelector(`#${p}-ig-endpoint-row`);
    const endpointIn  = container.querySelector(`#${p}-ig-endpoint`);
    const templateTA  = container.querySelector(`#${p}-ig-template`);
    const autosaveCb  = container.querySelector(`#${p}-autosave`);
    const maxSavedIn  = container.querySelector(`#${p}-max-saved`);
    const verboseCb   = container.querySelector(`#${p}-verbose`);

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