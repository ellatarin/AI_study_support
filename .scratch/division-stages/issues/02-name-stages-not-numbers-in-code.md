# 02 — Name stages, not numbers, in code

**What to build:** code comments, TSDoc, test titles and user-facing messages refer to a stage by its id (`transcript-structuring`), never by its old number ("Stage 3"), matching the design docs after ticket 01. Numbers stop making sense once the four division stages sit between `transcription` and `transcript-structuring`. At ticket time 163 lines across 34 files carried a stage number, most in `src/types/pipeline.ts`, the stage modules, the fixtures and `src/cli/lecture-identity.ts`.

**Blocked by:** 01 — the cross-references point at the technical design's renamed stage sections.

**Status:** resolved

- [x] No line in `src/` or `scripts/` refers to a stage by number; each names the stage id, with the sentence reworded where needed.
- [x] Any cross-reference into the technical design points at the renamed section (`§5, \`transcript-structuring\``), not at a stage number.
- [x] A user-facing message that named a stage by number now names it by id, and any test asserting that message is updated with it.
- [x] Test titles that named a stage by number are renamed to match the implementation plan. Ticket 01 already changed the plan's copies, e.g. two Phase 4 test names that said "Stage 0" now say "source-normalisation".
- [x] Stage ids themselves are unchanged. Renaming them to the README's verb-first names needs a manifest migration and is separate, later work.
- [x] Every edit is made with the Edit tool, so the change is visible, and the full gate passes.
