import path from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot } from "./repo-root.mjs";
import {
	changedParagraphs,
	formatHardFindings,
	isProseFile,
	lintInput,
	proseParagraphs,
	writesProse,
	writtenTexts,
} from "./ste-prose.mjs";

const sourceFile = path.join(repoRoot, "src", "example.ts");
const markdownFile = path.join(repoRoot, "docs", "example.md");

/**
 * The text of each paragraph, for tests that do not check line numbers.
 *
 * @param {Parameters<typeof proseParagraphs>[0]} args - The file and its text.
 * @returns {string[]} One string for each paragraph.
 */
function paragraphTexts(args) {
	return proseParagraphs(args).map((paragraph) => paragraph.lines.join("\n"));
}

describe("isProseFile", () => {
	it.each([
		{ filePath: sourceFile, expected: true, why: "a TypeScript file is in the repo" },
		{ filePath: markdownFile, expected: true, why: "a Markdown file is in the repo" },
		{
			filePath: path.join(repoRoot, "scripts", "hooks", "lib", "x.mjs"),
			expected: true,
			why: "a script module is in the repo",
		},
		{
			filePath: path.join(repoRoot, "docs", "split-prompt-s8.md"),
			expected: false,
			why: "the file is a prompt, which is kept word for word",
		},
		{
			filePath: path.join(repoRoot, "package.json"),
			expected: false,
			why: "the file holds no prose",
		},
		{ filePath: "/tmp/elsewhere.ts", expected: false, why: "the file is outside the repo" },
	])("should return $expected when $why", ({ filePath, expected }) => {
		expect(isProseFile(filePath)).toBe(expected);
	});
});

describe("proseParagraphs", () => {
	it("should join each paragraph of a block comment into one line when the comment spans lines", () => {
		const text = [
			"/**",
			" * The first sentence",
			" * goes on here.",
			" *",
			" * A second paragraph.",
			" */",
			"export const value = 1;",
		].join("\n");

		const paragraphs = proseParagraphs({ filePath: sourceFile, text });

		expect(paragraphs).toEqual([
			{ startLine: 2, endLine: 3, lines: ["The first sentence goes on here."] },
			{ startLine: 5, endLine: 5, lines: ["A second paragraph."] },
		]);
	});

	it.each([
		{
			line: " * @param args.moduleRoot - Absolute path to the module.",
			expected: "Absolute path to the module.",
		},
		{ line: " * @typeParam TOutput - The output payload.", expected: "The output payload." },
		{
			line: " * @returns {boolean} True when it is blocked.",
			expected: "True when it is blocked.",
		},
		{
			line: " * @throws {StageError} When the input is missing.",
			expected: "When the input is missing.",
		},
		{
			line: " * @returns {{ add: (args: { body: string }) => void }} The builder.",
			expected: "The builder.",
		},
		{ line: " * See {@link StageEntry} for the shape.", expected: "See StageEntry for the shape." },
		{ line: " * See {@link StageEntry | the entry} here.", expected: "See the entry here." },
	])("should keep only the prose when a comment line is $line", ({ line, expected }) => {
		const text = ["/**", line, " */"].join("\n");

		expect(paragraphTexts({ filePath: sourceFile, text })).toEqual([expected]);
	});

	it("should leave out the example when a TSDoc block has an @example tag", () => {
		const text = [
			"/**",
			" * Adds one.",
			" * @example",
			" * addOne(1); // 2",
			" * @returns The sum.",
			" */",
		].join("\n");

		expect(paragraphTexts({ filePath: sourceFile, text })).toEqual(["Adds one.", "The sum."]);
	});

	it("should join consecutive line comments and keep a trailing comment apart when both occur", () => {
		const text = [
			"// The first half",
			"// and the second half.",
			"const value = 1; // A trailing note.",
		].join("\n");

		expect(paragraphTexts({ filePath: sourceFile, text })).toEqual([
			"The first half and the second half.",
			"A trailing note.",
		]);
	});

	it.each([
		{
			line: "// eslint-disable-next-line max-params -- The comparator takes two.",
			expected: ["The comparator takes two."],
		},
		{
			line: "// biome-ignore lint/style/noX: The library needs it.",
			expected: ["The library needs it."],
		},
		{
			line: "// @ts-expect-error The type is wrong upstream.",
			expected: ["The type is wrong upstream."],
		},
		{ line: "// jscpd:ignore-start", expected: [] },
	])("should keep only the reason when a lint directive is $line", ({ line, expected }) => {
		expect(paragraphTexts({ filePath: sourceFile, text: line })).toEqual(expected);
	});

	it.each([
		{ text: 'const url = "https://example.com";', why: "a string holds two slashes" },
		{ text: "export const value = 1;", why: "the line is code alone" },
	])("should find no prose when $why", ({ text }) => {
		expect(proseParagraphs({ filePath: sourceFile, text })).toEqual([]);
	});

	it("should read lines as a block comment when the text starts inside one", () => {
		const text = [" * The middle of a comment.", " */", "const value = 1;"].join("\n");

		expect(paragraphTexts({ filePath: sourceFile, text, insideBlockComment: true })).toEqual([
			"The middle of a comment.",
		]);
	});

	it("should keep each block of lines whole and skip fenced code when the file is Markdown", () => {
		const text = [
			"# Title",
			"",
			"| A | B |",
			"| --- | --- |",
			"| x | y |",
			"",
			"```",
			"code; here",
			"```",
			"Last.",
		].join("\n");

		expect(proseParagraphs({ filePath: markdownFile, text })).toEqual([
			{ startLine: 1, endLine: 1, lines: ["# Title"] },
			{ startLine: 3, endLine: 5, lines: ["| A | B |", "| --- | --- |", "| x | y |"] },
			{ startLine: 10, endLine: 10, lines: ["Last."] },
		]);
	});
});

