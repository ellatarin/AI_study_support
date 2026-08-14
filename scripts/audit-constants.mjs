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
 * Six groups are reported, split source-vs-test:
 *   1. `const NAME = …` names declared in several files
 *   2. string literals
 *   3. numeric literals
 *   4. object shapes repeated verbatim
 *   5. object-property knobs (`maxRetries: 4`) and every value each is given
 *   6. single-home constants in source — candidates for configuration
 *
 * Groups 1–3 report a value seen in several files *or* several times within one
 * file. Counting files alone missed two whole classes of duplication:
 *
 *   - One home, many uses. `0.0042` was written out eleven times inside a single
 *     suite and never reported, because it lived in one file.
 *   - A shape rather than a value. The same four-field stage entry appeared four
 *     times in one suite; no individual literal in it looked duplicated. Group 4
 *     hashes whole object literals to catch this, below the size at which jscpd
 *     starts calling something a clone.
 *
 * Group 6 exists for a third class the other five *cannot* see: a value with
 * exactly one home that should not be a constant at all. `LANGUAGE_CODE = "eng"`
 * was hardcoded in one stage while the output language sat in config, and no
 * duplication-counting rule could ever have flagged it. So the tool stops
 * counting and simply lists every literal constant in shipped code, for a human
 * to read and ask of each: is this a fact about this codebase, or about the
 * service, the account, or the user's material? Only the second kind is
 * configuration. Expect most of the list to be fine; that is the point.
 *
 * A shared *name* is not a duplicate. `STAGE_ID`, `TRANSCRIPT_TEXT` and
 * `FIXTURE_SECONDS` each hold a different value in every file that declares
 * them. Group 1 reports names; check the values before changing anything.
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
 * @returns {{ code: string, bare: string, strings: string[] }} The code with strings
 *   masked, the same code with strings intact, and the strings themselves.
 */
function scan(source) {
	const strings = [];
	let code = "";
	let bare = "";
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
			bare += JSON.stringify(value);
			continue;
		}
		code += char;
		bare += char;
		index += 1;
	}
	return { code, bare, strings };
}

/**
 * Marks every character that sits inside a string literal, so the brace walk can
 * tell structure from content. The strings here were re-emitted by {@link scan}
 * through `JSON.stringify`, so every one is double-quoted with its escapes
 * normalised.
 *
 * @param {string} text - Comment-free source with its strings intact.
 * @returns {Uint8Array} `1` at each index within a string, `0` elsewhere.
 */
function maskedStringSpans(text) {
	const quoted = new Uint8Array(text.length);
	for (let index = 0; index < text.length; index += 1) {
		if (text[index] !== '"') continue;
		let end = index + 1;
		while (end < text.length && text[end] !== '"') {
			end += text[end] === "\\" ? 2 : 1;
		}
		for (let inner = index; inner <= Math.min(end, text.length - 1); inner += 1) {
			quoted[inner] = 1;
		}
		index = end;
	}
	return quoted;
}

/**
 * Every balanced `{…}` literal in a file, normalised to one line so that two
 * spelt the same but wrapped differently still compare equal.
 *
 * Braces inside string literals are not structure: `"{ not json"` opens nothing.
 * They are masked first, so a string holding an unmatched brace cannot close a
 * real literal early or run a scan off the end of the file.
 *
 * Blocks are excluded rather than judged: anything holding a statement
 * separator, an arrow, or a keyword that only appears in code is a function
 * body or a control structure, not a data literal.
 *
 * @param {string} text - Comment-free source with its strings intact.
 * @returns {string[]} The normalised literals found.
 */
function objectLiterals(text) {
	const found = [];
	const quoted = maskedStringSpans(text);
	for (let start = 0; start < text.length; start += 1) {
		if (text[start] !== "{" || quoted[start] === 1) continue;
		let depth = 0;
		let end = start;
		for (; end < text.length; end += 1) {
			if (quoted[end] === 1) continue;
			if (text[end] === "{") depth += 1;
			else if (text[end] === "}") {
				depth -= 1;
				if (depth === 0) break;
			}
		}
		if (depth !== 0) continue;
		const body = text.slice(start, end + 1);
		if (/[;]|=>|\b(?:function|return|await|if|for|while)\b/.test(body)) continue;
		const normalised = body.replace(/\s+/g, " ").replace(/,\s*}/g, " }").trim();
		// Three properties minimum. A one- or two-field literal is nearly always
		// some API's own option vocabulary — `{ recursive: true, force: true }` is
		// `rm`'s, not ours — and there is no objective way to tell those from our
		// own small shapes. Size is objective, so the threshold is size: a literal
		// big enough to be a design decision rather than a call convention.
		if ((normalised.match(/:/g) ?? []).length < 3) continue;
		if (normalised.length > 240) continue;
		found.push(normalised);
	}
	return found;
}

/**
 * Records one sighting of a value, keeping a per-file tally rather than a set of
 * files, so a value used many times in one place is as visible as one spread
 * across several.
 *
 * @param {Map<string, Map<string, number>>} counts - The value-to-files tally to add to.
 * @param {string} value - The value seen.
 * @param {string} file - The file it was seen in.
 * @returns {void}
 */
