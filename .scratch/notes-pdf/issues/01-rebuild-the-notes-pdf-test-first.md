# 01 — Rebuild the notes PDF test first

**Status:** resolved

**Blocked by:** none

**Spec:** `.scratch/notes-pdf/spec.md`

**The problem:** the notes PDF works, but it was built fast, without tests and
without the doc updates (2026-10-15). The user accepted this once. The feature
must now be built again by the project's rules: test first, one behaviour at a
time.

**The agreed method:**

1. The user reviews the spec.
2. A new agent works in a git worktree, made from the last commit. The worktree
   does not hold the fast version, so the agent cannot see it. The agent gets
   only the spec and the `/tdd` skill.
3. The agent commits on its branch in the worktree.
4. Claude compares the agent's result with the fast version. Each thing that the
   fast version does and the spec does not say becomes a new test.
5. The agent's branch is merged into `main`. The fast version is deleted.

**Waiting on the user:**

- [ ] The review of the spec. Four points to check:
  - §3.4: a deleted `notes.pdf` alone is not rebuilt.
  - §5.1: both layouts stay, although the user chose `break`.
  - §12.3: the glossary term for the PDF, proposed as **Notes PDF**.
  - §13: what is left out.
- [ ] Permission to use a worktree and a branch for this one job. The project
  commits to `main` only.

**The fast version, in the working tree of `main`, not committed:**

- `src/pipeline/stages/build-notes-page/print-pdf.ts` (new)
- `src/pipeline/stages/build-notes-page/notes-page-html.ts`
- `src/pipeline/stages/build-notes-page/notes-page-style.ts`
- `src/pipeline/stages/build-notes-page/build-notes-page.ts`
- `src/pipeline/config.ts`, `src/pipeline/layout.ts`, `src/pipeline/runner.ts`
- `src/types/pipeline.ts` (the PDF types, not the comment fix of ticket 02)
- `pipeline-config.example.json`, `package.json`, `pnpm-lock.yaml`
- `pipeline-config.json` (not tracked) holds `finalOutput.pdf`: `break`, 60%.

The commit gate refuses the fast version: it has duplicated code and no tests.
So no other commit can pass the gate while the fast version is in the working
tree, unless the fast version is put away for that commit.

**Files that must not be committed:**

- The comparison PDFs in `.scratch/notes-pdf/`, 18 MB each.
- The backups of the notes folders of Genomics of Disease lectures 1, 2 and 3,
  in the job folder of the session of 2026-10-15.

## Comments

**2026-10-15:** done. The agent built the Notes PDF test first on the branch
`notes-pdf`, in 16 commits. The last commit, ffbb9f7d, gives the PDF the look of
the fast version (spec §6.1). `main` moved forward to ffbb9f7d. The stash that
held the fast version is dropped. A backup patch of the fast version is in
`../Ella_AI_project-fast-pdf-backup/`. The comparison PDFs are deleted.
