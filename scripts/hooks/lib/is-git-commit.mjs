#!/usr/bin/env node
/*
 * Classifies the Bash command on stdin for pre-commit-check.
 *
 * Exit 0  — this command commits; run the checks.
 * Exit 10 — it does not; let it through untouched.
 *
 * An unreadable payload exits 10 too, with a note on stderr. Treating it as a
 * commit would run the whole suite ahead of every unrelated Bash call, which is
 * unusable — and it is not the hole A1.1 closed. That hole was the substring
 * test this replaces, which let `git -C . commit` through with a payload it had
 * read perfectly well.
 */

import { isGitCommit } from "./bash-command.mjs";
import { readCommandFromStdin } from "./hook-payload.mjs";

/** Exit code meaning the command is not a commit. */
const NOT_A_COMMIT = 10;

const payload = await readCommandFromStdin();
if (!payload.parsed) {
	process.stderr.write("is-git-commit: hook payload unreadable; treating as not a commit.\n");
	process.exit(NOT_A_COMMIT);
}
process.exit(isGitCommit(payload.command) ? 0 : NOT_A_COMMIT);
