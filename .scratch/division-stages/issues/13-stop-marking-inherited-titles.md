# 13 — Stop marking inherited titles

**What to build:** deepening no longer records which subtopics carry an inherited title (CONTEXT.md, "Inherited title"), because `retitle-subtopics` (ticket 11) now replaces every title and nothing reads the mark. The live runs already saved keep working. Built to TD §5, `deepen-subtopic-splitting`, "Inherited titles are not marked", and plan Phase 11, "no inherited-title marks". Reverses ticket 10.

**Blocked by:** None — can start immediately

**Status:** resolved

- [x] A subtopic carries its span, title and reason, and no mark.
- [x] Deepening writes no mark on any piece.
- [x] A saved run carrying the mark still reads as a division; the mark is dropped as it is read and never written again.
- [x] The deepening tests of the mark are deleted.
- [x] The live deepened runs of all eight lectures still read as divisions, with no remake.

## Comments

2026-09-30, from the grill: the user chose removal over keeping the mark as unused information. Reading old files with the mark is what spares the eight lectures' remake (about $6.50).

2026-09-30, resolved. Saved runs are now read through a reader that keeps only a subtopic's span, title and reason, so a run file carrying the mark still reads and the mark is dropped; the panel machinery takes that reader in place of a yes/no check. Checked read-only on the live workspaces: all 288 saved runs (8 lectures, 18 initial and 18 deepened each) carry the mark and all read as divisions. The panel suite's "stand-in run" was renamed "numbered run" at the user's request.
