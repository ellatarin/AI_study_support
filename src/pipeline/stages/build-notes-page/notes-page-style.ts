/**
 * The stylesheet and the script of the notes page. The page holds both, so it
 * loads nothing from the internet (technical-design.md §5, `build-notes-page`).
 * The user checks the slide window by hand, because no suite opens the notes
 * page in a browser.
 */

/**
 * The colours of the page in dark mode. Both dark rules of the stylesheet use
 * them: the rule for a dark system setting, and the rule for `data-theme="dark"`.
 */
const DARK_COLOURS = `--paper: #1b1615; --ink: #efe5de; --muted: #b1a39b; --rule: #382d2a; --panel: #241d1b;
  --accent: #dca2cf; --figure-label: #f0a08f; --mark: #40302a;
  --removed-ink: #f2a39a; --removed-bg: #4a2420; --added-ink: #9fdcae; --added-bg: #1f3a27; color-scheme: dark;`;

/**
 * The light colours and the fonts of the notes page, as the CSS rule of `:root`.
 * The Notes PDF uses the same rule.
 */
export const LIGHT_COLOURS_AND_FONTS = `:root {
  --paper: #fbf7f2;
  --ink: #2c2321;
  --muted: #6f625c;
  --rule: #e9ddd5;
  --panel: #f4eae3;
  --accent: #6a3360;
  --figure-label: #b0423f;
  --mark: #f7e2c6;
  --removed-ink: #9b2c2c;
  --removed-bg: #f8dcd8;
  --added-ink: #1f5f33;
  --added-bg: #d9efdc;
  --font-text: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
  --font-ui: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}`;

/** The attribute that holds the note of an element. The page script shows the note in a box. */
export const NOTE_ATTRIBUTE = "data-note";

const NOTED_ELEMENT = `[${NOTE_ATTRIBUTE}]`;

/**
 * The stylesheet of the notes page. The text column is narrow, as in a textbook.
 * Each slide floats at its sentence, and on a wide screen its caption hangs in the
 * right margin. The fonts are system fonts.
 */
