# 01 — The bars of lectures in flight share one terminal

**Status:** needs-triage

**Blocked by:** none

**Unparked:** the user parked this ticket on 2026-10-08 and unparked it on 2026-10-14, after the batch of the Genomics of Disease lectures (see Comments).

**The problem:** a batch runs as many lectures at the same time as `batch.concurrency` allows (technical-design.md §4.7). Each lecture draws its own progress bars on stderr. Each bar thinks that it owns the current line of the terminal. When two lectures draw a bar at the same time, the bars write over each other. The user then sees a line that changes between two bars, or parts of two bars.

The bars that can meet:

- The audio extraction bar.
- The upload bar of transcription.
- The parallel work bar of read-slides ("Slides").
- The parallel work bar of each panel stage ("Runs").

A single `run` command has one lecture in flight, so it does not have this problem. The user's config sets `batch.concurrency` to 1, so a batch has the problem only with `--concurrency 2` or more.

**What a test showed (2026-10-08):** two parallel work bars ran at the same time in a fake terminal. Each bar moves the cursor to the start of the current line, clears the line, and draws itself. So the two bars share one line, and the line changes between them several times each second:

```
Slides  |██████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░| 6/53  ETA 8s  in flight: 7, 8
Slides  |██████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░| 6/41  ETA 6s  in flight: 7
```

The terminal shows these two states on one line, one after the other. The two bars have the same label and no lecture name, so the user cannot tell which lecture a bar belongs to. When a bar stops, it leaves its last state on its own line.

**The calls in flight:** each lecture's read-slides stage has its own `concurrency` limit of 10. No limit applies across lectures. So a batch with `--concurrency 3` can have up to 30 read-slides calls in flight, when all three lectures are at read-slides at the same moment.

**What to decide first:** what the user must see during a batch. Possible answers:

- One line for each lecture in flight, with the lecture's name in front of its bar. cli-progress has a `MultiBar` that draws several bars on several lines.
- No bars during a batch, with the stage notices only.

- [x] The user chooses what a batch shows (2026-10-14). Each lecture in flight gets one line. The lecture's name stands in front of its bar and its stage lines.
- [ ] A batch with two or more lectures in flight shows no bar that writes over another bar.
- [ ] A single `run` shows the same bars as now.
- [ ] During a batch, each stage line names its lecture, or sits in the block of its lecture. A stage line is a line such as "▶ Transcription…" or "✔ Transcription — 1 call, £0.175".

## Comments

**2026-10-14, a batch of the two Genomics of Disease lectures with `--concurrency 2`.** The stage lines have the same fault as the bars. The batch prints the heading of each lecture once, at the start. After that, the stage lines of both lectures follow each other with no lecture name. So each line looks as if it belongs to the last heading, "Lecture 2". The line "✔ Transcription — 1 call, £0.175" belonged to Lecture 1. The user read the screen as "Lecture 1 is stalling", stopped the batch, and started it again. The restart sent the Lecture 1 recording to transcription a second time.
