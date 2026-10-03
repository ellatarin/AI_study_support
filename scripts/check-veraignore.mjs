/**
 * Fails when `.veraignore` lacks a pattern that `.gitignore` has.
 *
 *     pnpm check:veraignore
 *
 * Vera reads `.veraignore` *instead of* `.gitignore` once the file exists, so
 * `.veraignore` has to repeat every `.gitignore` pattern on top of its own.
 * Without this check the two lists drift, and whatever git ignores — `.env`
 * included — is indexed and can be sent to the reranking API with a search.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "./hooks/lib/repo-root.mjs";
import { isEntryPoint } from "./lib/entry-point.mjs";

/**
 * The patterns in an ignore file, without comments or blank lines.
 *
 * @param {string} ignoreText - The ignore file's contents.
 * @returns {string[]} Each pattern, trimmed.
 */
function ignorePatterns(ignoreText) {
	return ignoreText
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "" && !line.startsWith("#"));
}

/**
 * The `.gitignore` patterns that `.veraignore` does not repeat.
 *
 * @param {object} options - The two files' contents.
 * @param {string} options.gitignoreText - The contents of `.gitignore`.
 * @param {string} options.veraignoreText - The contents of `.veraignore`.
 * @returns {string[]} The missing patterns, in `.gitignore` order; empty when none are missing.
 */
export function patternsMissingFromVeraignore({ gitignoreText, veraignoreText }) {
	const veraignorePatterns = new Set(ignorePatterns(veraignoreText));
	return ignorePatterns(gitignoreText).filter((pattern) => !veraignorePatterns.has(pattern));
}

/**
 * Compares the repo's two ignore files and exits non-zero on a missing pattern.
 * With no `.veraignore`, Vera reads `.gitignore` itself and there is nothing to check.
 */
function check() {
	const veraignorePath = path.join(repoRoot, ".veraignore");
	if (!existsSync(veraignorePath)) return;
	const missing = patternsMissingFromVeraignore({
		gitignoreText: readFileSync(path.join(repoRoot, ".gitignore"), "utf8"),
		veraignoreText: readFileSync(veraignorePath, "utf8"),
	});
	if (missing.length === 0) return;
	console.error(
		`.veraignore is missing these .gitignore patterns, so Vera would index them:\n${missing.map((pattern) => `    ${pattern}`).join("\n")}`,
	);
	process.exitCode = 1;
}

// Importing this module — the test suite does — must not run the check.
if (isEntryPoint(import.meta.url)) {
	check();
}
