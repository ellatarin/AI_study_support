# Ask the model where the transcript divides, not what it says

Cutting a transcript into subtopics is done by asking the model for **cut positions** — a label and the first eight to twelve words of each subtopic, quoted verbatim — and then slicing the original transcript at those quotes ourselves. The model never emits transcript text. This makes losslessness a property of the construction rather than something we hope for and check afterwards: a subtopic is a span of the source by definition, so there is nothing for the model to truncate, reword or re-escape.

## Considered options

**Have the model emit the segmented transcript directly.** The obvious approach, and the one tried first. It truncated on 40% of runs against a 9,226-word lecture, and mangled JSON escaping wherever the lecturer quoted speech. Both failures are silent in the sense that matters — the output is well-formed and plausible, and you only learn what went missing by diffing it against the source.

**Ask for cut positions.** What we do. The failure mode moves from "text was lost" to "a quote could not be located", which is loud, cheap to detect, and reported rather than guessed at.

## Consequences

Checking a run is a **subsequence test**, not a similarity score: every change must be a deletion, at most six characters may go, and the comparison is case-folded. An insertion or substitution is rejected however small — this is what lets us accept the model tidying a seam (`So some` → `Some`) while still rejecting `50 mils` → `50 mm`, which moves the same number of characters but changes a dose.

A model that names a quote we cannot find in the transcript produces a reported failure, not a subtopic. We never fuzzy-match a near-miss into place; losing the guarantee is worse than losing the run.

Deepening inherits this for free. It is handed one oversized subtopic's text and can only add cuts inside it, so it cannot move or lose a cut initial subtopic splitting made.

Grouping is unaffected, and deliberately so. It works on finished subtopics and may not split, merge, reorder or reword them, so no decision it makes can put the text at risk — which is why the two levels are found by separate calls rather than asked for together.
