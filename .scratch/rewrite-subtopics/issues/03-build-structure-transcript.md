# 03 — Build `structure-transcript`

**What to build:** After `judge-lecture-title`, each lecture gets its structured transcript. Code makes it from the stored files, with no model call.

**Blocked by:** 02 — Remove the stages that the new design replaces. The old `transcript-structuring` stage writes to a folder with the same name.

**Status:** ready-for-agent

- [x] The stage reads the transcript, the retitled subtopics and the topics. It takes the lecture title from the manifest. (The user ruled 2026-10-08 that the stage does not read the chosen division or the title judgement.)
- [x] The stage writes `Structured transcript/structured-transcript.json`. It holds the lecture title and the topics in lecture order, each with its title. Each topic holds its subtopics in order, each with its subtopic id, its title and its own text.
- [x] The file holds no position in the transcript and no reason that a model gave.
- [x] The text of each subtopic is the lecturer's words, unchanged.
- [x] The stage fails when an input file is missing, unreadable or the wrong shape. The error names the file.
- [x] The stage has a place in the stage order directly after `judge-lecture-title`. It can be the start or the end of a bounded run.
- [ ] A run on one real lecture writes the file. The user can open the file and see each topic with its subtopics.
