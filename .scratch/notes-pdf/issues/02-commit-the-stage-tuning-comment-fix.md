# 02 — Commit the comment fix of the stage tuning type

**Status:** resolved

**Blocked by:** 01

**The problem:** two comments on the stage tuning type in `src/types/pipeline.ts`
were wrong.

- The comment on `concurrency` named only panel runs. The subtopic stages and
  `read-slides` also use `concurrency`.
- The comment on `sendGapSeconds` said that only `group-into-topics` reads it.
  Every model stage reads it. Technical design §6 already says this.

**State (2026-10-15):** the fix is in the working tree and staged in the index.
The fix is the only staged change. The commit gate refused the commit because
the gate also checks the fast version of the notes PDF (ticket 01).

**The agreed way:** commit the fix as the first commit on `main` after ticket 01
is merged.

**Before the commit:** check that the index still holds only the two comment
lines. A `git add` of `src/types/pipeline.ts` would also stage the PDF types.

## Comments

**2026-10-15:** done in 70718146, the first commit on `main` after the merge of
ticket 01. The commit holds only the two comment lines.
