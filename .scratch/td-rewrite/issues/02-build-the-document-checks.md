# 02 — Build the programs that check the TD

**Status:** ready-for-agent

**What to build:** scripts in `scripts/`, each with tests, that check a Markdown document. The commit check accepts a script only in `scripts/` with a test. Each script reports the file and the line of each fault.

**Blocked by:** none

- [ ] **STE lint.** The hook library `scripts/hooks/lib/ste-prose.mjs` runs on a whole document, not only on the lines that an edit changed.
- [ ] **Earlier-state words.** A word list finds sentences that describe an earlier state. The list is in `spec.md`, rule 2.
- [ ] **Hanging openings.** The check finds a sentence or list item that opens with What, How, Why, Where, Whether or "Thrown when".
- [ ] **Names in backticks.** Each function, type, constant, file path and config key that the TD names in backticks exists in the code. A name of a stage not yet built is reported apart, not as a fault.
- [ ] **Section references.** Each reference such as `§4.7` or `(§5, "Panel runs")` points to a section, and a heading, that exists. The check reads `src/`, `scripts/`, the TD, the plan and the README.
- [ ] The section-reference check runs in the commit check, so that a later edit cannot break a reference.
- [ ] The dated review records (`docs/code-review-*.md`, `docs/code-review-worklist.md`) are not checked. They record a past state on purpose.

## Comments
