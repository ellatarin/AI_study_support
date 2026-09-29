/**
 * Compares the pipeline's live splitting runs with the prototype's saved runs,
 * lecture by lecture, on the same transcripts: `initial-subtopic-splitting`
 * against the `s6` runs, or `deepen-subtopic-splitting` against the `d13` runs.
 *
 * The prototype has 18 runs per lecture; the stage makes a panel of 9. Cuts
 * from both are pooled and grouped into cut sites the way `vote-cut-sites`
 * groups them (a cut joins a site when it lies within one percent of the
 * transcript's length of that site's first cut), and each site's support is
 * counted separately for the prototype and the live panel. Lectures with no
 * live runs of the stage are left out.
 *
 * Run from the project root, naming the stage:
 *   pnpm exec tsx docs/quality/segmentation-prototype/compare-live-splitting.mts initial
 *   pnpm exec tsx docs/quality/segmentation-prototype/compare-live-splitting.mts deepened
 *
 * Writes LIVE-INITIAL-SPLITTING.md or LIVE-DEEPENED-SPLITTING.md beside this script.
 */

import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const PROTOTYPE_DIR = "docs/quality/segmentation-prototype";
const RUNS_DIR = join(PROTOTYPE_DIR, "runs");
const LECTURES = ["l1", "l2", "l3", "l4", "l5", "l6", "l7", "l8"];

/** What differs between comparing the two stages: whose runs, and where the report goes. */
const PASSES = {
	initial: {
		stage: "initial-subtopic-splitting",
		prompt: "s6",
		prototypeRunPrefix: "split-s6",
		liveDirectory: "Initial subtopics",
		results: "LIVE-INITIAL-SPLITTING.md",
		note: "These are undeepened runs, so this previews the vote rather than reproducing it.",
	},
	deepened: {
		stage: "deepen-subtopic-splitting",
		prompt: "d13",
		prototypeRunPrefix: "deepen-d13-600-split-s6",
		liveDirectory: "Deepened subtopics",
		results: "LIVE-DEEPENED-SPLITTING.md",
		note: "These are the runs the vote counts.",
	},
} as const;

type Pass = (typeof PASSES)[keyof typeof PASSES];

const passName = process.argv[2];
if (passName !== "initial" && passName !== "deepened") {
	throw new Error(`Name the stage to compare: initial or deepened (got ${String(passName)})`);
}
const PASS: Pass = PASSES[passName];
/** The bar and panel the pipeline's settings hold: a site is kept with 5 of 9. */
const BAR_SHARE = 5 / 9;
const SITE_TOLERANCE_SHARE = 0.01;

type Source = "prototype" | "live";
type Cut = { readonly position: number; readonly source: Source; readonly run: number };
type Site = { readonly first: number; readonly cuts: Cut[] };

async function readJson(path: string): Promise<unknown> {
	return JSON.parse(await readFile(path, "utf8"));
}

/**
 * The transcript a lecture's prototype runs cut. Only the splitting runs record
 * it; a deepened run names the splitting run it deepened.
 */
async function transcriptPathOf(lecture: string): Promise<string> {
	const saved = (await readJson(join(RUNS_DIR, `split-s6-${lecture}-1.blocks.json`))) as {
		transcriptPath: string;
	};
	return saved.transcriptPath;
}

/** Each prototype run's cut positions, from its blocks, which were sliced in order. */
async function prototypeRuns(lecture: string): Promise<{ transcriptPath: string; runs: number[][] }> {
	const transcriptPath = await transcriptPathOf(lecture);
	const pattern = new RegExp(`^${PASS.prototypeRunPrefix}-${lecture}-\\d+\\.blocks\\.json$`, "u");
	const names = (await readdir(RUNS_DIR)).filter((name) => pattern.test(name));
	const runs: number[][] = [];
	for (const name of names) {
		const saved = (await readJson(join(RUNS_DIR, name))) as { blocks: { content: string }[] };
		const starts: number[] = [];
		let at = 0;
		for (const block of saved.blocks) {
			starts.push(at);
			at += block.content.length;
		}
		runs.push(starts.slice(1));
	}
	return { transcriptPath, runs };
}

/** Where the stage saved a lecture's live runs, beside its transcript's folder. */
function liveDirectoryOf(transcriptPath: string): string {
	return join(dirname(dirname(transcriptPath)), PASS.liveDirectory);
}

