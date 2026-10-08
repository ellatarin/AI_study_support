# 03 — Build `structure-transcript`

**What to build:** After `judge-lecture-title`, each lecture gets its structured transcript. Code makes it from the stored files, with no model call.

**Blocked by:** 02 — Remove the stages that the new design replaces. The old `transcript-structuring` stage writes to a folder with the same name.

**Status:** ready-for-agent

- [ ] The stage reads the transcript, the chosen division, the retitled subtopics, the topics and the title judgement.
- [ ] The stage writes `Structured transcript/structured-transcript.json`. It holds the lecture title and the topics in lecture order, each with its title. Each topic holds its subtopics in order, each with its subtopic id, its title and its own text.
- [ ] The file holds no position in the transcript and no reason that a model gave.
- [ ] The text of each subtopic is the lecturer's words, unchanged.
- [ ] The stage fails when an input file is missing, unreadable or the wrong shape. The error names the file.
- [ ] The stage has a place in the stage order directly after `judge-lecture-title`. It can be the start or the end of a bounded run.
- [ ] A run on one real lecture writes the file. The user can open the file and see each topic with its subtopics.
