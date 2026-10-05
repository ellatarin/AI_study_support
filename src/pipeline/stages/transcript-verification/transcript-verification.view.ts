/**
 * `transcript-verification`'s report as a page a person reads.
 *
 * The same deficiencies as `verification-report.json`, projected into markdown: this
 * module is handed the report that was already stored and returns text, so the
 * two files cannot disagree about what the checker said, and no second call is
 * made to write prose about a judgement that has already been made.
 *
 * It is provisional. The view exists while the checker is being calibrated by
 * hand against the assessments in `docs/quality/`, which is work done by reading
 * reports and arguing with them; a JSON file is the wrong medium for that. When
 * a checker is settled on, this file goes, along with the stage's `readableView`
 * declaration (technical-design.md §5, `transcript-verification`, "The readable
 * view is temporary").
 */

import {
	QA_SEVERITIES,
	type QaCheckerReport,
	type QaConsideration,
	type QaDeficiency,
	type QaDeficiencyType,
	type QaSeverity,
	type QaSourcePassage,
} from "../../../types/pipeline.js";
import { pluralise } from "../../../utils/text.js";

/**
 * How each deficiency type is named to a reader, and how early it is read.
 *
 * The ranks are the reading order, and the order is a claim about risk rather
 * than a tidy alphabetisation. A distortion leads because it is the one fault
 * that makes the structured transcript assert something the lecture does not
 * support, and a reader acting on it is misled rather than merely underserved —
 * the assessment method calls it the highest-risk deficiency type in as many words. An
 * unsourced addition follows for the same reason from the other direction.
 * Content that is missing or thinned comes after, since what is absent can still
 * be recovered from the transcript. The prose fault types rank last and belong to
 * the QA loop; a verification checker is never offered them, and they are here
 * so that a report carrying one is still rendered rather than silently dropped.
 */
const DEFICIENCY_TYPE_PRESENTATION: Readonly<
	Record<QaDeficiencyType, { readonly label: string; readonly rank: number }>
> = {
	distortion: { label: "Distortion", rank: 0 },
	"unsourced-addition": { label: "Unsourced addition", rank: 1 },
	omission: { label: "Omission", rank: 2 },
	underexplained: { label: "Underexplained", rank: 3 },
	other: { label: "Other", rank: 4 },
	clarity: { label: "Clarity", rank: 5 },
	"british-english": { label: "British English", rank: 6 },
	formatting: { label: "Formatting", rank: 7 },
	"figure-reference": { label: "Figure reference", rank: 8 },
};

/** What a deficiency with no source passage says where a location would go. */
const NO_SOURCE_PASSAGE = "the source carries no such passage";

/** Separates the document's blocks: one blank line between them. */
const BLOCK_BREAK = "\n\n";

/**
 * How severe a deficiency is, as a number the sort can use: the position of its
 * severity in {@link QA_SEVERITIES}, which is declared worst first.
 *
 * @param severity - The deficiency's severity.
 * @returns Its position in the declared order.
 */
function severityRank(severity: QaSeverity): number {
	return QA_SEVERITIES.indexOf(severity);
}

/**
 * The deficiencies in the order they are read: grouped by deficiency type with
 * the riskiest deficiency type first, and worst first within each one. Deficiencies the
 * checker ranked alike keep the order it reported them in, which is the only
 * ordering it expressed beyond severity.
 *
 * @param deficiencies - The deficiencies as the report holds them.
 * @returns The same deficiencies, sorted.
 */
function inReadingOrder(deficiencies: readonly QaDeficiency[]): readonly QaDeficiency[] {
	return [...deficiencies].sort(
		// eslint-disable-next-line max-params -- Array.prototype.sort's comparator is spec-defined
		(left, right) =>
			DEFICIENCY_TYPE_PRESENTATION[left.type].rank -
				DEFICIENCY_TYPE_PRESENTATION[right.type].rank ||
			severityRank(left.severity) - severityRank(right.severity),
	);
}

/**
 * A severity as it heads a deficiency: the same word, capitalised.
 *
 * @param severity - The deficiency's severity.
 * @returns The word with an initial capital.
 */
function severityLabel(severity: QaSeverity): string {
	return `${severity.charAt(0).toUpperCase()}${severity.slice(1)}`;
}

/**
 * A quoted passage as a markdown blockquote, marking every line of it so that a
 * quote spanning more than one line stays inside the quote.
 *
 * @param evidence - The passage quoted from the source.
 * @returns The passage as a blockquote.
 */
function asBlockquote(evidence: string): string {
	return evidence
		.split("\n")
		.map((line) => `> ${line}`)
		.join("\n");
}

/**
 * The two ends of one deficiency: where the fault sits in the structured
 * transcript, and where in the lecture the passage it is about sits. A deficiency
 * with no source passage says so rather than leaving the second end blank, since
 * having no basis in the source is the whole content of an unsourced addition.
 *
 * @param args - The deficiency's two ends.
 * @param args.outputLocation - Where the fault sits in the structured transcript.
 * @param args.source - The source passage the deficiency is about, or `null`.
 * @returns The two locations, and the quoted passage where there is one.
 */
function locations({
	outputLocation,
	source,
}: {
	readonly outputLocation: string;
	readonly source: QaSourcePassage | null;
}): readonly string[] {
	const bothEnds = `- **In the structured transcript:** ${outputLocation}\n- **In the source:** ${source === null ? NO_SOURCE_PASSAGE : source.location}`;
	return source === null ? [bothEnds] : [bothEnds, asBlockquote(source.evidence)];
}

