/**
 * @file data/default-user/extensions/characteryze/settings-panel.js
 * @stamp {"utc":"2026-05-04T13:35:00.000Z"}
 * @version 2.1.0
 * @architectural-role IO — Settings Panel UI
 * @description
 * Renders the Settings tab. Manages image generation (Pollinations) and
 * Forge Engine/Preset selection.
 *
 * This version adds the "Forge Preset" selector to ensure the Forge 
 * environment uses a clean Chat Completion profile.
 *
 * @api-declaration
 * mountPanel(container, idPrefix) — inject settings HTML and wire inputs
 *
 * @contract
 *   assertions:
 *     purity: IO
 *     state_ownership: []
 *     external_io: [DOM, extension_settings write, saveSettingsDebounced, 
 *                   writeSecret, secret_state, ConnectionManagerRequestService,
 *                   openai_setting_names read]
 */

import { extension_settings }    from '../../../extensions.js';
import { saveSettingsDebounced } from '../../../../script.js';
import { writeSecret, secret_state } from '../../../secrets.js';
import { log, error, setVerbose, isVerbose } from './log.js';
import { activateTab }                       from './tab-bar.js';
import { generatePortrait, revokePreview }   from './portrait-studio.js';
import { 
    CTZ_EXT_NAME, 
    CTZ_HOST_CHAR_NAME, 
    POLLINATIONS_SECRET_KEY_NAME,
    POLLINATIONS_MODELS,
    DEFAULT_PORTRAIT_PROMPT_TEMPLATE 
} from './defaults.js';
import { ConnectionManagerRequestService } from '../../shared.js';
import { openai_setting_names }            from '../../../../scripts/openai.js';

const TAG = 'Settings';

// ─── Mount ────────────────────────────────────────────────────────────────────

