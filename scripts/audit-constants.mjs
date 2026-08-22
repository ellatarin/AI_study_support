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
import { pathToFileURL } from "node:url";

/** The directory audited when the command line names none. */
const DEFAULT_ROOT = "src";

/** Numbers too common to be worth reporting. */
const TRIVIAL_NUMBERS = new Set(["0", "1", "2"]);

/**
 * What a numeric literal looks like, named once because three patterns embed it
 * and they must agree. They did not: the bare-number pattern used to omit the
 * sign, so `-1` was recorded as `1` and then discarded as trivial.
 */
const NUMBER_SOURCE = String.raw`-?\d[\d_]*(?:\.\d+)?`;

/** The file extensions holding code this tool can read. */
const CODE_EXTENSIONS = [".ts", ".tsx", ".js", ".mjs", ".cjs"];

/**
 * Escape sequences that denote a character other than the one written. Anything
 * absent — `\\`, `\"`, `\'` — denotes itself.
 */
const STRING_ESCAPES = new Map([
	["n", "\n"],
	["t", "\t"],
	["r", "\r"],
	["b", "\b"],
	["f", "\f"],
	["v", "\v"],
	["0", "\0"],
]);

/**
 * Characters after which a `/` opens a regular expression rather than dividing.
 * A value cannot precede a regex, so anything that ends an expression — a name,
 * a number, `)`, `]` — is division.
 */
const REGEX_MAY_FOLLOW = new Set([
	"(",
	",",
	"=",
	":",
	"[",
	"!",
	"&",
	"|",
	"?",
	"{",
	"}",
	";",
	"+",
	"-",
	"*",
	"%",
	"^",
	"~",
	"<",
	">",
]);

/** Keywords after which a `/` opens a regular expression. */
const REGEX_MAY_FOLLOW_KEYWORD =
	/\b(?:return|typeof|instanceof|case|in|of|do|else|yield|await|new|delete|void|throw)$/;

/**
 * Every code file beneath a directory, declaration files excluded: a `.d.ts`
 * describes types that exist elsewhere and declares no constant anyone could
 * extract.
 *
 * @param {string} dir - The directory to walk.
 * @returns {string[]} The file paths found.
 */
export function walk(dir) {
	const found = [];
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) {
			found.push(...walk(path));
			continue;
		}
		if (name.endsWith(".d.ts")) continue;
		if (CODE_EXTENSIONS.some((extension) => name.endsWith(extension))) found.push(path);
	}
	return found;
}

/**
 * Whether a `/` at the end of the code scanned so far opens a regular
 * expression rather than dividing.
 *
 * @param {string} precedingCode - Everything emitted as code before the slash.
 * @returns {boolean} True when a regex may start here.
 */
function startsRegex(precedingCode) {
	const trimmed = precedingCode.trimEnd();
	if (trimmed === "") return true;
	if (REGEX_MAY_FOLLOW.has(trimmed[trimmed.length - 1])) return true;
	return REGEX_MAY_FOLLOW_KEYWORD.test(trimmed);
}

/**
 * Reads one backslash escape, so that `\n` is recorded as a newline rather than
 * as the letter n — which used to make `"a\nb"` and `"anb"` the same value.
 *
 * @param {object} position - Where the escape starts.
 * @param {string} position.source - The file contents.
 * @param {number} position.index - The index of the backslash.
 * @returns {{ value: string, next: number }} The character denoted, and the index after it.
 */
function readEscape({ source, index }) {
	const escaped = source[index + 1];
	/**
	 * Decodes a hex code point, falling back to the raw text when it is malformed.
	 *
	 * @param {object} span - The digits to decode.
	 * @param {string} span.digits - The hex digits.
	 * @param {number} span.next - The index after the sequence.
	 * @returns {{ value: string, next: number }} The character, and where to resume.
	 */
	const fromHex = ({ digits, next }) => {
		const code = Number.parseInt(digits, 16);
		if (Number.isNaN(code)) return { value: escaped, next: index + 2 };
		return { value: String.fromCodePoint(code), next };
	};
	if (escaped === "u" && source[index + 2] === "{") {
		const close = source.indexOf("}", index + 3);
		if (close !== -1) {
			return fromHex({ digits: source.slice(index + 3, close), next: close + 1 });
		}
	}
	if (escaped === "u")
		return fromHex({ digits: source.slice(index + 2, index + 6), next: index + 6 });
	if (escaped === "x")
		return fromHex({ digits: source.slice(index + 2, index + 4), next: index + 4 });
	return { value: STRING_ESCAPES.get(escaped) ?? escaped, next: index + 2 };
}

