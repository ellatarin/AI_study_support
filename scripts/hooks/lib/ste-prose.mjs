/*
 * The prose in a file that the STE hooks check: comment text in code, and
 * paragraphs in Markdown.
 *
 * The hooks check prose only. Code, prompts and fenced examples are not
 * prose, so they never reach the linter.
 */

import os from "node:os";
import path from "node:path";
import { repoRoot } from "./repo-root.mjs";

/** The skill that holds the STE rules. */
export const STE_SKILL_NAME = "asd-ste100";

/** The linter that comes with the skill. */
export const STE_LINTER_PATH = path.join(
	os.homedir(),
	".claude",
	"skills",
	STE_SKILL_NAME,
	"scripts",
	"ste-lint.py",
);

const CODE_EXTENSIONS = new Set([".ts", ".mjs"]);
const MARKDOWN_EXTENSION = ".md";
const FENCE = /^(```|~~~)/;
const TSDOC_TAG = /^@(\w+)\s*/;
const TAGS_WITH_A_NAME = new Set(["param", "typeParam"]);
const LINK = /\{@link\s+([^}|]+?)(?:\s*\|\s*([^}]+?))?\s*\}/g;
const LIST_ITEM = /^(?:[-*+]|\d+[.)])\s/;
const TRAILING_COMMENT = /\s\/\/\s+(.*)$/;

/**
 * A paragraph of prose and where it is in its file.
 *
 * @typedef {{ startLine: number, endLine: number, lines: string[] }} ProseParagraph
 */

/**
 * Tells whether the STE hooks check a file.
 *
 * @param {string} filePath - The absolute path of the file.
 * @returns {boolean} True for code and Markdown in this repo, except prompt files.
 */
export function isProseFile(filePath) {
	const relative = path.relative(repoRoot, filePath);
	if (relative.startsWith("..") || path.isAbsolute(relative)) return false;
	if (path.basename(filePath).includes("prompt")) return false;
	const extension = path.extname(filePath);
	return CODE_EXTENSIONS.has(extension) || extension === MARKDOWN_EXTENSION;
}

/**
 * Finds the paragraphs of prose in the text of a file.
 *
 * In code, each comment paragraph becomes one line, with its comment marks
 * and TSDoc tags removed. In Markdown, each block of lines between blank
 * lines stays as it is, so the linter still sees tables and lists.
 *
 * @param {{ filePath: string, text: string, insideBlockComment?: boolean }} args - The file, its
 *   text, and whether the text starts inside a block comment (true for a part of a file).
 * @returns {ProseParagraph[]} The paragraphs, in file order.
 */
export function proseParagraphs({ filePath, text, insideBlockComment = false }) {
	const lines = text.split("\n");
	return path.extname(filePath) === MARKDOWN_EXTENSION
		? markdownParagraphs(lines)
		: commentParagraphs({ lines, insideBlockComment });
}

/**
 * Gives each line with its line number, counting from 1.
 *
 * @param {string[]} lines - The lines of a file.
 * @returns {{ line: string, lineNumber: number }[]} The lines with their numbers.
 */
function numberedLines(lines) {
	return [...lines.entries()].map(([index, line]) => ({ line, lineNumber: index + 1 }));
}

/**
 * Collects the blocks of Markdown lines between blank lines, without fenced code.
 *
 * @param {string[]} lines - The lines of the file.
 * @returns {ProseParagraph[]} One paragraph for each block.
 */
function markdownParagraphs(lines) {
	const paragraphs = [];
	let current = null;
	let inFence = false;
	for (const { line, lineNumber } of numberedLines(lines)) {
		if (FENCE.test(line.trim())) {
			inFence = !inFence;
			current = null;
			continue;
		}
		if (inFence || line.trim() === "") {
			current = null;
			continue;
		}
		if (current === null) {
			current = { startLine: lineNumber, endLine: lineNumber, lines: [] };
			paragraphs.push(current);
		}
		current.lines.push(line);
		current.endLine = lineNumber;
	}
	return paragraphs;
}

/**
 * Collects the comment paragraphs in code.
 *
 * @param {{ lines: string[], insideBlockComment: boolean }} args - The lines, and whether the
 *   first line is inside a block comment.
 * @returns {ProseParagraph[]} One paragraph for each comment paragraph.
 */
function commentParagraphs({ lines, insideBlockComment }) {
	const builder = paragraphBuilder();
	let inBlock = insideBlockComment;
	for (const { line, lineNumber } of numberedLines(lines)) {
		const trimmed = line.trim();
		if (inBlock || trimmed.startsWith("/*")) {
			const closes = trimmed.includes("*/");
			const body = trimmed
				.replace(/\*\/.*$/, "")
				.replace(/^\/\*+/, "")
				.replace(/^\*+/, "")
				.trim();
			builder.add({ body, lineNumber });
			inBlock = !closes;
			if (closes) builder.end();
			continue;
		}
		if (trimmed.startsWith("//")) {
			builder.add({ body: trimmed.replace(/^\/\/+/, "").trim(), lineNumber });
			continue;
		}
		builder.end();
		const trailing = line.match(TRAILING_COMMENT);
		if (trailing && !insideString({ line, position: trailing.index })) {
			builder.add({ body: trailing[1].trim(), lineNumber });
			builder.end();
		}
	}
	builder.end();
	return builder.paragraphs;
}

/**
 * Tells whether a position in a line of code is inside a string.
 *
 * @param {{ line: string, position: number }} args - The line of code and the position to test.
 * @returns {boolean} True when an odd number of quote marks comes before it.
 */
function insideString({ line, position }) {
	const before = line.slice(0, position);
	return ['"', "'", "`"].some((quote) => before.split(quote).length % 2 === 0);
}

