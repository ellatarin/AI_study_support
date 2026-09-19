/**
 * Deepening one division: send every subtopic over the size gate to the model,
 * cut where it says, and go round again for any piece still over.
 *
 * It takes the model call as a function rather than making it, so what it
 * decides can be tested without the network. Reading the initial subtopic
 * splitting run and writing the result stay with `deepen-trial.mts`.
 *
 * A splitting run with any subtopic whose call never succeeded is REFUSED
 * rather than completed. A failed subtopic left whole reads in the results
 * exactly like the model deciding it was one step, and so would enter the vote
 * unnoticed.
 */

import { applyCuts } from "./cut-blocks.mts";
import { type TrialMessage, type TrialReply, threwVerdict, VERDICT } from "./trial-model.mts";

/** How many times a piece may be sent back after being split. */
const MAX_ROUNDS = 2;

/**
 * How many times one subtopic's call is attempted before it is given up on.
 *
 * Running every subtopic of every run at once makes a proportion of the calls
 * come back empty. Without retrying, the measurement is of the rate limiter
 * rather than of the prompt.
 */
const MAX_ATTEMPTS = 3;

/** The back-off grows by this much with each attempt, since failures cluster when many calls are in flight. */
const BACK_OFF_MILLISECONDS = 1500;

/**
 * The label the user message puts before the passage. It says "Section"
 * because that is what every deepening version with recorded runs was sent;
 * changing it changes the prompt, and so belongs in a new version.
 */
const PASSAGE_LABEL = "Section:";

/** One subtopic of the division, and where it sits in the transcript. */
export type Subtopic = {
	readonly label: string;
	readonly why: string;
	readonly from: number;
	readonly to: number;
};

/** The one model call deepening makes, given its messages. */
export type CallModel = (messages: readonly TrialMessage[]) => Promise<TrialReply>;

/**
 * What a completed splitting run is worth knowing about, without opening its
 * subtopics. The field names are the ones every recorded run file carries.
 */
export type DeepenTally = {
	/** Subtopics that were over the size gate and so were sent, across all rounds. */
	readonly sectionsSent: number;
	/** Of those, how many came back as one step. */
	readonly heldAsOneStep: number;
	/** Cuts the model proposed that could not be located in their subtopic. */
	readonly cutsUnplaced: number;
	/** Attempts beyond the first, across every subtopic. */
	readonly retries: number;
	readonly promptTokens: number;
	readonly completionTokens: number;
};

/** A subtopic whose every attempt failed, and the verdict on its last one. */
export type SubtopicFailure = {
	readonly label: string;
	readonly reason: string;
};

/** A splitting run either divides every subtopic it sent, or is refused. */
export type DeepenResult =
	| { readonly state: "completed"; readonly subtopics: readonly Subtopic[]; readonly tally: DeepenTally }
	| { readonly state: "refused"; readonly failures: readonly SubtopicFailure[] };

/** What one call to the model came back with. */
type DeepenReply = {
	readonly verdict?: string;
	readonly cuts?: readonly {
		readonly label?: string;
		readonly groupedBecause?: string;
		readonly startsWith?: string;
	}[];
};

/** What one round did to one subtopic. */
type Deepened = {
	readonly subtopics: readonly Subtopic[];
	readonly sent: boolean;
	readonly held: boolean;
	readonly unplaced: number;
	readonly promptTokens: number;
	readonly completionTokens: number;
	/** The verdict on the last attempt when every attempt failed; null otherwise. */
	readonly failure: string | null;
	/** Attempts beyond the first that this subtopic needed. */
	readonly retries: number;
};

/** A reply that could be read, or the verdict on why it could not. */
type ReadReply = { readonly state: "read"; readonly reply: DeepenReply } | { readonly state: "failed"; readonly verdict: string };

/** Waits between attempts. */
function pause(milliseconds: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, milliseconds);
	});
}

/** Words, counted the one way this harness counts them. */
function wordCount(text: string): number {
	return text.split(/\s+/u).filter((word) => word.length > 0).length;
}

/** A subtopic that was never sent, reported as though a round had passed over it. */
function untouched(subtopic: Subtopic): Deepened {
	return {
		subtopics: [subtopic],
		sent: false,
		held: false,
		unplaced: 0,
		promptTokens: 0,
		completionTokens: 0,
		failure: null,
		retries: 0,
	};
}

/** Parse a reply's content, naming what was wrong with it when it cannot be read. */
function readReply(content: string): ReadReply {
	if (content.length === 0) {
		return { state: "failed", verdict: VERDICT.empty };
	}
	try {
		return { state: "read", reply: JSON.parse(content) as DeepenReply };
	} catch {
		return { state: "failed", verdict: VERDICT.unparseable };
	}
}

/**
 * Cut one subtopic at the openings the model quoted.
 *
 * The cuts are located within the subtopic's own text and never outside it, so
 * a quote that cannot be placed is dropped rather than guessed at, and the
 * subtopic's own cuts are untouchable.
 */
function cutSubtopic({
	transcriptText,
	subtopic,
	reply,
}: {
	readonly transcriptText: string;
	readonly subtopic: Subtopic;
	readonly reply: DeepenReply;
}): Pick<Deepened, "subtopics" | "held" | "unplaced"> {
	const proposed = (reply.cuts ?? []).filter((cut) => (cut.startsWith ?? "").length > 0);
	if (proposed.length === 0) {
		return { subtopics: [subtopic], held: true, unplaced: 0 };
	}
	// The placeholder stands for the subtopic's own start, which applyCuts skips.
	const { blocks, misses } = applyCuts(transcriptText.slice(subtopic.from, subtopic.to), [
		{ id: 0, label: subtopic.label, startsWith: "" },
		...proposed.map((cut, index) => ({
			id: index + 1,
			label: cut.label ?? "",
			startsWith: cut.startsWith ?? "",
		})),
	]);
	let offset = subtopic.from;
	const subtopics = blocks.map((block, index) => {
		const from = offset;
		offset += block.content.length;
		return {
			label: index === 0 ? subtopic.label : block.label,
			why: index === 0 ? subtopic.why : (proposed[index - 1]?.groupedBecause ?? ""),
			from,
			to: offset,
		};
	});
	return { subtopics, held: false, unplaced: misses.length };
}

