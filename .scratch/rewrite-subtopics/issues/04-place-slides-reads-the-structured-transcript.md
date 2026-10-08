# 04 — Change `place-slides` to read the structured transcript

**What to build:** `place-slides` gets each subtopic from the structured transcript. Each placement stores its position inside its subtopic, not inside the whole transcript.

**Blocked by:** 03 — Build `structure-transcript`

**Status:** resolved

- [x] The stage reads the structured transcript in place of the transcript and the retitled subtopics.
- [x] The model gets the same subtopic ids, titles and texts as before. The prompt stays `p2`.
- [x] Each placement stores `positionInSubtopic` in place of `textPosition`. The value is the number of characters from the start of the subtopic text to the placement point.
- [x] The deck-order check compares placements by subtopic order first, then by `positionInSubtopic`.
- [x] A references slide still goes at the end of the last subtopic, with no start words.
- [x] The test page script reads `positionInSubtopic` and shows each slide at its sentence, as before. (Checked on a copy of lecture 3 with the stored `p2` placements converted to `positionInSubtopic`. The page has the same 49 highlighted sentences and the same text before each figure as the `p2` page.)
- [x] The user runs the stage again on lectures 3 and 4. The pages show the slides at the same sentences as the `p2` pages. The ticket records the measured costs.

  Result, 2026-10-08. Each slide stays in the same subtopic as in the `p2` run, and the code puts each slide exactly at the model's start words. Some slides moved within their subtopic. The input to the model was the same as in the `p2` run, so the moves come from the variation between two calls of the model.

  | Lecture | Cost | Prompt tokens | Completion tokens | Slides moved |
  |---|---|---|---|---|
  | Lecture 3 | $0.2136 | 22,616 | 52,431 | 13 of 49: 11 past one filler word such as "Okay?", 2 by one sentence |
  | Lecture 4 | $0.0865 | 23,752 | 18,303 | 21 of 48: 12 by one sentence, 6 by two, 1 each by three, five and eight |

  The user accepted the result, because the slides are in the correct subtopics. The place that matters is the place in the rewritten text. That place is decided after `rewrite-subtopics`.
