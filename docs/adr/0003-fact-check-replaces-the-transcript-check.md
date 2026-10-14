# A fact check replaces the transcript check

Replaces ADR 0002.

After the rewrite, the pipeline checks the whole rewrite for factual errors and corrects each subtopic that has one. It no longer compares each rewritten subtopic with its transcript text, and it has no rewrite loop. The student needed notes soon, and the fact check and the fact correction were already tried on lecture 4.

## Considered options

**Keep the transcript check, and let it only report its faults.** Rejected. Nothing would act on the faults, and its code and its stage would stay in the pipeline for a report alone.

**Keep the transcript check and the rewrite loop, and add the fact check after the loop.** Rejected for now. The loop was not built, and the student would wait longest.

**Remove the transcript check and the loop, and add the fact check and the fact correction.** What we do. The check can come back from git and ADR 0002 if the notes need it.

## Consequences

- The pipeline cannot find a fault that shows only against the transcript. The fact check gets no transcript. In the lecture 4 trial, the user found five such faults that neither fact check model reported.
- The notes can now differ from the lecture: where the lecturer states a factual error, the notes state the correct fact (CONTEXT.md, **Faithfulness**).
- Each stage runs once. A stage entry has no round, and a stored file has no attempt number.
