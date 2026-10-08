/**
 * The `rewrite-subtopics` stage. It corrects the misheard terms of each subtopic
 * from the slides placed in it. It saves the first rewrite attempt of each
 * subtopic (technical-design.md §5, `rewrite-subtopics`).
 */

/* jscpd:ignore-start -- the model-calling stages import the same pipeline types,
   division helpers and model-stage helpers. So their import blocks are the
   same line for line. Imports cannot be shared, and CLAUDE.md (File
   Organisation) forbids barrel files. Only the imports are exempt. jscpd
   checks the code below. */
import { join, relative } from "node:path";
import type { StageContext, StageResult } from "../../../types/pipeline.js";
import { NamedError } from "../../../utils/errors.js";
import { isRecord, readerFromCheck } from "../../../utils/record.js";
import { countWords } from "../../../utils/text.js";
import { stageDirectoryPath } from "../../layout.js";
import type { SubtopicWithIdAndText } from "../division.js";
import {
	defineModelStage,
	type ModelStageFactory,
	type ModelStageRunArgs,
} from "../model-stage.js";
/* jscpd:ignore-end */
import { readOrMakeSavedFiles, unreadableSavedFileMessage } from "../saved-files.js";
import { isSubjectMatter, readSlideReading, type SlideReading } from "../slides.js";
import { readStageSlidePlacements, readStageStructuredTranscript } from "../stage-input.js";
import {
	buildTermCorrectionMessages,
	TERM_CORRECTION_PROMPT_VERSION,
} from "./rewrite-subtopics.prompt.js";

/**
 * The error when an input file is missing or unreadable, or when a saved rewrite
 * attempt is unreadable. A call whose third send is still unusable fails the
 * stage with `ResendsExhaustedError`.
 */
export class RewriteSubtopicsError extends NamedError {}

const STAGE_ID = "rewrite-subtopics";

/** The most words that each form of a correction can have (CONTEXT.md, "Correction"). */
const MAX_FORM_WORDS = 4;

/** One subtopic, and the reading of each slide placed in it, in deck order. */
type SubtopicWithSlides = {
	readonly subtopic: SubtopicWithIdAndText;
	readonly slides: readonly SlideReading[];
};

/** Every subtopic of the structured transcript in lecture order, each with its placed slides. */
type RewriteInput = { readonly subtopics: readonly SubtopicWithSlides[] };

/** One correction as the reply gives it (CONTEXT.md, "Correction"). */
type ReplyCorrection = {
	readonly wrongForm: string;
	readonly rightForm: string;
	readonly reason: string;
};

/** The reply that the term-correction prompt asks for. */
type TermCorrectionReply = { readonly corrections: readonly ReplyCorrection[] };

/** The check that a correction failed, in the order that code checks it. */
type IgnoredBecause = "form-too-long" | "right-form-not-on-slide" | "wrong-form-not-in-text";

/** A correction that passed each check, and the number of places where it changed the text. */
type Correction = ReplyCorrection & { readonly occurrencesChanged: number };

/** A correction that failed a check, and the first check that it failed. */
type IgnoredCorrection = ReplyCorrection & { readonly ignoredBecause: IgnoredBecause };

/** One rewrite attempt of a subtopic, as the stage writes it (technical-design.md §5, `rewrite-subtopics`). */
type RewriteAttempt = {
	readonly subtopicId: number;
	readonly attemptNumber: number;
	readonly termCorrectionPromptVersion: string;
	/** The slides placed in the subtopic. An empty list means that term correction made no call. */
	readonly slideNumbers: readonly number[];
	readonly corrections: readonly Correction[];
	readonly ignoredCorrections: readonly IgnoredCorrection[];
	readonly correctedText: string;
};

/** The output of `rewrite-subtopics`. */
type RewriteSubtopicsOutput = {
	/** The rewrite attempt of each subtopic, in lecture order. */
	readonly attempts: readonly RewriteAttempt[];
};

/** The text that ends the failure "The model's reply is not the documented …". */
const DOCUMENTED_REPLY_SHAPE = "{ corrections } object";

/** The only rewrite attempt that the stage makes so far. */
const FIRST_ATTEMPT = 1;

/**
 * Tells if a value is one correction of a reply: a `wrongForm`, a `rightForm`
 * and a `reason`, all strings.
 *
 * @param value - The value to test.
 * @returns `true` when the value is a {@link ReplyCorrection}.
 */
