/**
 * @file data/default-user/extensions/characteryze/workbench-panel.js
 * @stamp {"utc":"2026-04-28T00:00:00.000Z"}
 * @version 1.0.0
 * @architectural-role IO — Workbench Diff UI
 * @description
 * Implements the two-pane diff workbench. Left pane: live state (read-only).
 * Right pane: draft state (editable). Source navigator lists scraped codeblocks.
 * Stage action marks a field dirty. Commit pushes all staged fields to disk.
 *
 * Follows the Vistalyze diff pattern exactly: same two-pane layout, stage
 * action, dirty-field tracking, and commit action via ST native save functions.
 *
 * Portrait field detection: if the selected field is "portrait", commit
 * delegates to portrait-studio.js instead of field-mapper.
 *
 * @api-declaration
 * mountPanel(container, deps) — mount panel; deps provides { getWorkspace }
 * refreshPanel()              — re-derive blocks and re-render
 *
 * @contract
 *   assertions:
 *     purity: IO
 *     state_ownership: [_previewUrl]
 *     external_io: [DOM, scraper, field-mapper, portrait-studio,
 *                   session-manager draft state, toastr]
 */

import { log, error }                     from './log.js';
import { getSessionBlocks }               from './scraper.js';
import { getFieldList, getLiveValue, commitDraftState } from './field-mapper.js';
import { generatePortrait, commitPortrait, revokePreview } from './portrait-studio.js';
import {
    getWorkspace,
    getDraftState,
    setDraftField,
    clearDraftState,
} from './session-manager.js';
import { extension_settings }             from '../../../extensions.js';
import { CTZ_EXT_NAME }                   from './defaults.js';

const TAG = 'Workbench';

let _container   = null;
let _previewUrl  = null;   // portrait preview object URL, if any
let _stageTimer  = null;   // debounce handle for auto-staging

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
    const ws        = getWorkspace();
    const blocks    = getSessionBlocks();
    const fields    = getFieldList(ws.canvas_type);
    const draft     = ws.filename ? getDraftState(ws.filename) : {};
    const dirtyKeys = Object.keys(draft);

    _container.innerHTML = _buildHTML(ws, blocks, fields, draft, dirtyKeys);
    _wire(ws, blocks, fields);
}

function _buildHTML(ws, blocks, fields, draft, dirtyKeys) {
    const blockItems = blocks.length
        ? blocks.map(b => `
            <div class="ctz-block-item" data-id="${_esc(b.id)}"
                 title="msg ${b.msgIndex} · ${b.ts ?? ''}">
                <span class="ctz-block-lang">${_esc(b.lang || 'text')}</span>
                <span class="ctz-block-preview">${_esc(b.content.slice(0, 60))}…</span>
            </div>`).join('')
        : '<p class="ctz-muted">No codeblocks in this session yet.</p>';

    const fieldOptions = fields.map(f => {
        const dirty = dirtyKeys.includes(f.id);
        return `<option value="${_esc(f.id)}" ${dirty ? 'data-dirty="1"' : ''}>
            ${_esc(f.label)}${dirty ? ' ●' : ''}
        </option>`;
    }).join('');

    const firstField  = fields[0]?.id ?? '';
    const liveText    = firstField ? (getLiveValue(ws.canvas_type, firstField, ws.target) ?? '') : '';
    const draftText   = draft[firstField] ?? '';

    return `
        <div class="ctz-workbench">
            <div class="ctz-wb-sidebar">
                <h4 class="ctz-section-title">Blocks</h4>
                <div class="ctz-block-list" id="ctz-block-list">${blockItems}</div>
                <button id="ctz-wb-refresh-btn" class="ctz-btn ctz-btn-sm">↺ Refresh</button>
            </div>

            <div class="ctz-wb-main">
                <div class="ctz-wb-toolbar">
                    <select id="ctz-field-select" class="ctz-select">${fieldOptions}</select>
                    <button id="ctz-commit-btn" class="ctz-btn ctz-btn-primary"
                            ${dirtyKeys.length === 0 ? 'disabled' : ''}>
                        Commit (${dirtyKeys.length})
                    </button>
                </div>

                <div class="ctz-diff-panes">
                    <div class="ctz-pane ctz-pane-live">
                        <div class="ctz-pane-header">Live State</div>
                        <textarea class="ctz-pane-text" id="ctz-live-pane"
                                  readonly>${_esc(liveText)}</textarea>
                    </div>
                    <div class="ctz-pane ctz-pane-draft">
                        <div class="ctz-pane-header">Draft</div>
                        <textarea class="ctz-pane-text" id="ctz-draft-pane">${_esc(draftText)}</textarea>
                    </div>
                </div>

                <div id="ctz-portrait-preview-area" class="ctz-portrait-preview ctz-hidden">
                    <img id="ctz-portrait-img" src="" alt="Portrait preview" />
                    <button id="ctz-gen-portrait-btn" class="ctz-btn ctz-btn-sm">Generate Image</button>
                </div>
            </div>
        </div>
    `;
}

