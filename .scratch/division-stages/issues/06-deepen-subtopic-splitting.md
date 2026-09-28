# 06 — `deepen-subtopic-splitting`

**What to build:** after the initial splitting runs, every subtopic over the size gate is divided further, and the stage writes one deepened run per initial run. Built to the technical design, then compared against the prototype.

**Blocked by:** 05

**Status:** ready-for-agent

- [ ] Each subtopic over `sizeGateWords` (600, counted by code) is sent on its own with the prototype's `d9` prompt, byte-identical; subtopics at or under the gate are never sent.
- [ ] The reply is either "one step" or a list of cuts; each cut is looked for only inside the subtopic it was proposed for, so deepening adds cuts but never moves or removes one.
- [ ] A piece still over the gate after being cut is sent again, for at most two rounds.
- [ ] A call failing all 3 attempts fails the stage; a failed subtopic is never recorded as "one step".
- [ ] Calls are made a few at a time; each deepened run is saved as it completes and a relaunch makes only the missing ones (ticket 04).
- [ ] Every deepened run's subtopics joined in order equal the transcript character for character.
- [ ] `sizeGateWords` (600) is added to the `division` settings section; the stage's model is set per stage.
- [ ] **Replay against the prototype:** a one-off script feeds the prototype's saved `d9` replies, across all 8 lectures, through the new deepening code, and the deepened divisions match the prototype's deepened run files exactly. Any difference is explained or fixed.
- [ ] **Live run:** the stage runs for real on one lecture (cost stated first); its deepened subtopic counts fall within the prototype's `d9` range on that lecture.
- [ ] The replay script and results stay in the prototype folder.
