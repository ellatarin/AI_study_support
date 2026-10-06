# Divergences

Each entry is a place where the code and a statement of intent disagree. A statement of intent is the technical design, the plan, the requirements, an ADR, `CONTEXT.md` or an old comment. Nobody edits either side to make them agree. The user decides which side is wrong, and the fix gets its own ticket.

An entry has this shape:

```markdown
## D<n> — <one line that names the disagreement>

- **Where:** `<file>:<line>` (the declaration), found in ticket <nn>.
- **The code does:** <what the code does, with the lines that show it>.
- **The intent says:** <document and section, and a quote>.
- **Other sources:** <any other document that agrees with one side, or "none">.
- **Status:** open
```

When the user rules, the status becomes `code wrong`, `intent wrong` or `both wrong`, with the date and the ticket that makes the fix.

## Entries
