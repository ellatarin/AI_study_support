import path from "node:path";
import { describe, expect, it } from "vitest";
import { commentFindings, formatCommentFindings } from "./comment-checks.mjs";
import { repoRoot } from "./repo-root.mjs";
import { proseParagraphs } from "./ste-prose.mjs";

const sourceFile = path.join(repoRoot, "src", "example.ts");

/**
 * Runs the comment checks on every paragraph of a source text.
 *
 * @param {string} fileText - The text of the source file.
 * @returns {{ line: number, rule: string }[]} The line and the rule of each finding.
 */
function findingsIn(fileText) {
	const paragraphs = proseParagraphs({ filePath: sourceFile, text: fileText });
	return commentFindings({ filePath: sourceFile, fileText, paragraphs }).map(({ line, rule }) => ({
		line,
		rule,
	}));
}

describe("formatCommentFindings", () => {
	it("should give null when there is no finding", () => {
		expect(formatCommentFindings({ filePath: sourceFile, findings: [] })).toBeNull();
	});

	it("should name the file, the line, the rule and the matched words when there is a finding", () => {
		const fileText = "/** Tells if a value is a figure. */\nfunction isFigure(): void {}";
		const paragraphs = proseParagraphs({ filePath: sourceFile, text: fileText });
		const findings = commentFindings({ filePath: sourceFile, fileText, paragraphs });

		expect(formatCommentFindings({ filePath: sourceFile, findings })).toBe(
			[
				"Comment checks: 1 breach(es) in the comments this edit wrote.",
				'  src/example.ts:1 tells-if-opening: Write "Checks that" and the condition. [Tells if]',
				"Reword each one.",
			].join("\n"),
		);
	});
});

describe("commentFindings", () => {
	it.each([
		{ opening: "When a piece of work started and ended.", rule: "question-word-opening" },
		{ opening: "Thrown when the file is missing.", rule: "question-word-opening" },
		{ opening: "Tells if a value is a figure.", rule: "tells-if-opening" },
		{ opening: "Says whether a value is a figure.", rule: "tells-if-opening" },
		{ opening: "Checks whether a value is a figure.", rule: "tells-if-opening" },
		{ opening: "The function that receives the events.", rule: "function-that-opening" },
		{ opening: "A function that receives the events.", rule: "function-that-opening" },
		{ opening: "The method that receives the events.", rule: "function-that-opening" },
		{ opening: "The cutting of a transcript into subtopics.", rule: "action-noun-opening" },
		{ opening: "The choice of the topics of a lecture.", rule: "action-noun-opening" },
	])('should flag $rule when a comment opens with "$opening"', ({ opening, rule }) => {
		const fileText = [`/** ${opening} */`, "function receive(): void {}"].join("\n");

		expect(findingsIn(fileText)).toStrictEqual([{ line: 1, rule }]);
	});

	it.each([
		"The number of lectures to run at once.",
		"The name of a flag that a command can accept.",
		"The string of the reply.",
		"The meaning of a mark.",
		"The heading of a section.",
		"The tuning of the example.",
		"The reading of each slide.",
		"Replies that cut the second subtopic.",
		"Runs 2 and 3 make the only grouping.",
		"Conveniences for the filesystem.",
	])('should not flag a comment when it opens with "%s"', (opening) => {
		const fileText = [`/** ${opening} */`, "const value = 1;"].join("\n");

		expect(findingsIn(fileText)).toStrictEqual([]);
	});

	it.each([
		"no longer",
		"used to",
		"previously",
		"formerly",
		"originally",
		"from before",
		"existed",
		"old form",
		"new form",
		"until now",
		"any more",
	])('should flag a history phrase when any paragraph of a comment holds "%s"', (phrase) => {
		const fileText = [
			"/**",
			" * Reads the manifest of a workspace.",
			" *",
			` * The reader ${phrase} checks the round.`,
			" */",
			"function read(): void {}",
		].join("\n");

		expect(findingsIn(fileText)).toStrictEqual([{ line: 4, rule: "history-phrase" }]);
	});

	it.each([
		{ target: "a constant with a literal value", code: ["const PROMPT = `# Task`;"] },
		{ target: "an object type", code: ["export type PanelSettings = {", "};"] },
		{ target: "a field with a plain type", code: ["\treadonly path: string;"] },
		{ target: "a module header", code: ["", 'import { join } from "node:path";'] },
	])("should flag a verb opening when the comment is on $target", ({ code }) => {
		const fileText = ["/** Gives the task of the model. */", ...code].join("\n");

		expect(findingsIn(fileText)).toStrictEqual([{ line: 1, rule: "verb-opening-on-value" }]);
	});

	it.each([
		{ target: "a function", code: ["export async function read(): Promise<void> {}"] },
		{ target: "an arrow function", code: ["const read = (path: string): void => {};"] },
		{ target: "a function type", code: ["export type WriteText = (text: string) => void;"] },
		{ target: "a field with a named type", code: ["\treadonly write: WriteText;"] },
		{
			target: "a method signature",
			code: ["\tisComplete(context: StageContext): Promise<boolean>;"],
		},
		{
			target: "a function under a lint directive",
			code: ["// eslint-disable-next-line max-params -- the reason", "function read(): void {}"],
		},
	])("should not flag a verb opening when the comment is on $target", ({ code }) => {
		const fileText = ["const before = 1;", "/** Gives the task of the model. */", ...code].join(
			"\n",
		);

		expect(findingsIn(fileText)).toStrictEqual([]);
	});

	it("should not flag a module header when it opens with This", () => {
		const fileText = [
			"/** This module reads the manifest. */",
			"",
			'import { join } from "node:path";',
		].join("\n");

		expect(findingsIn(fileText)).toStrictEqual([]);
	});

	it("should flag nothing when the file is Markdown", () => {
		const filePath = path.join(repoRoot, "docs", "example.md");
		const fileText = "What the stage writes.\n\nThe stage previously wrote a PDF.";
		const paragraphs = proseParagraphs({ filePath, text: fileText });

		expect(commentFindings({ filePath, fileText, paragraphs })).toStrictEqual([]);
	});

	it("should not flag a later paragraph of a comment when it opens with a question word", () => {
		const fileText = [
			"/**",
			" * Asks the user which lecture to act on.",
			" *",
			" * When the user cancels, it gives `null`.",
			" */",
			"function pick(): void {}",
		].join("\n");

		expect(findingsIn(fileText)).toStrictEqual([]);
	});
});
