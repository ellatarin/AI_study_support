# 02 — A bar wider than the terminal repeats on new lines

**Status:** needs-triage

**Blocked by:** none

**The problem:** a parallel work bar lists each call in flight, for example "in flight: 1, 2, 3, 6, 4, 7, 8, 9, 10, 11". With 10 calls in flight, the line can be wider than the terminal window. Then the terminal wraps the line onto a second line. The bar redraws itself from the start of the current line, and after a wrap that is the start of the second line. So each update leaves the first line on the screen, and a new copy of the bar starts on a new line.

**What the user saw (2026-10-14):** a batch of the two Genomics of Disease lectures. The read-slides bar ("Slides", 55 slides, `concurrency` 10) printed a new line for each update: "1/55", "2/55", "3/55" and on, one under the other. The end of the last wrapped line, "16, 17", ran into the next stage line, "✔ Retitle subtopics — 1 call, £0.051". That stage line belonged to the other lecture (ticket 01).

This fault does not need two lectures in flight. A single `run` shows it when the bar line is wider than the window.

**What to decide first:** what the bar shows in place of the full list. Possible answers:

- the number of calls in flight, such as "in flight: 10"
- the list, cut to fit the width of the terminal, with "…" at the end.

- [x] The user chooses what the bar shows: the number of calls in flight, such as "in flight: 10" (2026-10-14).
- [ ] A bar line is never wider than the terminal.
- [ ] A test with a narrow fake terminal shows that the bar redraws on one line, with no copies left above it.

## Comments