/**
 * Scans source from an index, optionally stopping at the `}` that closes a
 * template interpolation. Done with a character scanner rather than a regex so
 * that a `//` inside a string is not mistaken for a comment, a quote inside a
 * comment or a regex character class does not open a string, and the expression
 * inside `${…}` is read as the code it is rather than swallowed as prose.
 *
 * @param {object} span - The region to scan.
 * @param {string} span.source - The file contents.
 * @param {number} span.startIndex - Where to start.
 * @param {boolean} span.stopAtUnmatchedBrace - Whether a `}` at depth zero ends the scan.
 * @returns {{ code: string, bare: string, strings: string[], end: number }} The code with
 *   strings masked, the same code with strings intact, the strings themselves, and the
 *   index just past where the scan stopped.
 */
function scanSegment({ source, startIndex, stopAtUnmatchedBrace }) {
	const strings = [];
	let code = "";
	let bare = "";
	let index = startIndex;
	let braceDepth = 0;

	/**
	 * Records one completed string literal and leaves a marker in its place.
	 *
	 * @param {string} value - The literal's contents.
	 * @returns {void}
	 */
	const pushString = (value) => {
		strings.push(value);
		code += '"<str>"';
		bare += JSON.stringify(value);
	};

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
		if (char === "/" && startsRegex(code)) {
			index += 1;
			let inCharacterClass = false;
			while (index < source.length && source[index] !== "\n") {
				const inner = source[index];
				if (inner === "\\") {
					index += 2;
					continue;
				}
				if (inner === "[") inCharacterClass = true;
				else if (inner === "]") inCharacterClass = false;
				else if (inner === "/" && !inCharacterClass) break;
				index += 1;
			}
			index += 1;
			while (index < source.length && /[a-z]/.test(source[index])) index += 1;
			code += "/<re>/";
			bare += "/<re>/";
			continue;
		}

		if (char === '"' || char === "'" || char === "`") {
			const quote = char;
			const isTemplate = quote === "`";
			let value = "";
			let pushedAny = false;
			index += 1;
			while (index < source.length && source[index] !== quote) {
				if (source[index] === "\\") {
					const decoded = readEscape({ source, index });
					value += decoded.value;
					index = decoded.next;
					continue;
				}
				if (isTemplate && source[index] === "$" && source[index + 1] === "{") {
					// The literal text either side of an interpolation is a value in its
					// own right; the expression between them is code, and is scanned as
					// code so the constants inside it are not hidden.
					if (value !== "") {
						pushString(value);
						pushedAny = true;
						value = "";
					}
					const inner = scanSegment({
						source,
						startIndex: index + 2,
						stopAtUnmatchedBrace: true,
					});
					code += inner.code;
					bare += inner.bare;
					strings.push(...inner.strings);
					index = inner.end;
					continue;
				}
				value += source[index];
				index += 1;
			}
			index += 1;
			// A template that ended on an interpolation has already contributed its
			// text; anything else contributes exactly one value, empty or not, so the
			// masked code keeps a marker where the literal stood.
			if (!isTemplate || value !== "" || !pushedAny) pushString(value);
			continue;
		}

		if (stopAtUnmatchedBrace) {
			if (char === "{") {
				braceDepth += 1;
			} else if (char === "}") {
				if (braceDepth === 0) return { code, bare, strings, end: index + 1 };
				braceDepth -= 1;
			}
		}

		code += char;
		bare += char;
		index += 1;
	}
	return { code, bare, strings, end: index };
}

/**
 * Splits source into code with comments blanked out, and the string literals it
 * held.
 *
 * @param {string} source - The file contents.
 * @returns {{ code: string, bare: string, strings: string[] }} The code with strings
 *   masked, the same code with strings intact, and the strings themselves.
 */