export function mountPanel(container, idPrefix = 'ctz') {
    container.innerHTML = _buildHTML(idPrefix);
    _wire(container, idPrefix);
    _updateKeyStatus(container, idPrefix);
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function _buildHTML(p) {
    const s      = extension_settings[CTZ_EXT_NAME] ?? {};
    const ig     = s.image_gen   ?? {};
    const sess   = s.sessions    ?? {};
    const tmpl   = ig.prompt_template ?? DEFAULT_PORTRAIT_PROMPT_TEMPLATE;
    const currentModel = ig.model ?? 'flux';
    const currentPreset = s.forge_preset_name ?? 'Default';
    const isDrawer = p === 'ctzd';

    const modelOptions = POLLINATIONS_MODELS.map(m => 
        `<option value="${_esc(m)}" ${m === currentModel ? 'selected' : ''}>${_esc(m)}</option>`
    ).join('');

    const presetOptions = Object.keys(openai_setting_names || {})
        .map(n => `<option value="${_esc(n)}" ${n === currentPreset ? 'selected' : ''}>${_esc(n)}</option>`)
        .join('');

    // Instructions: Only for the Drawer
    const guide = isDrawer ? `
        <div class="ctz-section" style="background: var(--ctz-surface); padding: 12px; border-radius: var(--ctz-radius); border: 1px solid var(--ctz-accent); margin-bottom: 12px;">
            <h3 class="ctz-section-title" style="color: var(--ctz-accent);">Required Setup</h3>
            <div style="font-size: 12px; line-height: 1.4;">
                1. Create a character named <strong>${_esc(CTZ_HOST_CHAR_NAME)}</strong>.<br/>
                2. Create a connection profile for brainstorming (e.g., "Forge Engine") and select it below.
            </div>
        </div>
    ` : '';

    // Section Wrapper Helper: Collapsible detail blocks for drawer, simple sections for sidebar
    const wrap = (title, content) => {
        if (isDrawer) {
            return `
                <details class="ctz-settings-detail">
                    <summary class="ctz-section-title">${_esc(title)}</summary>
                    <div class="ctz-detail-content">${content}</div>
                </details>`;
        }
        return `<section class="ctz-section"><h3 class="ctz-section-title">${_esc(title)}</h3>${content}</section>`;
    };

    return `
        <div class="ctz-settings-panel">
            ${guide}

            ${wrap('Forge Environment', `
                <div class="ctz-form-row">
                    <label class="ctz-label" for="${p}-forge-engine">Forge Engine</label>
                    <select id="${p}-forge-engine" class="ctz-select"></select>
                </div>
                <div class="ctz-form-row">
                    <label class="ctz-label" for="${p}-forge-preset">Forge Preset</label>
                    <select id="${p}-forge-preset" class="ctz-select">
                        ${presetOptions}
                    </select>
                </div>
                <div class="ctz-form-row">
                    <label class="ctz-label">Permasave Engine</label>
                    <span class="ctz-muted">${_esc(s.permasave_profile ?? '—')}</span>
                </div>
                <div class="ctz-form-row">
                    <label class="ctz-label">Permasave Preset</label>
                    <span class="ctz-muted">${_esc(s.permasave_preset ?? '—')}</span>
                </div>
            `)}

            ${wrap('Image Generation (Pollinations)', `
                <div class="ctz-form-row">
                    <label class="ctz-label">API Key Vault</label>
                    <input type="password" id="${p}-pollinations-key" class="ctz-input" placeholder="sk_..." />
                    <button id="${p}-pollinations-save" class="ctz-btn ctz-btn-sm">Save</button>
                </div>
                <div id="${p}-key-status" class="ctz-hint" style="margin-bottom: 10px;">Checking vault...</div>

                <div class="ctz-form-row">
                    <label class="ctz-label">Diagnostics</label>
                    <button id="${p}-test-connection" class="ctz-btn ctz-btn-sm">Test Connection</button>
                    <span id="${p}-test-status" class="ctz-hint"></span>
                </div>

                <div class="ctz-form-row">
                    <label class="ctz-label" for="${p}-image-model">Model</label>
                    <select id="${p}-image-model" class="ctz-select">${modelOptions}</select>
                </div>

                <div class="ctz-form-row">
                    <label class="ctz-label" for="${p}-ig-template">Template</label>
                    <textarea id="${p}-ig-template" class="ctz-input ctz-textarea" rows="2">${_esc(tmpl)}</textarea>
                </div>
            `)}

            ${wrap('UI & Sessions', `
                <div class="ctz-form-row">
                    <label class="ctz-label">Autosave</label>
                    <input type="checkbox" id="${p}-autosave" class="ctz-checkbox" ${sess.autosave !== false ? 'checked' : ''} />
                </div>
                <div class="ctz-form-row">
                    <label class="ctz-label">Max sessions</label>
                    <input type="number" id="${p}-max-saved" class="ctz-input ctz-input-sm" value="${sess.max_saved ?? 50}" />
                </div>
                <div class="ctz-form-row">
                    <label class="ctz-label">Verbose logs</label>
                    <input type="checkbox" id="${p}-verbose" class="ctz-checkbox" ${isVerbose() ? 'checked' : ''} />
                </div>
            `)}

            ${isDrawer ? '' : '<button class="ctz-dismiss-handle">▲ Return to Chat</button>'}
        </div>
    `;
}

// ─── Wiring ───────────────────────────────────────────────────────────────────

function _wire(container, p) {
    const s = () => extension_settings[CTZ_EXT_NAME];

    container.querySelector('.ctz-dismiss-handle')?.addEventListener('click', () => activateTab('forge'));

    container.querySelector(`#${p}-ig-template`)?.addEventListener('input', (e) => {
        s().image_gen.prompt_template = e.target.value;
        saveSettingsDebounced();
    });

    container.querySelector(`#${p}-image-model`)?.addEventListener('change', (e) => {
        s().image_gen.model = e.target.value;
        saveSettingsDebounced();
    });

    container.querySelector(`#${p}-forge-preset`)?.addEventListener('change', (e) => {
        s().forge_preset_name = e.target.value;
        saveSettingsDebounced();
    });

    const keyInput = container.querySelector(`#${p}-pollinations-key`);
    container.querySelector(`#${p}-pollinations-save`)?.addEventListener('click', async () => {
        const val = keyInput.value.trim();
        if (!val) return;
        await writeSecret(POLLINATIONS_SECRET_KEY_NAME, val, 'Characteryze: Pollinations');
        keyInput.value = '';
        _updateKeyStatus(container, p);
        toastr.success('Key saved to vault.');
    });

    const testBtn = container.querySelector(`#${p}-test-connection`);
    const testStatus = container.querySelector(`#${p}-test-status`);
    testBtn?.addEventListener('click', async () => {
        testBtn.disabled = true;
        testStatus.textContent = 'Generating test...';
        let previewUrl = null;
        try {
            previewUrl = await generatePortrait('A noble knight', s());
            testStatus.innerHTML = '<span style="color:var(--ctz-success)">Connected!</span>';
        } catch (err) {
            testStatus.innerHTML = `<span style="color:var(--ctz-danger)">Error: ${err.message}</span>`;
        } finally {
            testBtn.disabled = false;
            if (previewUrl) setTimeout(() => revokePreview(previewUrl), 5000);
        }
    });

    container.querySelector(`#${p}-autosave`)?.addEventListener('change', (e) => {
        s().sessions.autosave = e.target.checked;
        saveSettingsDebounced();
    });

    container.querySelector(`#${p}-max-saved`)?.addEventListener('change', (e) => {
        const val = parseInt(e.target.value, 10);
        if (!isNaN(val) && val > 0) { s().sessions.max_saved = val; saveSettingsDebounced(); }
    });

    container.querySelector(`#${p}-verbose`)?.addEventListener('change', (e) => {
        setVerbose(e.target.checked);
        s().verbose = e.target.checked;
        saveSettingsDebounced();
    });

    try {
        ConnectionManagerRequestService.handleDropdown(`#${p}-forge-engine`, s().forge_profile_id ?? '', (profile) => {
            s().forge_profile_id = profile?.id ?? null;
            saveSettingsDebounced();
        });
    } catch (err) { log(TAG, 'ConnectionManager failure:', err); }
}

function _updateKeyStatus(container, p) {
    const statusEl = container.querySelector(`#${p}-key-status`);
    if (!statusEl) return;
    const state = secret_state[POLLINATIONS_SECRET_KEY_NAME];
    const isConfigured = Array.isArray(state) && state.length > 0;
    statusEl.innerHTML = `<span style="color:var(--ctz-${isConfigured ? 'success' : 'danger'})">
        ${isConfigured ? '● Configured' : '○ Not Configured'}
    </span>`;
}

function _esc(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}