function record(counts, value, file) {
	if (!counts.has(value)) counts.set(value, new Map());
	const perFile = counts.get(value);
	perFile.set(file, (perFile.get(file) ?? 0) + 1);
}

/**
 * How many times a value was seen in total, across every file holding it.
 *
 * @param {Map<string, number>} perFile - One value's per-file tally.
 * @returns {number} The total sightings.
 */
function totalSightings(perFile) {
	let total = 0;
	for (const count of perFile.values()) total += count;
	return total;
}

const constNames = new Map();
const stringLiterals = new Map();
const numberLiterals = new Map();
const objectShapes = new Map();
const propertyKnobs = new Map();
/** @type {{ file: string, name: string, value: string, exported: boolean }[]} */
const sourceConstants = [];

for (const path of walk(ROOT).sort()) {
	const file = relative(".", path);
	const raw = readFileSync(path, "utf8");
	const { code, bare, strings } = scan(raw);

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

	for (const shape of objectLiterals(bare)) {
		record(objectShapes, shape, file);
	}

	// Group 6 asks a question about shipped code, so test scaffolding is not
	// listed: a constant in a suite is that suite's own business.
	if (!isTest(file)) {
		for (const match of bare.matchAll(
			/(?:^|\n)(export\s+)?const\s+([A-Za-z][A-Za-z0-9_]*)\s*(?::[^=\n]*)?=\s*("(?:[^"\\]|\\.)*"|-?\d[\d_]*(?:\.\d+)?)\s*;/g,
		)) {
			const [, exported, name, value] = match;
			sourceConstants.push({ file, name, value, exported: exported !== undefined });
		}
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

/** A value in one file is reported once it has been written out this many times. */
const MIN_SIGHTINGS_IN_ONE_FILE = 4;

/**
 * Prints one report section: every value in at least `minFiles` files, plus
 * every value concentrated in a single file but written out often enough to be
 * worth naming.
 *
 * @param {string} title - The section heading.
 * @param {Map<string, Map<string, number>>} counts - The values and their per-file tallies.
 * @param {number} minFiles - The number of files a value must appear in to be reported.
 * @returns {void}
 */
function report(title, counts, minFiles) {
	const rows = [...counts.entries()]
		.filter(
			([, perFile]) =>
				perFile.size >= minFiles || totalSightings(perFile) >= MIN_SIGHTINGS_IN_ONE_FILE,
		)
		.sort(
			(left, right) =>
				right[1].size - left[1].size || totalSightings(right[1]) - totalSightings(left[1]),
		);
	console.log(
		`\n${"=".repeat(78)}\n${title} — ${rows.length} in ≥${minFiles} files, or ≥${MIN_SIGHTINGS_IN_ONE_FILE} times in one\n${"=".repeat(78)}`,
	);
	for (const [value, perFile] of rows) {
		const describe = (file) => {
			const count = perFile.get(file);
			return count === 1 ? file : `${file} (${count}×)`;
		};
		const all = [...perFile.keys()];
		const source = all.filter((file) => !isTest(file)).map(describe);
		const tests = all.filter(isTest).map(describe);
		console.log(`\n[${perFile.size} file(s), ${totalSightings(perFile)}×] ${JSON.stringify(value)}`);
		if (source.length > 0) console.log(`    src : ${source.join(", ")}`);
		if (tests.length > 0) console.log(`    test: ${tests.join(", ")}`);
	}
}

report("NAMED CONSTANTS declared in several files", constNames, 2);
report("STRING LITERALS", stringLiterals, 2);
report("NUMERIC LITERALS", numberLiterals, 2);
report("OBJECT SHAPES repeated verbatim", objectShapes, 2);

console.log(`\n${"=".repeat(78)}\nPROPERTY KNOBS given literal values\n${"=".repeat(78)}`);
for (const [key, values] of [...propertyKnobs.entries()].sort()) {
	const files = new Set([...values.values()].flatMap((perFile) => [...perFile.keys()]));
	if (files.size < 2) continue;
	console.log(`\n${key}:`);
	for (const [value, perFile] of values) {
		console.log(`    = ${value}  (${perFile.size} files)`);
	}
}

console.log(
	`\n${"=".repeat(78)}\nSINGLE-HOME CONSTANTS IN SOURCE — ${sourceConstants.length} to read\n${"=".repeat(78)}`,
);
console.log(
	"\nNot duplication — no counting rule can reach these. For each, ask: is this a\n" +
		"fact about this codebase, or about the service, the account, or the user's\n" +
		"material? Only the second kind belongs in pipeline-config.json. Most of this\n" +
		"list is expected to be fine.\n",
);
let lastFile = "";
for (const { file, name, value, exported } of sourceConstants) {
	if (file !== lastFile) {
		console.log(`\n${file}`);
		lastFile = file;
	}
	// Long values are prose — usage text, prompts — and are never the answer to
	// "should this be configuration?", so they are shown only far enough to
	// recognise.
	const shown = value.length > 72 ? `${value.slice(0, 69)}…` : value;
	console.log(`    ${exported ? "export " : "       "}${name} = ${shown}`);
}
