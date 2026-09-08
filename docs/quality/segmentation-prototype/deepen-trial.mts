/**
 * Pass 1.5: deepening a division that pass one already made.
 *
 * The harness measures every section of a pass-one run and sends ONLY those
 * over its gate to the model, asking where each one divides further. Sections
 * under the gate are never sent and so can never be disturbed — which is the
 * point, since a full re-division has been measured losing boundaries it had
 * already made.
 *
 * The gate lives here rather than in the prompt because a word count is
 * something code can do exactly and a model can only estimate by eye.
 *
 * It reads a pass-one run out of `runs/` rather than calling pass one again, so
 * a deepening version can be measured against the same sixteen divisions every
 * time, and the two passes are never confounded.
 *
 * Usage:
 *   TRIAL_MODEL=google/gemini-3.7-flash \
 *     pnpm exec tsx deepen-trial.mts <version> <split-run-stem> <gate-words>
 *   e.g. deepen-trial.mts d1 split-s6-l5-1 600
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { applyCuts, judgeFidelity } from "./cut-blocks.mts";
import { deepenPromptVersion } from "./deepen-prompts.mts";
import { callTrialModel, loadTrialConfig, OUT_DIR } from "./trial-model.mts";

const MODEL = process.env["TRIAL_MODEL"] ?? "google/gemini-3.7-flash";

/** How many times a piece may be sent back after being split. */
const MAX_ROUNDS = 2;

/**
 * How many times one section's call is attempted before it is given up on.
 *
 * Running every section of every run at once makes a proportion of the calls
 * come back empty, and a section whose call fails is left whole — which reads
 * in the results as the model deciding it was one step. Without this the
 * measurement is of the rate limiter rather than of the prompt.
 */
const MAX_ATTEMPTS = 3;

/** Backs off between attempts, since the failures cluster when many calls are in flight. */
function pause(milliseconds: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, milliseconds);
	});
}

/** One section of the division, and where it sits in the transcript. */
type Section = {
	readonly label: string;
	readonly why: string;
	readonly from: number;
	readonly to: number;
};

/** What one call to the model came back with. */
type DeepenReply = {
	readonly verdict?: string;
	readonly cuts?: readonly {
		readonly label?: string;
		readonly groupedBecause?: string;
		readonly startsWith?: string;
	}[];
};

/** What one run is worth knowing about, without opening its sections. */
type DeepenOutcome = {
	readonly promptVersion: string;
	readonly source: string;
	readonly lecture: string;
	readonly instance: string;
	readonly modelId: string;
	readonly gateWords: number;
	readonly seconds: number;
	readonly promptTokens: number;
	readonly completionTokens: number;
	/** Sections that were over the gate and so were sent, across all rounds. */
	readonly sectionsSent: number;
	/** Of those, how many came back as one step. */
	readonly heldAsOneStep: number;
	/** Cuts the model proposed that could not be located in their section. */
	readonly cutsUnplaced: number;
	readonly calls: number;
	/** Attempts beyond the first, across every section. */
	readonly retries: number;
	/** Sections still failing after every attempt, and so left whole. */
	readonly failures: number;
	readonly subtopicsBefore: number;
	readonly subtopicsAfter: number;
	readonly fidelity: string;
};

/** Words, counted the one way this harness counts them. */
function wordCount(text: string): number {
	return text.split(/\s+/u).filter((word) => word.length > 0).length;
}

/**
 * Turn a pass-one reply into the sections of its division.
 *
 * @param options - Options object.
 * @param options.transcriptText - The transcript the run was made against.
 * @param options.raw - The pass-one reply, as written to `<stem>.raw.json`.
 * @returns The sections, in transcript order.
 */