/**
 * One deficiency: its severity and what it says, both ends of where it applies, and
 * what the checker suggests doing about it. Its deficiency type is the section it sits
 * in rather than a line of its own.
 *
 * @param deficiency - The deficiency to render.
 * @returns The deficiency's block of markdown.
 */
function renderDeficiency(deficiency: QaDeficiency): string {
	return [
		`#### ${severityLabel(deficiency.severity)} — ${deficiency.description}`,
		...locations({ outputLocation: deficiency.outputLocation, source: deficiency.source }),
		`**Suggested fix:** ${deficiency.suggestedFix}`,
	].join(BLOCK_BREAK);
}

/**
 * How many deficiencies fell into each deficiency type, in reading order, counting
 * only the deficiency types that occurred — a table of every one the vocabulary carries
 * would be mostly zeroes.
 *
 * The rows are joined by single newlines: a blank line between two rows ends the
 * table, and what a reader would see is a run of pipe characters.
 *
 * @param deficiencies - The deficiencies as the report holds them.
 * @returns The counts table, as one markdown table under its heading.
 */
function renderDeficiencyTypeCounts(deficiencies: readonly QaDeficiency[]): string {
	const counts = new Map<QaDeficiencyType, number>();
	for (const deficiency of deficiencies) {
		counts.set(deficiency.type, (counts.get(deficiency.type) ?? 0) + 1);
	}
	const rows = [...counts.entries()]
		.sort(
			// eslint-disable-next-line max-params -- Array.prototype.sort's comparator is spec-defined
			([left], [right]) =>
				DEFICIENCY_TYPE_PRESENTATION[left].rank - DEFICIENCY_TYPE_PRESENTATION[right].rank,
		)
		.map(([type, count]) => `| ${DEFICIENCY_TYPE_PRESENTATION[type].label} | ${count} |`);
	const table = ["| Category | Findings |", "| --- | --- |", ...rows].join("\n");
	return ["## Findings by category", table].join(BLOCK_BREAK);
}

/**
 * Every deficiency, under a heading per deficiency type, with a heading emitted
 * each time the deficiency type changes down the sorted list.
 *
 * @param deficiencies - The deficiencies as the report holds them.
 * @returns The deficiencies section, grouped and ordered.
 */
function renderDeficiencies(deficiencies: readonly QaDeficiency[]): string {
	if (deficiencies.length === 0) {
		return ["## Findings", "The checker raised nothing."].join(BLOCK_BREAK);
	}
	const blocks: string[] = ["## Findings"];
	let openDeficiencyType: QaDeficiencyType | null = null;
	for (const deficiency of inReadingOrder(deficiencies)) {
		if (deficiency.type !== openDeficiencyType) {
			blocks.push(`### ${DEFICIENCY_TYPE_PRESENTATION[deficiency.type].label}`);
			openDeficiencyType = deficiency.type;
		}
		blocks.push(renderDeficiency(deficiency));
	}
	return blocks.join(BLOCK_BREAK);
}

/**
 * What the checker examined and decided not to raise.
 *
 * Recorded in the document for the reason it is recorded in the report: a list
 * of deficiencies alone cannot tell a checker that missed something from one that
 * looked at it and cleared it, and only the first is a reason to distrust what
 * the rest of the page says.
 *
 * @param considered - The cleared passages as the report holds them.
 * @returns The considered section.
 */
function renderConsiderations(considered: readonly QaConsideration[]): string {
	const heading = "## Considered and not raised";
	if (considered.length === 0) {
		return [heading, "The checker recorded nothing it examined and cleared."].join(BLOCK_BREAK);
	}
	const entries = considered.map(
		({ source, whyNotRaised }) => `- *"${source.evidence}"* — ${source.location}. ${whyNotRaised}`,
	);
	return [
		heading,
		`The checker examined and cleared **${pluralise({ count: considered.length, noun: "passage" })}**.`,
		entries.join("\n"),
	].join(BLOCK_BREAK);
}

/**
 * The verification report as a document a person reads: what the checker
 * concluded, how much it found and of what kind, every deficiency with both ends of
 * where it applies, and what it looked at and let pass.
 *
 * Pure — it is handed the stored report and returns text, calls nothing and
 * reads no file, which is what makes every ordering and counting rule here
 * testable on its own (technical-design.md §5, `transcript-verification`).
 *
 * @param args - What to render.
 * @param args.report - The report the checker returned, as it was stored.
 * @returns The whole document, ending in a newline.
 * @example
 * renderVerificationReport({ report }); // "# Transcript verification\n\nVerdict **fail**, …"
 */
export function renderVerificationReport({ report }: { readonly report: QaCheckerReport }): string {
	const summary = `Verdict **${report.overallVerdict}**, coverage **${report.coverageScore}/100**, **${pluralise({ count: report.deficiencies.length, noun: "finding" })}**.`;
	const sections = [
		"# Transcript verification",
		summary,
		...(report.deficiencies.length === 0 ? [] : [renderDeficiencyTypeCounts(report.deficiencies)]),
		renderDeficiencies(report.deficiencies),
		renderConsiderations(report.considered),
	];
	return `${sections.join(BLOCK_BREAK)}\n`;
}