export function scan(source) {
	const { code, bare, strings } = scanSegment({
		source,
		startIndex: 0,
		stopAtUnmatchedBrace: false,
	});
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
export function objectLiterals(text) {
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
 * @param {object} sighting - The sighting to record.
 * @param {Map<string, Map<string, number>>} sighting.counts - The value-to-files tally to add to.
 * @param {string} sighting.value - The value seen.
 * @param {string} sighting.file - The file it was seen in.
 * @returns {void}
 */
function record({ counts, value, file }) {
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

/**
 * Records the first capture of every match of a pattern.
 *
 * @param {object} scanning - What to scan and where to put it.
 * @param {string} scanning.text - The text to search.
 * @param {string} scanning.pattern - The pattern source; captures the value in group 1.
 * @param {Map<string, Map<string, number>>} scanning.counts - The tally to add to.
 * @param {string} scanning.file - The file being scanned.
 * @param {Set<string>} [scanning.skip] - Values not worth recording.
 * @returns {void}
 */
function recordMatches({ text, pattern, counts, file, skip }) {
	for (const match of text.matchAll(new RegExp(pattern, "g"))) {
		if (skip?.has(match[1])) continue;
		record({ counts, value: match[1], file });
	}
}

/**
 * The empty tallies one audit fills, one per reported group.
 *
 * @returns {{
 *   constNames: Map<string, Map<string, number>>,
 *   stringLiterals: Map<string, Map<string, number>>,
 *   numberLiterals: Map<string, Map<string, number>>,
 *   objectShapes: Map<string, Map<string, number>>,
 *   propertyKnobs: Map<string, Map<string, Map<string, number>>>,
 *   sourceConstants: { file: string, name: string, value: string, exported: boolean }[],
 * }} The tallies.
 */
export function createTallies() {
	return {
		constNames: new Map(),
		stringLiterals: new Map(),
		numberLiterals: new Map(),
		objectShapes: new Map(),
		propertyKnobs: new Map(),
		sourceConstants: [],
	};
}

/**
 * Adds everything one file contributes to the tallies.
 *
 * @param {object} target - The file and the tallies to add to.
 * @param {string} target.file - The file's path, as it should appear in the report.
 * @param {string} target.raw - The file's contents.
 * @param {ReturnType<typeof createTallies>} target.tallies - The tallies to fill.
 * @returns {void}
 */
export function collectFromFile({ file, raw, tallies }) {
	const { constNames, stringLiterals, numberLiterals, objectShapes, propertyKnobs } = tallies;
	const { code, bare, strings } = scan(raw);

	// Every pattern below reads comment-free text. Matching the raw file would
	// let a TSDoc @example declare constants and set knobs that do not exist,
	// and — worse, because it hides rather than invents — let an import written
	// in a comment suppress a real string literal from the report.
	// `bare` keeps string contents (a module specifier is one); `code` masks
	// them, which is what the numeric and knob patterns want.

	// Import targets are not constants anyone could extract.
	const specifiers = new Set(
		[...bare.matchAll(/(?:from|import|vi\.mock|require)\s*\(?\s*"([^"]+)"/g)].map(
			(match) => match[1],
		),
	);
	for (const value of strings) {
		if (value.trim().length >= 2 && !specifiers.has(value))
			record({ counts: stringLiterals, value, file });
	}

	recordMatches({
		text: bare,
		pattern: String.raw`(?:^|\s)(?:export\s+)?const\s+([A-Z][A-Z0-9_]{2,})\s*(?::[^=]*)?=`,
		counts: constNames,
		file,
	});

	recordMatches({
		text: code,
		pattern: String.raw`(?<![\w.])(${NUMBER_SOURCE})(?![\w.])`,
		counts: numberLiterals,
		file,
		skip: TRIVIAL_NUMBERS,
	});

	for (const match of code.matchAll(
		new RegExp(
			String.raw`(?<![\w$])([a-z][A-Za-z0-9_]*)\s*:\s*(${NUMBER_SOURCE}|true|false)(?![\w])`,
			"g",
		),
	)) {
		const [, key, value] = match;
		if (!propertyKnobs.has(key)) propertyKnobs.set(key, new Map());
		record({ counts: propertyKnobs.get(key), value, file });
	}

	for (const shape of objectLiterals(bare)) {
		record({ counts: objectShapes, value: shape, file });
	}

	// Group 6 asks a question about shipped code, so test scaffolding is not
	// listed: a constant in a suite is that suite's own business.
	if (!isTest(file)) {
		for (const match of bare.matchAll(
			new RegExp(
				String.raw`(?:^|\n)(export\s+)?const\s+([A-Za-z][A-Za-z0-9_]*)\s*(?::[^=\n]*)?=\s*("(?:[^"\\]|\\.)*"|${NUMBER_SOURCE})\s*;`,
				"g",
			),
		)) {
			const [, exported, name, value] = match;
			tallies.sourceConstants.push({ file, name, value, exported: exported !== undefined });
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

/** A value spread across this many files is reported however often it appears. */
const MIN_FILES_TO_REPORT = 2;

/**
 * Prints one report section: every value in at least `MIN_FILES_TO_REPORT`
 * files, plus every value concentrated in a single file but written out often
 * enough to be worth naming.
 *
 * @param {object} section - The section to print.
 * @param {string} section.title - The section heading.
 * @param {Map<string, Map<string, number>>} section.counts - The values and their per-file tallies.
 * @returns {void}
 */
function report({ title, counts }) {
	const rows = [...counts.entries()]
		.filter(
			([, perFile]) =>
				perFile.size >= MIN_FILES_TO_REPORT || totalSightings(perFile) >= MIN_SIGHTINGS_IN_ONE_FILE,
		)
		.sort(
			// eslint-disable-next-line max-params -- Array.prototype.sort's comparator is spec-defined
			(left, right) =>
				right[1].size - left[1].size || totalSightings(right[1]) - totalSightings(left[1]),
		);
	console.log(
		`\n${"=".repeat(78)}\n${title} — ${rows.length} in ≥${MIN_FILES_TO_REPORT} files, or ≥${MIN_SIGHTINGS_IN_ONE_FILE} times in one\n${"=".repeat(78)}`,
	);
	for (const [value, perFile] of rows) {
		const describe = (file) => {
			const count = perFile.get(file);
			return count === 1 ? file : `${file} (${count}×)`;
		};
		const all = [...perFile.keys()];
		const source = all.filter((file) => !isTest(file)).map(describe);
		const tests = all.filter(isTest).map(describe);
		console.log(
			`\n[${perFile.size} file(s), ${totalSightings(perFile)}×] ${JSON.stringify(value)}`,
		);
		if (source.length > 0) console.log(`    src : ${source.join(", ")}`);
		if (tests.length > 0) console.log(`    test: ${tests.join(", ")}`);
	}
}

/**
 * Audits a directory and prints all six groups.
 *
 * @param {object} options - What to audit.
 * @param {string} options.root - The directory to walk.
 * @returns {void}
 */
function audit({ root }) {
	const tallies = createTallies();
	for (const path of walk(root).sort()) {
		collectFromFile({ file: relative(".", path), raw: readFileSync(path, "utf8"), tallies });
	}
	const { constNames, stringLiterals, numberLiterals, objectShapes, propertyKnobs } = tallies;

	report({ title: "NAMED CONSTANTS declared in several files", counts: constNames });
	report({ title: "STRING LITERALS", counts: stringLiterals });
	report({ title: "NUMERIC LITERALS", counts: numberLiterals });
	report({ title: "OBJECT SHAPES repeated verbatim", counts: objectShapes });

	console.log(`\n${"=".repeat(78)}\nPROPERTY KNOBS given literal values\n${"=".repeat(78)}`);
	for (const [key, values] of [...propertyKnobs.entries()].sort()) {
		const files = new Set([...values.values()].flatMap((perFile) => [...perFile.keys()]));
		if (files.size < 2) continue;
		console.log(`\n${key}:`);
		for (const [value, perFile] of values) {
			console.log(`    = ${value}  (${perFile.size} files)`);
		}
	}

	printSingleHomeConstants(tallies.sourceConstants);
}

/**
 * Prints group 6: every literal constant in shipped code, for a human to read.
 *
 * @param {{ file: string, name: string, value: string, exported: boolean }[]} sourceConstants -
 *   The constants found, in file order.
 * @returns {void}
 */
function printSingleHomeConstants(sourceConstants) {
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
}

// Importing this module — a test suite does — must not run an audit, so the
// walk starts only when the file is the process entry point.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
	audit({ root: process.argv[2] ?? DEFAULT_ROOT });
}
