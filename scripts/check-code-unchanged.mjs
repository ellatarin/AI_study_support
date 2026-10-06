/*
 * Checks that an edit changed comments only.
 *
 * The script prints each changed TypeScript file without its comments, and
 * does the same for the file at a git revision. It reports each file where
 * the two differ. The exit code is 1 when any file differs.
 *
 * Usage: node scripts/check-code-unchanged.mjs [revision]
 * The revision is HEAD when none is given.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import typescript from "typescript";
import { isEntryPoint } from "./lib/entry-point.mjs";

const printer = typescript.createPrinter({ removeComments: true });

/**
 * Prints TypeScript source without its comments.
 *
 * @param {{ fileName: string, text: string }} args - The file name and its source.
 * @returns {string} The source, printed again with no comments.
 */
function withoutComments({ fileName, text }) {
	return printer.printFile(
		typescript.createSourceFile(fileName, text, typescript.ScriptTarget.Latest, true),
	);
}

/**
 * Tells whether two versions of a TypeScript file hold the same code.
 *
 * @param {{ fileName: string, before: string, after: string }} args - The file name and its
 *   two versions.
 * @returns {boolean} True when the versions differ in comments and layout only.
 */
export function sameCode({ fileName, before, after }) {
	return withoutComments({ fileName, text: before }) === withoutComments({ fileName, text: after });
}

/**
 * Lists the TypeScript files whose code changed since a revision.
 *
 * @param {string} revision - The git revision to compare with.
 * @returns {{ checked: number, differing: string[] }} How many changed files were
 *   checked, and the ones whose code changed.
 */
function filesWithCodeChanges(revision) {
	const changedFiles = execFileSync("git", ["diff", "--name-only", revision, "--", "*.ts"], {
		encoding: "utf8",
	})
		.split("\n")
		.filter((fileName) => fileName !== "" && fs.existsSync(fileName));
	const differing = changedFiles.filter(
		(fileName) =>
			!sameCode({
				fileName,
				before: execFileSync("git", ["show", `${revision}:${fileName}`], { encoding: "utf8" }),
				after: fs.readFileSync(fileName, "utf8"),
			}),
	);
	return { checked: changedFiles.length, differing };
}

if (isEntryPoint(import.meta.url)) {
	const { checked, differing } = filesWithCodeChanges(process.argv[2] ?? "HEAD");
	for (const fileName of differing) {
		process.stdout.write(`Code changed: ${fileName}\n`);
	}
	process.stdout.write(
		`${checked} changed file(s) checked, ${differing.length} with code changes.\n`,
	);
	process.exit(differing.length === 0 ? 0 : 1);
}
