# 10 — The notes page

**What to build:** The stage `build-notes-page` after `relocate-slides`. It writes the lecture's notes into `Final output/`: one folder for the lecture, with the page and its slide images. A student opens the page in a browser, with or without a network, and reads the text with each slide at its place.

**Blocked by:** 09 — The slide relocation stage

**Status:** ready-for-agent

The design comes from the parked ticket `.scratch/html-notes/issues/01-show-the-notes-as-an-html-page.md`. Its prototype is the test page script of `slide-placement` ticket 05.

- [x] The technical design and the requirements describe the stage before the build. FR-3.5 says that the slides are in a folder beside the page.
- [x] The stage writes `Final output/<base name>/notes.html` and `Final output/<base name>/slides/`.
- [x] Each slide is the PNG file that `render-slides` writes, copied unchanged. A JPEG file made the slides too distorted (user, 2026-10-14).
- [x] The page shows the topic and subtopic titles and the text of each subtopic, from the output of `relocate-slides`.
- [x] Each slide is small and floats at its sentence. Its figure number and caption are in the right margin.
- [x] The sentence of each slide is highlighted, as in the test page. A later ticket deletes the highlight after the user's tests.
- [x] A figure mark that points at no slide shows as `[FIGURE]`.
- [x] LaTeX in the text and in the captions is turned into maths when the stage builds the page. The page loads nothing from the internet.
- [ ] A click on a slide opens it in a window with a border. The page behind is not greyed out. The user can scroll and read the page behind the window.
- [ ] The user can drag the window by its border and change its size from its corner. The slide grows with the window.
- [ ] A close button and the Esc key close the window. A click on another slide shows that slide in the same window.
- [x] A reset of the stage deletes this lecture's folder from `Final output/`. The folders of the other lectures stay.
- [x] Rename, change-date, delete and normalisation move or delete the lecture's folder in `Final output/`, where they now move or delete a page.
- [ ] A live run on lecture 4 by the user.

## Comments

**2026-10-15, box check:** The design box is done in 1536425d and 073c8443, before the build in b2d997ee. FR-3.5 names the folder beside the page. The box of `notes.html` and `slides/` is done in b2d997ee. The PNG box is done in b2d997ee. A test checks that each PNG is copied byte for byte. The box of the titles and the text is done in b2d997ee. The box of the floating slide and its caption is done in b2d997ee. The highlight box is done in b2d997ee. caeb91cc later adds a config switch for the highlight. The `[FIGURE]` box is done in b2d997ee. The maths box is done in b2d997ee. The reset box is done in 6694633d. The box of rename, change-date, delete and normalisation is done in 11520b83.