function isReplyCorrection(value: unknown): value is ReplyCorrection {
	return (
		isRecord(value) &&
		typeof value.wrongForm === "string" &&
		typeof value.rightForm === "string" &&
		typeof value.reason === "string"
	);
}

/**
 * Checks that a parsed reply has a list `corrections`, and that each entry is a correction.
 *
 * @param value - The parsed reply.
 * @returns `true` when the value is a {@link TermCorrectionReply}.
 */
function isTermCorrectionReply(value: unknown): value is TermCorrectionReply {
	return (
		isRecord(value) &&
		Array.isArray(value.corrections) &&
		value.corrections.every(isReplyCorrection)
	);
}

/**
 * Checks that a parsed saved file is a rewrite attempt.
 *
 * @param value - The parsed file.
 * @returns `true` when the value is a {@link RewriteAttempt}.
 */
function isRewriteAttempt(value: unknown): value is RewriteAttempt {
	return (
		isRecord(value) &&
		typeof value.subtopicId === "number" &&
		typeof value.attemptNumber === "number" &&
		typeof value.termCorrectionPromptVersion === "string" &&
		Array.isArray(value.slideNumbers) &&
		value.slideNumbers.every((slideNumber) => typeof slideNumber === "number") &&
		Array.isArray(value.corrections) &&
		value.corrections.every(
			(entry) =>
				isRecord(entry) && typeof entry.occurrencesChanged === "number" && isReplyCorrection(entry),
		) &&
		Array.isArray(value.ignoredCorrections) &&
		value.ignoredCorrections.every(
			(entry) =>
				isRecord(entry) && typeof entry.ignoredBecause === "string" && isReplyCorrection(entry),
		) &&
		typeof value.correctedText === "string"
	);
}

/**
 * Gives the reply, or the reason that it is unusable. A blank form cannot be
 * found or written, so it makes the reply unusable.
 *
 * @param reply - The parsed reply, with the documented shape.
 * @returns The reply, or the reason that it is unusable.
 */
function usableReply(
	reply: TermCorrectionReply,
): { readonly reply: TermCorrectionReply } | { readonly failure: string } {
	const blank = reply.corrections.find(
		(correction) => correction.wrongForm.trim() === "" || correction.rightForm.trim() === "",
	);
	return blank === undefined
		? { reply }
		: {
				failure: `The model's reply gives a correction with a blank form: ${JSON.stringify(blank)}`,
			};
}

/**
 * Gives each piece of printed text of a slide reading. A form must be inside one
 * piece, so that a form never joins the end of one field to the start of the next.
 *
 * @param slide - The slide reading.
 * @returns The title, the body, each table, each figure description and the caption.
 */
function printedTexts(slide: SlideReading): readonly string[] {
	return [
		slide.title,
		slide.body,
		...slide.tables,
		...slide.figures.map((figure) => figure.description),
		slide.caption,
	];
}

/**
 * Gives the first check that a correction fails, in the order of
 * {@link IgnoredBecause}.
 *
 * @param args - The correction, the subtopic text and the placed slides.
 * @param args.correction - The correction from the reply.
 * @param args.text - The subtopic text before term correction.
 * @param args.slides - The reading of each slide placed in the subtopic.
 * @returns The failed check, or `null` when the correction passes each check.
 */
function failedCheck({
	correction,
	text,
	slides,
}: {
	readonly correction: ReplyCorrection;
	readonly text: string;
	readonly slides: readonly SlideReading[];
}): IgnoredBecause | null {
	if (
		countWords(correction.wrongForm) > MAX_FORM_WORDS ||
		countWords(correction.rightForm) > MAX_FORM_WORDS
	) {
		return "form-too-long";
	}
	if (
		!slides.some((slide) =>
			printedTexts(slide).some((piece) => piece.includes(correction.rightForm)),
		)
	) {
		return "right-form-not-on-slide";
	}
	if (!text.includes(correction.wrongForm)) {
		return "wrong-form-not-in-text";
	}
	return null;
}

/** A span of the subtopic text that one correction changes. */
type ChangedSpan = { readonly start: number; readonly end: number; readonly rightForm: string };

/**
 * Finds the occurrences of a form in a text, from left to right, with no two
 * occurrences overlapping.
 *
 * @param args - The text and the form.
 * @param args.text - The text to search.
 * @param args.form - The form to find. It is not blank.
 * @returns The start of each occurrence.
 */
