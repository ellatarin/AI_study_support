/**
 * The `retitle-subtopics` stage. It gives each subtopic of the chosen division a
 * new title from its own text. It makes one call for the whole lecture, with the
 * `r9` prompt of the prototype. Only titles change. No cut moves
 * (technical-design.md §5, `retitle-subtopics`).
 */

import type { StageContext, StageResult } from "../../../types/pipeline.js";
import { NamedError } from "../../../utils/errors.js";
import { isRecord } from "../../../utils/record.js";
import { type Subtopic, subtopicText } from "../division.js";
import {
	defineModelStage,
	type ModelStageFactory,
	type ModelStageRunArgs,
} from "../model-stage.js";
import { sendJsonWithResends } from "../panel-runs.js";
import { readTranscriptAndDivision, type TranscriptAndDivision } from "../stage-input.js";
import { type DivisionOutput, writeDivisionWithStageRecord } from "../stage-output.js";
import { buildRetitleMessages } from "./retitle-subtopics.prompt.js";

/**
 * The error when the transcript or the chosen division is missing or unreadable.
 * A call whose third send is still unusable fails the stage with `ResendsExhaustedError`.
 */
export class RetitleSubtopicsError extends NamedError {}

const STAGE_ID = "retitle-subtopics";

/** One entry of the reply: a subtopic id and the new title of that subtopic. */
type ReplyTitle = { readonly id: number; readonly title: string };

/** The reply that the `r9` prompt asks for: a title for each subtopic, by subtopic id. */
type TitlesReply = { readonly titles: readonly ReplyTitle[] };

/** The text that ends the failure "The model's reply is not the documented …". */
const DOCUMENTED_REPLY_SHAPE = "{ titles: [{ id, title }] } object";

/**
 * Checks that a value in a parsed reply is the title of one subtopic.
 *
 * @param value - One entry of the list in the reply.
 * @returns `true` when it has a number subtopic id and a string title.
 */
function isReplyTitle(value: unknown): value is ReplyTitle {
	return isRecord(value) && typeof value.id === "number" && typeof value.title === "string";
}

/**
 * Checks that a parsed reply is a list of titles.
 *
 * @param value - The parsed reply.
 * @returns `true` when it holds a list and each entry is a title.
 */
function isTitlesReply(value: unknown): value is TitlesReply {
	return isRecord(value) && Array.isArray(value.titles) && value.titles.every(isReplyTitle);
}

/** One subtopic of the chosen division, and the title that the reply gave it. */
type Retitling = { readonly subtopic: Subtopic; readonly newTitle: string };

/**
 * Pairs each subtopic with its title from the reply. The reply must give one
 * title that is not blank for each subtopic, in order. A missing, repeated,
 * out-of-range or out-of-order subtopic id makes the reply unusable. A blank
 * title also makes it unusable.
 *
 * @param args - The subtopics of the division, and the titles of the reply.
 * @param args.subtopics - The subtopics of the chosen division, in order.
 * @param args.titles - The titles that the reply gave.
 * @returns Each subtopic with its new title, or the reason that the reply is unusable.
 */
function pairTitles({
	subtopics,
	titles,
}: {
	readonly subtopics: readonly Subtopic[];
	readonly titles: readonly ReplyTitle[];
}): { readonly reply: readonly Retitling[] } | { readonly failure: string } {
	const outOfOrder = {
		failure: `The model's reply does not give subtopics 1 to ${subtopics.length} once each, in order`,
	};
	const pairs: Retitling[] = [];
	for (const [index, subtopic] of subtopics.entries()) {
		const entry = titles[index];
		if (entry?.id !== index + 1) {
			return outOfOrder;
		}
		if (entry.title.trim() === "") {
			return { failure: "The model's reply gives a subtopic a blank title" };
		}
		pairs.push({ subtopic, newTitle: entry.title });
	}
	return titles.length === subtopics.length ? { reply: pairs } : outOfOrder;
}

/** The stage record of `retitle-subtopics`: the number of subtopics, and the titles that changed (technical-design.md §4.5). */
type TitleChanges = {
	readonly subtopics: number;
	readonly titlesChanged: number;
	readonly changed: readonly {
		readonly subtopicId: number;
		readonly oldTitle: string;
		readonly newTitle: string;
	}[];
};

/**
 * Lists the titles that retitling changed. A new title that is the same as the
 * old title is not a change.
 *
 * @param retitlings - Each subtopic of the chosen division with its new title, in order.
 * @returns The stage record that is written beside the retitled division.
 */
function titleChanges(retitlings: readonly Retitling[]): TitleChanges {
	const changed = [...retitlings.entries()].flatMap(([index, { subtopic, newTitle }]) =>
		newTitle === subtopic.title
			? []
			: [{ subtopicId: index + 1, oldTitle: subtopic.title, newTitle }],
	);
	return { subtopics: retitlings.length, titlesChanged: changed.length, changed };
}

/**
 * Reads the transcript and the chosen division.
 *
 * @param context - The stage context.
 * @returns The input of the stage.
 * @throws {RetitleSubtopicsError} If the transcript is missing or holds no text, or the chosen division is missing or unreadable.
 */
function readInput(context: StageContext): Promise<TranscriptAndDivision> {
	return readTranscriptAndDivision({
		context,
		stageId: "choose-division",
		purpose: "retitle",
		fail: (message) => new RetitleSubtopicsError(message),
	});
}

/**
 * Asks the model for a title for each subtopic. Then it writes the retitled
 * division, with its stage record beside it.
 *
 * @param args - The input, the stage context and the dependencies of the stage.
 * @param args.input - The transcript and the chosen division.
 * @param args.context - The stage context.
 * @param args.logger - The logger that records the model call.
 * @param args.client - The OpenAI client that sends the call.
 * @param args.sendGate - The send gate of this stage run. Every send waits on it.
 * @returns The retitled division, the cost of the call, and the files written.
 * @throws {ResendsExhaustedError} If the third send is still unusable.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger and the OpenAI client have mutable properties that the rule cannot ignore. This function only reads them. CLAUDE.md permits a mutable type that a library requires.
async function retitle({
	input,
	context,
	logger,
	client,
	sendGate,
}: ModelStageRunArgs<TranscriptAndDivision>): Promise<StageResult<DivisionOutput>> {
	const messages = buildRetitleMessages({
		texts: input.subtopics.map((subtopic) => subtopicText({ text: input.transcript, subtopic })),
	});
	const sent = await sendJsonWithResends({
		what: "Retitling",
		messages,
		stageId: STAGE_ID,
		context,
		isReply: isTitlesReply,
		documentedShape: DOCUMENTED_REPLY_SHAPE,
		logger,
		client,
		sendGate,
		use: ({ titles }) => pairTitles({ subtopics: input.subtopics, titles }),
	});
	return writeDivisionWithStageRecord({
		stageId: STAGE_ID,
		context,
		subtopics: sent.reply.map(({ subtopic, newTitle }) => ({ ...subtopic, title: newTitle })),
		stageRecord: titleChanges(sent.reply),
		cost: sent.cost,
	});
}

/** Builds the `retitle-subtopics` stage from the logger and the OpenAI client of the invocation. */
export const createRetitleSubtopicsStage: ModelStageFactory<TranscriptAndDivision, DivisionOutput> =
	defineModelStage({ stageId: STAGE_ID, getInput: readInput, run: retitle });