/**
 * Makes the state that turns comment lines into paragraphs.
 *
 * @returns {{ paragraphs: ProseParagraph[], add: (args: { body: string, lineNumber: number }) => void, end: () => void }}
 *   The paragraphs so far, a function that adds one comment line, and a
 *   function that ends the current paragraph.
 */
function paragraphBuilder() {
	const paragraphs = [];
	let words = [];
	let startLine = 0;
	let endLine = 0;
	let inExample = false;

	const end = () => {
		if (words.length > 0) {
			paragraphs.push({ startLine, endLine, lines: [words.join(" ")] });
		}
		words = [];
	};

	const append = ({ prose, lineNumber }) => {
		if (prose === "") return;
		if (words.length === 0) startLine = lineNumber;
		words.push(prose.replace(LINK, (...match) => (match[2] ?? match[1]).trim()));
		endLine = lineNumber;
	};

	const add = ({ body, lineNumber }) => {
		const reason = directiveReason(body);
		if (reason !== undefined) {
			end();
			append({ prose: reason, lineNumber });
			end();
			return;
		}
		const tag = body.match(TSDOC_TAG);
		if (tag) {
			end();
			inExample = tag[1] === "example";
			if (!inExample) append({ prose: tagProse({ body, tag }), lineNumber });
			return;
		}
		if (inExample) return;
		if (body === "") {
			end();
			return;
		}
		if (LIST_ITEM.test(body)) end();
		append({ prose: body, lineNumber });
	};

	return { paragraphs, add, end };
}

/**
 * Finds the reason in a lint directive.
 *
 * @param {string} body - A comment line without its comment marks.
 * @returns {string | undefined} The reason, an empty string for a directive
 *   with no reason, or undefined when the line is not a directive.
 */
function directiveReason(body) {
	if (/^eslint-(?:disable|enable)/.test(body)) return body.split(" -- ")[1] ?? "";
	if (body.startsWith("biome-ignore")) return body.split(/:\s+/).slice(1).join(": ");
	if (body.startsWith("@ts-expect-error")) return body.replace("@ts-expect-error", "").trim();
	if (body.startsWith("jscpd:")) return "";
	return undefined;
}

/**
 * Removes a TSDoc tag, its type and its parameter name from a comment line.
 *
 * @param {{ body: string, tag: RegExpMatchArray }} args - The line and the tag match.
 * @returns {string} The prose that follows.
 */
function tagProse({ body, tag }) {
	const rest = withoutType(body.slice(tag[0].length));
	return TAGS_WITH_A_NAME.has(tag[1]) ? rest.replace(/^\S+\s+(?:-\s+)?/, "") : rest;
}

/**
 * Removes a JSDoc type in braces from the start of a text.
 *
 * A type can hold braces of its own, so the function counts them.
 *
 * @param {string} text - The text after a TSDoc tag.
 * @returns {string} The text after the type, or the same text when it has no type.
 */
function withoutType(text) {
	if (!text.startsWith("{")) return text;
	let depth = 0;
	for (let index = 0; index < text.length; index++) {
		if (text[index] === "{") depth++;
		if (text[index] === "}") depth--;
		if (depth === 0) return text.slice(index + 1).trim();
	}
	return "";
}

/**
 * Finds the text that an Edit, MultiEdit or Write call puts in its file.
 *
 * @param {Record<string, unknown>} toolInput - The tool call's input.
 * @returns {string[]} Each new string, or the whole new content.
 */
