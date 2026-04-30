/**
 * @file data/default-user/extensions/characteryze/ruleset-library.js
 * @stamp {"utc":"2026-04-29T13:10:00.000Z"}
 * @version 1.0.0
 * @architectural-role Stateful (reads) / IO (writes)
 * @description
 * Authority for the Ruleset Virtual Library. Manages CRUD operations for 
 * rulesets stored inside the extension_settings JSON blob. Decouples the 
 * librarian flow from the host's native filesystem and prompt manager.
 *
 * @api-declaration
 * getRulesetList()              — returns array of ruleset names
 * getRulesetContent(name)       — returns string content for a ruleset
 * saveRuleset(name, content)    — persists content to settings
 * deleteRuleset(name)           — removes entry from library
 *
 * @contract
 *   assertions:
 *     purity: Stateful (reads from extension_settings)
 *     state_ownership: [extension_settings.characteryze.ruleset_library]
 *     external_io: [saveSettingsDebounced]
 */

import { extension_settings }    from '../../../extensions.js';
import { saveSettingsDebounced } from '../../../../script.js';
import { CTZ_EXT_NAME }          from './defaults.js';
import { log }                   from './log.js';

const TAG = 'Library';

/** 
 * Helper to access the internal library dictionary.
 * @returns {Object}
 */
function _getLib() {
    const settings = extension_settings[CTZ_EXT_NAME];
    if (!settings.ruleset_library) {
        settings.ruleset_library = {};
    }
    return settings.ruleset_library;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns a list of all ruleset names in the virtual library.
 * @returns {string[]}
 */
export function getRulesetList() {
    return Object.keys(_getLib());
}

/**
 * Retrieves the content of a specific ruleset.
 * @param {string} name 
 * @returns {string}
 */
export function getRulesetContent(name) {
    return _getLib()[name] ?? '';
}

/**
 * Saves or updates a ruleset in the virtual library.
 * @param {string} name 
 * @param {string} content 
 */
export function saveRuleset(name, content) {
    if (!name) return;
    const lib = _getLib();
    lib[name] = content;
    saveSettingsDebounced();
    log(TAG, 'Ruleset saved:', name);
}

/**
 * Deletes a ruleset from the virtual library.
 * @param {string} name 
 */
export function deleteRuleset(name) {
    const lib = _getLib();
    if (Object.hasOwn(lib, name)) {
        delete lib[name];
        saveSettingsDebounced();
        log(TAG, 'Ruleset deleted:', name);
    }
}

