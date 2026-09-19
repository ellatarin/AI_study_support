/**
 * Deepening a division that initial subtopic splitting already made.
 *
 * The harness measures every subtopic of an initial splitting run and sends
 * ONLY those over the size gate to the model, asking where each one divides
 * further. Subtopics under the size gate are never sent and so can never be
 * disturbed — which is the point, since a full re-division has been measured
 * losing cuts it had already made.
 *
 * The size gate lives here rather than in the prompt because a word count is
 * something code can do exactly and a model can only estimate by eye.
 *
 * It reads an initial splitting run out of `runs/` rather than splitting
 * again, so a deepening version can be measured against the same divisions
 * every time, and the two steps are never confounded.
 *
 * The deepening itself is `deepen-division.mts`; this script reads the run,
 * calls the model for it, and writes the result. A run in which any subtopic's
 * call failed on every attempt writes NOTHING and exits non-zero, so it can
 * never enter the vote as though the model had chosen not to divide.
 *
 * Usage:
 *   TRIAL_MODEL=google/gemini-3.7-flash \
 *     pnpm exec tsx deepen-trial.mts <version> <split-run-stem> <size-gate-words>
 *   e.g. deepen-trial.mts d1 split-s6-l5-1 600
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { applyCuts, judgeFidelity } from "./cut-blocks.mts";
import {
	type DeepenTally,
	deepenDivision,
	type Subtopic,
	type SubtopicFailure,
} from "./deepen-division.mts";
import { deepenPromptVersion } from "./deepen-prompts.mts";
import { callTrialModel, loadTrialConfig, OUT_DIR } from "./trial-model.mts";

const MODEL = process.env["TRIAL_MODEL"] ?? "google/gemini-3.7-flash";

/**
 * What one run is worth knowing about, without opening its subtopics. The field
 * names are the ones every recorded run file carries, so they stay as they are.
 */
type DeepenOutcome = DeepenTally & {
	readonly promptVersion: string;
	readonly source: string;
	readonly lecture: string;
	readonly instance: string;
	readonly modelId: string;
	readonly gateWords: number;
	readonly seconds: number;
	/** One per subtopic sent; retries are counted separately. */
	readonly calls: number;
	readonly subtopicsBefore: number;
	readonly subtopicsAfter: number;
	readonly fidelity: string;
};

/** A run refused because at least one subtopic's call never succeeded. */
class DeepeningRefusedError extends Error {
	/**
	 * @param options - Options object.
	 * @param options.stem - The pass-one run that was being deepened.
	 * @param options.failures - Each subtopic that failed, and the verdict on its last attempt.
	 */
	constructor({
		stem,
		failures,
	}: {
		readonly stem: string;
		readonly failures: readonly SubtopicFailure[];
	}) {
		super(
			`${stem}: ${failures.length} subtopic(s) failed on every attempt, so nothing was written — ` +
				failures.map((failure) => `"${failure.label}": ${failure.reason}`).join("; "),
		);
		this.name = "DeepeningRefusedError";
	}
}

/**
 * Turn an initial splitting reply into the subtopics of its division.
 *
 * @param options - Options object.
 * @param options.transcriptText - The transcript the run was made against.
 * @param options.raw - The initial splitting reply, as written to `<stem>.raw.json`.
 * @returns The subtopics, in transcript order.
 */
function subtopicsOf({
	transcriptText,
	raw,
}: {
	readonly transcriptText: string;
	readonly raw: string;
}): readonly Subtopic[] {
	const parsed = JSON.parse(raw) as {
		readonly subtopics?: readonly {
			readonly label?: string;
			readonly groupedBecause?: string;
			readonly startsWith?: string;
		}[];
	};
	const starts = (parsed.subtopics ?? []).map((subtopic, index) => ({
		id: index,
		label: subtopic.label ?? "",
		startsWith: subtopic.startsWith ?? "",
	}));
	const { blocks } = applyCuts(transcriptText, starts);
	let offset = 0;
	return blocks.map((block, index) => {
		const from = offset;
		offset += block.content.length;
		return {
			label: block.label,
			why: parsed.subtopics?.[index]?.groupedBecause ?? "",
			from,
			to: offset,
		};
	});
}

async function main(): Promise<void> {
	const version = deepenPromptVersion({ id: process.argv[2] ?? "d1" });
	const stem = process.argv[3];
	if (stem === undefined) {
		throw new Error("Usage: deepen-trial.mts <version> <split-run-stem> <size-gate-words>");
	}
	const sizeGateWords = Number(process.argv[4] ?? "600");
	await mkdir(OUT_DIR, { recursive: true });

	const outcomeBefore = JSON.parse(
		await readFile(join(OUT_DIR, `${stem}.outcome.json`), "utf8"),
	) as { readonly transcriptPath: string; readonly lecture: string; readonly instance: string };
	const transcriptText = (await readFile(outcomeBefore.transcriptPath, "utf8")).trim();
	const raw = await readFile(join(OUT_DIR, `${stem}.raw.json`), "utf8");

	const config = await loadTrialConfig({ modelId: MODEL });
	const startedAt = performance.now();

	const subtopicsBefore = subtopicsOf({ transcriptText, raw });
	const result = await deepenDivision({
		transcriptText,
		subtopics: subtopicsBefore,
		sizeGateWords,
		systemPrompt: version.build(),
		callModel: (messages) => callTrialModel({ config, modelId: MODEL, messages }),
	});
	if (result.state === "refused") {
		throw new DeepeningRefusedError({ stem, failures: result.failures });
	}
	const { subtopics, tally } = result;

	const blocks = subtopics.map((subtopic) => ({
		label: subtopic.label,
		why: subtopic.why,
		content: transcriptText.slice(subtopic.from, subtopic.to),
	}));
	const seconds = Math.round((performance.now() - startedAt) / 1000);
	const outStem = `deepen-${version.id}-${sizeGateWords}-${stem}`;
	const outcome: DeepenOutcome = {
		promptVersion: version.id,
		source: stem,
		lecture: outcomeBefore.lecture,
		instance: outcomeBefore.instance,
		modelId: MODEL,
		gateWords: sizeGateWords,
		seconds,
		...tally,
		calls: tally.sectionsSent,
		subtopicsBefore: subtopicsBefore.length,
		subtopicsAfter: subtopics.length,
		fidelity: judgeFidelity(transcriptText, blocks),
	};
	await writeFile(
		join(OUT_DIR, `${outStem}.outcome.json`),
		JSON.stringify(outcome, null, 2),
		"utf8",
	);
	await writeFile(
		join(OUT_DIR, `${outStem}.blocks.json`),
		JSON.stringify({ ...outcome, blocks }, null, 2),
		"utf8",
	);
	console.log(
		`${outStem.padEnd(34)} ${String(seconds).padStart(3)}s ` +
			`sent=${String(tally.sectionsSent).padStart(2)} held=${String(tally.heldAsOneStep).padStart(2)} ` +
			`retry=${String(tally.retries).padStart(2)} ` +
			`unplaced=${String(tally.cutsUnplaced).padStart(2)} ` +
			`${String(subtopicsBefore.length).padStart(2)}->${String(subtopics.length).padStart(2)} ` +
			`in=${String(tally.promptTokens).padStart(6)} out=${String(tally.completionTokens).padStart(5)} ` +
			`${outcome.fidelity}`,
	);
}

await main();
