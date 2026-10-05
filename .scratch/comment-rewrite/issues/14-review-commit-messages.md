# 14 — Review every commit message

**What to build:** every commit message in the history reviewed against the commit-message rules in `CLAUDE.md` (Version Control), and reworded where it fails them. The review covers the whole message: the subject line and the body.

The subject must start with a verb that names the change, and say what changed to what. 21 subjects still start with "Say" or "Use", for example "Say each of Stage 0's rules once". The body must be in the same ASD-STE100 style as comments, and must use the glossary terms in `CONTEXT.md`.

**Blocked by:** 02

**Status:** ready-for-human

- [ ] Ticket 02 (the renaming work) is finished, so the review sees the final vocabulary.
- [ ] A backup of the repository is made before any history is rewritten, and its location is recorded in this ticket's comments.
- [ ] Every commit message is reviewed, subject and body, and each failing one is reworded.
- [ ] The file contents of the rewritten history are identical to the original: `git diff <old head> <new head>` is empty.
- [ ] The user approves the force-push before it runs. Every later commit gets a new ID, so notes, memory and tickets that cite old commit IDs are listed and updated.
