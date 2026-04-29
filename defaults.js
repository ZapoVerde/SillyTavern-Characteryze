/**
 * @file data/default-user/extensions/characteryze/defaults.js
 * @stamp {"utc":"2026-04-29T11:30:00.000Z"}
 * @version 1.4.0
 * @architectural-role Pure — Static Configuration
 * @description
 * Seed constants for Characteryze. Defines naming conventions, canvas schemas,
 * and Pollinations API configuration. Aligned with Vistalyze for verified
 * image generation pathways.
 *
 * @api-declaration
 * CTZ_EXT_NAME, CTZ_FORGE_PROFILE_NAME, CTZ_HOST_CHAR_NAME
 * CANVAS_TYPES — enum of valid canvas type strings
 * FIELD_MAPS   — per-canvas ordered field descriptors
 * POLLINATIONS_BASE_URL, POLLINATIONS_APP_KEY, POLLINATIONS_MODELS, POLLINATIONS_SECRET_KEY_NAME
 * DEV_IMAGE_WIDTH, DEV_IMAGE_HEIGHT
 * DEFAULT_SETTINGS — shape of extension_settings.characteryze on first init
 *
 * @contract
 *   assertions:
 *     purity: pure
 *     state_ownership: []
 *     external_io: []
 */

export const CTZ_EXT_NAME              = 'characteryze';
export const CTZ_FORGE_PROFILE_NAME    = 'Characteryze Forge';

/** 
 * Convention: Users must create a character with this exact name to act 
 * as the isolated workbench for Forge sessions.
 */
export const CTZ_HOST_CHAR_NAME        = 'Characteryze Host';

export const CANVAS_TYPES = Object.freeze({
    CHARACTER_CARD:   'character_card',
    SYSTEM_PROMPT:    'system_prompt',
    RULESET:          'ruleset',
});

/**
 * Ordered field descriptors per canvas type.
 * id      — machine key used in draft_state and commit
 * label   — display label in Workbench dropdown
 * hint    — codeblock language tag that auto-suggests this field
 */
export const FIELD_MAPS = Object.freeze({
    [CANVAS_TYPES.CHARACTER_CARD]: [
        { id: 'name',        label: 'Name',          hint: 'name'           },
        { id: 'description', label: 'Description',   hint: 'description'    },
        { id: 'personality', label: 'Personality',   hint: 'personality'    },
        { id: 'scenario',    label: 'Scenario',       hint: 'scenario'       },
        { id: 'first_mes',   label: 'First Message',  hint: 'first_message'  },
        { id: 'mes_example', label: 'Example Dialogue', hint: 'example'     },
        { id: 'portrait',    label: 'Avatar / Portrait', hint: 'portrait-prompt' },
    ],
    [CANVAS_TYPES.SYSTEM_PROMPT]: [
        { id: 'main',      label: 'Main Prompt',   hint: 'main'      },
        { id: 'nsfw',      label: 'NSFW Prompt',   hint: 'nsfw'      },
        { id: 'jailbreak', label: 'Jailbreak',     hint: 'jailbreak' },
        { id: 'an',        label: "Author's Note",  hint: 'note'      },
    ],
    [CANVAS_TYPES.RULESET]: [
        { id: 'name',    label: 'Ruleset Name',    hint: 'ruleset-name'    },
        { id: 'content', label: 'Ruleset Content', hint: 'ruleset'         },
    ],
});

/** Pollinations API Configuration (Aligned with Vistalyze) */
export const POLLINATIONS_BASE_URL = 'https://gen.pollinations.ai';
export const POLLINATIONS_APP_KEY  = 'pk_WfuLORZ5RZDfPRZU';
export const POLLINATIONS_SECRET_KEY_NAME = 'api_key_pollinations';

/** Available Pollinations image models */
export const POLLINATIONS_MODELS = Object.freeze([
    'flux',
    'zimage',
    'klein',
    'gptimage',
    'grok-imagine',
    'seedream',
    'qwen-image',
]);

/** Dev Mode Dimensions */
export const DEV_IMAGE_WIDTH  = 320;
export const DEV_IMAGE_HEIGHT = 180;

export const DEFAULT_PORTRAIT_PROMPT_TEMPLATE =
    '{{prompt}}, character portrait, high detail, soft lighting, painterly.';

/** Shape of extension_settings.characteryze — written on first init. */
export const DEFAULT_SETTINGS = Object.freeze({
    permasave_profile:  null,
    forge_profile_name: CTZ_FORGE_PROFILE_NAME,
    forge_profile_id:   null,
    ui_active:          false,
    devMode:            false,    // Generates low-res previews when true
    known_sessions:     [],       // [{ filename, canvas_type, session_name, created_at }]
    draft_states:       {},       // keyed by chat filename
    image_gen: {
        engine:           'pollinations',
        model:            'flux',
        endpoint:         '',
        prompt_template:  DEFAULT_PORTRAIT_PROMPT_TEMPLATE,
    },
    sessions: {
        autosave:  true,
        max_saved: 50,
    },
    verbose: false,
});