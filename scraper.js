/**
 * @file data/default-user/extensions/characteryze/scraper.js
 * @stamp {"utc":"2026-04-28T00:00:00.000Z"}
 * @version 1.0.0
 * @architectural-role Pure — Codeblock Harvester
 * @description
 * Extracts codeblocks from ST chat message arrays by pure syntactic heuristic.
 * No AI instruction required — the harvester reads what is there.
 *
 * parseCodeblocks() is the pure core: takes a messages array, returns a flat
 * list of block descriptors. getSessionBlocks() is the thin IO wrapper that
 * reads the live context.chat and delegates to parseCodeblocks().
 *
 * The language tag (e.g. "description", "portrait-prompt") is captured as free
 * metadata for Workbench target suggestions. The harvester does not interpret
 * content — it only reads structure.
 *
 * @api-declaration
 * parseCodeblocks(messages) — pure; returns BlockDescriptor[] from messages array
 * getSessionBlocks()        — IO thin wrapper; reads SillyTavern.getContext().chat
 *
 * BlockDescriptor: { id, msgIndex, blockIndex, lang, content, ts, isUser }
 *
 * @contract
 *   assertions:
 *     purity: Pure (parseCodeblocks) / IO (getSessionBlocks)
 *     state_ownership: []
 *     external_io: [SillyTavern.getContext (getSessionBlocks only)]
 */

// Matches fenced codeblocks: ```lang\ncontent\n``` (non-greedy, multiline)
const CODEBLOCK_RE = /```(?<lang>[^\n`]*)\n(?<content>[\s\S]*?)```/g;

/**
 * Extract all codeblocks from an array of ST chat message objects.
 * @param {Array} messages — context.chat or any compatible message array
 * @returns {Array} flat list of BlockDescriptor objects
 */
export function parseCodeblocks(messages) {
    const blocks = [];
    for (let msgIdx = 0; msgIdx < messages.length; msgIdx++) {
        const msg = messages[msgIdx];
        if (!msg?.mes) continue;

        CODEBLOCK_RE.lastIndex = 0;
        let match;
        let blockIdx = 0;
        while ((match = CODEBLOCK_RE.exec(msg.mes)) !== null) {
            blocks.push({
                id:         `${msgIdx}-${blockIdx}`,
                msgIndex:   msgIdx,
                blockIndex: blockIdx,
                lang:       match.groups.lang.trim().toLowerCase(),
                content:    match.groups.content.replace(/\n$/, ''),
                ts:         msg.send_date ?? null,
                isUser:     !!(msg.is_user),
            });
            blockIdx++;
        }
    }
    return blocks;
}

/**
 * Derive codeblocks from the currently active ST session chat.
 * @returns {Array} BlockDescriptor[]
 */
export function getSessionBlocks() {
    const ctx = SillyTavern.getContext();
    return parseCodeblocks(ctx.chat ?? []);
}
