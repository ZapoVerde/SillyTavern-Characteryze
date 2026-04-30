/**
 * @file data/default-user/extensions/characteryze/workbench-panel.js
 * @stamp {"utc":"2026-04-29T14:30:00.000Z"}
 * @version 1.1.0
 * @architectural-role IO — Workbench Diff UI
 * @description
 * Implements the two-pane diff workbench. Left pane: live state (read-only).
 * Right pane: draft state (editable). Source navigator lists scraped codeblocks.
 * Stage action marks a field dirty. Commit pushes all staged fields to disk.
 *
 * Refactored for Librarian Workbench (Phase 2): Rulesets now feature a 
 * target-selection dropdown within the toolbar, allowing multi-document 
 * editing within a single Forge session.
 *
 * @api-declaration
 * mountPanel(container, deps) — mount panel; deps provides { getWorkspace }
 * refreshPanel()              — re-derive blocks and re-render
 *
 * @contract
 *   assertions:
 *     purity: IO
 *     state_ownership: [_previewUrl]
 *     external_io: [DOM, scraper, field-mapper, portrait-studio, ruleset-library,
 *                   session-manager draft state, forge-panel refresh, toastr]
 */

import { log, error }                     from './log.js';
import { getSessionBlocks }               from './scraper.js';
import { getFieldList, getLiveValue, commitDraftState } from './field-mapper.js';
import { generatePortrait, commitPortrait, revokePreview } from './portrait-studio.js';
import { getRulesetList }                 from './ruleset-library.js';
import { refreshStrip }                   from './forge-panel.js';
import { refreshPanel as refreshRulesets } from './rulesets-panel.js';
import {
    getWorkspace,
    getDraftState,
    setDraftField,
    clearDraftState,
    setWorkspaceTarget,
} from './session-manager.js';
import { extension_settings }             from '../../../extensions.js';
import { CTZ_EXT_NAME, CANVAS_TYPES }     from './defaults.js';

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

    if (ws.canvas_type === CANVAS_TYPES.RULESET) {
        return _buildRulesetHTML(ws, blocks, draft, dirtyKeys, blockItems);
    }

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

function _buildRulesetHTML(ws, _blocks, draft, dirtyKeys, blockItems) {
    const isNew     = !ws.target || ws.target === '__new__';
    const nameValue = _esc(draft['name'] ?? (isNew ? '' : ws.target));
    const liveText  = _esc(getLiveValue(CANVAS_TYPES.RULESET, 'content', ws.target) ?? '');
    const draftText = _esc(draft['content'] ?? '');

    // Librarian Dropdown
    const libItems = getRulesetList();
    const libOptions = libItems.map(name => 
        `<option value="${_esc(name)}" ${ws.target === name ? 'selected' : ''}>${_esc(name)}</option>`
    ).join('');

    return `
        <div class="ctz-workbench">
            <div class="ctz-wb-sidebar">
                <h4 class="ctz-section-title">Blocks</h4>
                <div class="ctz-block-list" id="ctz-block-list">${blockItems}</div>
                <button id="ctz-wb-refresh-btn" class="ctz-btn ctz-btn-sm">↺ Refresh</button>
            </div>

            <div class="ctz-wb-main">
                <div class="ctz-wb-toolbar">
                    <select id="ctz-ruleset-target-select" class="ctz-select ctz-input-sm" style="max-width:200px;">
                        <option value="__new__" ${isNew ? 'selected' : ''}>&lt; New Ruleset &gt;</option>
                        ${libOptions}
                    </select>
                    <input id="ctz-ruleset-name" class="ctz-input"
                           value="${nameValue}" placeholder="Enter Name..." />
                    <button id="ctz-commit-btn" class="ctz-btn ctz-btn-primary"
                            ${dirtyKeys.length === 0 ? 'disabled' : ''}>
                        Commit (${dirtyKeys.length})
                    </button>
                </div>

                <div class="ctz-diff-panes">
                    <div class="ctz-pane ctz-pane-live">
                        <div class="ctz-pane-header">Live State</div>
                        <textarea class="ctz-pane-text" id="ctz-live-pane"
                                  readonly>${liveText}</textarea>
                    </div>
                    <div class="ctz-pane ctz-pane-draft">
                        <div class="ctz-pane-header">Draft</div>
                        <textarea class="ctz-pane-text" id="ctz-draft-pane">${draftText}</textarea>
                    </div>
                </div>
            </div>
        </div>
    `;
}

