# Characteryze

A [SillyTavern](https://github.com/SillyTavern/SillyTavern) extension for AI-assisted character card and content creation. Characteryze gives you a structured Forge → Workbench workflow that keeps your live SillyTavern data safe until you're ready to commit.

---

## What It Does

Characteryze overlays a tabbed interface on top of SillyTavern's existing UI. You use ST's native chat pipeline to generate content, a codeblock scraper collects the output, and the Workbench lets you review and map each block to a specific target field before anything is written to disk.

**Core loop:**

1. Open the **Forge** (ST's native chat, running under the Characteryze connection profile)
2. Ask the AI to generate character descriptions, dialogue, prompts, etc.
3. AI output wrapped in codeblocks (` ```description `, ` ```portrait-prompt `, etc.) is scraped automatically
4. Switch to the **Workbench** — select a source block, select a target field, stage it
5. **Commit** — writes all staged fields to the ST character card / system prompt / ruleset entry

Nothing is written until you explicitly commit.

---

## Canvas Types

| Canvas | What Gets Edited |
|---|---|
| **Character Card** | Name, Description, Personality, Scenario, First Message, Example Dialogue, Avatar/Portrait |
| **System Prompt Profile** | Main Prompt, NSFW Prompt, Jailbreak, Author's Note |
| **Ruleset** | A named prompt manager entry in the Forge connection profile |

Rulesets are instruction manuals for the AI — you build them the same way as any other content, then toggle them on/off in the Forge to shape future generation.

---

## Sessions

Each Forge session is a standard ST chat JSONL tagged with a `characteryze` metadata marker. Sessions and targets are **decoupled** — a good writing session can be mined against multiple different characters without regenerating.

Sessions autosave via ST's native machinery. A one-shot LLM call generates a human-readable session name after the first reply.

---

## Portrait Studio

If the AI outputs a ` ```portrait-prompt ` codeblock, mapping it to the **Avatar / Portrait** field triggers an async image generation call using ST's configured image backend (Pollinations by default). The result previews in the Workbench right pane and is attached to the character card on commit.

---

## Connection Profile Management

On launch, Characteryze saves your current connection profile (`permasave_profile`) and swaps to the Forge profile. On exit, your original profile is restored and ST returns to the loading screen.

A guard fires on every `CHAT_LOADED` event — if the Forge profile is somehow active outside Characteryze, it swaps back automatically.

---

## Installation

1. In SillyTavern, open **Extensions → Install extension**
2. Paste: `https://github.com/ZapoVerde/SillyTavern-Characteryze`
3. Reload SillyTavern
4. Open the **Extensions** panel, expand **Characteryze**, and click **Launch**

Requires SillyTavern with extension support enabled.

---

## Tabs

| Tab | Description |
|---|---|
| **Home** | Session list, new session flow, canvas and target selectors |
| **Forge** | ST's native chat UI under the Forge connection profile |
| **Workbench** | Codeblock source navigator, field diff view (live left / draft right), stage and commit |
| **Portrait** | Image generation preview and prompt editor |
| **Settings** | Image gen engine, prompt template, session limits, verbose logging |

---

## Compatibility

- SillyTavern (latest main branch)
- Optionally integrates with [SillyTavern-Personalyze](https://github.com/ZapoVerde/SillyTavern-Personalyze) for style selectors in portrait prompt templates

---

## Version

`0.1.0` — initial release
