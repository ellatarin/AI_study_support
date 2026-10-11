/*
 * The checks on the wording of code comments that the STE linter cannot make.
 * Each check flags a word pattern that the global CLAUDE.md, "Comments in
 * code", forbids. A pattern is here only when it has no wrong hits in src/.
 */

import path from "node:path";
import { formatBreaches } from "./ste-prose.mjs";

/**
 * A breach of a comment check.
 *
 * @typedef {{ line: number, rule: string, message: string, match: string }} CommentFinding
 */

/** A line of a comment, or the end of a block comment. */
const COMMENT_LINE = /^(\/\/|\/\*|\*)/;

/** The marks at the start of a comment line. */
const COMMENT_MARK = /^(\/\/+|\/\*+|\*+)/;

/** A lint directive in a comment, which is not prose. */
const DIRECTIVE = /^(eslint-|biome-ignore|@ts-expect-error|jscpd:)/;

/**
 * The declaration of a value. It is a constant with a literal value, a type
 * that is not a function type, or a field with a plain type.
 */
const VALUE_DECLARATION =
	/^(export\s+)?((const|let)\s+\w+(\s*:[^=]+)?\s*=\s*([`"'[{]|-?\d|true\b|false\b|null\b)|type\s+\w+(<[^>]*>)?\s*=(?!\s*(\(|<|new\b)))|^(readonly\s+)?\w+\??:\s*(readonly\s+)?(string|number|boolean)\b/;

/** The words that end in "-ing" but name a thing, not an action. */
const ING_NOUNS =
	"string|thing|ring|king|wing|spring|meaning|heading|setting|ending|beginning|building|padding|ceiling|tuning|reading";

/**
 * The checks, each with the paragraphs that it reads: the first paragraph of a
 * comment, or any paragraph.
 *
 * @type {{ rule: string, scope: "first paragraph" | "any paragraph", pattern: RegExp, message: string }[]}
 */
const COMMENT_CHECKS = [
	{
		rule: "history-phrase",
		scope: "any paragraph",
		pattern:
			/\b(no longer|used to|previously|formerly|originally|from before|existed|old form|new form|until now|any ?more)\b/i,
		message: "Describe the code as it is. Leave its history to git.",
	},
	{
		rule: "question-word-opening",
		scope: "first paragraph",
		pattern: /^(What|How|Why|Where|When|Whether|Which|Who|Thrown when)\b/,
		message: "Open with the thing that the comment describes, not a question word.",
	},
	{
		rule: "action-noun-opening",
		scope: "first paragraph",
		pattern: new RegExp(
			`^The ((?!(?:${ING_NOUNS}) )[a-z]+ing|choice|move|migration|removal|deletion|creation|conversion|close|change|use) of\\b`,
		),
		message:
			'Keep the verb a verb: write "the code that cuts a transcript", not "the cutting of a transcript".',
	},
	{
		rule: "function-that-opening",
		scope: "first paragraph",
		pattern: /^(The|A) (function|method) that\b/,
		message: 'Open a function comment with its verb, such as "Receives the events".',
	},
	{
		rule: "verb-opening-on-value",
		scope: "first paragraph on a value",
		pattern:
			/^(?!(This|Its|Has|Was|Is|Thus|Plus|Always|Perhaps)\b)[A-Z][a-z]*[^s\W]s (the|a|an|one|each|every|its|all|no|any|some|both|`)/,
		message: 'Open with the thing, such as "The task of the model", because no function is here.',
	},
	{
		rule: "tells-if-opening",
		scope: "first paragraph",
		pattern: /^(Tells|Says|Checks) (if|whether)\b/,
		message: 'Write "Checks that" and the condition.',
	},
];

/**
 * Checks that a paragraph is the first paragraph of its comment: no line of the
 * same comment before it holds prose. A lint directive is not prose.
 *
 * @param {{ lines: string[], startLine: number }} args - The lines of the file, and the first
 *   line of the paragraph, counting from 1.
 * @returns {boolean} True when the paragraph opens its comment.
 */
function opensComment({ lines, startLine }) {
	for (let index = startLine - 2; index >= 0; index--) {
		const trimmed = lines[index].trim();
		if (!COMMENT_LINE.test(trimmed)) return true;
		const body = trimmed.replace(COMMENT_MARK, "").trim();
		if (body !== "" && !DIRECTIVE.test(body)) return false;
	}
	return true;
}

/**
 * Checks that a comment describes a value and not a function. The comment is a
 * module header, or the code under it is a {@link VALUE_DECLARATION}.
 *
 * @param {{ lines: string[], paragraph: import("./ste-prose.mjs").ProseParagraph }} args - The
 *   lines of the file, and the first paragraph of the comment.
 * @returns {boolean} True when the comment describes a value.
 */
function describesValue({ lines, paragraph }) {
	let first = paragraph.startLine - 1;
	while (first > 0 && COMMENT_LINE.test(lines[first - 1].trim())) first--;
	let below = paragraph.endLine;
	while (
		below < lines.length &&
		(lines[below].trim() === "" || COMMENT_LINE.test(lines[below].trim()))
	)
		below++;
	const isModuleHeader =
		lines.slice(0, first).every((line) => line.trim() === "") &&
		lines[endOfComment({ lines, from: paragraph.endLine - 1 }) + 1]?.trim() === "";
	return isModuleHeader || VALUE_DECLARATION.test(lines[below]?.trim() ?? "");
}

/**
 * Finds the last line of the comment that holds a given line.
 *
 * @param {{ lines: string[], from: number }} args - The lines of the file, and the index of a
 *   line of the comment.
 * @returns {number} The index of the last line of the comment.
 */
function endOfComment({ lines, from }) {
	let last = from;
	while (last + 1 < lines.length && COMMENT_LINE.test(lines[last + 1].trim())) last++;
	return last;
}

/**
 * Finds the breaches of the comment checks in the changed comment paragraphs of a file.
 *
 * @param {{ filePath: string, fileText: string, paragraphs: import("./ste-prose.mjs").ProseParagraph[] }} args
 *   The file, its text, and the changed paragraphs.
 * @returns {CommentFinding[]} The breaches, in file order.
 */
export function commentFindings({ filePath, fileText, paragraphs }) {
	if (path.extname(filePath) === ".md") return [];
	const lines = fileText.split("\n");
	return paragraphs.flatMap((paragraph) => {
		const opens = opensComment({ lines, startLine: paragraph.startLine });
		const text = paragraph.lines.join(" ");
		const onValue = opens && describesValue({ lines, paragraph });
		const reads = {
			"any paragraph": true,
			"first paragraph": opens,
			"first paragraph on a value": onValue,
		};
		return COMMENT_CHECKS.filter(({ scope }) => reads[scope]).flatMap(
			({ rule, pattern, message }) => {
				const match = text.match(pattern);
				return match ? [{ line: paragraph.startLine, rule, message, match: match[0] }] : [];
			},
		);
	});
}

/**
 * Writes the report of the comment-check breaches.
 *
 * @param {{ filePath: string, findings: CommentFinding[] }} args - The file and its breaches.
 * @returns {string | null} The report, or null when there is no breach.
 */
export function formatCommentFindings({ filePath, findings }) {
	if (findings.length === 0) return null;
	return formatBreaches({
		filePath,
		heading: `Comment checks: ${findings.length} breach(es) in the comments this edit wrote.`,
		breaches: findings,
		closing: "Reword each one.",
	});
}
