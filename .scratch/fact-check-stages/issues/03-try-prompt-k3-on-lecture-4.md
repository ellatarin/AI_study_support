# 03 — Try prompt k3 on lecture 4

**What to build:** Prompt k3 is k2 with one change: the paragraphs of the subtopic go to the model as a JSON list, with no labels such as "[1]". A prototype run on lecture 4 shows if k3 corrects as well as k2. The user decides which prompt the fact correction stage uses.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] The user sees the k3 text and its difference from k2, and agrees, before the paid run.
- [ ] k3 is a new numbered version in the prototype's prompt registry. k2 does not change.
- [ ] The run uses the factual errors and the rewrite of the f2k2 run, and Sonnet 5.5. Only the prompt differs from f2k2. The cost is about $0.48.
- [ ] Each call's usage is saved, refused tries included.
- [ ] A page shows the k3 result beside the f2k2 result for each subtopic, in full text.
- [ ] The report in the chat counts the replies that held a paragraph label and the replies that changed the number of paragraphs, for k3 and for k2.
- [ ] The user chooses k2 or k3 for ticket 06.

## Comments
