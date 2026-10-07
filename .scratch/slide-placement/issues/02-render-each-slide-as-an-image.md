# 02 — Render each slide as an image

**What to build:** The new stage `render-slides` runs after `judge-lecture-title` on every lecture. It uses no model. It writes one PNG image for each page of the lecture's slide deck. The design is in TD §5, `render-slides`.

**Blocked by:** 01 — Update the design documents to the three slide stages

**Status:** ready-for-agent

- [ ] Before the first edit, check whether stored manifests hold entries for the old stage ids `slide-conversion` and `image-extraction`. If they do, show the user the change to the stored data and wait for agreement.
- [ ] The stage runs after `judge-lecture-title`. It has its stage id, its folder entry and its cost-report label.
- [ ] The stage writes `Slide images/slide-001.png`, `slide-002.png` and so on, one file for each page, numbered from 1 in deck order.
- [ ] The stage fails with a named error when the slide deck is missing or is not a readable PDF. The error names the file.
- [ ] The old stage ids `slide-conversion` and `image-extraction` and the `Slide content` folder entry are removed from the code.
- [ ] The stage records a cost of zero, because it makes no model call.