describe("writtenTexts", () => {
	it.each([
		{ toolInput: { new_string: "a" }, expected: ["a"], why: "an edit" },
		{ toolInput: { content: "b" }, expected: ["b"], why: "a write" },
		{
			toolInput: { edits: [{ new_string: "c" }, { new_string: "d" }] },
			expected: ["c", "d"],
			why: "a multi-edit",
		},
		{ toolInput: {}, expected: [], why: "the input holds no text" },
	])("should return the new text when the tool call is $why", ({ toolInput, expected }) => {
		expect(writtenTexts(toolInput)).toEqual(expected);
	});
});

describe("writesProse", () => {
	it.each([
		{
			filePath: sourceFile,
			toolInput: { new_string: "/** A comment. */" },
			expected: true,
			why: "an edit writes a comment",
		},
		{
			filePath: sourceFile,
			toolInput: { new_string: " * The middle of a comment.\n */" },
			expected: true,
			why: "an edit writes the middle of a block comment",
		},
		{
			filePath: sourceFile,
			toolInput: { new_string: "const value = 1;" },
			expected: false,
			why: "an edit writes code alone",
		},
		{
			filePath: markdownFile,
			toolInput: { content: "Some text." },
			expected: true,
			why: "a write puts text in Markdown",
		},
		{
			filePath: path.join(repoRoot, "package.json"),
			toolInput: { content: "{}" },
			expected: false,
			why: "the file is not one the hooks check",
		},
	])("should return $expected when $why", ({ filePath, toolInput, expected }) => {
		expect(writesProse({ filePath, toolInput })).toBe(expected);
	});
});

describe("changedParagraphs", () => {
	const fileText = [
		"/** First paragraph. */",
		"const a = 1;",
		"/** Second paragraph. */",
		"const b = 2;",
	].join("\n");

	it.each([
		{
			toolInput: { new_string: "/** Second paragraph. */" },
			expected: ["Second paragraph."],
			why: "an edit wrote one paragraph",
		},
		{
			toolInput: { content: fileText },
			expected: ["First paragraph.", "Second paragraph."],
			why: "a write replaced the file",
		},
		{
			toolInput: { edits: [{ new_string: "First" }, { new_string: "Second" }] },
			expected: ["First paragraph.", "Second paragraph."],
			why: "a multi-edit wrote both",
		},
		{ toolInput: { new_string: "" }, expected: [], why: "an edit deleted text" },
		{ toolInput: { new_string: "const b = 2;" }, expected: [], why: "an edit wrote code alone" },
	])("should select the paragraphs the edit wrote when $why", ({ toolInput, expected }) => {
		const paragraphs = changedParagraphs({ filePath: sourceFile, fileText, toolInput });

		expect(paragraphs.map((paragraph) => paragraph.lines.join("\n"))).toEqual(expected);
	});
});

describe("lintInput", () => {
	it("should map each line to its source line when a blank line separates two paragraphs", () => {
		const paragraphs = [
			{ startLine: 4, endLine: 5, lines: ["One."] },
			{ startLine: 9, endLine: 10, lines: ["| A |", "| --- |"] },
		];

		expect(lintInput(paragraphs)).toEqual({
			text: "One.\n\n| A |\n| --- |",
			sourceLines: [4, null, 9, 10],
		});
	});
});

describe("formatHardFindings", () => {
	const sourceLines = [4, null, 9];

	it("should name each hard breach at its source line when the linter found some", () => {
		const findings = [
			{ line: 3, rule: "semicolon", level: "advisory-free", message: "No semicolons.", match: ";" },
			{ line: 1, rule: "passive-voice", level: "advisory", message: "Passive.", match: "is made" },
		];

		const report = formatHardFindings({ filePath: sourceFile, findings, sourceLines });

		expect(report).toContain("src/example.ts:9 semicolon: No semicolons. [;]");
		expect(report).not.toContain("passive-voice");
	});

	it("should return null when every finding is advisory", () => {
		const findings = [
			{ line: 1, rule: "passive-voice", level: "advisory", message: "Passive.", match: "is made" },
		];

		expect(formatHardFindings({ filePath: sourceFile, findings, sourceLines })).toBeNull();
	});
});
