/**
 * @file data/default-user/extensions/characteryze/settings-panel.js
 * @stamp {"utc":"2026-04-29T11:45:00.000Z"}
 * @version 1.4.0
 * @architectural-role IO — Settings Panel UI
 * @description
 * Renders the Settings tab. Manages image generation configuration (model selection,
 * prompt templates, and secure API vault storage), connection testing,
 * and LLM engine selection via the Connection Manager.
 *
 * @api-declaration
 * mountPanel(container) — inject settings HTML into container and wire inputs
 *
 * @contract
 *   assertions:
 *     purity: IO
 *     state_ownership: []
 *     external_io: [DOM, extension_settings write, saveSettingsDebounced, 
 *                   writeSecret, secret_state, generatePortrait, ConnectionManagerRequestService]
 */

import { extension_settings }    from '../../../extensions.js';
import { saveSettingsDebounced } from '../../../../script.js';
import { writeSecret, secret_state } from '../../../secrets.js';
import { log, error }                                 from './log.js';
import { activateTab }                               from './tab-bar.js';
import { setVerbose, isVerbose }                      from './log.js';
import { generatePortrait, revokePreview }            from './portrait-studio.js';
import { 
    CTZ_EXT_NAME, 
    CTZ_HOST_CHAR_NAME, 
    POLLINATIONS_SECRET_KEY_NAME,
    POLLINATIONS_MODELS,
    DEFAULT_PORTRAIT_PROMPT_TEMPLATE 
} from './defaults.js';
import { ConnectionManagerRequestService } from '../../shared.js';

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
    _updateKeyStatus(container, idPrefix);
    log(TAG, 'Mounted', idPrefix);
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function _buildHTML(p) {
    const s      = extension_settings[CTZ_EXT_NAME] ?? {};
    const ig     = s.image_gen   ?? {};
    const sess   = s.sessions    ?? {};
    const tmpl   = ig.prompt_template ?? DEFAULT_PORTRAIT_PROMPT_TEMPLATE;
    const currentModel = ig.model ?? 'flux';

    const modelOptions = POLLINATIONS_MODELS.map(m => 
        `<option value="${_esc(m)}" ${m === currentModel ? 'selected' : ''}>${_esc(m)}</option>`
    ).join('');

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
                <h3 class="ctz-section-title">Image Generation (Pollinations)</h3>
                <div class="ctz-form-row">
                    <label class="ctz-label">API Key Vault</label>
                    <input type="password" id="${p}-pollinations-key" class="ctz-input" placeholder="Paste sk_... key" />
                    <button id="${p}-pollinations-save" class="ctz-btn ctz-btn-sm">Save to Vault</button>
                </div>
                <div id="${p}-key-status" class="ctz-hint" style="margin-left: 140px; margin-bottom: 10px;">
                    Checking vault...
                </div>

                <div class="ctz-form-row">
                    <label class="ctz-label">Diagnostics</label>
                    <button id="${p}-test-connection" class="ctz-btn ctz-btn-sm">Test Connection</button>
                    <span id="${p}-test-status" class="ctz-hint"></span>
                </div>

                <div class="ctz-form-row">
                    <label class="ctz-label" for="${p}-image-model">Image Model</label>
                    <select id="${p}-image-model" class="ctz-select">
                        ${modelOptions}
                    </select>
                </div>

                <div class="ctz-form-row">
                    <label class="ctz-label" for="${p}-dev-mode">Dev Mode</label>
                    <input type="checkbox" id="${p}-dev-mode" class="ctz-checkbox" ${s.devMode ? 'checked' : ''} />
                    <span class="ctz-hint">Generate low-res previews (saves credits)</span>
                </div>

                <div class="ctz-form-row">
                    <label class="ctz-label" for="${p}-ig-template">Prompt Template</label>
                    <textarea id="${p}-ig-template" class="ctz-input ctz-textarea"
                              rows="3">${_esc(tmpl)}</textarea>
                </div>
            </section>

            <section class="ctz-section">
                <h3 class="ctz-section-title">Forge Engine</h3>
                <div class="ctz-form-row">
                    <label class="ctz-label" for="${p}-forge-engine">Active Engine</label>
                    <select id="${p}-forge-engine" class="ctz-select"></select>
                </div>
                <div class="ctz-form-row">
                    <label class="ctz-label">Permasave Target</label>
                    <span class="ctz-muted">${_esc(s.permasave_profile ?? '—')}</span>
                </div>
            </section>

            <section class="ctz-section">
                <h3 class="ctz-section-title">Sessions & UI</h3>
                <div class="ctz-form-row">
                    <label class="ctz-label" for="${p}-autosave">Autosave</label>
                    <input type="checkbox" id="${p}-autosave" class="ctz-checkbox"
                           ${sess.autosave !== false ? 'checked' : ''} />
                </div>
                <div class="ctz-form-row">
                    <label class="ctz-label" for="${p}-max-saved">Max sessions</label>
                    <input type="number" id="${p}-max-saved" class="ctz-input ctz-input-sm"
                           value="${sess.max_saved ?? 50}" min="1" max="500" />
                </div>
                <div class="ctz-form-row">
                    <label class="ctz-label" for="${p}-verbose">Verbose logging</label>
                    <input type="checkbox" id="${p}-verbose" class="ctz-checkbox"
                           ${isVerbose() ? 'checked' : ''} />
                </div>
            </section>
            <button class="ctz-dismiss-handle" title="Return to chat">▲ Return to Chat</button>
        </div>
    `;
}

// ─── Wiring ───────────────────────────────────────────────────────────────────

function _wire(container, p) {
    container.querySelector('.ctz-dismiss-handle')
        ?.addEventListener('click', () => activateTab('forge'));
    const s = () => extension_settings[CTZ_EXT_NAME];

    // Image Gen Inputs
    container.querySelector(`#${p}-ig-template`)?.addEventListener('input', (e) => {
        s().image_gen.prompt_template = e.target.value;
        saveSettingsDebounced();
    });

    container.querySelector(`#${p}-image-model`)?.addEventListener('change', (e) => {
        s().image_gen.model = e.target.value;
        saveSettingsDebounced();
        log(TAG, 'Image model updated:', e.target.value);
    });

    container.querySelector(`#${p}-dev-mode`)?.addEventListener('change', (e) => {
        s().devMode = e.target.checked;
        saveSettingsDebounced();
    });

    // Vault Logic
    const keyInput = container.querySelector(`#${p}-pollinations-key`);
    container.querySelector(`#${p}-pollinations-save`)?.addEventListener('click', async () => {
        const val = keyInput.value.trim();
        if (!val) return;
        await writeSecret(POLLINATIONS_SECRET_KEY_NAME, val, 'Characteryze: Pollinations');
        keyInput.value = '';
        _updateKeyStatus(container, p);
        toastr.success('Pollinations key saved to vault.');
    });

    // Test Connection
    const testBtn = container.querySelector(`#${p}-test-connection`);
    const testStatus = container.querySelector(`#${p}-test-status`);
    testBtn?.addEventListener('click', async () => {
        testBtn.disabled = true;
        testStatus.textContent = 'Generating test portrait...';
        let previewUrl = null;
        try {
            previewUrl = await generatePortrait('A noble knight in shining armor', s());
            testStatus.innerHTML = '<span style="color:var(--ctz-success)">Connected!</span>';
            log(TAG, 'Test connection successful');
        } catch (err) {
            testStatus.innerHTML = `<span style="color:var(--ctz-danger)">Failed: ${err.message}</span>`;
            error(TAG, 'Test connection failed', err);
        } finally {
            testBtn.disabled = false;
            if (previewUrl) setTimeout(() => revokePreview(previewUrl), 5000);
        }
    });

    // Sessions & UI
    container.querySelector(`#${p}-autosave`)?.addEventListener('change', (e) => {
        s().sessions.autosave = e.target.checked;
        saveSettingsDebounced();
    });

    container.querySelector(`#${p}-max-saved`)?.addEventListener('change', (e) => {
        const val = parseInt(e.target.value, 10);
        if (!isNaN(val) && val > 0) {
            s().sessions.max_saved = val;
            saveSettingsDebounced();
        }
    });

    container.querySelector(`#${p}-verbose`)?.addEventListener('change', (e) => {
        setVerbose(e.target.checked);
        s().verbose = e.target.checked;
        saveSettingsDebounced();
    });

    // Forge Engine Selector
    try {
        ConnectionManagerRequestService.handleDropdown(
            `#${p}-forge-engine`,
            s().forge_profile_id ?? '',
            (profile) => {
                s().forge_profile_id = profile?.id ?? null;
                saveSettingsDebounced();
                log(TAG, 'Forge Engine updated:', profile?.name);
            },
        );
    } catch (err) {
        log(TAG, 'ConnectionManager failure:', err);
    }
}

function _updateKeyStatus(container, p) {
    const statusEl = container.querySelector(`#${p}-key-status`);
    if (!statusEl) return;

    const state = secret_state[POLLINATIONS_SECRET_KEY_NAME];
    if (Array.isArray(state) && state.length > 0) {
        statusEl.innerHTML = `<span style="color:var(--ctz-success)">● Configured (Saved in Vault)</span>`;
    } else {
        statusEl.innerHTML = `<span style="color:var(--ctz-danger)">○ Not Configured</span>`;
    }
}

function _esc(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}