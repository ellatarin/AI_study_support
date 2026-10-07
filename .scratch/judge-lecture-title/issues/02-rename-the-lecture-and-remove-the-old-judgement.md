# 02 — Rename the lecture, and remove the title judgement from `transcript-structuring`

**What to build:** When the outcome is `adopted-derived`, `judge-lecture-title` gives the lecture its AI-derived title. It moves the source video, the source slide, the workspace and any `Final output/` PDF to the new base name. The order is in TD §5, `judge-lecture-title`, "Order of Operations". The runner records the new title. The rename code moves from `transcript-structuring` to the new stage. `transcript-structuring` then only structures the transcript. After this ticket, only one stage can rename a lecture.

**Blocked by:** 01 — Judge the title and record the judgement

**Status:** ready-for-agent

- [ ] For `adopted-derived`, the video, the slide, the workspace and the PDF move to the new base name. The stage returns `aiDerivedTitle`, `lectureTitle` and `baseName`.
- [ ] For `kept-provisional` and `kept-user-title`, every file stays in place.
- [ ] For each of the three outcomes, the runner writes the right identity changes to the manifest.
- [ ] The stage writes `judgement.json` before it moves the workspace.
- [ ] The `transcript-structuring` prompt sends no provisional title and asks only for `structuredMarkdown`.
- [ ] `transcript-structuring` returns no identity changes and moves no file.
- [ ] The title tests of `transcript-structuring` move to the new stage. No title test stays in the old stage.
