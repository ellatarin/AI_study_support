import { describe, expect, it } from "vitest";
import { collectFromFile, createTallies, objectLiterals, scan } from "./audit-constants.mjs";

const SOURCE_FILE = "example.ts";

// A lone `$`, so a fixture written as a template literal can contain `${…}`
// without the test file's own interpolation eating it.
const DOLLAR = "$";

/**
 * Runs one source string through the collector and returns the tallies it filled.
 *
 * @param {string} raw - The file contents to scan.
 * @returns {ReturnType<typeof createTallies>} The tallies after collection.
 */
function collect(raw) {
	const tallies = createTallies();
	collectFromFile({ file: SOURCE_FILE, raw, tallies });
	return tallies;
}

/**
 * The files a tallied value was seen in, so assertions read as a plain list.
 *
 * @param {Map<string, Map<string, number>>} counts - One tally.
 * @returns {string[]} The values recorded, in insertion order.
 */
function valuesIn(counts) {
	return [...counts.keys()];
}

describe("scan", () => {
	it("should keep the following code intact when a regex literal contains a quote", () => {
		const source = `const QUOTE_PATTERN = /["']/; const NAME = "kept";`;

		const { strings } = scan(source);

		expect(strings).toEqual(["kept"]);
	});

	it("should not treat a division as a regex when the slash follows a value", () => {
		const source = `const RATIO = total / count; const NAME = "kept";`;

		const { strings } = scan(source);

		expect(strings).toEqual(["kept"]);
	});

	it.each([
		{ sequence: String.raw`\n`, character: "\n", name: "newline" },
		{ sequence: String.raw`\t`, character: "\t", name: "tab" },
		{ sequence: String.raw`\r`, character: "\r", name: "carriage return" },
	])("should record a $name as its own character when a string escapes it", ({
		sequence,
		character,
	}) => {
		const source = `const MESSAGE = "before${sequence}after";`;

		const { strings } = scan(source);

		expect(strings).toEqual([`before${character}after`]);
	});

	it("should record an escaped quote as the quote when a string contains one", () => {
		const source = String.raw`const MESSAGE = "she said \"go\"";`;

		const { strings } = scan(source);

		expect(strings).toEqual(['she said "go"']);
	});

	it("should expose the interpolated expression as code when the source holds a template literal", () => {
		const source = `const LABEL = \`Stage ${DOLLAR}{STAGE_INDEX} of ${DOLLAR}{STAGE_TOTAL}\`;`;

		const { code, strings } = scan(source);

		expect(strings).toEqual(["Stage ", " of "]);
		expect(code).toContain("STAGE_INDEX");
		expect(code).toContain("STAGE_TOTAL");
	});

	it("should scan a nested template as code when an interpolation holds another template", () => {
		const source = `const LABEL = \`outer ${DOLLAR}{\`inner ${DOLLAR}{VALUE}\`}\`;`;

		const { code, strings } = scan(source);

		expect(strings).toEqual(["outer ", "inner "]);
		expect(code).toContain("VALUE");
	});

	it("should blank a comment when the comment contains a quote", () => {
		const source = `// don't be fooled\nconst NAME = "kept";`;

		const { strings } = scan(source);

		expect(strings).toEqual(["kept"]);
	});
});

describe("collectFromFile", () => {
	it("should record a negative number with its sign when a literal is negative", () => {
		const tallies = collect("const NOT_FOUND = -1;");

		expect(valuesIn(tallies.numberLiterals)).toContain("-1");
	});

	it("should record a positive number without a sign when a literal is positive", () => {
		const tallies = collect("const TIMEOUT_MS = 120000;");

		expect(valuesIn(tallies.numberLiterals)).toEqual(["120000"]);
	});

	it.each([
		"0",
		"1",
		"2",
	])("should ignore the number %s when it is too common to be worth naming", (trivial) => {
		const tallies = collect(`const COUNT = ${trivial};`);

		expect(valuesIn(tallies.numberLiterals)).toEqual([]);
	});

	it("should not record a subtrahend as a negative number when the source subtracts", () => {
		const tallies = collect("const REMAINING = total-1;");

		expect(valuesIn(tallies.numberLiterals)).not.toContain("-1");
	});

	it("should record a screaming-case name when the file declares one", () => {
		const tallies = collect('const STAGE_ID = "transcription";');

		expect(valuesIn(tallies.constNames)).toEqual(["STAGE_ID"]);
	});

	it("should ignore a module specifier when the file imports from it", () => {
		const tallies = collect('import { join } from "node:path";');

		expect(valuesIn(tallies.stringLiterals)).toEqual([]);
	});

	it("should record a knob and its value when a property is given a literal", () => {
		const tallies = collect("const options = { maxRetries: 5 };");

		expect(valuesIn(tallies.propertyKnobs.get("maxRetries") ?? new Map())).toEqual(["5"]);
	});

	it("should record a single-home constant when shipped code declares one", () => {
		const tallies = collect('const LANGUAGE_CODE = "eng";');

		expect(tallies.sourceConstants).toEqual([
			{ file: SOURCE_FILE, name: "LANGUAGE_CODE", value: '"eng"', exported: false },
		]);
	});

	it("should skip single-home constants when the file is test scaffolding", () => {
		const tallies = createTallies();

		collectFromFile({ file: "example.test.ts", raw: 'const FIXTURE = "x";', tallies });

		expect(tallies.sourceConstants).toEqual([]);
	});
});

describe("objectLiterals", () => {
	it("should normalise whitespace when the same shape is wrapped differently", () => {
		const wrapped = objectLiterals('{\n\tone: 1,\n\ttwo: 2,\n\tthree: "3",\n}');
		const inline = objectLiterals('{ one: 1, two: 2, three: "3" }');

		expect(wrapped).toEqual(inline);
	});

	it("should ignore a block when the braces hold a statement rather than data", () => {
		const found = objectLiterals("function run() { const a = 1; return a; }");

		expect(found).toEqual([]);
	});

	it("should ignore a literal when it has fewer than three properties", () => {
		const found = objectLiterals("{ recursive: true, force: true }");

		expect(found).toEqual([]);
	});
});
