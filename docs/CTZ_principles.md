# Characteryze — Project Principles
*Read before writing any code. Applies to every session.*

---

## 1. The Core Philosophy: The Forge is a Workbench, Not a Chat

Characteryze manages **Structured Content Generation**. Every session is task-scoped — one canvas target, one clean context, one deliberate output. The Forge is a controlled generation environment. It is not a general-purpose chat interface.

Intermediate generation state has no intrinsic value. Value is extracted from a session by committing harvested content to ST's native files via the Workbench. A session that has not been committed is a draft. The session transcript is the means; the committed content is the end.

---

## 2. ST Native Machinery is the Default Answer

Before building anything, ask: does ST already do this?

Characteryze is a layer, not a replacement. ST's generation pipeline, persistence model, profile system, preset system, and save functions are the foundation. We hook into them; we do not shadow them.

A custom implementation is only justified when ST's surface is genuinely inaccessible or so tightly coupled to the main chat context that reuse would introduce unpredictable side effects. Every custom implementation must be justified by this test. If it cannot be, it should not exist.

---

## 3. Session Isolation is Structural, Not Conventional

Forge sessions must be physically isolated from the user's real content. This isolation is enforced by the architecture, not by naming conventions or user discipline.

The mechanism chosen to achieve this isolation may change. The principle does not: at no point should a Forge session be reachable through normal ST navigation, and at no point should a Forge session's existence affect the user's character library, chat history, or normal workflow.

---

## 4. Nothing Writes Until Finalize

The Workbench operates in permanent draft state until the user explicitly commits. No ST file — character card, prompt profile, ruleset, or image asset — is touched until that moment.

This is not a UI convention. It is an architectural contract. Any module that writes to ST's native files outside of the commit path is in violation of this principle, regardless of intent.

Dirty state persists across browser refreshes. Switching sessions does not commit. The user is never surprised by a write they did not explicitly authorise.

---

## 5. The Profile Lifecycle is the Heart of the Extension

Characteryze's primary mechanical responsibility is managing a clean, reversible environment for generation. The user must always be able to exit Characteryze and find their ST exactly as they left it.

This means:
- Entry captures the current environment state before modifying anything
- Exit restores that captured state unconditionally
- A guard detects and corrects any state where Characteryze's environment is active but Characteryze is not

The captured state is permanent and self-healing. It is overwritten only on a clean entry. It is never cleared. It is the authoritative answer to "where does the user return to."

---

## 6. Harvesting is Observational, Not Instructional

The content harvester derives its output from syntactic markers in the AI's responses. It does not instruct the AI to produce harvestable output. It does not interpret meaning. It does not make judgements about content quality or relevance.

The harvester reads what is there. The user decides what to do with it.

This principle keeps the harvester robust across model changes, prompt changes, and ruleset changes. A harvester that depends on AI cooperation is fragile. A harvester that depends on syntax is not.

---

## 7. The Workbench Diff Pattern is Consistent Across the Suite

The two-pane diff editor — live state on the left, draft state on the right, explicit stage action, explicit commit — is the established interaction pattern for this suite. Characteryze does not invent a new pattern for this problem.

Consistency here is a feature. A user familiar with any other extension in the suite understands the Workbench immediately. Do not introduce variation in the diff interaction model without a compelling reason that cannot be served by the existing pattern.

---

## 8. Image Generation is an Owned Concern

Characteryze's image generation capability is self-contained. It does not depend on ST's image generation UI, ST's image generation API surface, or any other extension's image generation machinery.

Characteryze owns its image generation connection configuration. It manages its own calls. It is responsible for its own failure handling.

This principle ensures that Portrait Studio works predictably regardless of what the user has configured in ST's main image generation settings, and regardless of what other extensions are installed.

---
9. (Deprecated)

---

## 10. The Three Kinds of Code

All code belongs to exactly one of three categories. No module mixes these responsibilities. If a module is hard to categorise, it needs to be split.

1. **Pure:** Takes data in, returns derived data out. No side effects. No knowledge of the UI, the filesystem, or external services. Deterministic and testable in isolation.

2. **Stateful:** Owns a bounded domain of runtime state. Is the single authoritative writer for that domain. Other modules request state changes through the stateful owner; they do not mutate shared state directly.

3. **IO:** Performs work with external consequences — DOM manipulation, API calls, filesystem writes, LLM requests. Contains no state derivation logic and no business logic. It does what it is told by the stateful and pure layers.

---

## 11. Every Module is Self-Describing

Every source file opens with a structured preamble declaring:

- Its architectural role (Pure / Stateful / IO, and what it owns or does)
- Its public API surface (what it exports and what those exports do)
- Its contracts (what it reads, what it writes, what it must never do)
- A timestamp marking the last intentional architectural change

This preamble is not documentation for documentation's sake. It is a forcing function. A module whose role cannot be stated clearly in a preamble has not been designed clearly enough to be implemented. Write the preamble first.

Example form:

```javascript
/**
 * @file {path}
 * @stamp {utc timestamp}
 * @architectural-role {Pure | Stateful | IO} — {one line describing what this module owns or does}
 * @description
 * {Two to four sentences. What problem does this module solve? What is it not responsible for?}
 *
 * @api-declaration
 * functionName(args) — what it does and what it returns
 *
 * @contract
 *   assertions:
 *     purity:        {classification}
 *     state_ownership: [{domains owned, or none}]
 *     external_io:   [{services touched, or none}]
 */
```

---

## 12. File Size is a Design Signal

No source file exceeds 300 lines. Proximity to this limit is a signal — not that the code needs to be compressed, but that responsibilities need to be separated. When a file approaches the limit, name the split explicitly before making it.

A file that is hard to split is a file whose concerns were not separated cleanly enough at design time. The limit surfaces this early.

---

## 13. All Output Routes Through the Logger

No raw console calls anywhere in the codebase. All diagnostic output routes through a single logging utility that supports at minimum two modes:

- **Verbose:** Structured entries for all operations — state transitions, API calls, guard triggers, harvester events, commit actions.
- **Error only:** Suppresses informational output. Only failures surface.

Log entries are structured objects. Every entry carries at minimum a timestamp, the originating module, the event name, and relevant data. Freeform strings are not log entries.

The logger is not a debugging afterthought. It is the observability layer. It is written first and used consistently.

---

## 14. Known Deferred Features are Documented, Not Hidden

Features explicitly deferred from MVP scope are recorded here and marked in code with a consistent tag so they remain visible and intentional:

- **Programmatic ruleset creation** — requires ST settings surgery, deferred pending risk assessment
- **LLM-generated session names** — nice to have, structural identity is sufficient for MVP
- **Extended image gen style selectors** — current approach is sufficient for MVP, extended options deferred to V2

Tag deferred boundaries in code with `// V2: {reason}`. A future implementer must be able to find every deferred boundary without reading the full codebase.