function sectionsOf({
	transcriptText,
	raw,
}: {
	readonly transcriptText: string;
	readonly raw: string;
}): readonly Section[] {
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

/** What one round did to one section. */
type Deepened = {
	readonly sections: readonly Section[];
	readonly sent: boolean;
	readonly held: boolean;
	readonly unplaced: number;
	readonly promptTokens: number;
	readonly completionTokens: number;
	readonly failed: boolean;
	/** Attempts beyond the first that this section needed. */
	readonly retries: number;
};

/** A section that was never sent, reported as though a round had passed over it. */
function untouched(section: Section): Deepened {
	return {
		sections: [section],
		sent: false,
		held: false,
		unplaced: 0,
		promptTokens: 0,
		completionTokens: 0,
		failed: false,
		retries: 0,
	};
}

/**
 * Ask the model where one section divides, and apply whatever it proposes.
 *
 * The cuts are located within the section's own text and never outside it, so
 * a reply this pass cannot place is dropped rather than guessed at, and the
 * section's own boundaries are untouchable.
 *
 * @param options - Options object.
 * @param options.config - The config carrying the OpenRouter credentials.
 * @param options.systemPrompt - The deepening prompt for this version.
 * @param options.transcriptText - The whole transcript, for slicing.
 * @param options.section - The section to deepen.
 * @returns What the section became, and what the call cost.
 */
async function deepenSection({
	config,
	systemPrompt,
	transcriptText,
	section,
}: {
	readonly config: Awaited<ReturnType<typeof loadTrialConfig>>;
	readonly systemPrompt: string;
	readonly transcriptText: string;
	readonly section: Section;
}): Promise<Deepened> {
	const passage = transcriptText.slice(section.from, section.to);
	let promptTokens = 0;
	let completionTokens = 0;
	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
		const retries = attempt - 1;
		const spent = { promptTokens, completionTokens, retries };
		let reply: Awaited<ReturnType<typeof callTrialModel>>;
		try {
			reply = await callTrialModel({
				config,
				modelId: MODEL,
				messages: [
					{ role: "system", content: systemPrompt },
					{ role: "user", content: `Section:\n${passage}` },
				],
			});
		} catch {
			await pause(attempt * 1500);
			continue;
		}
		promptTokens += reply.promptTokens ?? 0;
		completionTokens += reply.completionTokens ?? 0;
		let parsed: DeepenReply | null = null;
		if (reply.content.length > 0) {
			try {
				parsed = JSON.parse(reply.content) as DeepenReply;
			} catch {
				parsed = null;
			}
		}
		if (parsed === null) {
			await pause(attempt * 1500);
			continue;
		}
		const proposed = (parsed.cuts ?? []).filter((cut) => (cut.startsWith ?? "").length > 0);
		if (proposed.length === 0) {
			return { ...untouched(section), sent: true, held: true, ...spent, promptTokens, completionTokens };
		}
		// The placeholder stands for the section's own start, which applyCuts skips.
		const { blocks, misses } = applyCuts(passage, [
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
		return {
			sections,
			sent: true,
			held: false,
			unplaced: misses.length,
			failed: false,
			retries,
			promptTokens,
			completionTokens,
		};
	}
	return {
		...untouched(section),
		sent: true,
		failed: true,
		retries: MAX_ATTEMPTS - 1,
		promptTokens,
		completionTokens,
	};
}

async function main(): Promise<void> {
	const version = deepenPromptVersion({ id: process.argv[2] ?? "d1" });
	const stem = process.argv[3];
	if (stem === undefined) {
		throw new Error("Usage: deepen-trial.mts <version> <split-run-stem> <gate-words>");
	}
	const gateWords = Number(process.argv[4] ?? "600");
	await mkdir(OUT_DIR, { recursive: true });

	const outcomeBefore = JSON.parse(
		await readFile(join(OUT_DIR, `${stem}.outcome.json`), "utf8"),
	) as { readonly transcriptPath: string; readonly lecture: string; readonly instance: string };
	const transcriptText = (await readFile(outcomeBefore.transcriptPath, "utf8")).trim();
	const raw = await readFile(join(OUT_DIR, `${stem}.raw.json`), "utf8");

	const config = await loadTrialConfig({ modelId: MODEL });
	const systemPrompt = version.build();
	const startedAt = performance.now();

	let sections = sectionsOf({ transcriptText, raw });
	const subtopicsBefore = sections.length;
	let sectionsSent = 0;
	let heldAsOneStep = 0;
	let cutsUnplaced = 0;
	let calls = 0;
	let retries = 0;
	let failures = 0;
	let promptTokens = 0;
	let completionTokens = 0;

	for (let round = 0; round < MAX_ROUNDS; round += 1) {
		const isOver = sections.map(
			(section) => wordCount(transcriptText.slice(section.from, section.to)) > gateWords,
		);
		if (!isOver.some(Boolean)) {
			break;
		}
		// Every over-gate section goes at once. They are independent — each is
		// asked only about its own text and can only cut inside it — so nothing
		// is lost by not waiting, and Promise.all keeps them in transcript order.
		const results = await Promise.all(
			sections.map(async (section, index) =>
				isOver[index] === true
					? deepenSection({ config, systemPrompt, transcriptText, section })
					: untouched(section),
			),
		);
		for (const result of results) {
			if (!result.sent) {
				continue;
			}
			calls += 1;
			sectionsSent += 1;
			retries += result.retries;
			failures += result.failed ? 1 : 0;
			heldAsOneStep += result.held ? 1 : 0;
			cutsUnplaced += result.unplaced;
			promptTokens += result.promptTokens;
			completionTokens += result.completionTokens;
		}
		const next = results.flatMap((result) => result.sections);
		// Nothing moved, so another round would ask the same questions again.
		if (next.length === sections.length) {
			sections = next;
			break;
		}
		sections = next;
	}

	const blocks = sections.map((section) => ({
		label: section.label,
		why: section.why,
		content: transcriptText.slice(section.from, section.to),
	}));
	const seconds = Math.round((performance.now() - startedAt) / 1000);
	const outStem = `deepen-${version.id}-${gateWords}-${stem}`;
	const outcome: DeepenOutcome = {
		promptVersion: version.id,
		source: stem,
		lecture: outcomeBefore.lecture,
		instance: outcomeBefore.instance,
		modelId: MODEL,
		gateWords,
		seconds,
		promptTokens,
		completionTokens,
		sectionsSent,
		heldAsOneStep,
		cutsUnplaced,
		calls,
		retries,
		failures,
		subtopicsBefore,
		subtopicsAfter: sections.length,
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
			`sent=${String(sectionsSent).padStart(2)} held=${String(heldAsOneStep).padStart(2)} ` +
			`retry=${String(retries).padStart(2)} fail=${String(failures).padStart(2)} ` +
			`unplaced=${String(cutsUnplaced).padStart(2)} ` +
			`${String(subtopicsBefore).padStart(2)}->${String(outcome.subtopicsAfter).padStart(2)} ` +
			`in=${String(promptTokens).padStart(6)} out=${String(completionTokens).padStart(5)} ` +
			`${outcome.fidelity}`,
	);
}

await main();
