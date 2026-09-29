# 09 — Call a subtopic's title a title

**What to build:** both splitting stages save each subtopic's **title** (CONTEXT.md, "Title") where they now save `label`, and nothing past the model's reply calls it a label. The prompts are unchanged: they still ask the model for `label`, because they are the prototype's `s6` and `d13` word for word, and a reply's `label` becomes `title` as the reply is read. Built to TD §5, `initial-subtopic-splitting`, and the plan's "Phase 11, continued — titles, and marking inherited ones".

**Blocked by:** None — can start immediately. Build order is 09 → 10 → 07 → 08 → 11.

**Status:** resolved

- [x] Saved initial and deepened runs hold `title`, not `label`, for every subtopic.
- [x] The prompts are byte-identical to before; a reply carrying `label` is read as the subtopic's title.
- [x] A run file saved before the rename no longer reads as a division; the stage treats it as unreadable, as it does any other malformed run file, and the design's answer is to remake such runs (ticket 10 does this).
- [x] No `label` remains outside the prompt modules and the check on a reply's shape; tests, fixtures and comments say title.
- [x] ~~**Live run:** initial splitting runs on one lecture and its run files show `title`. The cost is stated first.~~ Skipped by the user: ticket 10 remakes every lecture's runs, which checks this too.

## Comments

2026-09-29: the user settled the word as **title** everywhere (grill round 1). Old live run files are remade, not converted: converting cannot recover every inherited-title mark (ticket 10), so the user chose to remake all eight lectures.

2026-09-29, resolved (064a716): `replyNaming` is the one place a reply's `label` becomes a title. The user asked why `label` survives there: the prompts' reply shape asks for it, and they stay the prototype's word for word. Left as is. The live run was skipped in favour of ticket 10's remake.
