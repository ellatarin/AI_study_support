/**
 * The `correct-terms` stage. It corrects the misheard terms of each subtopic
 * from the slides placed in it. It saves the term-correction result of the first
 * rewrite attempt of each subtopic (technical-design.md §5, `correct-terms`).
 */

/* jscpd:ignore-start -- the model-calling stages import the same pipeline types,
   division helpers and model-stage helpers. So their import blocks are the
   same line for line. Imports cannot be shared, and CLAUDE.md (File
   Organisation) forbids barrel files. Only the imports are exempt. jscpd
   checks the code below. */
import type { StageContext } from "../../../types/pipeline.js";
import { NamedError } from "../../../utils/errors.js";
import { isRecord } from "../../../utils/record.js";
import { countWords } from "../../../utils/text.js";
import { FIRST_ROUND } from "../../manifest.js";
import type { SubtopicWithIdAndText } from "../division.js";
import type { ModelStageFactory } from "../model-stage.js";
import { defineRewriteAttemptStage, type RewriteAttemptWork } from "../rewrite-attempts.js";
import { isSubjectMatter, readSlideReading, type SlideReading } from "../slides.js";
import { readStageSlidePlacements, readStageSubtopics } from "../stage-input.js";
import {
	type Correction,
	type IgnoredBecause,
	isReplyCorrection,
	isTermCorrectionResult,
	type ReplyCorrection,
	type TermCorrectionResult,
} from "../term-corrections.js";
import {
	buildTermCorrectionMessages,
	TERM_CORRECTION_PROMPT_VERSION,
} from "./correct-terms.prompt.js";
/* jscpd:ignore-end */

/**
 * The error when an input file is missing or unreadable, or when a saved
 * term-correction file is unreadable. A call whose third send is still unusable
 * fails the stage with `ResendsExhaustedError`.
 */
export class CorrectTermsError extends NamedError {}

const STAGE_ID = "correct-terms";

/** The most words that each form of a correction can have (CONTEXT.md, "Correction"). */
const MAX_FORM_WORDS = 4;

/** One subtopic and its id, and the reading of each slide placed in it, in deck order. */
type SubtopicWithSlides = {
	readonly subtopicId: number;
	readonly subtopic: SubtopicWithIdAndText;
	readonly slides: readonly SlideReading[];
};

/** Every subtopic of the structured transcript in lecture order, each with its placed slides. */
type CorrectTermsInput = { readonly subtopics: readonly SubtopicWithSlides[] };

/** The reply that the term-correction prompt asks for. */
type TermCorrectionReply = { readonly corrections: readonly ReplyCorrection[] };

/** The output of `correct-terms`. */
type CorrectTermsOutput = {
	/** The term-correction result of each subtopic, in lecture order. */
	readonly attempts: readonly TermCorrectionResult[];
};

/** The text that ends the failure "The model's reply is not the documented …". */
const DOCUMENTED_REPLY_SHAPE = "{ corrections } object";

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
 * occurrences that a longer wrong form did not change. Each form is found in the text
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
 * @returns The term-correction result of the first rewrite attempt of the subtopic.
 */
function correctedAttempt({
	subtopic,
	slides,
	corrections,
}: SubtopicWithSlides & {
	readonly corrections: readonly ReplyCorrection[];
}): TermCorrectionResult {
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
		attemptNumber: FIRST_ROUND,
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
 * Reads the structured transcript, the slide placements, and the reading of each
 * placed slide.
 *
 * @param context - The stage context.
 * @returns Every subtopic in lecture order, each with the reading of each slide placed in it.
 * @throws {CorrectTermsError} If an input file is missing, unreadable or the wrong shape.
 */
async function readCorrectTermsInput(context: StageContext): Promise<CorrectTermsInput> {
	const fail = (message: string): Error => new CorrectTermsError(message);
	const purpose = "correct the terms of";
	const subtopics = await readStageSubtopics({ context, purpose, fail });
	const { placements } = await readStageSlidePlacements({ context, purpose, fail });
	const slideNumbers = [...new Set(placements.map((placement) => placement.slideNumber))];
	const readings = await Promise.all(
		slideNumbers.map((slideNumber) => readSlideReading({ context, slideNumber, fail })),
	);
	const readingOf = new Map(readings.map((reading) => [reading.slideNumber, reading]));
	return {
		subtopics: subtopics.map((subtopic) => ({
			subtopicId: subtopic.subtopicId,
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
 * Corrects the terms of one subtopic. A subtopic with no placed slide gets no
 * call, and its text is unchanged.
 *
 * @param args - The subtopic with its slides, and the model calls of the stage run.
 * @param args.subtopic - The subtopic, with the reading of each slide placed in it.
 * @param args.calls - The model calls of this stage run.
 * @returns The term-correction result.
 * @throws {ResendsExhaustedError} If the third send is still unusable.
 */
async function correctSubtopicTerms({
	subtopic: entry,
	calls,
}: RewriteAttemptWork<CorrectTermsInput, SubtopicWithSlides>): Promise<TermCorrectionResult> {
	if (entry.slides.length === 0) {
		return correctedAttempt({ ...entry, corrections: [] });
	}
	const sent = await calls.sendJsonWithResends({
		what: `Term correction of subtopic ${entry.subtopicId}`,
		messages: buildTermCorrectionMessages({ text: entry.subtopic.text, slides: entry.slides }),
		isReply: isTermCorrectionReply,
		documentedShape: DOCUMENTED_REPLY_SHAPE,
		use: usableReply,
	});
	return correctedAttempt({ ...entry, corrections: sent.reply.corrections });
}

/** Builds the `correct-terms` stage from the logger and the OpenAI client of the invocation. */
export const createCorrectTermsStage: ModelStageFactory<CorrectTermsInput, CorrectTermsOutput> =
	defineRewriteAttemptStage({
		stageId: STAGE_ID,
		getInput: readCorrectTermsInput,
		subtopicsOf: (input) => input.subtopics,
		isSaved: isTermCorrectionResult,
		saved: { content: "term-correction file", remake: "correct the subtopic" },
		fail: (message) => new CorrectTermsError(message),
		make: correctSubtopicTerms,
		output: (attempts) => ({ attempts }),
	});
