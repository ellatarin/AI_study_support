# 02 — Remove the stages that the new design replaces

**What to build:** The code no longer holds the stages that the new design replaces. The pipeline still runs from the source files to `place-slides`.

**Blocked by:** 01 — Update the design documents to the new design

**Status:** ready-for-agent

- [ ] The stages `transcript-structuring` and `transcript-verification` are gone from the code, the stage order and the config.
- [ ] The stage ids `synthesis`, `qa-loop` and `pdf-generation` are gone from the code. Those stages were never built.
- [ ] Before the deletion, the text of the structuring prompt goes to `docs/reference/transcript-structuring-prompt.md`. The file holds only the prompt text and one line that says where it came from.
- [ ] Code that only the removed stages used is removed, with its tests. Code that a remaining stage uses stays.
- [ ] Each glossary term that only the removed stages used is removed from `CONTEXT.md`, after the user agrees to the list. **Underexplained** is one of them.
- [ ] A run of the pipeline on one lecture still reaches `place-slides`.
