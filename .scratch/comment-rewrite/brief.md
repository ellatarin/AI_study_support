# Writing comments from the code

This brief is for the agent that does a comment ticket (03 to 13). The work is to write each comment again from what the code does and why it was built that way. The old comment is a claim to test. It is not a draft.

## Before the first file

Read these. They hold the rules, and this brief does not repeat them:

- `CLAUDE.md`, section Documentation: the comment rules.
- `CONTEXT.md`: the terms. Use a term from it for every concept that it defines.
- `spec.md` in this folder, section "Criteria every rewording ticket shares".
- The ticket you are doing, and the Comments sections of tickets 01, 02 and 03. Later rulings overrule earlier ones.
- `style-sheet.md` in this folder, when it exists. It holds the user's corrections from the pilot.

Load the `asd-ste100` skill. A hook blocks comment edits until you do.

## For each declaration

Work through each file in order. A declaration is a type, a constant, a function, a field or a block of logic that has a comment or needs one. Do these steps for each one.

1. **What.** Read the declaration and every place that uses it (`vera references <name>`, or `vera grep`). Done when you can say what a caller sees.
2. **Why.** Find the reason for its shape. Look in this order:
   - the technical design section that covers it
   - `docs/adr/`
   - the ticket that built it (`.scratch/*/issues/`)
   - the commit that added it: `git log -S'<name>' --reverse --format='%h %s' -- <file>`, then `git show <hash>`.
   Done when you have the reason with its source, or you know that no source records one.
3. **Decide.** Write a comment only when it tells a reader something the code does not say. A comment earns its place with one of these:
   - the reason for a choice that a reader would question
   - a constraint or an invariant that the types do not show
   - what a value means in the domain, in `CONTEXT.md` terms
   - the technical design section that specifies it.
   An exported function needs TSDoc for the lint. Give it a one-line summary and one line for each parameter and return value.
4. **Write.** Write the comment from steps 1 and 2. Give the design section reference where one exists.
5. **Test the old comment.** List each fact that the old comment states. Each fact goes to one of these places:
   - into the new comment, after you check it against the code
   - nowhere, because it says nothing a reader needs
   - `divergences.md`, when the code disagrees with it (see below)
   - the "unverified" list in your report, when you cannot check it.
   Done when every fact of the old comment has a place.

## Divergences

A **divergence** is a place where the code disagrees with a statement of intent. A statement of intent is the technical design, the plan, the requirements, an ADR, `CONTEXT.md` or an old comment.

When you find one:

1. Add an entry to `divergences.md`, in the shape that file gives. Quote both sides.
2. Write the new comment to describe what the code does. Leave the design reference off that point, because the reference would claim an agreement that does not exist.
3. Keep the code and the documents as they are. The user decides which side is wrong.

## Each comment is in the code's terms

A comment describes the code as it is now. A reader of the comment learns what the code does and why. Compare the old and the new comment only at step 5, after you write the new one.

## After each file

1. Fix every breach that the STE lint hook reports.
2. Run `node scripts/check-code-unchanged.mjs`. It must report 0 files with code changes. A change to code is outside this work.
3. Read each new comment once more for a subject-first opening. The lint does not check this.

## After each ticket

1. Commit the ticket's files in one commit. The commit hook runs the full gate.
2. Report to the user:
   - the number of comment lines before and after, for each file
   - each divergence you added, by its number
   - the "unverified" list: each old fact you could not check, with its file and line.
