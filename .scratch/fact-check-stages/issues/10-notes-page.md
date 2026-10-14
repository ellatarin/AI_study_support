# 10 — The notes page

**What to build:** The stage `build-notes-page` after `relocate-slides`. It writes the lecture's notes into `Final output/`: one folder for the lecture, with the page and its slide images. A student opens the page in a browser, with or without a network, and reads the text with each slide at its place.

**Blocked by:** 09 — The slide relocation stage

**Status:** ready-for-agent

The design comes from the parked ticket `.scratch/html-notes/issues/01-show-the-notes-as-an-html-page.md`. Its prototype is the test page script of `slide-placement` ticket 05.

- [ ] The technical design and the requirements describe the stage before the build. FR-3.5 says that the slides are in a folder beside the page.
- [ ] The stage writes `Final output/<base name>/notes.html` and `Final output/<base name>/slides/`.
- [ ] Each slide is the PNG file that `render-slides` writes, copied unchanged. A JPEG file made the slides too distorted (user, 2026-10-14).
- [ ] The page shows the topic and subtopic titles and the text of each subtopic, from the output of `relocate-slides`.
- [ ] Each slide is small and floats at its sentence. Its figure number and caption are in the right margin.
- [ ] The sentence of each slide is highlighted, as in the test page. A later ticket deletes the highlight after the user's tests.
- [ ] A figure mark that points at no slide shows as `[FIGURE]`.
- [ ] LaTeX in the text and in the captions is turned into maths when the stage builds the page. The page loads nothing from the internet.
- [ ] A click on a slide opens it in a window with a border. The page behind is not greyed out. The user can scroll and read the page behind the window.
- [ ] The user can drag the window by its border and change its size from its corner. The slide grows with the window.
- [ ] A close button and the Esc key close the window. A click on another slide shows that slide in the same window.
- [ ] A reset of the stage deletes this lecture's folder from `Final output/`. The folders of the other lectures stay.
- [ ] Rename, change-date, delete and normalisation move or delete the lecture's folder in `Final output/`, where they now move or delete a page.
- [ ] A live run on lecture 4 by the user.

## Comments
