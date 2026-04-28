/**
 * @file data/default-user/extensions/characteryze/portrait-studio.js
 * @stamp {"utc":"2026-04-28T00:00:00.000Z"}
 * @version 1.0.0
 * @architectural-role IO — Portrait Image Generation
 * @description
 * Self-contained image generation for character portraits. Does not use ST's
 * image generation UI or API surface — owns its own Pollinations connection.
 *
 * buildPortraitUrl() is pure. generatePortrait() fetches from Pollinations and
 * returns a local object URL for preview. commitPortrait() uploads the image as
 * the character's avatar via ST's native character edit endpoint.
 *
 * Operates on the "portrait" field of the CHARACTER_CARD canvas type.
 *
 * @api-declaration
 * buildPortraitUrl(prompt, settings) — pure; returns Pollinations fetch URL
 * generatePortrait(prompt, settings) — fetch image; returns object URL for preview
 * commitPortrait(objectUrl, avatarFilename) — upload image as character avatar
 * revokePreview(objectUrl)           — cleanup object URL after commit or discard
 *
 * @contract
 *   assertions:
 *     purity: Pure (buildPortraitUrl) / IO (generatePortrait, commitPortrait)
 *     state_ownership: []
 *     external_io: [Pollinations API, fetch /api/characters/edit-attribute,
 *                   URL.createObjectURL / revokeObjectURL]
 */

import { error, log }  from './log.js';
import {
    POLLINATIONS_BASE_URL,
    POLLINATIONS_APP_KEY,
    DEFAULT_PORTRAIT_PROMPT_TEMPLATE,
} from './defaults.js';

const TAG = 'Portrait';

// ─── Pure: URL builder ────────────────────────────────────────────────────────

export function buildPortraitUrl(promptText, settings = {}) {
    const template = settings.prompt_template ?? DEFAULT_PORTRAIT_PROMPT_TEMPLATE;
    const full     = template.replace('{{prompt}}', promptText);
    const encoded  = encodeURIComponent(full);
    return `${POLLINATIONS_BASE_URL}/prompt/${encoded}` +
           `?model=flux&nologo=true&private=true&enhance=true&app=${POLLINATIONS_APP_KEY}`;
}

// ─── IO: generation ───────────────────────────────────────────────────────────

/**
 * Generate a portrait image and return a local preview object URL.
 * @param {string} promptText — raw portrait prompt text from codeblock
 * @param {object} settings   — extension_settings.characteryze.image_gen
 * @returns {Promise<string>} object URL suitable for <img src>
 */
export async function generatePortrait(promptText, settings = {}) {
    const url = buildPortraitUrl(promptText, settings);
    log(TAG, 'Fetching portrait from Pollinations');

    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Pollinations fetch failed: ${resp.status}`);

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
 * Call after commit or discard to avoid memory leaks.
 * @param {string} objectUrl
 */
export function revokePreview(objectUrl) {
    if (objectUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(objectUrl);
        log(TAG, 'Preview URL revoked');
    }
}