/** Ask the model where one subtopic divides, retrying a failed call, and apply what it proposes. */
async function deepenSubtopic({
	transcriptText,
	subtopic,
	systemPrompt,
	callModel,
}: {
	readonly transcriptText: string;
	readonly subtopic: Subtopic;
	readonly systemPrompt: string;
	readonly callModel: CallModel;
}): Promise<Deepened> {
	const passage = transcriptText.slice(subtopic.from, subtopic.to);
	let promptTokens = 0;
	let completionTokens = 0;
	let failure: string = VERDICT.empty;
	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
		if (attempt > 1) {
			await pause((attempt - 1) * BACK_OFF_MILLISECONDS);
		}
		let reply: TrialReply;
		try {
			reply = await callModel([
				{ role: "system", content: systemPrompt },
				{ role: "user", content: `${PASSAGE_LABEL}\n${passage}` },
			]);
		} catch (error: unknown) {
			failure = threwVerdict(error);
			continue;
		}
		promptTokens += reply.promptTokens ?? 0;
		completionTokens += reply.completionTokens ?? 0;
		const read = readReply(reply.content);
		if (read.state === "failed") {
			failure = read.verdict;
			continue;
		}
		return {
			...cutSubtopic({ transcriptText, subtopic, reply: read.reply }),
			sent: true,
			failure: null,
			retries: attempt - 1,
			promptTokens,
			completionTokens,
		};
	}
	return {
		...untouched(subtopic),
		sent: true,
		failure,
		retries: MAX_ATTEMPTS - 1,
		promptTokens,
		completionTokens,
	};
}

/** Add one round's sent subtopics to the running tally. */
function addToTally({
	tally,
	results,
}: {
	readonly tally: DeepenTally;
	readonly results: readonly Deepened[];
}): DeepenTally {
	return results
		.filter((result) => result.sent)
		.reduce(
			(sum, result) => ({
				sectionsSent: sum.sectionsSent + 1,
				heldAsOneStep: sum.heldAsOneStep + (result.held ? 1 : 0),
				cutsUnplaced: sum.cutsUnplaced + result.unplaced,
				retries: sum.retries + result.retries,
				promptTokens: sum.promptTokens + result.promptTokens,
				completionTokens: sum.completionTokens + result.completionTokens,
			}),
			tally,
		);
}

/**
 * Deepen a division: send each subtopic over the size gate to the model and
 * cut it where the model says, for up to two rounds.
 *
 * Subtopics under the size gate are never sent and so can never be disturbed.
 * Every over-gate subtopic in a round goes at once — each is asked only about
 * its own text and can only cut inside it — and a failed call is retried with
 * a growing pause before its subtopic is given up on.
 *
 * @param options - Options object.
 * @param options.transcriptText - The whole transcript the subtopics index into.
 * @param options.subtopics - The division to deepen, in transcript order.
 * @param options.sizeGateWords - A subtopic with more words than this is sent.
 * @param options.systemPrompt - The deepening prompt for this version.
 * @param options.callModel - Makes one model call from the given messages.
 * @returns The deeper division and its tally, or — when any subtopic's call
 *   failed on every attempt — a refusal naming each such subtopic and why.
 *
 * @example
 * const result = await deepenDivision({ transcriptText, subtopics, sizeGateWords: 600, systemPrompt, callModel });
 * if (result.state === "refused") throw new Error(result.failures.map((f) => f.reason).join("; "));
 */
export async function deepenDivision({
	transcriptText,
	subtopics: initial,
	sizeGateWords,
	systemPrompt,
	callModel,
}: {
	readonly transcriptText: string;
	readonly subtopics: readonly Subtopic[];
	readonly sizeGateWords: number;
	readonly systemPrompt: string;
	readonly callModel: CallModel;
}): Promise<DeepenResult> {
	let subtopics = initial;
	let tally: DeepenTally = {
		sectionsSent: 0,
		heldAsOneStep: 0,
		cutsUnplaced: 0,
		retries: 0,
		promptTokens: 0,
		completionTokens: 0,
	};
	for (let round = 0; round < MAX_ROUNDS; round += 1) {
		const isOver = subtopics.map(
			(subtopic) => wordCount(transcriptText.slice(subtopic.from, subtopic.to)) > sizeGateWords,
		);
		if (!isOver.some(Boolean)) {
			break;
		}
		// Promise.all keeps the results in transcript order.
		const results = await Promise.all(
			subtopics.map(async (subtopic, index) =>
				isOver[index] === true
					? deepenSubtopic({ transcriptText, subtopic, systemPrompt, callModel })
					: untouched(subtopic),
			),
		);
		const failures = results.flatMap((result) =>
			result.failure === null
				? []
				: [{ label: result.subtopics[0]?.label ?? "", reason: result.failure }],
		);
		if (failures.length > 0) {
			return { state: "refused", failures };
		}
		tally = addToTally({ tally, results });
		const next = results.flatMap((result) => result.subtopics);
		const nothingMoved = next.length === subtopics.length;
		subtopics = next;
		// Another round would ask the same questions again.
		if (nothingMoved) {
			break;
		}
	}
	return { state: "completed", subtopics, tally };
}