function occurrencesOf({
	text,
	form,
}: {
	readonly text: string;
	readonly form: string;
}): readonly number[] {
	const starts: number[] = [];
	for (
		let start = text.indexOf(form);
		start !== -1;
		start = text.indexOf(form, start + form.length)
	) {
		starts.push(start);
	}
	return starts;
}

/**
 * Changes each occurrence of the wrong form of each correction to its right
 * form. The longer wrong form goes first. A shorter wrong form changes only the
 * occurrences that no longer form has changed. Each form is found in the text
 * before term correction, so a right form is never changed again.
 *
 * @param args - The text, and the corrections that passed each check.
 * @param args.text - The subtopic text before term correction.
 * @param args.corrections - The corrections, in reply order.
 * @returns Each correction in reply order with its number of changes, and the corrected text.
 */
function applyCorrections({
	text,
	corrections,
}: {
	readonly text: string;
	readonly corrections: readonly ReplyCorrection[];
}): { readonly corrections: readonly Correction[]; readonly correctedText: string } {
	const longestFirst = [...corrections].sort(
		// eslint-disable-next-line max-params -- the specification sets the parameters of the comparator of Array.prototype.sort.
		(first, second) => second.wrongForm.length - first.wrongForm.length,
	);
	const spans: ChangedSpan[] = [];
	const changes = new Map<ReplyCorrection, number>();
	for (const correction of longestFirst) {
		const free = occurrencesOf({ text, form: correction.wrongForm })
			.map((start) => ({
				start,
				end: start + correction.wrongForm.length,
				rightForm: correction.rightForm,
			}))
			.filter((span) => !spans.some((taken) => span.start < taken.end && taken.start < span.end));
		spans.push(...free);
		changes.set(correction, free.length);
	}
	let correctedText = text;
	// The last span changes first, so each change leaves the start of each earlier span in place.
	// eslint-disable-next-line max-params -- the specification sets the parameters of the comparator of Array.prototype.sort.
	for (const span of [...spans].sort((first, second) => second.start - first.start)) {
		correctedText =
			correctedText.slice(0, span.start) + span.rightForm + correctedText.slice(span.end);
	}
	return {
		corrections: corrections.map((correction) => ({
			...correction,
			occurrencesChanged: changes.get(correction) ?? 0,
		})),
		correctedText,
	};
}

/**
 * Checks each correction of a reply, and applies the corrections that pass.
 *
 * @param args - The subtopic with its slides, and the corrections of the reply.
 * @param args.subtopic - The subtopic.
 * @param args.slides - The reading of each slide placed in the subtopic.
 * @param args.corrections - The corrections of the reply, in reply order.
 * @returns The first rewrite attempt of the subtopic.
 */
function correctedAttempt({
	subtopic,
	slides,
	corrections,
}: SubtopicWithSlides & { readonly corrections: readonly ReplyCorrection[] }): RewriteAttempt {
	const checked = corrections.map((correction) => ({
		correction,
		ignoredBecause: failedCheck({ correction, text: subtopic.text, slides }),
	}));
	const applied = applyCorrections({
		text: subtopic.text,
		corrections: checked.flatMap(({ correction, ignoredBecause }) =>
			ignoredBecause === null ? [correction] : [],
		),
	});
	return {
		subtopicId: subtopic.subtopicId,
		attemptNumber: FIRST_ATTEMPT,
		termCorrectionPromptVersion: TERM_CORRECTION_PROMPT_VERSION,
		slideNumbers: slides.map((slide) => slide.slideNumber),
		corrections: applied.corrections,
		ignoredCorrections: checked.flatMap(({ correction, ignoredBecause }) =>
			ignoredBecause === null ? [] : [{ ...correction, ignoredBecause }],
		),
		correctedText: applied.correctedText,
	};
}

/**
 * Gives the path of one rewrite attempt of a subtopic.
 *
 * @param args - The workspace, the subtopic and the attempt.
 * @param args.workspaceRoot - The absolute path to the lecture workspace.
 * @param args.subtopicId - The subtopic.
 * @param args.attemptNumber - The number of the rewrite attempt, from 1.
 * @returns The absolute path of the rewrite attempt.
 */
function rewriteAttemptPath({
	workspaceRoot,
	subtopicId,
	attemptNumber,
}: {
	readonly workspaceRoot: string;
	readonly subtopicId: number;
	readonly attemptNumber: number;
}): string {
	return join(
		stageDirectoryPath({ workspaceRoot, stageId: STAGE_ID }),
		`subtopic-${subtopicId}-attempt-${attemptNumber}.json`,
	);
}

