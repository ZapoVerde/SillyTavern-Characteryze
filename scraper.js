/**
 * @file data/default-user/extensions/characteryze/scraper.js
 * @stamp {"utc":"2026-04-29T12:20:00.000Z"}
 * @version 1.0.2
 * @architectural-role Pure — Codeblock Harvester
 * @description
 * Extracts codeblocks from ST chat message arrays by pure syntactic heuristic.
 * Scans the entire provided message array (the full .jsonl history).
 *
 * @api-declaration
 * parseCodeblocks(messages) — pure; returns BlockDescriptor[] from messages array
 * getSessionBlocks()        — IO thin wrapper; reads SillyTavern.getContext().chat
 *
 * @contract
 *   assertions:
 *     purity: Pure (parseCodeblocks) / IO (getSessionBlocks)
 *     state_ownership: []
 *     external_io: [SillyTavern.getContext (getSessionBlocks only)]
 */

/**
 * Permissive Codeblock Regex
 * 1. Matches triple backticks
 * 2. Captures optional language (non-greedy, up to the first newline)
 * 3. Captures content (non-greedy, including newlines)
 * 4. Matches closing triple backticks
 */
const CODEBLOCK_RE = /```(?<lang>[^\r\n`]*?)(?:\r?\n)(?<content>[\s\S]*?)(?:\r?\n)```/g;

/**
 * Extract all codeblocks from an array of ST chat message objects.
 * Iterates through the entire chat history.
 * @param {Array} messages — context.chat or any compatible message array
 * @returns {Array} flat list of BlockDescriptor objects
 */
export function parseCodeblocks(messages) {
    const blocks = [];
    if (!Array.isArray(messages)) return blocks;

    log('Scraper', `Scanning ${messages.length} messages for blocks...`);

    for (let msgIdx = 0; msgIdx < messages.length; msgIdx++) {
        const msg = messages[msgIdx];
        const text = msg?.mes;
        if (typeof text !== 'string' || !text) continue;

        // Reset regex state for the new string
        CODEBLOCK_RE.lastIndex = 0;
        let match;
        let blockIdx = 0;
        
        while ((match = CODEBLOCK_RE.exec(text)) !== null) {
            blocks.push({
                id:         `${msgIdx}-${blockIdx}`,
                msgIndex:   msgIdx,
                blockIndex: blockIdx,
                lang:       (match.groups.lang || '').trim().toLowerCase(),
                content:    (match.groups.content || '').replace(/\r\n|\r/g, '\n'),
                ts:         msg.send_date ?? null,
                isUser:     !!(msg.is_user),
            });
            blockIdx++;
        }
    }
    
    log('Scraper', `Found ${blocks.length} blocks.`);
    return blocks;
}

/**
 * Helper to log from this pure-ish module
 */
function log(tag, msg) {
    console.log(`[CTZ:${tag}] ${msg}`);
}

/**
 * Derive codeblocks from the currently active ST session chat.
 * @returns {Array} BlockDescriptor[]
 */
export function getSessionBlocks() {
    const ctx = SillyTavern.getContext();
    return parseCodeblocks(ctx.chat ?? []);
}