// ─── Wiring ───────────────────────────────────────────────────────────────────

function _wire(ws, blocks, fields) {
    if (ws.canvas_type === CANVAS_TYPES.RULESET) {
        _wireRuleset(ws, blocks);
        return;
    }

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
                commitBtn.disabled    = dirtyCount === 0;
                commitBtn.textContent = `Commit (${dirtyCount})`;
            }
            // Update dirty marker on the currently-selected option
            const opt = fieldSelect?.querySelector(`option[value="${CSS.escape(fieldId)}"]`);
            if (opt) {
                opt.dataset.dirty = '1';
                opt.textContent   = opt.textContent.endsWith(' ●')
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

function _wireRuleset(ws, blocks) {
    const targetSelect = _container.querySelector('#ctz-ruleset-target-select');
    const nameInput    = _container.querySelector('#ctz-ruleset-name');
    const draftPane    = _container.querySelector('#ctz-draft-pane');
    const commitBtn    = _container.querySelector('#ctz-commit-btn');
    const refreshBtn   = _container.querySelector('#ctz-wb-refresh-btn');

    // Librarian Dropdown Change
    targetSelect?.addEventListener('change', () => {
        clearTimeout(_stageTimer);
        const newTarget = targetSelect.value;
        setWorkspaceTarget(newTarget);
        refreshPanel();
        refreshStrip(); // Sync the Forge strip display
        log(TAG, 'Switched Ruleset target:', newTarget);
    });

    // Block click → load content into draft pane
    _container.querySelectorAll('.ctz-block-item').forEach(item => {
        item.addEventListener('click', () => {
            const block = blocks.find(b => b.id === item.dataset.id);
            if (block && draftPane) draftPane.value = block.content;
        });
    });

    // Name input stages immediately
    nameInput?.addEventListener('input', () => {
        if (!ws.filename) return;
        setDraftField(ws.filename, 'name', nameInput.value.trim());
        _refreshCommitBtn(commitBtn, ws.filename);
        log(TAG, 'Staged ruleset name');
    });

    // Content draft pane: debounced staging
    draftPane?.addEventListener('input', () => {
        clearTimeout(_stageTimer);
        if (!ws.filename) return;
        _stageTimer = setTimeout(() => {
            setDraftField(ws.filename, 'content', draftPane.value);
            _refreshCommitBtn(commitBtn, ws.filename);
            log(TAG, 'Auto-staged ruleset content');
        }, 300);
    });

    refreshBtn?.addEventListener('click', () => { _render(); log(TAG, 'Blocks refreshed'); });

    commitBtn?.addEventListener('click', async () => {
        if (!ws.filename) return;
        const preCommitTarget = ws.target; // snapshot before _commitRuleset may call setWorkspaceTarget
        try {
            await _commitAll(ws, getDraftState(ws.filename));
            clearDraftState(ws.filename, preCommitTarget);
            toastr.success('Ruleset committed.');
            refreshPanel();    // Re-render to update the dropdown list and Live Pane
            refreshStrip();    // Sync the Forge strip if the target name changed
            refreshRulesets(); // Sync the Rulesets toggle panel with the new library entry
        } catch (err) {
            // Error logged by field-mapper
            toastr.warning(err.message || 'Commit failed.');
        }
    });
}

function _refreshCommitBtn(btn, filename) {
    if (!btn) return;
    const count = Object.keys(getDraftState(filename)).length;
    btn.disabled      = count === 0;
    btn.textContent   = `Commit (${count})`;
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