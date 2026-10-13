/**
 * The Jev scores of the faults of a check run. Jev is the decision model of
 * TypeSafe. It gives each fault the probability that a student who learns from
 * the rewrite learns something wrong or misses something that the lecturer
 * taught. The score for the same input can change by a few hundredths from
 * call to call.
 */

import { join } from "node:path";
import { writeJsonAtomic } from "/Users/ellatarin/my_repositories/Ella_AI_project/src/utils/files.js";
import { isRecord } from "/Users/ellatarin/my_repositories/Ella_AI_project/src/utils/record.js";
import { readChecked, readRunFaults } from "./check-results.mts";
import type { QuotedFault } from "./fault-matching.mts";

/** The file in a run folder that holds the Jev score of each fault of the run. */
export const JEV_SCORES_FILE = "jev-scores.json";

/** The question that Jev answers for each fault, with its criteria. */
const JEV_QUESTION = {
	type: "noul",
	instructions:
		"The `rewrite` turns what the lecturer said in `lecture` into textbook prose for students. A checker reported the change in `reportedFault`, about the words in `lecturePassage` and `rewritePassage`. Does this change make a student who learns from the rewrite learn something wrong, or miss something that the lecturer taught?",
	criteria: {
		true: "Yes: the rewrite states a fact, a link or a description that is wrong or doubtful, such as a link that makes two things the same when the lecturer only lists them, merges two separate things into one, widens or narrows a cause, gives a term a different role, or drops a fact, a step or something that the lecturer points out to look for on a slide.",
		false: "No: the rewrite keeps what the student learns. Examples: an added link or description that is correct, as when the lecturer says 'Most seeds never sprout. It takes the right soil, water and warmth' and the rewrite says 'Most seeds never sprout, because it takes the right soil, water and warmth', a repaired slip of speech, a sentence rebuilt with the same meaning, a dropped hedge or filler word, or a dropped remark about the course.",
	},
} as const;

/** What Jev reads for one fault. A fault with no passage gives "none". */
export type JevState = {
	readonly lecture: string;
	readonly rewrite: string;
	readonly reportedFault: string;
	readonly lecturePassage: string;
	readonly rewritePassage: string;
};

/** A fault that a checker reported, with the score that Jev gave it. */
export type ScoredFault = QuotedFault & { readonly description: string; readonly jevScore: number };

/** The score of one fault in {@link JEV_SCORES_FILE}. */
type SavedScore = { readonly subtopicId: number; readonly faultIndex: number; readonly score: number };

/**
 * Checks that a parsed file is a file of Jev scores.
 *
 * @param value - The parsed file.
 * @returns `true` when the value has a list of scores, each with its fault and its score.
 */
function isScoresFile(value: unknown): value is { readonly scores: readonly SavedScore[] } {
	return (
		isRecord(value) &&
		Array.isArray(value.scores) &&
		value.scores.every(
			(score) =>
				isRecord(score) &&
				typeof score.subtopicId === "number" &&
				typeof score.faultIndex === "number" &&
				typeof score.score === "number",
		)
	);
}

/**
 * Reads each fault of a check run with the score that {@link JEV_SCORES_FILE} gives it.
 *
 * @param runFolder - The absolute path of the run folder.
 * @returns The faults with their scores.
 * @throws Error when the scores file is missing or has the wrong shape, or when a fault has no score.
 */
export async function readScoredFaults(runFolder: string): Promise<readonly ScoredFault[]> {
	const { scores } = await readChecked({ path: join(runFolder, JEV_SCORES_FILE), isShape: isScoresFile });
	const faults = await readRunFaults(runFolder);
	return faults.map(({ subtopicId, faultIndex, description, sourcePassage, rewritePassage }) => {
		const saved = scores.find((score) => score.subtopicId === subtopicId && score.faultIndex === faultIndex);
		if (saved === undefined) {
			throw new Error(`Fault ${faultIndex} of subtopic ${subtopicId} in ${runFolder} has no Jev score`);
		}
		return { subtopicId, description, sourcePassage, rewritePassage, jevScore: saved.score };
	});
}

/** Jev's answer for one fault. */
export type JevAnswer = { readonly score: number; readonly jevModel: string; readonly inputTokens: number };

/** Asks Jev the question about one fault. */
export type AskJev = (state: JevState) => Promise<JevAnswer>;

/** The TypeSafe endpoint that answers questions with Jev. */
const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";

/**
 * Makes the call to Jev over HTTP.
 *
 * @param apiKey - The TypeSafe API key.
 * @returns The call, which asks Jev the question about one fault.
 * @throws Error from the call when TypeSafe does not answer with status 200.
 */
export function createJevCall(apiKey: string): AskJev {
	return async (state) => {
		const response = await fetch(JEV_ENDPOINT, {
			method: "POST",
			headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
			body: JSON.stringify({ model: "jev-latest", state, questions: { harms: JEV_QUESTION } }),
		});
		const body: unknown = await response.json();
		if (response.status !== 200) {
			throw new Error(`TypeSafe answered ${response.status}: ${JSON.stringify(body)}`);
		}
		const { answers, model, usage } = body as {
			readonly answers: { readonly harms: { readonly noul: number } };
			readonly model: string;
			readonly usage: { readonly input_tokens: number };
		};
		return { score: answers.harms.noul, jevModel: model, inputTokens: usage.input_tokens };
	};
}

/** The text and the rewrite of one subtopic. */
export type SubtopicMaterial = {
	readonly subtopicId: number;
	readonly text: string;
	readonly rewrite: readonly string[];
};

/**
 * Scores each fault of a check run with Jev, and writes the scores to
 * {@link JEV_SCORES_FILE} in the run folder. A score names its fault by the
 * subtopic and the position of the fault in the subtopic's result file.
 *
 * @param args - The run folder, the material of each subtopic and the call to Jev.
 * @param args.runFolder - The absolute path of the run folder.
 * @param args.material - The text and the rewrite of each subtopic.
 * @param args.askJev - Asks Jev about one fault.
 * @returns The number of faults and the input tokens of all the calls.
 * @throws Error when a subtopic of the run has no material.
 */
export async function scoreRunFaults({
	runFolder,
	material,
	askJev,
}: {
	readonly runFolder: string;
	readonly material: readonly SubtopicMaterial[];
	readonly askJev: AskJev;
}): Promise<{ readonly faults: number; readonly inputTokens: number }> {
	const faults = await readRunFaults(runFolder);
	const scores = await Promise.all(
		faults.map(async (fault) => {
			const subtopic = material.find(({ subtopicId }) => subtopicId === fault.subtopicId);
			if (subtopic === undefined) {
				throw new Error(`Subtopic ${fault.subtopicId} of ${runFolder} has no text or rewrite`);
			}
			const answer = await askJev({
				lecture: subtopic.text,
				rewrite: subtopic.rewrite.join("\n\n"),
				reportedFault: fault.description,
				lecturePassage: fault.sourcePassage ?? "none",
				rewritePassage: fault.rewritePassage ?? "none",
			});
			return { subtopicId: fault.subtopicId, faultIndex: fault.faultIndex, ...answer };
		}),
	);
	const inputTokens = scores.reduce((sum, score) => sum + score.inputTokens, 0);
	await writeJsonAtomic({
		path: join(runFolder, JEV_SCORES_FILE),
		value: {
			question: JEV_QUESTION,
			inputTokens,
			scores: scores.map(({ subtopicId, faultIndex, score, jevModel }) => ({ subtopicId, faultIndex, score, jevModel })),
		},
	});
	return { faults: scores.length, inputTokens };
}
