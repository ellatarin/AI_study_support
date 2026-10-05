# 02 — Rename everything to the glossary

**What to build:** every name in the code and in the files the pipeline writes uses `CONTEXT.md` terms. The ticket audits the names, the user rules on each proposed rename, and the ticket then makes every rename. It comes before the comment rewording, because comments quote names in backticks. See `../spec.md`.

**Blocked by:** 01

**Status:** ready-for-agent

The ticket covers two kinds of name:

- **Code names:** types, functions, variables, constants, test names and file names in `src/`. Renaming one changes no behaviour, so the type checker is its guard and it needs no new test.
- **Stored names:** keys in the manifest, run logs, saved runs, stage records and the config file; stage ids; command-line flags; folder and file names on disk. The user ruled on 2026-10-05 that these are renamed too, and the existing lectures' files are then fixed by hand. A manifest with renamed keys can stop a workspace being recognised as a lecture, so each fix is done before the next pipeline run.

- [ ] Every code name and stored name that uses a word `CONTEXT.md` avoids, or names a domain concept in an invented way, is listed with its proposed new name and where it is used. Each stored name also lists the existing files that carry it.
- [ ] The user has ruled on each proposal, and the rulings are recorded in this ticket's comments.
- [ ] Every code name is renamed as ruled, in commits of related names.
- [ ] Every stored name is renamed test first: a test that the written file carries the new name fails, then the rename makes it pass.
- [ ] After each stored-name rename, the user is given the list of existing files to fix and how, and confirms the fix before the next stored-name rename lands.
- [ ] Docs that name a renamed thing (technical design, implementation plan, README, config example) use the new name.
- [ ] The commit gate passes after every commit.
