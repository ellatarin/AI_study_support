/**
 * The `choose-division` stage, the third division stage. The deepened splitting
 * runs vote on where the transcript divides. The run nearest the vote is handed
 * on whole (technical-design.md §5, `choose-division`). The rule that chooses the run
 * is the rule of the prototype (`division_support.py`), copied exactly with its arithmetic. So
 * the stage chooses what the prototype chose.
 */

import type { Logger } from "pino";
import type { PipelineStage, StageContext } from "../../../types/pipeline.js";
import { NamedError } from "../../../utils/errors.js";
import type { Subtopic } from "../division.js";
import { distanceFromVote, panelVote } from "../panel-vote.js";
import { createPipelineStage } from "../pipeline-stage.js";
import { readTranscriptAndRuns } from "../stage-input.js";
import { type DivisionOutput, writeDivisionWithStageRecord } from "../stage-output.js";

const STAGE_ID = "choose-division";

/**
 * The error when the transcript is missing, unreadable or holds no text. It is
 * also the error when a deepened splitting run is missing, or when there are no
 * runs to choose from.
 */
export class ChooseDivisionError extends NamedError {}

/**
 * The largest distance from the first cut of a cut site to another cut of the
 * same cut site, in percent of the transcript length. It is a measured property
 * of how runs disagree, not a setting (technical-design.md §5, "Dividing the transcript").
 */
const CUT_SITE_TOLERANCE_PERCENT = 1;

/** The stage record of `choose-division`: the chosen run, its distance from the vote, and the panel size. */
export type DivisionChoice = {
	/** The chosen run, counting from 1, as the saved runs are numbered. */
	readonly chosenRun: number;
	readonly distanceFromVote: number;
	readonly panelSize: number;
};

/**
 * Gives the cuts of a run, in percent of the transcript length. The first
 * subtopic starts at the start of the transcript, so its start is not a cut.
 *
 * @param args - The run, and the transcript length.
 * @param args.run - The subtopics of the run.
 * @param args.length - The transcript length in characters.
 * @returns The cuts of the run, in percent.
 */
function cutsInPercent({
	run,
	length,
}: {
	readonly run: readonly Subtopic[];
	readonly length: number;
}): readonly number[] {
	return run.slice(1).map((subtopic) => (subtopic.start / length) * 100);
}

/**
 * Groups cuts into cut sites, in position order. A cut joins the current cut
 * site when it is within the tolerance of the first cut of the cut site.
 * Otherwise it starts a new cut site. So a cut site cannot grow cut by cut until
 * it includes a neighbour.
 *
 * @param cuts - The cuts of all the runs together, in percent.
 * @returns The first and the last cut of each cut site, in order.
 */
function cutSites(
	cuts: readonly number[],
): readonly { readonly first: number; readonly last: number }[] {
	const sites: { first: number; last: number }[] = [];
	// eslint-disable-next-line max-params -- the specification sets the parameters of the comparator of Array.prototype.sort.
	for (const cut of [...cuts].sort((earlier, later) => earlier - later)) {
		const current = sites.at(-1);
		if (current !== undefined && cut - current.first <= CUT_SITE_TOLERANCE_PERCENT) {
			current.last = cut;
		} else {
			sites.push({ first: cut, last: cut });
		}
	}
	return sites;
}

/**
 * Gives the division of each run as the cut sites that it cuts at. A run cuts
 * at a cut site when one of its cuts is inside the cut site, widened by half the
 * tolerance at each end. So a cut just outside a cut site still counts for it.
 * One cut can count for two cut sites that are near each other.
 *
 * @param args - The runs, and the transcript length.
 * @param args.runs - The runs of the panel, in run order.
 * @param args.length - The transcript length in characters.
 * @returns The cut sites of each run, as indexes into the ordered list of cut sites.
 */
function runsAsCutSites({
	runs,
	length,
}: {
	readonly runs: readonly (readonly Subtopic[])[];
	readonly length: number;
}): readonly (readonly number[])[] {
	const cuts = runs.map((run) => cutsInPercent({ run, length }));
	const sites = [...cutSites(cuts.flat()).entries()];
	const margin = CUT_SITE_TOLERANCE_PERCENT / 2;
	return cuts.map((runCuts) =>
		sites
			.filter(([, site]) =>
				runCuts.some((cut) => site.first - margin <= cut && cut <= site.last + margin),
			)
			.map(([index]) => index),
	);
}

