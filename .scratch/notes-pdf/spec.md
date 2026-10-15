# Notes PDF — spec

Status: agreed by the user, 2026-10-15.

This spec states what the notes PDF does. It does not say how to build it. An
agent builds the feature from this spec, test first, with the `/tdd` skill.

## 1. Purpose

The `build-notes-page` stage writes a PDF of the notes as well as the notes
page. A student can print the PDF or read it on a tablet.

## 2. Input

The PDF uses the same input as the notes page. It reads no new file.

## 3. Output

1. The stage writes `notes.pdf` in the lecture's folder in the final output
   folder, beside `notes.html`.
2. The stage writes `notes.pdf` before `notes.html`. A stage that stops part of
   the way leaves no `notes.html`, so the stage does not count as complete.
3. The list of files that the stage reports holds the path of `notes.pdf` and
   the path of `notes.html`.
4. The stage counts as complete only when `notes.html` and `notes.pdf` are both
   on disk. When either file is missing, the next pipeline run builds both files
   again. This makes no model call. A notes folder from before this feature has
   no `notes.pdf`, so its next run builds the PDF.
5. `notes.html` does not change because of this feature.

## 4. What the PDF shows

1. The lecture date, then the lecture title.
2. Each topic title and each subtopic title, in lecture order.
3. The text of the Notes page view: each paragraph of each subtopic.
4. Maths in the text shows the same way as on the notes page.
5. The PDF shows no other page view, no view switch, no list of topic links and
   no sentence highlight. `finalOutput.pageViews` and
   `finalOutput.highlightSlideSentences` have no effect on the PDF.
6. Each page has its page number at the bottom, in the middle.

## 5. Slides

1. Each slide of the notes is at the start of the sentence where its
   discussion starts. This is the same point as on the notes page.
2. Each slide shows the slide image, then its figure number and its caption
   under the image, as "Figure N. caption". A references slide shows
   "References." in place of "Figure N.".
3. Two or more slides at the same point go in the order of their slide
   numbers, lowest first. `relocate-slides` already writes the slides in deck
   order, so the PDF keeps the input order and does not sort the slides.
4. A slide never splits across two pages.
5. The slide width is a percent of the width of the text column, from the config.
6. The space above and the space below each slide come from the config, in
   millimetres. A slide is the image and its caption together, so the space
   below a slide is below its caption.

### 5.1 Slide layout

The paragraph stops at the slide's point. The slide is in the middle of the
column. The paragraph continues under the slide. A slide at the end of a
paragraph goes after the paragraph's text. So a slide divides a paragraph into
blocks of text.

## 6. Page layout

1. The page size is A4.
2. The margin is the same on all four sides, from the config, in millimetres.
3. The text size is from the config, in points.
4. The text fills the width of the page between the margins.
5. A topic title or a subtopic title never splits across two pages.
6. A page never ends with a title. The rules are these:
   - A topic title is on the same page as the first subtopic title of the
     topic.
   - A subtopic title is on the same page as the start of the subtopic. The
     start is at least the first 3 lines of the first paragraph. When the
     subtopic starts with a slide, the start is that whole slide. When a slide
     comes after line 1 of the first paragraph, the start is that line and the
     whole slide. When the first paragraph has fewer than 3 lines, the start is
     the whole paragraph.
   - When the titles and the start do not fit at the bottom of a page, they all
     move to the next page together.
7. A block of text that splits across two pages has at least 3 lines on each
   page. The rule applies to each block of text at any page break, also to a
   block before or after a slide (§5.1).
8. A test does not check §6.5 for a title that wraps onto two lines. The CSS
   rule alone covers it.

### 6.1 The look

The PDF looks like the PDF of the fast version (agreed 2026-10-15). "em" is the
text size, fontSizePt.

| Part | Look |
|---|---|
| Body text | Justified. Line height 1.45 em. Space below a paragraph 0.7 em. |
| Lecture date | 0.75 em, grey (the muted colour), system font, letter spacing 0.08 em, upper case. |
| Lecture title | 2 em, weight 600, line height 1.15. |
| Topic title | 1.45 em, weight 600, line height 1.25. A 2 px line above it in the accent colour, with 0.4 em of space between the line and the title. |
| Subtopic title | 1.15 em, weight 600, line height 1.3. |
| Slide | Caption text 0.85 em, line height 1.35. A 1 px border round the image in the rule colour. 1.5 mm between the image and the caption. |
| Page number | 8 pt, grey, Chrome's footer font, in the middle of the bottom margin. Its baseline is about 6 mm above the bottom edge of the page. |

