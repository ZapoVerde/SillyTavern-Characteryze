/**
 * @file data/default-user/extensions/characteryze/defaults.js
 * @stamp {"utc":"2026-04-28T00:00:00.000Z"}
 * @version 1.0.0
 * @architectural-role Pure — Static Configuration
 * @description
 * Seed constants for Characteryze. Nothing here is mutated at runtime.
 * All runtime state lives in extension_settings.characteryze or in module
 * memory. This file is referenced only for shape definitions and defaults.
 *
 * @api-declaration
 * CTZ_EXT_NAME, CTZ_FORGE_PROFILE_NAME, CTZ_INTERNAL_CHAR_FILENAME
 * CANVAS_TYPES — enum of valid canvas type strings
 * FIELD_MAPS   — per-canvas ordered field descriptors
 * POLLINATIONS_BASE_URL, POLLINATIONS_APP_KEY
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
export const CTZ_INTERNAL_CHAR_FILENAME = '_characteryze_internal.png';
// Chats for the internal character live under this directory name (avatar sans extension)
export const CTZ_INTERNAL_CHAR_CHATDIR  = '_characteryze_internal';

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

/**
 * Minimal V2 character card used as the internal Forge session host.
 * Inlined to avoid a runtime HTTP fetch for the asset file.
 */
export const INTERNAL_CHARACTER_CARD = Object.freeze({
    spec:         'chara_card_v2',
    spec_version: '2.0',
    data: Object.freeze({
        name:                    'Characteryze',
        description:             '',
        personality:             '',
        scenario:                '',
        first_mes:               '',
        mes_example:             '',
        creator_notes:           'Internal Characteryze session host. Do not modify or chat with this character directly.',
        system_prompt:           '',
        post_history_instructions: '',
        tags:                    [],
        creator:                 'Characteryze',
        character_version:       '1.0',
        extensions: Object.freeze({ characteryze_internal: true }),
    }),
});

export const POLLINATIONS_BASE_URL = 'https://image.pollinations.ai';
export const POLLINATIONS_APP_KEY  = 'characteryze';

export const DEFAULT_PORTRAIT_PROMPT_TEMPLATE =
    '{{prompt}}, character portrait, high detail, soft lighting, painterly.';

/** Shape of extension_settings.characteryze — written on first init. */
export const DEFAULT_SETTINGS = Object.freeze({
    permasave_profile:  null,
    forge_profile_name: CTZ_FORGE_PROFILE_NAME,
    ui_active:          false,
    known_sessions:     [],       // [{ filename, canvas_type, session_name, created_at }]
    draft_states:       {},       // keyed by chat filename
    image_gen: {
        engine:           'pollinations',
        endpoint:         '',
        prompt_template:  DEFAULT_PORTRAIT_PROMPT_TEMPLATE,
    },
    sessions: {
        autosave:  true,
        max_saved: 50,
    },
    verbose: false,
});
