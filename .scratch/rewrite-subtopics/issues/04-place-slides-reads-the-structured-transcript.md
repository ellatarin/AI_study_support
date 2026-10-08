# 04 — Change `place-slides` to read the structured transcript

**What to build:** `place-slides` gets each subtopic from the structured transcript. Each placement stores its position inside its subtopic, not inside the whole transcript.

**Blocked by:** 03 — Build `structure-transcript`

**Status:** ready-for-agent

- [ ] The stage reads the structured transcript in place of the transcript and the retitled subtopics.
- [ ] The model gets the same subtopic ids, titles and texts as before. The prompt stays `p2`.
- [ ] Each placement stores `positionInSubtopic` in place of `textPosition`. The value is the number of characters from the start of the subtopic text to the placement point.
- [ ] The deck-order check compares placements by subtopic order first, then by `positionInSubtopic`.
- [ ] A references slide still goes at the end of the last subtopic, with no start words.
- [ ] The test page script reads `positionInSubtopic` and shows each slide at its sentence, as before.
- [ ] The user runs the stage again on lectures 3 and 4. The pages show the slides at the same sentences as the `p2` pages. The ticket records the measured costs.
