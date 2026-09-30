# 13 — Stop marking inherited titles

**What to build:** deepening no longer records which subtopics carry an inherited title (CONTEXT.md, "Inherited title"), because `retitle-subtopics` (ticket 11) now replaces every title and nothing reads the mark. The live runs already saved keep working. Built to TD §5, `deepen-subtopic-splitting`, "Inherited titles are not marked", and plan Phase 11, "no inherited-title marks". Reverses ticket 10.

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] A subtopic carries its span, title and reason, and no mark.
- [ ] Deepening writes no mark on any piece.
- [ ] A saved run carrying the mark still reads as a division; the mark is dropped as it is read and never written again.
- [ ] The deepening tests of the mark are deleted.
- [ ] The live deepened runs of all eight lectures still read as divisions, with no remake.

## Comments

2026-09-30, from the grill: the user chose removal over keeping the mark as unused information. Reading old files with the mark is what spares the eight lectures' remake (about $6.50).
