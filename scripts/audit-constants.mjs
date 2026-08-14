/**
 * Finds constants and literals that are declared in more than one file.
 *
 *     pnpm audit:constants           # audits src/
 *     node scripts/audit-constants.mjs <dir>
 *
 * Read-only. jscpd catches duplicated *blocks*; this catches a single value
 * restated in a dozen places, which jscpd cannot see because each occurrence is
 * too small to be a clone. That is how the filesystem layout came to have two
 * owners and how the pipeline order came to be derived from two different maps.
 *
 * It reports by value rather than by name, and it reports everything above the
 * threshold — the point is to find what you were not already looking for.
 * Searching for the literals you happen to suspect only confirms your priors.
 *
 * Module specifiers are excluded by an objective rule (they appear as the target
 * of an import, `vi.mock`, or `require`), never by judging which values look
 * like noise.
 *
 * Four groups are reported, each restricted to values appearing in more than one
 * file and split source-vs-test:
 *   1. `const NAME = …` names declared in several files
 *   2. string literals
 *   3. numeric literals
 *   4. object-property knobs (`maxRetries: 4`) and every value each is given
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.argv[2] ?? "src";

/** Numbers too common to be worth reporting. */
const TRIVIAL_NUMBERS = new Set(["0", "1", "2"]);

/**
 * Every TypeScript file beneath a directory.
 *
 * @param {string} dir - The directory to walk.
 * @returns {string[]} The file paths found.
 */
function walk(dir) {
	const found = [];
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) {
			found.push(...walk(path));
		} else if (name.endsWith(".ts")) {
			found.push(path);
		}
	}
	return found;
}

/**
 * Splits source into code with comments blanked out, and the string literals it
 * held. Done with a character scanner rather than a regex so that a `//` inside
 * a string is not mistaken for a comment, and a quote inside a comment does not
 * open a string.
 *
 * @param {string} source - The file contents.
 * @returns {{ code: string, strings: string[] }} The comment-free code and its strings.
 */
function scan(source) {
	const strings = [];
	let code = "";
	let index = 0;
	while (index < source.length) {
		const char = source[index];
		const next = source[index + 1];
		if (char === "/" && next === "/") {
			while (index < source.length && source[index] !== "\n") index += 1;
			continue;
		}
		if (char === "/" && next === "*") {
			index += 2;
			while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
				index += 1;
			}
			index += 2;
			continue;
		}
		if (char === '"' || char === "'" || char === "`") {
			const quote = char;
			let value = "";
			index += 1;
			while (index < source.length && source[index] !== quote) {
				if (source[index] === "\\") {
					value += source[index + 1];
					index += 2;
					continue;
				}
				value += source[index];
				index += 1;
			}
			index += 1;
			strings.push(value);
			code += '"<str>"';
			continue;
		}
		code += char;
		index += 1;
	}
	return { code, strings };
}

/**
 * Records that a value was seen in a file.
 *
 * @param {Map<string, Set<string>>} counts - The value-to-files map to add to.
 * @param {string} value - The value seen.
 * @param {string} file - The file it was seen in.
 * @returns {void}
 */
function record(counts, value, file) {
	if (!counts.has(value)) counts.set(value, new Set());
	counts.get(value).add(file);
}

const constNames = new Map();
const stringLiterals = new Map();
const numberLiterals = new Map();
const propertyKnobs = new Map();

for (const path of walk(ROOT).sort()) {
	const file = relative(".", path);
	const raw = readFileSync(path, "utf8");
	const { code, strings } = scan(raw);

	// Import targets are not constants anyone could extract.
	const specifiers = new Set(
		[...raw.matchAll(/(?:from|import|vi\.mock|require)\s*\(?\s*["'`]([^"'`]+)["'`]/g)].map(
			(match) => match[1],
		),
	);
	for (const value of strings) {
		if (value.trim().length >= 2 && !specifiers.has(value)) record(stringLiterals, value, file);
	}

	for (const match of raw.matchAll(
		/(?:^|\s)(?:export\s+)?const\s+([A-Z][A-Z0-9_]{2,})\s*(?::[^=]*)?=/g,
	)) {
		record(constNames, match[1], file);
	}

	for (const match of code.matchAll(/(?<![\w.])(\d[\d_]*(?:\.\d+)?)(?![\w.])/g)) {
		if (!TRIVIAL_NUMBERS.has(match[1])) record(numberLiterals, match[1], file);
	}

	for (const match of raw.matchAll(
		/(?<![\w$])([a-z][A-Za-z0-9_]*)\s*:\s*(-?\d[\d_]*(?:\.\d+)?|true|false)(?![\w])/g,
	)) {
		const [, key, value] = match;
		if (!propertyKnobs.has(key)) propertyKnobs.set(key, new Map());
		record(propertyKnobs.get(key), value, file);
	}
}

/**
 * Whether a file is test scaffolding rather than shipped code.
 *
 * @param {string} file - The file path.
 * @returns {boolean} `true` for test and fixture files.
 */
function isTest(file) {
	return file.includes(".test.") || file.endsWith("fixtures.ts");
}

/**
 * Prints one report section.
 *
 * @param {string} title - The section heading.
 * @param {Map<string, Set<string>>} counts - The values and the files holding them.
 * @param {number} minFiles - The number of files a value must appear in to be reported.
 * @returns {void}
 */
function report(title, counts, minFiles) {
	const rows = [...counts.entries()]
		.filter(([, files]) => files.size >= minFiles)
		.sort((left, right) => right[1].size - left[1].size);
	console.log(`\n${"=".repeat(78)}\n${title} — ${rows.length} in ≥${minFiles} files\n${"=".repeat(78)}`);
	for (const [value, files] of rows) {
		const all = [...files];
		const source = all.filter((file) => !isTest(file));
		const tests = all.filter(isTest);
		console.log(`\n[${files.size}] ${JSON.stringify(value)}`);
		if (source.length > 0) console.log(`    src : ${source.join(", ")}`);
		if (tests.length > 0) console.log(`    test: ${tests.join(", ")}`);
	}
}

report("NAMED CONSTANTS declared in several files", constNames, 2);
report("STRING LITERALS", stringLiterals, 2);
report("NUMERIC LITERALS", numberLiterals, 3);

console.log(`\n${"=".repeat(78)}\nPROPERTY KNOBS given literal values\n${"=".repeat(78)}`);
for (const [key, values] of [...propertyKnobs.entries()].sort()) {
	const files = new Set([...values.values()].flatMap((set) => [...set]));
	if (files.size < 2) continue;
	console.log(`\n${key}:`);
	for (const [value, seenIn] of values) {
		console.log(`    = ${value}  (${seenIn.size} files)`);
	}
}
