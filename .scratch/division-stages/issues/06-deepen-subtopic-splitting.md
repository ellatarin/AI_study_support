# 06 — `deepen-subtopic-splitting`

**What to build:** after the initial splitting runs, every subtopic over the size gate is divided further, and the stage writes one deepened run per initial run. Built to the technical design, then compared against the prototype.

**Blocked by:** 05

**Status:** ready-for-agent

- [x] Each subtopic over `sizeGateWords` (600, counted by code) is sent on its own with the prototype's `d13` prompt, byte-identical; subtopics at or under the gate are never sent.
- [x] The reply is either "one step" or a list of cuts; each cut is looked for only inside the subtopic it was proposed for, so deepening adds cuts but never moves or removes one.
- [x] At most two rounds. When the first round cut anything, the second sends every subtopic still over the gate, one the model called one step included (the prototype's behaviour; measured against re-sending only cut pieces in `LATER-ROUNDS.md`).
- [x] A call failing all 3 attempts fails the stage; a failed subtopic is never recorded as "one step".
- [x] Calls are made a few at a time; each deepened run is saved as it completes and a relaunch makes only the missing ones (ticket 04).
- [x] Every deepened run's subtopics joined in order equal the transcript character for character.
- [x] `sizeGateWords` (600) is added to the `division` settings section; the stage's model is set per stage.
- [ ] **Live run:** the stage runs for real on one lecture (cost stated first); its deepened subtopic counts fall within the prototype's `d13` range on that lecture.
- [ ] **Side by side with the prototype, in place of a replay:** the prototype saved its deepened runs but not the replies that made them, so nothing can be replayed. A one-off script sets the live deepened runs beside the prototype's for that lecture, subtopic by subtopic, and the user reads them.
- [x] The side-by-side script and its output stay in the prototype folder.

## Comments

2026-09-29, built:

- The `d9` prompt was checked byte-identical to the prototype's (9,328 characters), and the user message keeps the prototype's `Section:` heading.
- A proposed cut that cannot be found inside its subtopic is dropped, not resent, as the prototype did; the prototype found every cut in 1,499 sends of its 144 `d9` runs, so this has never been exercised live. The technical design now says so.
- "A few at a time": up to the stage's `concurrency` runs are in flight at once, and within a run its subtopics are sent one after another, so no more than `concurrency` calls are ever in flight. The prototype sent all of a run's subtopics at once.
- `sizeGateWords` already existed (added in ticket 05).
- What deepening shared with initial splitting was moved out of that stage rather than copied: reading the trimmed transcript, recognising a saved division and a reply's subtopic, the panel scaffold and reading a finished panel, the JSON reply turned into what a stage keeps, the prompt message pair, and the model-stage factory.

2026-09-29, live run on lecture 6 (2026-03-11):

- Deepened subtopic counts 16–21 (prototype 15–22); 4–6 subtopics per run still over the gate after two rounds (prototype 4–6); every run joins back into the transcript exactly and keeps every initial cut.
- 110 calls, 373,172 tokens in and 137,956 out, about 6 minutes. Cost shows as n/a: every cost lookup returned 404 (issue #10).
- Slow because a run's subtopics were sent one after another. The prototype ran about 6 runs at once with every long subtopic in a round sent together. The user chose settings defaults of 6 runs × 10 calls at once, with lecture concurrency also in settings; to be built.
- Side by side: `compare-live-splitting.mts deepened` writes `LIVE-DEEPENED-SPLITTING.md`, every cut site with its opening words and each panel's support. Against the user's l6 ruling, the live vote at 5 of 9 would make 4 errors (keeps 76.2%, 78.9%, 94.7%; drops 63.6%); the prototype's 18 runs at 10 of 18 make 3 (keeps 76.2%, 78.9%; drops 91.5%).

2026-09-29, switched to `d13`:

- The user chose deepening prompt `d13` over `d9`: steadier panels and better topics and titles (technical design §5, `deepen-subtopic-splitting`). The prompt item and the live run are reopened; the live run and side-by-side view above were made with `d9` and are redone with `d13`.
- The live prompt was checked byte-identical to the prototype's `d13` (9,724 characters); `compare-live-splitting.mts deepened` now reads the prototype's `d13` runs.
