# 11 — A figure mark that points at a slide in another subtopic

**What to build:** Slide relocation makes one call for each subtopic. The call gets only the slides that `place-slides` put in that subtopic. A figure mark in one subtopic can point at a slide that `place-slides` put in another subtopic. The call cannot see that slide, so the mark gets no slide or a wrong slide. The stage must let such a mark point at the right slide.

**Blocked by:** 09 — The slide relocation stage

**Status:** needs-triage

The user accepted this limit for the first version of `relocate-slides` (2026-10-14). The design is not decided. Some options:

- give each call the slides of the subtopics next to it, as well as its own slides
- find the marks with no slide after all the calls, and send each one in a second call with the slides near it
- one call over the whole lecture, as prompt r3 of the prototype does.

- [ ] The prototype run on lecture 4 shows how often a mark points at a slide in another subtopic.
- [ ] The user chooses a design before the build.
- [ ] A mark that points at a slide in another subtopic gets "(Figure N)" for that slide.

## Comments
