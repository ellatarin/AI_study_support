# Style sheet

The user's corrections from the ticket 03 pilot. Each comment ticket follows these rules, in addition to `brief.md`.

## Length

Ruled 2026-10-06. The user: the comments "are generally really good, however there are so many of them that the code is difficult to read".

- A comment says what the value means.
- If a reader could question the code, the comment also gives the reason, in one sentence.
- If the technical design holds a longer reason, the comment does not repeat it. The comment gives the section, such as "(technical-design.md §6)".
- If the technical design does not hold the reason, the reason stays in the code in full.
- A type that is used only in its own file, and whose name says what it is, gets no comment.
- Most comments have one to three lines.

This changes the earlier ruling in ticket 03 that a comment is not cut only because the technical design says the same thing. The reason still counts. The technical design holds its long form.

Example, `CONFIG_FILENAME` in `src/types/pipeline.ts`:

Before (commit `9bc7b506`):

```ts
/**
 * The name of the configuration file in the project root.
 *
 * The name is declared here, and not in the config loader, because code that the
 * loader imports also names the file. The OpenRouter client and the message for
 * an unconfigured stage tell the user to edit it. `config.ts` imports from
 * `openrouter.ts`, so an import back from `config.ts` would make a cycle
 * (technical-design.md §6).
 */
```

After (commit `4cca3a75`):

```ts
/**
 * The name of the configuration file in the project root. It is here, not in the
 * config loader, to prevent an import cycle (technical-design.md §6).
 */
```

## Review

The user reviews each ticket's comments as a commit diff on GitHub, in split view. Each ticket's rewording is its own commit, with no other change in it.
