/**
 * @file data/default-user/extensions/characteryze/log.js
 * @stamp {"utc":"2026-04-28T00:00:00.000Z"}
 * @version 1.0.0
 * @architectural-role Utility / Central Logger
 * @description
 * Centralised logging wrapper for Characteryze. All console output in the
 * extension routes through here. Raw console calls are forbidden elsewhere.
 *
 * Verbose mode is off by default. error() always fires regardless of flag.
 * Entries are prefixed [CTZ:Tag] for easy filtering.
 *
 * @api-declaration
 * log(tag, ...args)    — verbose-gated informational output.
 * warn(tag, ...args)   — verbose-gated warning output.
 * error(tag, ...args)  — always-on error output.
 * setVerbose(enabled)  — toggle verbose mode at runtime.
 * isVerbose()          — returns current verbose state.
 *
 * @contract
 *   assertions:
 *     purity: IO
 *     state_ownership: [_verbose flag]
 *     external_io: [console]
 */

let _verbose = false;

function _output(consoleFn, tag, args) {
    const label = `[CTZ:${tag}] ${String(args[0] ?? '')}`;
    if (args.length <= 1) {
        consoleFn(label);
        return;
    }
    console.groupCollapsed(label);
    args.slice(1).forEach(a => consoleFn(a));
    console.groupEnd();
}

export function log(tag, ...args) {
    if (!_verbose) return;
    _output(console.log.bind(console), tag, args);
}

export function warn(tag, ...args) {
    if (!_verbose) return;
    _output(console.warn.bind(console), tag, args);
}

export function error(tag, ...args) {
    _output(console.error.bind(console), tag, args);
}

export function setVerbose(enabled) {
    _verbose = !!enabled;
}

export function isVerbose() {
    return _verbose;
}
