/**
 * @file data/default-user/extensions/characteryze/macro-escape.js
 * @stamp {"utc":"2026-04-30T00:00:00.000Z"}
 * @version 1.0.0
 * @architectural-role Pure — Macro Escape Utility
 * @description
 * Prevents SillyTavern's substituteParams from expanding {{macro}} references
 * that the user deliberately wants to keep literal.
 *
 * Escape syntax: prefix any double-curly opener with a backslash → \{{
 * On escape, \{{ is replaced with {ZWS{ (zero-width space between braces).
 * SillyTavern's macro regexes match {{, so the ZWS breaks the match.
 * The LLM receives the ZWS form, which is visually and semantically identical
 * to {{ for any language model.
 *
 * @api-declaration
 * escapeMacros(text) — pure; replaces \{{ with {ZWS{
 *
 * @contract
 *   assertions:
 *     purity: Pure
 *     state_ownership: []
 *     external_io: []
 */

const ZWS = '​'; // zero-width space

/**
 * Converts \{{ ... }} escape sequences to {ZWS{ ... }} so that
 * SillyTavern's substituteParams/evaluateMacros cannot match them.
 * @param {string} text
 * @returns {string}
 */
export function escapeMacros(text) {
    if (!text) return text;
    return text.replace(/\\{{/g, `{${ZWS}{`);
}
