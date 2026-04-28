/**
 * @file data/default-user/extensions/characteryze/portrait-panel.js
 * @stamp {"utc":"2026-04-28T00:00:00.000Z"}
 * @version 1.0.0
 * @architectural-role IO — Portrait Studio Panel
 * @description
 * Standalone Portrait Studio tab. Allows prompt entry (typed or loaded from
 * the current session's scraped blocks), direct Pollinations generation,
 * preview, and character attachment — without needing to go through the
 * full Workbench flow.
 *
 * Does not hold persistent state. Preview object URL is local to the panel
 * lifetime and is revoked on discard or commit.
 *
 * @api-declaration
 * mountPanel(container) — mount panel HTML into container
 * refreshPanel()        — re-derive block list and re-render
 *
 * @contract
 *   assertions:
 *     purity: IO
 *     state_ownership: [_previewUrl]
 *     external_io: [DOM, portrait-studio calls, scraper, extension_settings read,
 *                   SillyTavern context, toastr]
 */

import { log, error }                              from './log.js';
import { generatePortrait, commitPortrait, revokePreview } from './portrait-studio.js';
import { getSessionBlocks }                        from './scraper.js';
import { getWorkspace }                            from './session-manager.js';
import { extension_settings }                      from '../../../extensions.js';
import { CTZ_EXT_NAME }                            from './defaults.js';

const TAG = 'PortraitPanel';

let _container  = null;
let _previewUrl = null;

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
    const blocks = getSessionBlocks();
    const ws     = getWorkspace();

    // Harvest portrait-prompt blocks for the quick-load list
    const portraitBlocks = blocks.filter(b =>
        b.lang === 'portrait-prompt' || b.lang === 'portrait',
    );

    const ctx         = SillyTavern.getContext();
    const charOptions = ctx.characters.map(c =>
        `<option value="${_esc(c.avatar)}">${_esc(c.name)}</option>`,
    ).join('');

    const blockItems = portraitBlocks.length
        ? portraitBlocks.map(b => `
            <div class="ctz-block-item ctz-portrait-block" data-id="${_esc(b.id)}"
                 data-content="${_esc(b.content)}">
                <span class="ctz-block-lang">portrait-prompt</span>
                <span class="ctz-block-preview">${_esc(b.content.slice(0, 60))}…</span>
            </div>`).join('')
        : '<p class="ctz-muted">No portrait-prompt blocks in current session.</p>';

    _container.innerHTML = `
        <div class="ctz-portrait-panel">
            <section class="ctz-section">
                <h3 class="ctz-section-title">Portrait Studio</h3>
                <p class="ctz-muted" style="font-size:12px;margin-bottom:8px;">
                    Generate a character portrait. Click a block to load its prompt,
                    or type directly.
                </p>
            </section>

            <section class="ctz-section">
                <h3 class="ctz-section-title">Session Blocks</h3>
                <div class="ctz-block-list" style="max-height:120px;">${blockItems}</div>
            </section>

            <section class="ctz-section">
                <h3 class="ctz-section-title">Prompt</h3>
                <textarea id="ctz-portrait-prompt-input"
                          class="ctz-input ctz-textarea"
                          rows="4"
                          placeholder="Describe the character's appearance…"></textarea>
                <div style="display:flex;gap:8px;margin-top:6px;">
                    <button id="ctz-portrait-gen-btn" class="ctz-btn ctz-btn-primary">
                        Generate
                    </button>
                    <button id="ctz-portrait-discard-btn" class="ctz-btn ctz-btn-sm">
                        Discard Preview
                    </button>
                </div>
            </section>

            <section class="ctz-section" id="ctz-portrait-preview-section"
                     style="${_previewUrl ? '' : 'display:none'}">
                <h3 class="ctz-section-title">Preview</h3>
                <div style="display:flex;align-items:flex-start;gap:16px;">
                    <img id="ctz-portrait-preview-img"
                         src="${_previewUrl ?? ''}"
                         alt="Portrait preview"
                         style="width:200px;height:200px;object-fit:cover;
                                border-radius:6px;border:1px solid var(--ctz-border);" />
                    <div style="display:flex;flex-direction:column;gap:8px;">
                        <div class="ctz-form-row">
                            <label class="ctz-label" for="ctz-portrait-target">Attach to</label>
                            <select id="ctz-portrait-target" class="ctz-select">
                                <option value="">— select character —</option>
                                ${charOptions}
                            </select>
                        </div>
                        <button id="ctz-portrait-commit-btn" class="ctz-btn ctz-btn-primary">
                            Attach to Character
                        </button>
                    </div>
                </div>
            </section>
        </div>
    `;

    _wire();
}

// ─── Wiring ───────────────────────────────────────────────────────────────────

function _wire() {
    const promptInput    = _container.querySelector('#ctz-portrait-prompt-input');
    const genBtn         = _container.querySelector('#ctz-portrait-gen-btn');
    const discardBtn     = _container.querySelector('#ctz-portrait-discard-btn');
    const commitBtn      = _container.querySelector('#ctz-portrait-commit-btn');
    const previewSection = _container.querySelector('#ctz-portrait-preview-section');
    const previewImg     = _container.querySelector('#ctz-portrait-preview-img');

    // Load block content into prompt textarea
    _container.querySelectorAll('.ctz-portrait-block').forEach(item => {
        item.addEventListener('click', () => {
            if (promptInput) promptInput.value = item.dataset.content ?? '';
        });
    });

    // Generate
    genBtn?.addEventListener('click', async () => {
        const prompt = promptInput?.value.trim();
        if (!prompt) { toastr.warning('Enter a portrait prompt first.'); return; }

        genBtn.disabled = true;
        genBtn.textContent = 'Generating…';
        try {
            if (_previewUrl) revokePreview(_previewUrl);
            const imgSettings = extension_settings[CTZ_EXT_NAME]?.image_gen ?? {};
            _previewUrl = await generatePortrait(prompt, imgSettings);
            if (previewImg)     previewImg.src = _previewUrl;
            if (previewSection) previewSection.style.display = '';
            log(TAG, 'Portrait generated');
        } catch (err) {
            error(TAG, 'Generation failed', err);
            toastr.error('Portrait generation failed.');
        } finally {
            genBtn.disabled    = false;
            genBtn.textContent = 'Generate';
        }
    });

    // Discard
    discardBtn?.addEventListener('click', () => {
        if (_previewUrl) {
            revokePreview(_previewUrl);
            _previewUrl = null;
        }
        if (previewSection) previewSection.style.display = 'none';
        if (previewImg)     previewImg.src = '';
        log(TAG, 'Preview discarded');
    });

    // Commit — attach to character
    commitBtn?.addEventListener('click', async () => {
        if (!_previewUrl) { toastr.warning('No preview to attach.'); return; }
        const targetSelect = _container.querySelector('#ctz-portrait-target');
        const avatarFile   = targetSelect?.value;
        if (!avatarFile) { toastr.warning('Select a character to attach to.'); return; }

        commitBtn.disabled    = true;
        commitBtn.textContent = 'Attaching…';
        try {
            await commitPortrait(_previewUrl, avatarFile);
            revokePreview(_previewUrl);
            _previewUrl = null;
            if (previewSection) previewSection.style.display = 'none';
            toastr.success('Portrait attached to character.');
            log(TAG, 'Portrait committed to', avatarFile);
        } catch (err) {
            error(TAG, 'Commit failed', err);
            toastr.error('Failed to attach portrait.');
        } finally {
            commitBtn.disabled    = false;
            commitBtn.textContent = 'Attach to Character';
        }
    });
}

function _esc(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}