export const NOTES_PAGE_STYLE = `
${LIGHT_COLOURS_AND_FONTS}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { ${DARK_COLOURS} }
}
:root[data-theme="dark"] { ${DARK_COLOURS} }
body { margin: 0; background: var(--paper); color: var(--ink); font-family: var(--font-text); font-size: 1.0625rem; line-height: 1.65; }
.page { max-width: 50rem; margin: 0 auto; padding-inline: 16px; padding-block: 2.5rem 5rem; display: grid; gap: 2.5rem; }
header { display: grid; gap: 1rem; }
.eyebrow, .fact-check { font-family: var(--font-ui); font-size: 0.75rem; color: var(--muted); margin: 0; }
.eyebrow { letter-spacing: 0.08em; text-transform: uppercase; }
.fact-check { margin-top: -0.5rem; }
h1 { font-weight: 600; font-size: 2.25rem; line-height: 1.15; margin: 0; text-wrap: balance; }
.legend { margin: 0; font-family: var(--font-ui); font-size: 0.85rem; color: var(--muted); }
.legend mark { padding-inline: 0.2em; }
nav ol { margin: 0; padding-left: 1.4rem; font-family: var(--font-ui); font-size: 0.95rem; display: grid; gap: 0.2rem; }
nav a { color: var(--accent); text-decoration: none; }
nav a:hover { text-decoration: underline; }
.view-switch { margin: 0; padding: 0; border: 0; display: flex; flex-wrap: wrap; gap: 0.25rem 1rem; font-family: var(--font-ui); font-size: 0.9rem; }
.view-switch legend { padding: 0; margin-bottom: 0.25rem; color: var(--muted); font-size: 0.75rem; letter-spacing: 0.08em; text-transform: uppercase; }
.view-switch label { cursor: pointer; }
.view-switch input { accent-color: var(--accent); }
.view, header .legend { display: none; }
.not-in-notes, del { color: var(--removed-ink); background: var(--removed-bg); border-radius: 2px; }
del { text-decoration: line-through; text-decoration-thickness: 1px; }
ins { color: var(--added-ink); background: var(--added-bg); text-decoration: none; border-radius: 2px; }
${NOTED_ELEMENT} { cursor: help; }
${NOTED_ELEMENT}:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
#note { position: fixed; z-index: 1; max-width: min(24rem, calc(100vw - 32px)); padding: 0.45rem 0.65rem; box-sizing: border-box;
  border: 1px solid var(--accent); border-radius: 4px; background: var(--panel); color: var(--ink); box-shadow: 0 6px 20px rgb(0 0 0 / 0.25);
  font: 0.85rem/1.45 var(--font-ui); pointer-events: none; }
.topic { display: grid; gap: 2rem; }
h2 { font-weight: 600; font-size: 1.6rem; line-height: 1.25; margin: 0; padding-top: 1.5rem; border-top: 2px solid var(--accent); text-wrap: balance; }
h3 { font-weight: 600; font-size: 1.2rem; line-height: 1.3; margin: 0 0 0.75rem; text-wrap: balance; }
.subtopic { display: flow-root; }
.subtopic p { margin: 0 0 0.9rem; }
mark { background: var(--mark); color: inherit; border-radius: 2px; }
.nowrap { white-space: nowrap; }
.figure { float: right; clear: right; width: min(62%, 30rem); margin: 0.3rem 0 0.9rem 1.25rem; display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: 0.75rem; align-items: start; font-size: 0.82rem; line-height: 1.4; }
.figure-image { all: unset; order: 1; cursor: zoom-in; display: block; border: 1px solid var(--rule); background: var(--panel); border-radius: 4px; overflow: hidden; }
.figure-image:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.figure-image img { display: block; width: 100%; height: auto; }
.figure-text { order: 2; display: flex; flex-direction: column; gap: 0.35rem; min-width: 0; }
.caption { display: block; }
.figure-label { font-family: var(--font-ui); font-weight: 700; color: var(--figure-label); }
#enlarged { position: fixed; inset: auto; margin: 0; padding: 0.75rem; box-sizing: border-box; display: none; flex-direction: column; gap: 0.5rem;
  border: 2px solid var(--accent); border-radius: 6px; background: var(--paper); color: var(--ink); box-shadow: 0 12px 40px rgb(0 0 0 / 0.35);
  resize: both; overflow: hidden; min-width: 16rem; min-height: 12rem; cursor: move; }
#enlarged[open] { display: flex; }
#enlarged img { flex: 1; min-height: 0; width: 100%; object-fit: contain; cursor: auto; }
#enlarged .figure-text { flex: none; max-height: 30%; overflow: auto; font-size: 0.95rem; line-height: 1.5; cursor: auto; }
#enlarged .close { align-self: flex-end; font: 600 0.85rem var(--font-ui); color: var(--ink); background: var(--panel); border: 1px solid var(--rule); border-radius: 4px; padding: 0.15rem 0.6rem; cursor: pointer; }
@media (min-width: 66rem) {
  .page { max-width: 64rem; }
  main, header { padding-right: 16rem; }
  .figure { width: 31rem; grid-template-columns: 16rem 14rem; gap: 1rem; margin: 0.3rem -15rem 0.9rem 1.25rem; }
}
@media (max-width: 36rem) {
  h1 { font-size: 1.75rem; }
  body { font-size: 1rem; }
  .figure { float: none; width: 100%; margin: 0.75rem 0; grid-template-columns: 1fr; }
}
`;

/**
 * The script of the notes page. A click on a slide shows it in a window that
 * does not cover the page. The reader moves the window by its border and changes
 * its size from its corner. The close button and the Esc key close it. A link
 * to a topic goes to the topic in the page view that shows. A box shows the note
 * of a word when the mouse rests on the word, or when a tap or the keyboard
 * selects it. Esc and a scroll of the page hide the box.
 */
