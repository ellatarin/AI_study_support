/**
 * Pass 1.5's work on one division: send every section over the gate to the
 * model, cut where it says, and go round again for any piece still over.
 *
 * It takes the model call as a function rather than making it, so what it
 * decides can be tested without the network. Reading the pass-one run and
 * writing the result stay with `deepen-trial.mts`.
 *
 * A run with any section whose call never succeeded is REFUSED rather than
 * completed. A failed section left whole reads in the results exactly like the
 * model deciding it was one step, and so would enter the vote unnoticed.
 */

import { applyCuts } from "./cut-blocks.mts";
import { type TrialMessage, type TrialReply, threwVerdict, VERDICT } from "./trial-model.mts";

/** How many times a piece may be sent back after being split. */
const MAX_ROUNDS = 2;

/**
 * How many times one section's call is attempted before it is given up on.
 *
 * Running every section of every run at once makes a proportion of the calls
 * come back empty. Without retrying, the measurement is of the rate limiter
 * rather than of the prompt.
 */
const MAX_ATTEMPTS = 3;

/** The back-off grows by this much with each attempt, since failures cluster when many calls are in flight. */
const BACK_OFF_MILLISECONDS = 1500;

/** One section of the division, and where it sits in the transcript. */
export type Section = {
	readonly label: string;
	readonly why: string;
	readonly from: number;
	readonly to: number;
};

/** The one model call deepening makes, given its messages. */
export type CallModel = (messages: readonly TrialMessage[]) => Promise<TrialReply>;

/** What a completed run is worth knowing about, without opening its sections. */
export type DeepenTally = {
	/** Sections that were over the gate and so were sent, across all rounds. */
	readonly sectionsSent: number;
	/** Of those, how many came back as one step. */
	readonly heldAsOneStep: number;
	/** Cuts the model proposed that could not be located in their section. */
	readonly cutsUnplaced: number;
	/** Attempts beyond the first, across every section. */
	readonly retries: number;
	readonly promptTokens: number;
	readonly completionTokens: number;
};

/** A section whose every attempt failed, and the verdict on its last one. */
export type SectionFailure = {
	readonly label: string;
	readonly reason: string;
};

/** A run either divides every section it sent, or is refused. */
export type DeepenResult =
	| { readonly state: "completed"; readonly sections: readonly Section[]; readonly tally: DeepenTally }
	| { readonly state: "refused"; readonly failures: readonly SectionFailure[] };

/** What one call to the model came back with. */
type DeepenReply = {
	readonly verdict?: string;
	readonly cuts?: readonly {
		readonly label?: string;
		readonly groupedBecause?: string;
		readonly startsWith?: string;
	}[];
};