Tests check the justified text, the line height, the space below a paragraph,
the sizes of the topic title, the subtopic title and the date, and the size and
the height of the page number. The user checks the rest by hand: the colours,
the fonts, the weights, the letter spacing, the line above a topic title, the
border of a slide and the space above a caption.

## 7. Config

A new section `finalOutput.pdf` in `pipeline-config.json`. These names are
agreed.

| Key | Type | Meaning | Example value |
|---|---|---|---|
| `fontSizePt` | number | The text size, in points | 11 |
| `marginMm` | number | The margin on each side of the page, in millimetres | 18 |
| `slideWidthPercent` | number | The slide width, as a percent of the column width | 60 |
| `slideSpaceBeforeMm` | number | The space above each slide, in millimetres | 5 |
| `slideSpaceAfterMm` | number | The space below each slide, in millimetres | 5 |

1. Each key is required.
2. The config check refuses a missing section, a missing key, a value of the
   wrong type, a value of 0, a negative value, and a `slideWidthPercent` above
   100. The error names the key, in the same words as the other config errors.
3. `pipeline-config.example.json` holds the section with the example values.
4. The stage entry and the run log of `build-notes-page` record the
   `finalOutput.pdf` settings that the stage used, beside the page views and the
   highlight switch. `configUsed` holds them under the key `pdf`, with the same
   shape as `finalOutput.pdf`. This name is agreed.

## 8. Failure

1. When the PDF cannot be printed, the stage fails with the stage's named
   error. The message names the path of `notes.pdf` and gives the cause.
2. When the PDF fails, the stage does not write `notes.html`.

## 9. Printing

1. Chrome prints the PDF from an HTML page, through the `puppeteer` package.
   This decision is made.
2. `pnpm install` downloads puppeteer's Chrome. `pnpm-workspace.yaml` allows the
   build script of `puppeteer` (`puppeteer: true` under `allowBuilds`).
   `package.json` takes puppeteer `^25.14.0`. The lockfile is updated with
   `pnpm install --lockfile-only`.
3. The PDF page has its own stylesheet. The CSS that the screen page puts out
   does not change. Colours and fonts that both pages use are stated once, so
   the source of the screen stylesheet changes to take them from one place.
4. The HTML that Chrome prints from holds each slide image as data. The stage
   writes no temporary HTML file.
5. The page number is in the bottom margin. With a small margin, the page
   number can come close to the text. The user checks this by hand (§11).

## 10. Tests

1. Unit tests check the HTML that the PDF prints from, with no Chrome. Examples:
   the place of a slide in a paragraph and at its end, the
   absence of the other page views and of the highlight.
2. Integration tests print a small lecture with Chrome. Then they read the PDF
   back with `pdfjs-dist`, which the project already uses, and check what a
   reader sees. The page-break tests build the content in memory and print it
   with the HTML function and the printer that the stage uses. One test runs
   the whole stage with Chrome, to show that the config reaches the PDF.
   Examples:
   - The text and the slides are in the right order.
   - No page ends with a topic title or a subtopic title.
   - A subtopic title and the first 3 lines of its first paragraph are on one
     page.
   - The page size is A4.
   - The settings from the config change the PDF.
3. Tests of the stage that are not about printing do not start Chrome.
4. Config tests cover each refusal in §7.2, as rows of the existing rejection
   table.
5. A stage test checks §3.4: a notes folder with `notes.html` and no
   `notes.pdf` makes the stage run again, and the run writes both files.

## 11. Checks by hand

A test cannot judge how a page looks. The user checks these on real lectures:

1. The slide size and the space around each slide look right.
2. The text size and the margins look right.
3. The page breaks leave no large empty areas that are a problem.
4. The page number does not come too close to the text (§9.5).

## 12. Documents

1. The technical design, §5 `build-notes-page` and §6 config, describe the PDF.
2. The implementation plan lists the tests.
3. `CONTEXT.md`: the term **Notes PDF** is agreed (2026-10-15). The entries
   **Notes** and **Notes PDF** are written. Use the term in names, test titles
   and comments.
4. The suite version is bumped once, after the other document changes.
5. The work of §12.1, §12.2 and §12.4 happens on `main` after the merge of the
   feature branch. The feature branch holds the CONTEXT.md entries and this
   spec only.

## 13. Not in this feature

1. Smaller slide images, to make the PDF file smaller.
2. Command-line flags that change the PDF settings for one run.
3. A sentence highlight in the PDF.
4. A stage that builds the PDF alone.
