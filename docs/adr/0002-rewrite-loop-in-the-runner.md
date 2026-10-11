# The runner repeats the rewrite loop

Term correction, the rewrite and the check are three stages, and the runner repeats them. When the check finds a fault in a subtopic, the runner sends the lecture back to term correction for another round. Only the failed subtopics are worked on again. The runner already orders stages, skips completed work and records each stage entry. A loop inside one stage would make a second copy of that job.

## Considered options

**One stage with all three steps, and the loop inside it.** No shared code changes. But the stage would order its own steps, skip its own saved steps and repeat them. That is a second runner. The manifest and the cost report would show one line for three model jobs, and the check could not be run again alone.

**Three stages with no loop, and the check only reports its faults.** Rejected. There is no tolerance for errors in this part of the notes, and a checker whose faults nothing acts on does not protect the notes.

**Three stages, and the check stage repeats term correction and the rewrite itself.** Rejected. Two places would make a rewrite attempt.

**The runner repeats the three stages.** What we do. Each step keeps its own stage entry, cost line, model and `--from-stage`.

## Consequences

The pipeline is no longer a line, so three rules had to change:

- **"Complete" never goes backwards.** Each stage entry records its round. A stage of the loop is completed only for the round that its entry records. The status `sent-back` tells the runner that the check found failed subtopics and that rounds are left. `complete` still means that the stage finished and that its output can be used.
- **The data goes backwards inside the loop only.** In a later round, term correction and the writer read the faults that the check wrote. The check writes the failed subtopics of each round to a file that the runner reads. The file is written before the runner records the stage, so a crash between the two is safe.
- **A reset starts at the first loop stage.** This is true for a reset of any loop stage. A reset in the middle would keep the saved attempts of a later round. The check results that caused those attempts would be gone.

The run log keeps one entry for each stage in each pipeline run. A loop stage that ran in several rounds records the number of rounds and the total of their costs.

The assembly of the rewritten subtopics is an ordinary stage after the loop. The runner reaches it only when the check passes every subtopic, so no concept of a completed group is needed.