/** What one round did to one section. */
type Deepened = {
	readonly sections: readonly Section[];
	readonly sent: boolean;
	readonly held: boolean;
	readonly unplaced: number;
	readonly promptTokens: number;
	readonly completionTokens: number;
	/** The verdict on the last attempt when every attempt failed; null otherwise. */
	readonly failure: string | null;
	/** Attempts beyond the first that this section needed. */
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

/** A section that was never sent, reported as though a round had passed over it. */
function untouched(section: Section): Deepened {
	return {
		sections: [section],
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
 * Cut one section at the openings the model quoted.
 *
 * The cuts are located within the section's own text and never outside it, so
 * a quote that cannot be placed is dropped rather than guessed at, and the
 * section's own boundaries are untouchable.
 */
function cutSection({
	transcriptText,
	section,
	reply,
}: {
	readonly transcriptText: string;
	readonly section: Section;
	readonly reply: DeepenReply;
}): Pick<Deepened, "sections" | "held" | "unplaced"> {
	const proposed = (reply.cuts ?? []).filter((cut) => (cut.startsWith ?? "").length > 0);
	if (proposed.length === 0) {
		return { sections: [section], held: true, unplaced: 0 };
	}
	// The placeholder stands for the section's own start, which applyCuts skips.
	const { blocks, misses } = applyCuts(transcriptText.slice(section.from, section.to), [
		{ id: 0, label: section.label, startsWith: "" },
		...proposed.map((cut, index) => ({
			id: index + 1,
			label: cut.label ?? "",
			startsWith: cut.startsWith ?? "",
		})),
	]);
	let offset = section.from;
	const sections = blocks.map((block, index) => {
		const from = offset;
		offset += block.content.length;
		return {
			label: index === 0 ? section.label : block.label,
			why: index === 0 ? section.why : (proposed[index - 1]?.groupedBecause ?? ""),
			from,
			to: offset,
		};
	});
	return { sections, held: false, unplaced: misses.length };
}

/** Ask the model where one section divides, retrying a failed call, and apply what it proposes. */
async function deepenSection({
	transcriptText,
	section,
	systemPrompt,
	callModel,
}: {
	readonly transcriptText: string;
	readonly section: Section;
	readonly systemPrompt: string;
	readonly callModel: CallModel;
}): Promise<Deepened> {
	const passage = transcriptText.slice(section.from, section.to);
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
				{ role: "user", content: `Section:\n${passage}` },
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
			...cutSection({ transcriptText, section, reply: read.reply }),
			sent: true,
			failure: null,
			retries: attempt - 1,
			promptTokens,
			completionTokens,
		};
	}
	return {
		...untouched(section),
		sent: true,
		failure,
		retries: MAX_ATTEMPTS - 1,
		promptTokens,
		completionTokens,
	};
}

/** Add one round's sent sections to the running tally. */
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
 * Deepen a division: send each section over the gate to the model and cut it
 * where the model says, for up to two rounds.
 *
 * Sections under the gate are never sent and so can never be disturbed. Every
 * over-gate section in a round goes at once — each is asked only about its own
 * text and can only cut inside it — and a failed call is retried with a
 * growing pause before its section is given up on.
 *
 * @param options - Options object.
 * @param options.transcriptText - The whole transcript the sections index into.
 * @param options.sections - The division to deepen, in transcript order.
 * @param options.gateWords - A section with more words than this is sent.
 * @param options.systemPrompt - The deepening prompt for this version.
 * @param options.callModel - Makes one model call from the given messages.
 * @returns The deeper division and its tally, or — when any section's call
 *   failed on every attempt — a refusal naming each such section and why.
 *
 * @example
 * const result = await deepenDivision({ transcriptText, sections, gateWords: 600, systemPrompt, callModel });
 * if (result.state === "refused") throw new Error(result.failures.map((f) => f.reason).join("; "));
 */
export async function deepenDivision({
	transcriptText,
	sections: initial,
	gateWords,
	systemPrompt,
	callModel,
}: {
	readonly transcriptText: string;
	readonly sections: readonly Section[];
	readonly gateWords: number;
	readonly systemPrompt: string;
	readonly callModel: CallModel;
}): Promise<DeepenResult> {
	let sections = initial;
	let tally: DeepenTally = {
		sectionsSent: 0,
		heldAsOneStep: 0,
		cutsUnplaced: 0,
		retries: 0,
		promptTokens: 0,
		completionTokens: 0,
	};
	for (let round = 0; round < MAX_ROUNDS; round += 1) {
		const isOver = sections.map(
			(section) => wordCount(transcriptText.slice(section.from, section.to)) > gateWords,
		);
		if (!isOver.some(Boolean)) {
			break;
		}
		// Promise.all keeps the results in transcript order.
		const results = await Promise.all(
			sections.map(async (section, index) =>
				isOver[index] === true
					? deepenSection({ transcriptText, section, systemPrompt, callModel })
					: untouched(section),
			),
		);
		const failures = results.flatMap((result) =>
			result.failure === null
				? []
				: [{ label: result.sections[0]?.label ?? "", reason: result.failure }],
		);
		if (failures.length > 0) {
			return { state: "refused", failures };
		}
		tally = addToTally({ tally, results });
		const next = results.flatMap((result) => result.sections);
		const nothingMoved = next.length === sections.length;
		sections = next;
		// Another round would ask the same questions again.
		if (nothingMoved) {
			break;
		}
	}
	return { state: "completed", sections, tally };
}