export function writtenTexts(toolInput) {
	if (typeof toolInput.new_string === "string") return [toolInput.new_string];
	if (typeof toolInput.content === "string") return [toolInput.content];
	if (Array.isArray(toolInput.edits))
		return toolInput.edits.map((edit) => String(edit.new_string ?? ""));
	return [];
}

/**
 * Tells whether a tool call writes prose into a file that the STE hooks check.
 *
 * The new text of an Edit can start in the middle of a block comment. The
 * text starts inside one when a comment end comes before any comment start.
 *
 * @param {{ filePath: string, toolInput: Record<string, unknown> }} args - The file and the
 *   tool call's input.
 * @returns {boolean} True when any new text holds prose.
 */
export function writesProse({ filePath, toolInput }) {
	if (!isProseFile(filePath)) return false;
	return writtenTexts(toolInput).some((text) => {
		const end = text.indexOf("*/");
		const start = text.indexOf("/*");
		const insideBlockComment = end !== -1 && (start === -1 || end < start);
		return proseParagraphs({ filePath, text, insideBlockComment }).length > 0;
	});
}

/**
 * Finds the prose paragraphs that a finished edit wrote into a file.
 *
 * A paragraph counts when any of its lines is in a part of the file that the
 * edit wrote. So the result includes the whole paragraph around a changed
 * sentence. A Write replaces the file, so every paragraph counts.
 *
 * @param {{ filePath: string, fileText: string, toolInput: Record<string, unknown> }} args - The
 *   file, its text after the edit, and the tool call's input.
 * @returns {ProseParagraph[]} The paragraphs, in file order.
 */
export function changedParagraphs({ filePath, fileText, toolInput }) {
	const paragraphs = proseParagraphs({ filePath, text: fileText });
	if (typeof toolInput.content === "string") return paragraphs;
	const ranges = writtenTexts(toolInput).flatMap((written) => lineRanges({ fileText, written }));
	return paragraphs.filter((paragraph) =>
		ranges.some(
			(range) => paragraph.startLine <= range.endLine && range.startLine <= paragraph.endLine,
		),
	);
}

/**
 * Finds each place where a string occurs in a file, as line ranges.
 *
 * @param {{ fileText: string, written: string }} args - The file text and the string.
 * @returns {{ startLine: number, endLine: number }[]} One range for each occurrence.
 */
function lineRanges({ fileText, written }) {
	const ranges = [];
	if (written === "") return ranges;
	let offset = fileText.indexOf(written);
	while (offset !== -1) {
		const startLine = fileText.slice(0, offset).split("\n").length;
		ranges.push({ startLine, endLine: startLine + written.split("\n").length - 1 });
		offset = fileText.indexOf(written, offset + written.length);
	}
	return ranges;
}

/**
 * Makes the text that goes to the linter, and the source line of each of its lines.
 *
 * A blank line separates the paragraphs, so that the linter does not join a
 * table or a list to the paragraph before it.
 *
 * @param {ProseParagraph[]} paragraphs - The paragraphs to lint.
 * @returns {{ text: string, sourceLines: (number | null)[] }} The linter input, and for each
 *   of its lines the file line it came from, or null for a separator line.
 */
export function lintInput(paragraphs) {
	const lines = [];
	const sourceLines = [];
	for (const [index, paragraph] of paragraphs.entries()) {
		if (index > 0) {
			lines.push("");
			sourceLines.push(null);
		}
		for (const [offset, line] of paragraph.lines.entries()) {
			lines.push(line);
			sourceLines.push(paragraph.startLine + offset);
		}
	}
	return { text: lines.join("\n"), sourceLines };
}

/**
 * Writes the report of the hard breaches the linter found.
 *
 * Advisory findings, such as passive voice, are left out. They are often
 * right in this codebase, and a hook that blocks on them would be ignored.
 *
 * @param {{ filePath: string, findings: { line: number, rule: string, level: string, message: string, match: string }[], sourceLines: (number | null)[] }} args
 *   The file, the linter's findings, and the source line of each linted line.
 * @returns {string | null} The report, or null when there is no hard breach.
 */
export function formatHardFindings({ filePath, findings, sourceLines }) {
	const hard = findings.filter((finding) => finding.level === "advisory-free");
	if (hard.length === 0) return null;
	const relative = path.relative(repoRoot, filePath);
	return [
		`STE lint: ${hard.length} hard breach(es) in the prose this edit wrote (${STE_SKILL_NAME} skill).`,
		...hard.map(
			(finding) =>
				`  ${relative}:${sourceLines[finding.line - 1] ?? "?"} ${finding.rule}: ${finding.message} [${finding.match}]`,
		),
		"Reword each one. The check covers the whole paragraph around a changed line, because every comment you touch must follow STE.",
	].join("\n");
}