export const NOTES_PAGE_SCRIPT = `
const windowFrame = document.getElementById("enlarged");
const windowImage = windowFrame.querySelector("img");
const windowText = windowFrame.querySelector(".figure-text");
const CORNER_PX = 20;
function placeWindow() {
  const width = Math.min(window.innerWidth * 0.6, 900);
  windowFrame.style.width = width + "px";
  windowFrame.style.height = Math.min(window.innerHeight * 0.7, width * 0.85) + "px";
  windowFrame.style.left = (window.innerWidth - width) / 2 + "px";
  windowFrame.style.top = window.innerHeight * 0.12 + "px";
}
for (const button of document.querySelectorAll(".figure-image")) {
  button.addEventListener("click", () => {
    const image = button.querySelector("img");
    windowImage.src = image.src;
    windowImage.alt = image.alt;
    const parts = button.closest(".figure").querySelector(".figure-text").children;
    windowText.replaceChildren(...[...parts].map((part) => part.cloneNode(true)));
    if (!windowFrame.open) {
      placeWindow();
      windowFrame.show();
    }
  });
}
for (const link of document.querySelectorAll("nav a")) {
  link.addEventListener("click", (event) => {
    const view = document.querySelector('input[name="view"]:checked').value;
    const topic = document.getElementById(view + "-" + link.hash.slice(1));
    if (topic === null) return;
    event.preventDefault();
    topic.scrollIntoView();
  });
}
const noteBox = document.getElementById("note");
const NOTE_GAP_PX = 6;
const NOTE_EDGE_PX = 16;
let noteWord = null;
function showNote(word) {
  noteWord = word;
  noteBox.textContent = word.getAttribute("${NOTE_ATTRIBUTE}");
  noteBox.hidden = false;
  const wordBox = word.getClientRects()[0] ?? word.getBoundingClientRect();
  const box = noteBox.getBoundingClientRect();
  const left = Math.max(NOTE_EDGE_PX, Math.min(wordBox.left, window.innerWidth - box.width - NOTE_EDGE_PX));
  const below = wordBox.bottom + NOTE_GAP_PX;
  const top = below + box.height <= window.innerHeight ? below : wordBox.top - NOTE_GAP_PX - box.height;
  noteBox.style.left = left + "px";
  noteBox.style.top = top + "px";
}
function hideNote() {
  noteWord = null;
  noteBox.hidden = true;
}
document.addEventListener("pointerover", (event) => {
  if (event.pointerType !== "mouse") return;
  const word = event.target.closest("${NOTED_ELEMENT}");
  if (word !== null && word !== noteWord) showNote(word);
});
document.addEventListener("pointerout", (event) => {
  if (event.pointerType !== "mouse") return;
  const word = event.target.closest("${NOTED_ELEMENT}");
  if (word !== null && !word.contains(event.relatedTarget) && word !== document.activeElement) hideNote();
});
document.addEventListener("focusin", (event) => {
  const word = event.target.closest("${NOTED_ELEMENT}");
  if (word !== null) showNote(word);
});
document.addEventListener("focusout", (event) => {
  if (event.target === noteWord) hideNote();
});
window.addEventListener("scroll", hideNote, { passive: true });
windowFrame.querySelector(".close").addEventListener("click", () => windowFrame.close());
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  hideNote();
  if (windowFrame.open) windowFrame.close();
});
windowFrame.addEventListener("pointerdown", (event) => {
  if (event.target !== windowFrame) return;
  const box = windowFrame.getBoundingClientRect();
  if (event.clientX > box.right - CORNER_PX && event.clientY > box.bottom - CORNER_PX) return;
  const startX = event.clientX - box.left;
  const startY = event.clientY - box.top;
  const move = (moveEvent) => {
    windowFrame.style.left = moveEvent.clientX - startX + "px";
    windowFrame.style.top = moveEvent.clientY - startY + "px";
  };
  const stop = () => {
    windowFrame.removeEventListener("pointermove", move);
    windowFrame.removeEventListener("pointerup", stop);
  };
  windowFrame.setPointerCapture(event.pointerId);
  windowFrame.addEventListener("pointermove", move);
  windowFrame.addEventListener("pointerup", stop);
  event.preventDefault();
});
`;
