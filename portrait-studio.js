/**
 * @file data/default-user/extensions/characteryze/portrait-studio.js
 * @stamp {"utc":"2026-04-29T11:40:00.000Z"}
 * @version 1.3.0
 * @architectural-role IO — Portrait Image Generation
 * @description
 * Authenticated image generation for character portraits via Pollinations.
 * Pathing and parameterization aligned with Vistalyze to ensure 404-free
 * communication with gen.pollinations.ai.
 *
 * @api-declaration
 * buildPortraitUrl(prompt, settings, devMode) — pure; returns Pollinations fetch URL
 * generatePortrait(prompt, settings)           — fetch image; returns object URL for preview
 * commitPortrait(objectUrl, avatarFilename)    — upload image as character avatar
 * revokePreview(objectUrl)                     — cleanup object URL after commit or discard
 *
 * @contract
 *   assertions:
 *     purity: Pure (buildPortraitUrl) / IO (generatePortrait, commitPortrait)
 *     state_ownership: []
 *     external_io: [Pollinations API, findSecret, fetch /api/characters/edit-attribute,
 *                   URL.createObjectURL / revokeObjectURL]
 */

import { error, log }  from './log.js';
import { findSecret }  from '../../../secrets.js';
import {
    POLLINATIONS_BASE_URL,
    POLLINATIONS_APP_KEY,
    POLLINATIONS_SECRET_KEY_NAME,
    DEFAULT_PORTRAIT_PROMPT_TEMPLATE,
    DEV_IMAGE_WIDTH,
    DEV_IMAGE_HEIGHT,
} from './defaults.js';

const TAG = 'Portrait';

// ─── Pure: URL builder ────────────────────────────────────────────────────────

/**
 * Constructs the Pollinations API URL using the /image/ gateway.
 * @param {string} promptText — raw portrait prompt text
 * @param {object} settings   — image_gen settings object
 * @param {boolean} devMode   — if true, generates low-res preview
 */
export function buildPortraitUrl(promptText, settings = {}, devMode = false) {
    const template = settings.prompt_template ?? DEFAULT_PORTRAIT_PROMPT_TEMPLATE;
    const fullPrompt = template.replace('{{prompt}}', promptText);
    
    const params = new URLSearchParams({
        width:    devMode ? String(DEV_IMAGE_WIDTH)  : '1024',
        height:   devMode ? String(DEV_IMAGE_HEIGHT) : '1024',
        model:    settings.model ?? 'flux',
        nologo:   'true',
        enhance:  'true',
        referrer: POLLINATIONS_APP_KEY,
    });

    // gen.pollinations.ai requires the /image/ path to handle these parameters correctly
    return `${POLLINATIONS_BASE_URL}/image/${encodeURIComponent(fullPrompt)}?${params.toString()}`;
}

// ─── IO: Vault & Fetch ────────────────────────────────────────────────────────

/**
 * Retrieves the API key from the ST Secret Vault.
 * @returns {Promise<object>} Headers object with Authorization
 */
async function _getAuthHeaders() {
    const userKey = await findSecret(POLLINATIONS_SECRET_KEY_NAME);
    
    if (!userKey) {
        throw new Error(
            'Pollinations API key not found.\n\n' +
            'Please go to Characteryze Settings and save your key to the vault.'
        );
    }
    
    return {
        'Authorization': `Bearer ${userKey}`,
    };
}

/**
 * Generate a portrait image and return a local preview object URL.
 * @param {string} promptText — raw portrait prompt text
 * @param {object} settings   — extension_settings.characteryze
 * @returns {Promise<string>} object URL suitable for <img src>
 */
export async function generatePortrait(promptText, settings = {}) {
    const devMode = settings.devMode ?? false;
    const url = buildPortraitUrl(promptText, settings.image_gen ?? {}, devMode);
    
    log(TAG, `Fetching portrait from ${devMode ? 'Dev' : 'Full'} Pollinations API`);

    const headers = await _getAuthHeaders();
    const resp = await fetch(url, { headers });

    if (!resp.ok) {
        if (resp.status === 401 || resp.status === 403) {
            throw new Error('Pollinations API Key is invalid or expired.');
        }
        throw new Error(`Pollinations fetch failed: ${resp.status}`);
    }

    const blob      = await resp.blob();
    const objectUrl = URL.createObjectURL(blob);
    log(TAG, 'Portrait preview ready');
    return objectUrl;
}

/**
 * Upload a portrait (from a preview object URL) as the character's avatar.
 * @param {string} objectUrl      — preview URL returned by generatePortrait()
 * @param {string} avatarFilename — e.g. "my_character.png"
 */
export async function commitPortrait(objectUrl, avatarFilename) {
    log(TAG, 'Committing portrait for', avatarFilename);

    const imgResp = await fetch(objectUrl);
    if (!imgResp.ok) throw new Error('Failed to read preview blob');
    const blob = await imgResp.blob();

    const ctx      = SillyTavern.getContext();
    const formData = new FormData();
    formData.append('avatar', blob, avatarFilename);
    formData.append('overwrite_old', 'true');
    formData.append('ch_name', avatarFilename.replace(/\.[^.]+$/, ''));

    const resp = await fetch('/api/characters/edit-attribute', {
        method:  'POST',
        headers: ctx.getRequestHeaders(),
        body:    formData,
    });

    if (!resp.ok) {
        error(TAG, 'Avatar upload failed:', resp.status);
        throw new Error(`Avatar upload failed: ${resp.status}`);
    }
    log(TAG, 'Portrait committed');
}

/**
 * Release the object URL created by generatePortrait().
 * @param {string} objectUrl
 */
export function revokePreview(objectUrl) {
    if (objectUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(objectUrl);
        log(TAG, 'Preview URL revoked');
    }
}