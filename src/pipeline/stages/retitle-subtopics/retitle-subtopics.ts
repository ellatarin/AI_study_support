/**
 * `retitle-subtopics`: gives every subtopic of the chosen division a new title
 * from its own text, in one call over the whole lecture with the prototype's
 * `r9` prompt. Only titles change; no cut moves (technical-design.md §5,
 * `retitle-subtopics`).
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
import { type DivisionOutput, writeDivisionWithRecord } from "../stage-output.js";
import { buildRetitleMessages } from "./retitle-subtopics.prompt.js";

/**
 * The stage could not retitle: its transcript or chosen division is missing or
 * unreadable. A call whose replies stay unusable fails with the resend loop's own error.
 */
export class RetitleSubtopicsError extends NamedError {}

const STAGE_ID = "retitle-subtopics";

/** One entry of the reply: a subtopic's position, counting from 1, and its new title. */
type ReplyTitle = { readonly id: number; readonly title: string };

/** The object the `r9` prompt asks for: a title for each subtopic, by position. */
type TitlesReply = { readonly titles: readonly ReplyTitle[] };

/** The reply's shape in words, for the failure a user reads when a reply is not one. */
const DOCUMENTED_REPLY_SHAPE = "{ titles: [{ id, title }] } object";

/**
 * Whether a value in a parsed reply is one subtopic's title.
 *
 * @param value - One entry of the reply's list.
 * @returns `true` when it carries a numeric position and a string title.
 */
function isReplyTitle(value: unknown): value is ReplyTitle {
	return isRecord(value) && typeof value.id === "number" && typeof value.title === "string";
}

/**
 * Whether a parsed reply is the documented list of titles.
 *
 * @param value - The parsed reply.
 * @returns `true` when it holds a list whose every entry is a title.
 */
function isTitlesReply(value: unknown): value is TitlesReply {
	return isRecord(value) && Array.isArray(value.titles) && value.titles.every(isReplyTitle);
}

/** One subtopic of the chosen division, and the title the reply gave it. */
type Retitling = { readonly subtopic: Subtopic; readonly newTitle: string };

/**
 * Each subtopic paired with the reply's title for it, when the reply gives
 * exactly one non-blank title for every subtopic, in order: a missing,
 * repeated, out-of-range or out-of-order position, or a blank title, makes the
 * reply unusable.
 *
 * @param args - The division's subtopics, and the reply's titles.
 * @param args.subtopics - The chosen division's subtopics, in order.
 * @param args.titles - The titles the reply gave.
 * @returns Each subtopic with its new title, or why the reply could not be used.
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

/** How many subtopics there are, and which titles changed (technical-design.md §4.5). */
type TitleChanges = {
	readonly subtopics: number;
	readonly titlesChanged: number;
	readonly changed: readonly {
		/** The subtopic, counting from 1. */
		readonly position: number;
		readonly oldTitle: string;
		readonly newTitle: string;
	}[];
};

/**
 * Lists the titles retitling changed. A new title identical to the old one is
 * not a change.
 *
 * @param retitlings - Each subtopic of the chosen division with its new title, in order.
 * @returns The record written beside the retitled division.
 */
function titleChanges(retitlings: readonly Retitling[]): TitleChanges {
	const changed = [...retitlings.entries()].flatMap(([index, { subtopic, newTitle }]) =>
		newTitle === subtopic.title
			? []
			: [{ position: index + 1, oldTitle: subtopic.title, newTitle }],
	);
	return { subtopics: retitlings.length, titlesChanged: changed.length, changed };
}

/**
 * Reads the transcript and the chosen division.
 *
 * @param context - The current lecture run context.
 * @returns The stage's input.
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
 * Asks the model for a title for every subtopic.
 *
 * @param args - The stage's input, context and dependencies.
 * @param args.input - The transcript and the chosen division.
 * @param args.context - The current lecture run context.
 * @param args.logger - The run's logger, on which the call is recorded.
 * @param args.client - The OpenAI client the call goes through.
 * @param args.sendGate - The run's turns to send, which the call waits on.
 * @returns The retitled division, what the call cost, and the files written.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger and the OpenAI client carry mutable properties the rule cannot see past; both are only read from here (CLAUDE.md permits dropping readonly where a library requires a mutable type)
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
	return writeDivisionWithRecord({
		stageId: STAGE_ID,
		context,
		subtopics: sent.reply.map(({ subtopic, newTitle }) => ({ ...subtopic, title: newTitle })),
		record: titleChanges(sent.reply),
		cost: sent.cost,
	});
}

/**
 * Builds the `retitle-subtopics` stage from the run's logger and the
 * invocation's OpenAI client.
 */
export const createRetitleSubtopicsStage: ModelStageFactory<TranscriptAndDivision, DivisionOutput> =
	defineModelStage({ stageId: STAGE_ID, getInput: readInput, run: retitle });
