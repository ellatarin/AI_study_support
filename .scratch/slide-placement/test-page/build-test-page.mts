// Builds the private test page of slide-placement ticket 05 from the stored files of one lecture.
// It is also the prototype of the final output, an HTML page of the notes (html-notes ticket 01).
// The repository checks do not scan .mts files. Run from the repository root:
//   node --experimental-strip-types .scratch/slide-placement/test-page/build-test-page.mts "<workspace folder>" [out.html]
// Each placed slide floats, small, at the sentence where the lecturer starts to discuss it, and
// that sentence is highlighted. A click enlarges the slide. The transcript has no line breaks, so
// the page breaks each subtopic into paragraphs at sentence ends, for display only.

import { readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import sharp from "sharp";

type Subtopic = { start: number; end: number; title: string };
type Topic = { title: string; firstSubtopicId: number };
type Placement = {
	slideNumber: number;
	subtopicId: number;
	startWords?: string | null;
	textPosition?: number;
	placedBecause: string;
};
type Reading = { slideNumber: number; title: string; caption: string; kind: string };

const IMAGE_WIDTH = 1100;
const JPEG_QUALITY = 72;
const PAGE_LIMIT_BYTES = 16 * 1024 * 1024;
const PARAGRAPH_WORDS = 110;

const workspace = process.argv[2] ?? "";
if (workspace === "") {
	console.error("Give the lecture's workspace folder as the first argument.");
	process.exit(1);
}
const outPath =
	process.argv[3] ?? join(import.meta.dirname, `${basename(workspace)} - test page.html`);

async function readJson<TValue>(relative: string): Promise<TValue> {
	return JSON.parse(await readFile(join(workspace, relative), "utf8")) as TValue;
}

const slideFile = (slideNumber: number, extension: string): string =>
	`slide-${String(slideNumber).padStart(3, "0")}.${extension}`;

const escapeHtml = (text: string): string =>
	text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The Greek letters, by their LaTeX names, as text characters. */
const GREEK_LETTERS: Readonly<Record<string, string>> = Object.fromEntries(
	"alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega"
		.split(" ")
		.flatMap((name, index) => {
			const lower = String.fromCodePoint(0x3b1 + index + (index >= 17 ? 1 : 0));
			const capital = name[0]?.toUpperCase() + name.slice(1);
			return [
				[name, lower],
				[capital, lower.toUpperCase()],
			];
		}),
);

/**
 * Escapes a caption for HTML, and shows a LaTeX part that is only a Greek letter,
 * such as $\beta$, as the plain letter in the text font. The letter and the word
 * that it joins with a hyphen stay on one line. KaTeX renders every other LaTeX part.
 */
function captionHtml(caption: string): string {
	return escapeHtml(caption).replace(/\$\\([A-Za-z]+)\$(-[^\s,.;:]+)?/g, (part, name, joined) => {
		const letter = GREEK_LETTERS[name];
		if (letter === undefined) return part;
		return joined === undefined ? letter : `<span class="nowrap">${letter}${joined}</span>`;
	});
}

const transcript = (await readFile(join(workspace, "Transcript/transcript.txt"), "utf8")).trim();
const subtopics = await readJson<Subtopic[]>("Retitled subtopics/subtopics.json");
const topics = await readJson<Topic[]>("Topics/topics.json");
const { promptVersion, placements } = await readJson<{
	promptVersion?: string;
	placements: Placement[];
}>("Slide placements/placements.json");
const manifest = await readJson<{
	lectureTitle: string;
	lectureDate: string;
	stages: Record<string, { cost?: { costUsd: number | null }; configUsed?: { modelId?: string } }>;
}>("manifest.json");
const readings = new Map<number, Reading>();
for (const name of (await readdir(join(workspace, "Slide readings"))).filter((file) =>
	file.endsWith(".json"),
)) {
	const reading = await readJson<Reading>(join("Slide readings", name));
	readings.set(reading.slideNumber, reading);
}

/** The JPEG of one slide, as a data URI. */
async function slideImage(slideNumber: number): Promise<string> {
	const png = await readFile(join(workspace, "Slide images", slideFile(slideNumber, "png")));
	const jpeg = await sharp(png)
		.resize({ width: IMAGE_WIDTH, withoutEnlargement: true })
		.jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
		.toBuffer();
	return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
}

// Figures are numbered in reading order, which is deck order because placements never go back.
const figureNumbers = new Map(placements.map((placement, index) => [placement.slideNumber, index + 1]));

/** A slide as an inline figure that floats in the paragraph. Spans keep the paragraph valid HTML. */
async function figureHtml(placement: Placement): Promise<string> {
	const reading = readings.get(placement.slideNumber);
	const figureNumber = figureNumbers.get(placement.slideNumber);
	return `<span class="figure" role="figure" aria-label="Figure ${figureNumber}">
<span class="figure-text">
<span class="caption"><span class="figure-label">Figure ${figureNumber}.</span> ${captionHtml(reading?.caption ?? "(no reading)")}</span>
</span>
<button class="figure-image" type="button" aria-label="Show figure ${figureNumber} larger"><img src="${await slideImage(placement.slideNumber)}" alt="${escapeHtml(reading?.title || `Slide ${placement.slideNumber}`)}" loading="lazy"></button>
</span>`;
}

/** The end of each sentence in `text`, as a position after its closing mark and spaces. */
function sentenceEnds(text: string): number[] {
	const ends: number[] = [];
	for (const match of text.matchAll(/[.?!]["')\]]?\s+(?=["'(]?[A-Z0-9])/g)) {
		ends.push((match.index ?? 0) + match[0].length);
	}
	ends.push(text.length);
	return ends;
}

/** Paragraph spans of about {@link PARAGRAPH_WORDS} words, cut only at sentence ends. */
function paragraphSpans(text: string): Array<[number, number]> {
	const spans: Array<[number, number]> = [];
	let from = 0;
	for (const end of sentenceEnds(text)) {
		const words = text.slice(from, end).trim().split(/\s+/).length;
		if (words >= PARAGRAPH_WORDS || end === text.length) {
			spans.push([from, end]);
			from = end;
		}
	}
	return spans;
}

/** One subtopic's text as paragraphs, with each figure at its point and its sentence marked. */
async function subtopicTextHtml(subtopic: Subtopic, placed: Placement[]): Promise<string> {
	const text = transcript.slice(subtopic.start, subtopic.end);
	const ends = sentenceEnds(text);
	// A placement from prompt p1 has no position, so it goes at the start of its subtopic.
	const points = placed.map((placement) => ({
		placement,
		at: Math.min(Math.max((placement.textPosition ?? subtopic.start) - subtopic.start, 0), text.length),
	}));
	const marks = new Map<number, number>();
	for (const { placement, at } of points) {
		if (placement.startWords) marks.set(at, ends.find((end) => end > at) ?? text.length);
	}
	const paragraphs: string[] = [];
	const spans = paragraphSpans(text);
	for (const [index, [from, to]] of spans.entries()) {
		const isLast = index === spans.length - 1;
		const cuts = [
			...new Set([
				...points.filter(({ at }) => at >= from && (at < to || (isLast && at === to))).map(({ at }) => at),
				...[...marks.entries()].flatMap(([at, end]) => (at >= from && at < to ? [Math.min(end, to)] : [])),
			]),
		].sort((a, b) => a - b);
		let cursor = from;
		let html = "";
		let markEnd = -1;
		for (const cut of cuts) {
			const piece = escapeHtml(text.slice(cursor, cut));
			html += cursor < markEnd ? `<mark>${piece}</mark>` : piece;
			cursor = cut;
			for (const { placement } of points.filter(({ at }) => at === cut)) {
				html += await figureHtml(placement);
			}
			const end = marks.get(cut);
			if (end !== undefined) markEnd = Math.min(end, to);
		}
		const rest = escapeHtml(text.slice(cursor, to));
		html += cursor < markEnd ? `<mark>${rest}</mark>` : rest;
		paragraphs.push(`<p>${html}</p>`);
	}
	return paragraphs.join("\n");
}

const sections: string[] = [];
const contents: string[] = [];
for (const [topicIndex, topic] of topics.entries()) {
	const nextFirstId = topics[topicIndex + 1]?.firstSubtopicId ?? subtopics.length + 1;
	contents.push(`<li><a href="#topic-${topicIndex + 1}">${escapeHtml(topic.title)}</a></li>`);
	const subtopicSections: string[] = [];
	for (let subtopicId = topic.firstSubtopicId; subtopicId < nextFirstId; subtopicId++) {
		const subtopic = subtopics[subtopicId - 1];
		if (subtopic === undefined) continue;
		const placed = placements.filter((placement) => placement.subtopicId === subtopicId);
		const slideCount = placed.length === 1 ? "1 slide" : `${placed.length} slides`;
		subtopicSections.push(`<section class="subtopic" id="subtopic-${subtopicId}">
  <h3><span class="subtopic-id">Subtopic ${subtopicId} · ${slideCount}</span>${escapeHtml(subtopic.title)}</h3>
  ${await subtopicTextHtml(subtopic, placed)}
</section>`);
	}
	sections.push(`<section class="topic" id="topic-${topicIndex + 1}">
  <h2><span class="topic-number">Topic ${topicIndex + 1}</span>${escapeHtml(topic.title)}</h2>
  ${subtopicSections.join("\n")}
</section>`);
}

const stage = manifest.stages["place-slides"];
const cost = stage?.cost?.costUsd;
const kinds = [...readings.values()].reduce<Record<string, number>>((counts, reading) => {
	counts[reading.kind] = (counts[reading.kind] ?? 0) + 1;
	return counts;
}, {});
const facts = [
	`${placements.length} slides placed of ${readings.size}`,
	`${kinds["content-free"] ?? 0} content-free not shown`,
	`Model ${stage?.configUsed?.modelId ?? "unknown"}`,
	`Prompt ${promptVersion ?? "unknown"}`,
	cost === null || cost === undefined ? "Cost unknown" : `Cost $${cost.toFixed(4)}`,
];

const page = `<title>${escapeHtml(manifest.lectureTitle)} slides</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Figtree:wght@500;600;700&family=IBM+Plex+Mono:wght@500&family=Literata:opsz,wght@7..72,400;7..72,600&display=swap">
<style>
/* Layout: a textbook reading column; each slide sits at its sentence, with its description in the right margin on wide screens. */
:root {
  --paper: #fafafd;
  --ink: #1d2030;
  --muted: #5d6276;
  --rule: #dcdfea;
  --panel: #f0f0f7;
  --haem: #4a3f9c;   /* haematoxylin violet: headings and links */
  --eosin: #b8426f;  /* eosin pink: figure labels */
  --mark: #ece7fb;   /* the sentence where a slide's discussion starts */
  --font-text: "Literata", Georgia, "Times New Roman", serif;
  --font-ui: "Figtree", "Segoe UI", system-ui, sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, Menlo, monospace;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --paper: #13141b; --ink: #e6e7ef; --muted: #a2a6b8; --rule: #2b2e3c; --panel: #1b1d27;
    --haem: #a99df0; --eosin: #ef8db4; --mark: #2a2547; color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --paper: #13141b; --ink: #e6e7ef; --muted: #a2a6b8; --rule: #2b2e3c; --panel: #1b1d27;
  --haem: #a99df0; --eosin: #ef8db4; --mark: #2a2547; color-scheme: dark;
}
body { background: var(--paper); color: var(--ink); font-family: var(--font-text); font-size: 1.0625rem; line-height: 1.65; }
.page { max-width: 50rem; margin: 0 auto; padding-inline: 16px; padding-block: 2.5rem 5rem; display: grid; gap: 2.5rem; }
header { display: grid; gap: 1rem; }
.eyebrow { font-family: var(--font-ui); font-size: 0.75rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); margin: 0; }
h1 { font-weight: 600; font-size: 2.25rem; line-height: 1.15; margin: 0; text-wrap: balance; }
.facts { display: flex; flex-wrap: wrap; gap: 0.4rem 1.25rem; margin: 0; padding: 0; list-style: none; font-family: var(--font-ui); font-size: 0.85rem; color: var(--muted); font-variant-numeric: tabular-nums; }
.legend { margin: 0; font-family: var(--font-ui); font-size: 0.85rem; color: var(--muted); }
.legend mark { padding-inline: 0.2em; }
nav ol { margin: 0; padding-left: 1.4rem; font-family: var(--font-ui); font-size: 0.95rem; display: grid; gap: 0.2rem; }
nav a { color: var(--haem); text-decoration: none; }
nav a:hover { text-decoration: underline; }
.topic { display: grid; gap: 2rem; }
h2 { font-weight: 600; font-size: 1.6rem; line-height: 1.25; margin: 0; padding-top: 1.5rem; border-top: 2px solid var(--haem); text-wrap: balance; }
h3 { font-weight: 600; font-size: 1.2rem; line-height: 1.3; margin: 0 0 0.75rem; text-wrap: balance; }
.topic-number, .subtopic-id { display: block; font-family: var(--font-ui); font-weight: 600; font-size: 0.72rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--haem); margin-bottom: 0.25rem; }
.subtopic-id { color: var(--muted); }
.subtopic { display: flow-root; }
.subtopic p { margin: 0 0 0.9rem; }
mark { background: var(--mark); color: inherit; border-radius: 2px; }
.nowrap { white-space: nowrap; }
/* A small slide: image on the left, caption and reason on its right, so each block is short. */
.figure { float: right; clear: right; width: min(62%, 30rem); margin: 0.3rem 0 0.9rem 1.25rem; display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: 0.75rem; align-items: start; font-size: 0.82rem; line-height: 1.4; }
.figure-image { order: 1; }
.figure-text { order: 2; display: flex; flex-direction: column; gap: 0.35rem; min-width: 0; }
.figure-image { all: unset; cursor: zoom-in; display: block; border: 1px solid var(--rule); background: var(--panel); border-radius: 4px; overflow: hidden; }
.figure-image:focus-visible { outline: 2px solid var(--haem); outline-offset: 2px; }
.figure-image img { display: block; width: 100%; height: auto; }
.caption { display: block; }
.figure-label { font-family: var(--font-ui); font-weight: 700; color: var(--eosin); }
/* An enlarged slide: image on top, caption and reason underneath. */
dialog { border: none; padding: 0.75rem; background: var(--paper); color: var(--ink); border-radius: 6px; max-width: min(96vw, 1400px); }
dialog::backdrop { background: rgb(10 10 16 / 0.82); }
dialog img { display: block; max-width: 100%; max-height: 78vh; margin-inline: auto; border-radius: 4px; }
dialog .figure-text { max-width: 60rem; margin: 0.75rem auto 0; font-size: 0.95rem; line-height: 1.5; }
/* A wide screen: the image sits in the text at its sentence, and its description hangs in the right margin. */
@media (min-width: 66rem) {
  .page { max-width: 64rem; }
  main, header { padding-right: 16rem; }
  .figure { width: 31rem; grid-template-columns: 16rem 14rem; gap: 1rem; margin: 0.3rem -15rem 0.9rem 1.25rem; }
}
@media (max-width: 36rem) {
  h1 { font-size: 1.75rem; }
  body { font-size: 1rem; }
  .figure { float: none; width: 100%; margin: 0.75rem 0; grid-template-columns: 1fr; }
  .figure-text { order: 2; }
}
@media (prefers-reduced-motion: no-preference) { .figure-image img { transition: transform 0.15s; } .figure-image:hover img { transform: scale(1.02); } }
</style>
<div class="page">
  <header>
    <p class="eyebrow">Slide placement test · ${escapeHtml(manifest.lectureDate)}</p>
    <h1>${escapeHtml(manifest.lectureTitle)}</h1>
    <ul class="facts">${facts.map((fact) => `<li>${escapeHtml(fact)}</li>`).join("")}</ul>
    <p class="legend">Each slide sits at the sentence where the lecturer starts to discuss it. That sentence is <mark>highlighted</mark>. Click a slide to enlarge it.</p>
    <nav aria-label="Topics"><ol>${contents.join("")}</ol></nav>
  </header>
  <main>${sections.join("\n")}</main>
</div>
<dialog id="enlarged"><img alt=""><span class="figure-text"></span></dialog>
<script src="https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/contrib/auto-render.min.js"></script>
<script>
// Captions can hold LaTeX, such as $\\beta$. MathML output needs no KaTeX stylesheet or fonts.
if (window.renderMathInElement) {
  for (const caption of document.querySelectorAll(".caption")) {
    renderMathInElement(caption, { delimiters: [{ left: "$", right: "$", display: false }], output: "mathml", throwOnError: false });
  }
}
const dialog = document.getElementById("enlarged");
const enlarged = dialog.querySelector("img");
const enlargedText = dialog.querySelector(".figure-text");
for (const button of document.querySelectorAll(".figure-image")) {
  button.addEventListener("click", () => {
    const img = button.querySelector("img");
    enlarged.src = img.src;
    enlarged.alt = img.alt;
    enlargedText.replaceChildren(...[...button.closest(".figure").querySelector(".figure-text").children].map((part) => part.cloneNode(true)));
    dialog.showModal();
  });
}
dialog.addEventListener("click", () => dialog.close());
</script>
`;

await writeFile(outPath, page);
const size = Buffer.byteLength(page);
console.log(`Wrote ${outPath}`);
console.log(`${placements.length} figures, ${(size / 1024 / 1024).toFixed(2)} MB`);
if (size > PAGE_LIMIT_BYTES) {
	console.error("The page is over 16 MB. Lower IMAGE_WIDTH or JPEG_QUALITY.");
	process.exit(1);
}