/**
 * Gives the distance of a run from all the runs of the panel: the sum of its
 * distance to each run. Its distance to itself is 0, so the sum can include it.
 *
 * @param args - The run, and the panel.
 * @param args.run - The cut sites of the run.
 * @param args.sites - The cut sites of each run.
 * @returns The sum of the distances.
 */
function distanceFromOthers({
	run,
	sites,
}: {
	readonly run: readonly number[];
	readonly sites: readonly (readonly number[])[];
}): number {
	let total = 0;
	for (const other of sites) {
		total += distanceFromVote({ run, vote: other });
	}
	return total;
}

/**
 * Chooses the division of the lecture. It is the run whose cut sites differ
 * least from the vote. A tie goes to the run closest to all the other runs, then
 * to the earliest run. So the same panel always gives the same division
 * (technical-design.md §5, `choose-division`).
 *
 * @param args - The transcript, the runs of the panel, and the bar.
 * @param args.text - The transcript that the runs divide.
 * @param args.runs - The deepened splitting runs, in run order.
 * @param args.bar - The number of runs that must cut at a cut site for the vote to keep it.
 * @returns The subtopics of the chosen run, unchanged, and the stage record of the choice.
 * @throws {ChooseDivisionError} When there are no runs to choose from.
 */
export function chooseDivision({
	text,
	runs,
	bar,
}: {
	readonly text: string;
	readonly runs: readonly (readonly Subtopic[])[];
	readonly bar: number;
}): { readonly subtopics: readonly Subtopic[]; readonly choice: DivisionChoice } {
	const sites = runsAsCutSites({ runs, length: text.length });
	const vote = panelVote({ runs: sites, bar });
	const ranked = [...sites.entries()].map(([index, run]) => ({
		index,
		subtopics: runs[index],
		fromVote: distanceFromVote({ run, vote }),
		fromOthers: distanceFromOthers({ run, sites }),
	}));
	const [chosen] = ranked.sort(
		// eslint-disable-next-line max-params -- the specification sets the parameters of the comparator of Array.prototype.sort.
		(one, another) =>
			one.fromVote - another.fromVote ||
			one.fromOthers - another.fromOthers ||
			one.index - another.index,
	);
	if (chosen?.subtopics === undefined) {
		throw new ChooseDivisionError("A division cannot be chosen from no runs");
	}
	return {
		subtopics: chosen.subtopics,
		choice: {
			chosenRun: chosen.index + 1,
			distanceFromVote: chosen.fromVote,
			panelSize: runs.length,
		},
	};
}

/** The transcript, and every deepened splitting run in run order. */
type ChooseDivisionInput = Awaited<ReturnType<typeof readTranscriptAndRuns>>;

/**
 * Reads the transcript and the whole panel of deepened splitting runs.
 *
 * @param context - The stage context.
 * @returns The input of the stage.
 * @throws {ChooseDivisionError} When the transcript is missing, unreadable or holds no text, or a deepened splitting run is missing.
 * @throws {SavedRunUnreadableError} When a saved run holds no readable run.
 */
function readInput(context: StageContext): Promise<ChooseDivisionInput> {
	return readTranscriptAndRuns({
		context,
		panelStage: "deepen-subtopic-splitting",
		fail: (message) => new ChooseDivisionError(message),
	});
}

/**
 * Builds the `choose-division` stage. The stage writes the chosen division, with
 * its stage record beside it. It calls no model (technical-design.md §5, `choose-division`).
 *
 * @param args - The dependencies of the stage.
 * @param args.logger - The logger of the invocation.
 * @returns The stage.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger has mutable properties that the rule cannot ignore. This function only gives the logger to the stage.
export function createChooseDivisionStage({
	logger,
}: {
	readonly logger: Logger;
}): PipelineStage<ChooseDivisionInput, DivisionOutput> {
	return createPipelineStage({
		stageId: STAGE_ID,
		logger,
		getInput: readInput,
		run: ({ input, context }) => {
			const { subtopics, choice } = chooseDivision({
				text: input.transcript,
				runs: input.runs,
				bar: context.config.subtopicSplitting.bar,
			});
			return writeDivisionWithStageRecord({
				stageId: STAGE_ID,
				context,
				subtopics,
				stageRecord: choice,
				cost: null,
			});
		},
	});
}
