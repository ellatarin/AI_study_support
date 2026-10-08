# 01 — The bars of lectures in flight share one terminal

**Status:** needs-triage

**Blocked by:** none

**Parked:** the user parked this ticket on 2026-10-08. Other features come first.

**The problem:** a batch runs as many lectures at the same time as `batch.concurrency` allows (technical-design.md §4.7). Each lecture draws its own progress bars on stderr. Each bar thinks that it owns the current line of the terminal. When two lectures draw a bar at the same time, the bars write over each other. The user then sees a line that changes between two bars, or parts of two bars.

The bars that can meet:

- The audio extraction bar.
- The upload bar of transcription.
- The parallel work bar of read-slides ("Slides").
- The parallel work bar of each panel stage ("Runs").

A single `run` command has one lecture in flight, so it does not have this problem.

**What to decide first:** what the user must see during a batch. Possible answers:

- One line for each lecture in flight, with the lecture's name in front of its bar. cli-progress has a `MultiBar` that draws several bars on several lines.
- No bars during a batch, with the stage notices only.

- [ ] The user chooses what a batch shows.
- [ ] A batch with two or more lectures in flight shows no bar that writes over another bar.
- [ ] A single `run` shows the same bars as now.

## Comments