/**
 * Reads the structured transcript, the slide placements, and the reading of each
 * placed slide.
 *
 * @param context - The stage context.
 * @returns Every subtopic in lecture order, each with the reading of each slide placed in it.
 * @throws {RewriteSubtopicsError} If an input file is missing, unreadable or the wrong shape.
 */
async function readRewriteInput(context: StageContext): Promise<RewriteInput> {
	const fail = (message: string): Error => new RewriteSubtopicsError(message);
	const purpose = "rewrite the subtopics of";
	const { topics } = await readStageStructuredTranscript({ context, purpose, fail });
	const { placements } = await readStageSlidePlacements({ context, purpose, fail });
	const slideNumbers = [...new Set(placements.map((placement) => placement.slideNumber))];
	const readings = await Promise.all(
		slideNumbers.map((slideNumber) => readSlideReading({ context, slideNumber, fail })),
	);
	const readingOf = new Map(readings.map((reading) => [reading.slideNumber, reading]));
	return {
		subtopics: topics
			.flatMap((topic) => topic.subtopics)
			.map((subtopic) => ({
				subtopic,
				slides: placements.flatMap((placement) => {
					const reading = readingOf.get(placement.slideNumber);
					return placement.subtopicId === subtopic.subtopicId &&
						reading !== undefined &&
						isSubjectMatter(reading)
						? [reading]
						: [];
				}),
			})),
	};
}

/**
 * Corrects the terms of each subtopic that has a placed slide, with as many
 * calls in flight as the stage's `concurrency` allows. Each first rewrite attempt
 * is written as soon as it is made. A saved attempt is read back, and its
 * subtopic gets no call.
 *
 * @param args - The input, the stage context and the model calls of the stage run.
 * @param args.input - The subtopics with their placed slides.
 * @param args.context - The stage context.
 * @param args.calls - The model calls of this stage run.
 * @param args.concurrency - The stage's `concurrency`.
 * @returns The rewrite attempts, the cost of the calls and the files written.
 * @throws {ResendsExhaustedError} If a subtopic's third send is still unusable.
 * @throws {RewriteSubtopicsError} If a saved rewrite attempt is unreadable.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger has mutable properties that the rule cannot ignore. CLAUDE.md permits a mutable type that a library requires.
async function rewriteSubtopics({
	input,
	context,
	calls,
	concurrency,
}: ModelStageRunArgs<RewriteInput>): Promise<StageResult<RewriteSubtopicsOutput>> {
	const files = input.subtopics.map((entry) => ({
		...entry,
		path: rewriteAttemptPath({
			workspaceRoot: context.workspaceRoot,
			subtopicId: entry.subtopic.subtopicId,
			attemptNumber: FIRST_ATTEMPT,
		}),
	}));
	const { contents, cost } = await readOrMakeSavedFiles<(typeof files)[number], RewriteAttempt>({
		files,
		label: "Subtopics",
		concurrency,
		readSaved: readerFromCheck(isRewriteAttempt),
		unreadable: (path) =>
			new RewriteSubtopicsError(
				unreadableSavedFileMessage({
					path,
					content: "rewrite attempt",
					remake: "correct the subtopic",
				}),
			),
		make: async ({ subtopic, slides }) => {
			if (slides.length === 0) {
				return { content: correctedAttempt({ subtopic, slides, corrections: [] }), cost: null };
			}
			const sent = await calls.sendJsonWithResends({
				what: `Term correction of subtopic ${subtopic.subtopicId}`,
				messages: buildTermCorrectionMessages({ text: subtopic.text, slides }),
				isReply: isTermCorrectionReply,
				documentedShape: DOCUMENTED_REPLY_SHAPE,
				use: usableReply,
			});
			return {
				content: correctedAttempt({ subtopic, slides, corrections: sent.reply.corrections }),
				cost: sent.cost,
			};
		},
	});
	return {
		output: { attempts: contents },
		cost,
		filesWritten: files.map((file) => relative(context.workspaceRoot, file.path)),
	};
}

/** Builds the `rewrite-subtopics` stage from the logger and the OpenAI client of the invocation. */
export const createRewriteSubtopicsStage: ModelStageFactory<RewriteInput, RewriteSubtopicsOutput> =
	defineModelStage({ stageId: STAGE_ID, getInput: readRewriteInput, run: rewriteSubtopics });
