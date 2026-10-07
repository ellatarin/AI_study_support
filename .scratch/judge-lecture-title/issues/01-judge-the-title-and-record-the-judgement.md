# 01 — Judge the title and record the judgement

**What to build:** The new stage `judge-lecture-title` runs after `group-into-topics` on every lecture. It reads the retitled subtopics and the chosen topics, and sends the model the whole lecture as topics and subtopics with the provisional title. It makes one call and resends an unusable reply. It fails after the third send. It writes `Title judgement/judgement.json`. In this ticket, the stage does not rename the lecture. The design is in TD §5, `judge-lecture-title`, and the build is in Phase 15 of the implementation plan.

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] The stage runs after `group-into-topics`. It has its stage id, its folder entry, its cost-report label, and an entry in the example config and in the user's config with `openai/gpt-6.1-sol-pro`.
- [ ] The model gets each topic's title with its subtopics' titles and trimmed text, in order, and no subtopic ids or reasons.
- [ ] The model gets the provisional title. An empty provisional title is sent as a statement that the filename carried no title.
- [ ] The prompt is the title part of the `transcript-structuring` prompt. It asks for a one-sentence `judgedBecause`, and it applies `languageRule` to the AI-derived title.
- [ ] The stage resends each of the five unusable replies in TD §5, and fails without writing the judgement after the third send.
- [ ] The stage fails, without calling the model, when the retitled subtopics or the topics are missing, not JSON, or the wrong shape. The error names the file.
- [ ] `judgement.json` holds `provisionalTitle`, `provisionalTitleMeaningful`, `aiDerivedTitle`, `judgedBecause` and `outcome`.
- [ ] For `kept-provisional`, the stage returns no identity changes, and `aiDerivedTitle` is `null` even if the reply proposed a title.
- [ ] For `kept-user-title`, the stage returns only `aiDerivedTitle`.
- [ ] For `adopted-derived`, the stage writes the judgement and returns no identity changes yet. Ticket 02 adds the rename.
- [ ] The shared stage fixture that writes the retitled subtopics also writes the topics. No second fixture is made.
