# 01 — Settle the comment vocabulary and rules

**What to build:** one agreed vocabulary and one set of comment rules that every later ticket applies, so the rewording is consistent across the codebase. See `../spec.md`.

**Blocked by:** None — can start immediately

**Status:** resolved

- [x] Every term the comments use for a domain concept that `CONTEXT.md` does not define is listed, with how often it appears.
- [x] For each, a proposal: the `CONTEXT.md` term to use instead, or a definition to add to `CONTEXT.md`.
- [x] The user has ruled on each proposal; terms ruled in are added to `CONTEXT.md`, and the rulings are recorded in this ticket's comments.
- [x] The rules in `../spec.md` are added to the Documentation section of `CLAUDE.md`, worded once there.
- [x] No source comment is changed in this ticket.

## Comments

2026-10-04, the audit: four agents read every comment in `src/` (about 9,000 lines) against `CONTEXT.md`. Proposals in three groups: A, words the glossary already avoids (no ruling); B, words with two meanings; C, new glossary entries.

2026-10-04, the user's rulings:

- A stands: each avoided word becomes its glossary term.
- B stands. Bare "run" is always qualified (pipeline run, splitting run, grouping run, prototype run, "while the stage runs"); it may stand alone only where "panel" has just fixed it. "Launch" becomes invocation. "Settled" is said only of output; a title or identity is "decided". "Record" alone becomes stage record. "Gate" alone is only ever the size gate; the other is the send gate. "Scan" (listing workspaces) becomes "list the workspaces". "Initial run" and "deepened run" become a splitting run before or after deepening.
- C stands, with three changes: "refusal" is dropped, because a provider error is a provider error, so the entry is **Provider error**; "opening" becomes **Subtopic start**; "round" becomes **Deepening round**. "Finding" gets no entry: it becomes deficiency.
- Every implementation word is defined too, in a separate "In the code" section, except the startup model-ID check.

Also corrected while adding **Invocation**: a run log records one pipeline run, not one invocation (each lecture's workspace holds its own run logs), and a pipeline run is what one invocation does to one lecture.

2026-10-04, the glossary itself: the STE linter found 37 hard breaches in `CONTEXT.md` (long sentences, semicolons, synonym rotation) and mannered prose in the older entries. The user ruled it rewritten to the style, every fact kept. Three hard flags remain, all false: "launch" and "display" sit only in _Avoid_ lists, and "delete" is the command name. The user then ruled out subjectless fragments ("What spaces a stage's sends in time."); every entry now names its subject first. That rule is in `CLAUDE.md` and in `../spec.md`'s criteria.

2026-10-04, raised at close: identifiers (types, functions, variables) probably break the glossary too, e.g. `videos`, `runFiles`, `RunManifest`, `anomalies`. Proposed, not yet agreed: a name-audit ticket after this one; renames of shared names as their own tickets before the comment tickets; local names folded into each area ticket; stored names (manifest, run-log and config keys, stage ids, CLI flags, folder names) left alone unless the user rules otherwise.
