# 02 — Render each slide as an image

**What to build:** The new stage `render-slides` runs after `judge-lecture-title` on every lecture. It uses no model. It writes one PNG image for each page of the lecture's slide deck. The design is in TD §5, `render-slides`.

**Blocked by:** 01 — Update the design documents to the three slide stages

**Status:** resolved

- [x] Before the first edit, check whether stored manifests hold entries for the old stage ids `slide-conversion` and `image-extraction`. If they do, show the user the change to the stored data and wait for agreement.
- [x] The stage runs after `judge-lecture-title`. It has its stage id, its folder entry and its cost-report label.
- [x] The stage writes `Slide images/slide-001.png`, `slide-002.png` and so on, one file for each page, numbered from 1 in deck order.
- [x] The stage fails with a named error when the slide deck is missing or is not a readable PDF. The error names the file.
- [x] The old stage ids `slide-conversion` and `image-extraction` and the `Slide content` folder entry are removed from the code.
- [x] The stage records a cost of zero, because it makes no model call.

**Findings and decisions:**

- All 8 Biology of Disease manifests hold `pending` entries for `slide-conversion` and `image-extraction`. No code reads the manifest's stage map key by key, so the old entries are harmless. The stored data did not change.
- `pdfjs-dist` 6 renders through `@napi-rs/canvas`, which ships prebuilt. It is now a direct dependency. The old `canvas` package was never built on this machine, and no code uses it.
- The stage ids `read-slides` and `place-slides` are in the stage list now, as other stages that are not built are. Tests that used `slide-conversion` as an example of a vision stage now use `read-slides`.
- Both config files had entries for the old ids, so the tool would refuse to start. The entries are now `read-slides` (the vision placeholder) and `place-slides` (a reasoning-model placeholder).
- The lookup of a source file by base name moved from `audio-extraction` into `lecture-files.ts`.
- A new builder, `createSourceFileStage`, builds each stage that reads one source file. `audio-extraction` and `render-slides` now export only their parts: the stage id, the source folder, their error and their work. The user agreed to rename the input field of both stages to `sourceFilePath`.
- The duplication check then still matched two import lines in the two stages. The user agreed to exempt those lines in `render-slides.ts`, with a comment that says why.
