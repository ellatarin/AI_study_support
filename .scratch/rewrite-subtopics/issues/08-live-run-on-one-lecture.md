# 08 — Live run of `rewrite-subtopics` on one lecture

**What to build:** The user runs `rewrite-subtopics` on one lecture and judges the rewritten subtopics. Then the placement after the rewrite gets its design.

**Blocked by:** 07 — Correct misheard terms before each rewrite attempt

**Status:** ready-for-agent

- [ ] The user runs the stage on one lecture. The ticket quotes the measured cost from the manifest.
- [ ] The ticket records the number of rewrite attempts of each subtopic, and each subtopic that failed.
- [ ] The ticket records each correction and each ignored correction. The lecture of 2026-03-06 shows if "beta-naphthylene" becomes "β-naphthylamine".
- [ ] The user judges the rewritten subtopics against the five kinds of detail to keep. The ticket records the judgement.
- [ ] The ticket records the figure marks of each subtopic, beside the slides placed in that subtopic.
- [ ] After the judgement, the user and the agent design the rest of the placement after the rewrite:
  - its stage id
  - what happens when a subtopic has more figure marks than slides, or fewer
  - whether it uses a hint from the first placement.
