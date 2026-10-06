# 02 — A QA iteration's cost can be unknown

**What to build:** the record of each QA loop iteration holds its cost as a plain number (`QaIterationSummary.costUsd` in `src/types/pipeline.ts`). It has no way to say that the cost is unknown. When a cost lookup fails, the loop would have to write a number that is not true.

NFR-2.2 says that a cost that cannot be found is reported as unknown, never as nothing. `CONTEXT.md`, Unknown cost, says that an unknown cost is never zero and never blank. The other cost records do this with `CostResolution`: a number, or `null` with a reason.

- [ ] An iteration's cost can be unknown, with a reason, in the same way as a stage's cost.

**Blocked by:** the QA loop is not built.

**Status:** needs-triage

Found in comment-rewrite ticket 03. See `.scratch/comment-rewrite/divergences.md`, D15.
