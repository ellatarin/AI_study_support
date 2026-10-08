# 07 — Show symbols such as β in captions, not LaTeX code

**Status:** needs-triage

**Blocked by:** none

**The problem:** a caption can hold LaTeX code for a symbol. The reading of slide 32 of the lecture of 2026-03-06 has the caption "Metabolism of $\beta$-naphthylamine to an ultimate carcinogen…". The test page shows the code `$\beta$`, not the symbol β. A student reads the caption under the slide, so the caption must show the symbol.

**What exists:**

- The `read-slides` prompt asks for each formula in the body as LaTeX. It gives no rule for symbols in the caption or in the figure descriptions. The model therefore writes LaTeX there too.
- In lecture 4, one caption (slide 32) and three figure descriptions hold LaTeX. In lecture 3, none do.
- The notes are Markdown, and a later stage makes them into a PDF or a page. LaTeX in the body is right for a formula. A Greek letter in running text does not need LaTeX.

- [ ] The user decides where the change goes. One way is a rule in the `read-slides` prompt: the caption and the figure descriptions use the symbol itself, such as β, and not LaTeX. The other way is a step that shows LaTeX as symbols where the notes are shown.
- [ ] If the change is in the prompt, a test checks that the prompt holds the rule. Then lectures 3 and 4 are read again.
- [ ] The test page shows β on slide 32 of the lecture of 2026-03-06.