/** Each live run's cut positions, from the stage's run files in the lecture's workspace. */
async function liveRuns(transcriptPath: string): Promise<number[][]> {
	const directory = liveDirectoryOf(transcriptPath);
	const names = (await readdir(directory)).filter((name) => /^run-\d+\.json$/u.test(name)).sort();
	const runs: number[][] = [];
	for (const name of names) {
		const run = (await readJson(join(directory, name))) as { start: number }[];
		runs.push(run.map((subtopic) => subtopic.start).slice(1));
	}
	return runs;
}

/** Groups cuts into sites, measuring each from the site's first cut, as the vote does. */
function groupIntoSites(cuts: readonly Cut[], tolerance: number): Site[] {
	const sites: Site[] = [];
	for (const cut of [...cuts].sort((left, right) => left.position - right.position)) {
		const current = sites.at(-1);
		if (current !== undefined && cut.position - current.first <= tolerance) {
			current.cuts.push(cut);
		} else {
			sites.push({ first: cut.position, cuts: [cut] });
		}
	}
	return sites;
}

/** How many runs of one source cut at a site: a run with two cuts there counts once. */
function support(site: Site, source: Source): number {
	return new Set(site.cuts.filter((cut) => cut.source === source).map((cut) => cut.run)).size;
}

function choose(total: number, taken: number): number {
	let result = 1;
	for (let index = 1; index <= taken; index += 1) {
		result = (result * (total - taken + index)) / index;
	}
	return result;
}

/**
 * Two-sided Fisher exact test: how likely a split at least this uneven is when
 * both sources cut at the site equally often.
 */
function fisherExact(args: {
	readonly hitsA: number;
	readonly runsA: number;
	readonly hitsB: number;
	readonly runsB: number;
}): number {
	const { hitsA, runsA, hitsB, runsB } = args;
	const hits = hitsA + hitsB;
	const chance = (taken: number): number =>
		(choose(runsA, taken) * choose(runsB, hits - taken)) / choose(runsA + runsB, hits);
	const observed = chance(hitsA);
	let total = 0;
	for (let taken = Math.max(0, hits - runsB); taken <= Math.min(runsA, hits); taken += 1) {
		if (chance(taken) <= observed * (1 + 1e-9)) {
			total += chance(taken);
		}
	}
	return total;
}

function range(values: readonly number[]): string {
	const low = Math.min(...values);
	const high = Math.max(...values);
	return low === high ? String(low) : `${low}–${high}`;
}

type SiteTest = {
	readonly lecture: string;
	readonly at: string;
	readonly prototype: string;
	readonly live: string;
	readonly p: number;
	readonly liveLower: boolean;
	readonly liveHigher: boolean;
};

/** One lecture's summary row, the sites one source keeps alone, every site, and each site's test. */
type LectureComparison = {
	readonly row: string;
	readonly detail: string[];
	readonly everySite: string[];
	readonly tests: SiteTest[];
};

async function compareLecture(
	lecture: string,
): Promise<LectureComparison> {
	const prototype = await prototypeRuns(lecture);
	const live = await liveRuns(prototype.transcriptPath);
	const transcript = (await readFile(prototype.transcriptPath, "utf8")).trim();
	const prototypePositions = new Set(prototype.runs.flat());
	const liveCuts = live.flat();
	const atPrototypePosition = liveCuts.filter((cut) => prototypePositions.has(cut)).length;

	const cuts: Cut[] = [
		...prototype.runs.flatMap((run, index) =>
			run.map((position) => ({ position, source: "prototype" as const, run: index })),
		),
		...live.flatMap((run, index) => run.map((position) => ({ position, source: "live" as const, run: index }))),
	];
	const sites = groupIntoSites(cuts, transcript.length * SITE_TOLERANCE_SHARE);
	const keptBy = (site: Site, source: Source, runs: number): boolean =>
		support(site, source) >= BAR_SHARE * runs;
	const disagreements = sites.filter(
		(site) => keptBy(site, "prototype", prototype.runs.length) !== keptBy(site, "live", live.length),
	);
	const keptByBoth = sites.filter(
		(site) => keptBy(site, "prototype", prototype.runs.length) && keptBy(site, "live", live.length),
	).length;

	const row =
		`| ${lecture} | ${range(prototype.runs.map((run) => run.length + 1))} | ` +
		`${range(live.map((run) => run.length + 1))} | ${atPrototypePosition} of ${liveCuts.length} | ` +
		`${keptByBoth} | ${disagreements.length} |`;
	const at = (site: Site): string => `${((100 * site.first) / transcript.length).toFixed(1)}%`;
	const prototypeShare = (site: Site): string =>
		`${support(site, "prototype")} of ${prototype.runs.length}`;
	const liveShare = (site: Site): string => `${support(site, "live")} of ${live.length}`;
	const opening = (site: Site): string => transcript.slice(site.first, site.first + 60);
	const detail = disagreements.map(
		(site) =>
			`- ${lecture}, at ${at(site)} ${JSON.stringify(opening(site).slice(0, 50))}: ` +
			`prototype ${prototypeShare(site)}, live ${liveShare(site)}`,
	);
	const keptByWhom = (site: Site): string => {
		const byPrototype = keptBy(site, "prototype", prototype.runs.length);
		const byLive = keptBy(site, "live", live.length);
		if (byPrototype && byLive) {
			return "both";
		}
		if (byPrototype || byLive) {
			return `**${byPrototype ? "prototype" : "live"} only**`;
		}
		return "neither";
	};
	const everySite = sites.map(
		(site) =>
			`| ${lecture} | ${at(site)} | ${opening(site).replace(/\s+/gu, " ").replace(/\|/gu, "\\|")} | ` +
			`${prototypeShare(site)} | ${liveShare(site)} | ${keptByWhom(site)} |`,
	);
	const tests = sites.map((site) => {
		const hitsA = support(site, "prototype");
		const hitsB = support(site, "live");
		const runsA = prototype.runs.length;
		const runsB = live.length;
		return {
			lecture,
			at: at(site),
			prototype: prototypeShare(site),
			live: liveShare(site),
			p: fisherExact({ hitsA, runsA, hitsB, runsB }),
			liveLower: hitsB / runsB < hitsA / runsA,
			liveHigher: hitsB / runsB > hitsA / runsA,
		};
	});
	return { row, detail, everySite, tests };
}

