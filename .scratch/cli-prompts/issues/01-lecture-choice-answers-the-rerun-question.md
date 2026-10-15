# 01 — The choice of a lecture answers the re-run question with "No"

**Status:** needs-triage

**Blocked by:** none

**What happened (2026-10-15):** `run 2026-10-09 --from-stage build-notes-page`
matched two lectures: Genomics of Disease lecture 1 and Host-Pathogen
Interactions lecture 2. The CLI showed the menu "Several lectures share that
date. Which do you mean?". A script chose Genomics of Disease and pressed Enter.
The next question, "Re-running from … (y/N)", then showed "No" at once, before
the script sent "y". The CLI printed "Nothing was run." Nothing was deleted.

The same result came three times, with Enter sent as a carriage return and as a
line feed, and with pauses of up to one second.

**Not known:** whether this also happens when a person types. The script used
`expect`. A person can press keys more slowly, or in another way.

**First step:** the user runs the same command by hand and reports the result.
If the question answers itself, this is a fault in the CLI: the Enter key of the
menu reaches the next question.

## Comments
