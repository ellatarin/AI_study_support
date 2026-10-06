/**
 * Choosing the lecture's division from the deepened splitting runs: they vote
 * on where the transcript divides, and the run nearest the vote is handed on
 * whole (technical-design.md §5, `choose-division`). The rule is the
 * prototype's (`division_support.py`), copied exactly, arithmetic included, so
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

/** The stage could not choose a division: its transcript or a deepened run is missing or unreadable. */
export class ChooseDivisionError extends NamedError {}

/**
 * How close two cuts must be, in percent of the transcript's length, to be one
 * cut site: measured from the site's first cut. A measured property of how runs
 * disagree, not a setting (technical-design.md §5, "Dividing the transcript").
 */
const CUT_SITE_TOLERANCE_PERCENT = 1;

/** Which run was chosen, how far it stands from the vote, and out of how many runs. */
export type DivisionChoice = {
	/** The chosen run, counting from 1 as the run files are numbered. */
	readonly chosenRun: number;
	readonly distanceFromVote: number;
	readonly panelSize: number;
};

/**
 * Where a run cuts, in percent of the transcript's length: every subtopic's
 * start but the first, which is the transcript's opening and not a cut.
 *
 * @param args - The run, and the transcript's length.
 * @param args.run - The run's subtopics.
 * @param args.length - The transcript's length in characters.
 * @returns The run's cuts, in percent.
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
 * Pools cuts into cut sites: a cut joins the current site when it lies within
 * the tolerance of the site's first cut, and otherwise opens a new one, so a
 * site cannot grow cut by cut until it swallows a neighbour.
 *
 * @param cuts - Every run's cuts together, in percent.
 * @returns Each site's first and last cut, in order.
 */
function cutSites(
	cuts: readonly number[],
): readonly { readonly first: number; readonly last: number }[] {
	const sites: { first: number; last: number }[] = [];
	// eslint-disable-next-line max-params -- Array.prototype.sort's comparator is spec-defined
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
 * Each run's division as the cut sites it cuts at. A run cuts at a site when
 * any of its cuts lies within the site, widened by half the tolerance each
 * way, so a cut just outside a site still counts for it, and one cut can
 * count for two sites close together.
 *
 * @param args - The runs, and the transcript's length.
 * @param args.runs - The panel's runs, in run order.
 * @param args.length - The transcript's length in characters.
 * @returns Each run's cut sites, as indexes into the sites in order.
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
 * How far a run stands from all the panel's runs together: its distance to
 * each, summed. Its distance to itself is nothing, so it need not be left out.
 *
 * @param args - The run, and the panel.
 * @param args.run - The run's cut sites.
 * @param args.sites - Every run's cut sites.
 * @returns The summed distance.
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
 * Chooses the lecture's division: the run whose cut sites differ least from the
 * vote's, a tie going to the run closest to all the others — its distance to
 * each other run summed — and then to the earliest, so the same panel always
 * yields the same division.
 *
 * @param args - The transcript, the panel's runs, and the support a cut site needs.
 * @param args.text - The transcript the runs divide.
 * @param args.runs - The deepened runs, in run order.
 * @param args.bar - How many runs must cut at a site for the vote to keep it.
 * @returns The chosen run's subtopics unchanged, and how it was chosen.
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
		// eslint-disable-next-line max-params -- Array.prototype.sort's comparator is spec-defined
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

/** What choosing needs: the transcript, and every deepened run in run order. */
type ChooseDivisionInput = Awaited<ReturnType<typeof readTranscriptAndRuns>>;

/**
 * Reads the transcript and the whole panel of deepened runs.
 *
 * @param context - The current lecture run context.
 * @returns The stage's input.
 * @throws {ChooseDivisionError} When the transcript is missing or blank, or a deepened run is missing.
 */
function readInput(context: StageContext): Promise<ChooseDivisionInput> {
	return readTranscriptAndRuns({
		context,
		panelStage: "deepen-subtopic-splitting",
		fail: (message) => new ChooseDivisionError(message),
	});
}

/**
 * Builds the `choose-division` stage: the deepened runs vote, and the run
 * nearest the vote is written as the lecture's division, with a stage record beside
 * it of which run was chosen and how far it stands from the vote. No model is
 * called (technical-design.md §5, `choose-division`).
 *
 * @param args - The stage's dependencies.
 * @param args.logger - The run's logger.
 * @returns The stage.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger carries mutable properties the rule cannot see past; it is only handed on from here
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