// ─── Wiring ───────────────────────────────────────────────────────────────────

function _wire(ws, blocks, fields) {
    const fieldSelect  = _container.querySelector('#ctz-field-select');
    const livePane     = _container.querySelector('#ctz-live-pane');
    const draftPane    = _container.querySelector('#ctz-draft-pane');
    const commitBtn    = _container.querySelector('#ctz-commit-btn');
    const refreshBtn   = _container.querySelector('#ctz-wb-refresh-btn');
    const portraitArea = _container.querySelector('#ctz-portrait-preview-area');
    const genBtn       = _container.querySelector('#ctz-gen-portrait-btn');

    // Clicking a block loads it into the draft pane
    _container.querySelectorAll('.ctz-block-item').forEach(item => {
        item.addEventListener('click', () => {
            const block = blocks.find(b => b.id === item.dataset.id);
            if (block && draftPane) draftPane.value = block.content;
        });
    });

    // Field selection updates live pane and portrait area visibility
    fieldSelect?.addEventListener('change', () => {
        clearTimeout(_stageTimer);   // discard any pending stage for the old field
        const fieldId = fieldSelect.value;
        const live    = getLiveValue(ws.canvas_type, fieldId, ws.target) ?? '';
        const draft   = ws.filename ? getDraftState(ws.filename) : {};
        if (livePane)  livePane.value  = live;
        if (draftPane) draftPane.value = draft[fieldId] ?? '';
        _togglePortraitArea(fieldId, portraitArea);
    });

    _togglePortraitArea(fields[0]?.id ?? '', portraitArea);

    // Auto-stage: debounce draft pane input by 300 ms
    draftPane?.addEventListener('input', () => {
        clearTimeout(_stageTimer);
        const fieldId = fieldSelect?.value;   // capture now, not when timer fires
        if (!ws.filename || !fieldId) return;
        _stageTimer = setTimeout(() => {
            const value = draftPane.value;
            setDraftField(ws.filename, fieldId, value);

            // Partial DOM update — avoid full _render() which resets textarea state
            const draft      = getDraftState(ws.filename);
            const dirtyCount = Object.keys(draft).length;
            if (commitBtn) {
                commitBtn.disabled   = dirtyCount === 0;
                commitBtn.textContent = `Commit (${dirtyCount})`;
            }
            // Update dirty marker on the currently-selected option
            const opt = fieldSelect?.querySelector(`option[value="${CSS.escape(fieldId)}"]`);
            if (opt) {
                opt.dataset.dirty   = '1';
                opt.textContent     = opt.textContent.endsWith(' ●')
                    ? opt.textContent
                    : opt.textContent.trimEnd() + ' ●';
            }
            log(TAG, 'Auto-staged field:', fieldId);
        }, 300);
    });

    // Refresh blocks from live session
    refreshBtn?.addEventListener('click', () => {
        _render();
        log(TAG, 'Blocks refreshed');
    });

    // Commit all staged fields
    commitBtn?.addEventListener('click', async () => {
        if (!ws.filename) return;
        const draft = getDraftState(ws.filename);
        try {
            await _commitAll(ws, draft);
            clearDraftState(ws.filename);
            toastr.success('Workbench committed.');
            _render();
        } catch (err) {
            error(TAG, 'Commit failed', err);
            toastr.error('Commit failed — see console.');
        }
    });

    // Portrait generation
    genBtn?.addEventListener('click', async () => {
        const prompt = draftPane?.value?.trim();
        if (!prompt) { toastr.warning('No prompt text in draft pane.'); return; }
        try {
            if (_previewUrl) revokePreview(_previewUrl);
            const imgSettings = extension_settings[CTZ_EXT_NAME]?.image_gen ?? {};
            _previewUrl = await generatePortrait(prompt, imgSettings);
            const img = _container.querySelector('#ctz-portrait-img');
            if (img) img.src = _previewUrl;
            log(TAG, 'Portrait preview generated');
        } catch (err) {
            error(TAG, 'Portrait generation failed', err);
            toastr.error('Image generation failed.');
        }
    });
}

// ─── Commit dispatch ──────────────────────────────────────────────────────────

async function _commitAll(ws, draft) {
    const portraitDraft = draft.portrait;
    const restDraft     = Object.fromEntries(
        Object.entries(draft).filter(([k]) => k !== 'portrait'),
    );

    if (Object.keys(restDraft).length > 0) {
        await commitDraftState(ws.canvas_type, ws.target, restDraft);
    }

    if (portraitDraft && ws.target) {
        if (_previewUrl) {
            await commitPortrait(_previewUrl, ws.target);
            revokePreview(_previewUrl);
            _previewUrl = null;
        } else {
            log(TAG, 'Portrait field staged but no preview generated — skipping image commit');
        }
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _togglePortraitArea(fieldId, area) {
    if (!area) return;
    area.classList.toggle('ctz-hidden', fieldId !== 'portrait');
}

function _esc(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}