/** Whether the live panel cuts where the prototype did as often, over every site. */
function chanceSection(tests: readonly SiteTest[]): string[] {
	const threshold = 0.05;
	const below = tests.filter((test) => test.p < threshold).sort((left, right) => left.p - right.p);
	return [
		"## Could the differences be chance?",
		"",
		"Each site's prototype and live support is put to a two-sided Fisher exact test. With",
		`${tests.length} sites, about ${(threshold * tests.length).toFixed(1)} would fall below p = ${threshold} by chance alone if`,
		`the two cut alike; ${below.length} did. The live panel cuts less often than the prototype at`,
		`${tests.filter((test) => test.liveLower).length} sites and more often at ${tests.filter((test) => test.liveHigher).length}.`,
		"",
		...below.map(
			(test) =>
				`- ${test.lecture} at ${test.at}: prototype ${test.prototype}, live ${test.live}, p = ${test.p.toFixed(4)}`,
		),
		"",
	];
}

async function main(): Promise<void> {
	const compared: LectureComparison[] = [];
	for (const lecture of LECTURES) {
		if (existsSync(liveDirectoryOf(await transcriptPathOf(lecture)))) {
			compared.push(await compareLecture(lecture));
		}
	}
	const disagreements = compared.flatMap((lecture) => lecture.detail);
	const markdown = [
		`# Live \`${PASS.stage}\` runs against the prototype's \`${PASS.prompt}\` runs`,
		"",
		`Generated by \`compare-live-splitting.mts ${passName}\`; do not edit by hand.`,
		"",
		"Same transcripts, same prompt, same model: 18 prototype runs and 9 live runs per lecture.",
		"Cuts are grouped into cut sites as `vote-cut-sites` groups them. A site is *kept* by a",
		"source when at least 5 in 9 of its runs cut there (10 of the prototype's 18).",
		PASS.note,
		"",
		"| lecture | prototype subtopics | live subtopics | live cuts at a position a prototype run used | sites kept by both | sites kept by one only |",
		"|---|---|---|---|---|---|",
		...compared.map((lecture) => lecture.row),
		"",
		"## Sites kept by one source only",
		"",
		...(disagreements.length === 0 ? ["None."] : disagreements),
		"",
		...chanceSection(compared.flatMap((lecture) => lecture.tests)),
		"## Every cut site",
		"",
		"Each row is one cut site, in transcript order, with the words the transcript opens with",
		"there: how many runs of each source cut at it, and who keeps it.",
		"",
		"| lecture | at | opens with | prototype | live | kept by |",
		"|---|---|---|---|---|---|",
		...compared.flatMap((lecture) => lecture.everySite),
		"",
	].join("\n");
	await writeFile(join(PROTOTYPE_DIR, PASS.results), markdown, "utf8");
	console.log(markdown);
}

await main();
