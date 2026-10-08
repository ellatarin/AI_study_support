# 07 — Show symbols such as β in captions, not LaTeX code

**Status:** resolved

**Decision (2026-10-08):** the readings keep LaTeX. Each page that shows the notes renders the LaTeX as symbols. The PDF needs no change, because pandoc renders LaTeX. The test page loads KaTeX from cdnjs and renders each caption as MathML, which needs no KaTeX stylesheet or fonts. The parked HTML-notes ticket must do the same.

**Blocked by:** none

**The problem:** a caption can hold LaTeX code for a symbol. The reading of slide 32 of the lecture of 2026-03-06 has the caption "Metabolism of $\beta$-naphthylamine to an ultimate carcinogen…". The test page shows the code `$\beta$`, not the symbol β. A student reads the caption under the slide, so the caption must show the symbol.

**What exists:**

- The `read-slides` prompt asks for each formula in the body as LaTeX. It gives no rule for symbols in the caption or in the figure descriptions. The model therefore writes LaTeX there too.
- In lecture 4, one caption (slide 32) and three figure descriptions hold LaTeX. In lecture 3, none do.
- The notes are Markdown, and a later stage makes them into a PDF or a page. LaTeX in the body is right for a formula. A Greek letter in running text does not need LaTeX.

- [x] The user decides where the change goes. One way is a rule in the `read-slides` prompt: the caption and the figure descriptions use the symbol itself, such as β, and not LaTeX. The other way is a step that shows LaTeX as symbols where the notes are shown. The user chose the second way.
- [x] The test page shows β on slide 32 of the lecture of 2026-03-06.
