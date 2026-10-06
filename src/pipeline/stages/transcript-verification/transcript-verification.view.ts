/**
 * The verification report Markdown. This module makes it from the stored
 * verification report, with no model call. So the two files cannot disagree.
 *
 * The verification report Markdown is temporary. When the checker is calibrated,
 * this file and the `markdownVersion` declaration of the stage are deleted
 * (technical-design.md §5, `transcript-verification`).
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
 * The heading of each deficiency type, and its rank in the reading order. The
 * order puts the highest risk first:
 *
 * - A distortion is first. It makes the structured transcript assert something
 *   that the lecture does not support, so it misleads a reader. The assessment
 *   method calls it the highest-risk deficiency type.
 * - An unsourced addition is second. It puts in the structured transcript
 *   something with no basis in the lecture, so it also misleads a reader.
 * - Omissions and underexplained content are next. The transcript still holds what
 *   is missing.
 * - The prose faults are last. The checker of this stage is not offered them. They
 *   are here so that the verification report Markdown does not drop a deficiency
 *   of a prose fault type (technical-design.md §5, `transcript-verification`).
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

/** The text in place of the source location, for a deficiency with no source passage. */
const NO_SOURCE_PASSAGE = "the source carries no such passage";

/** One blank line between two blocks of the verification report Markdown. */
const BLOCK_BREAK = "\n\n";

/**
 * Gives the rank of a severity for the sort. {@link QA_SEVERITIES} lists the
 * worst severity first.
 *
 * @param severity - The severity of a deficiency.
 * @returns The position of the severity in {@link QA_SEVERITIES}.
 */
function severityRank(severity: QaSeverity): number {
	return QA_SEVERITIES.indexOf(severity);
}

/**
 * Sorts the deficiencies into the reading order: by deficiency type, highest risk
 * first, then by severity, worst first. Deficiencies of the same deficiency type and
 * severity keep the order of the report, because the checker expresses no other
 * order.
 *
 * @param deficiencies - The deficiencies of the report.
 * @returns The same deficiencies, sorted.
 */
function inReadingOrder(deficiencies: readonly QaDeficiency[]): readonly QaDeficiency[] {
	return [...deficiencies].sort(
		// eslint-disable-next-line max-params -- the specification of Array.prototype.sort sets the parameters of the comparator.
		(left, right) =>
			DEFICIENCY_TYPE_PRESENTATION[left.type].rank -
				DEFICIENCY_TYPE_PRESENTATION[right.type].rank ||
			severityRank(left.severity) - severityRank(right.severity),
	);
}

/**
 * Gives a severity as the heading of a deficiency shows it.
 *
 * @param severity - The severity of a deficiency.
 * @returns The word with an initial capital.
 */
function severityLabel(severity: QaSeverity): string {
	return `${severity.charAt(0).toUpperCase()}${severity.slice(1)}`;
}

/**
 * Gives a quoted passage as a Markdown blockquote. Each line gets the marker, so
 * that a quote of more than one line stays inside the blockquote.
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
 * Gives the two locations of a deficiency: in the structured transcript, and in
 * the source. For a deficiency with no source passage, the source location says
 * that the source has no such passage. The source location is not blank. An unsourced addition is a fault because it has no
 * source passage.
 *
 * @param args - The two locations of the deficiency.
 * @param args.outputLocation - The location of the fault in the structured transcript.
 * @param args.source - The source passage of the deficiency, or `null`.
 * @returns The two locations, and the quoted passage when there is one.
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
 * Writes one deficiency: its severity and description, its two locations, and the
 * suggested fix. The section heading gives its deficiency type.
 *
 * @param deficiency - The deficiency to write.
 * @returns The Markdown block of the deficiency.
 */
function renderDeficiency(deficiency: QaDeficiency): string {
	return [
		`#### ${severityLabel(deficiency.severity)} — ${deficiency.description}`,
		...locations({ outputLocation: deficiency.outputLocation, source: deficiency.source }),
		`**Suggested fix:** ${deficiency.suggestedFix}`,
	].join(BLOCK_BREAK);
}

/**
 * Writes a table of the number of deficiencies of each deficiency type, in reading
 * order. The table has a row only for a deficiency type that occurs, because a row
 * for each deficiency type would show mostly zeroes. The rows are joined by single
 * newlines, because a blank line between two rows ends a Markdown table.
 *
 * @param deficiencies - The deficiencies of the report.
 * @returns The table, under its heading.
 */
function renderDeficiencyTypeCounts(deficiencies: readonly QaDeficiency[]): string {
	const counts = new Map<QaDeficiencyType, number>();
	for (const deficiency of deficiencies) {
		counts.set(deficiency.type, (counts.get(deficiency.type) ?? 0) + 1);
	}
	const rows = [...counts.entries()]
		.sort(
			// eslint-disable-next-line max-params -- the specification of Array.prototype.sort sets the parameters of the comparator.
			([left], [right]) =>
				DEFICIENCY_TYPE_PRESENTATION[left].rank - DEFICIENCY_TYPE_PRESENTATION[right].rank,
		)
		.map(([type, count]) => `| ${DEFICIENCY_TYPE_PRESENTATION[type].label} | ${count} |`);
	const table = ["| Deficiency type | Deficiencies |", "| --- | --- |", ...rows].join("\n");
	return ["## Deficiencies by deficiency type", table].join(BLOCK_BREAK);
}

/**
 * Writes every deficiency in reading order, under a heading for each deficiency type.
 *
 * @param deficiencies - The deficiencies of the report.
 * @returns The deficiencies section.
 */
function renderDeficiencies(deficiencies: readonly QaDeficiency[]): string {
	if (deficiencies.length === 0) {
		return ["## Deficiencies", "The checker raised nothing."].join(BLOCK_BREAK);
	}
	const blocks: string[] = ["## Deficiencies"];
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
 * Writes the considerations of the report. A list of deficiencies alone cannot
 * tell a checker that missed a fault from a checker that looked and cleared the
 * passage. So the verification report holds the considerations
 * (technical-design.md §5, `qa-loop`). The verification report Markdown shows
 * them for the same reason.
 *
 * @param considered - The considerations of the report.
 * @returns The considerations section.
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
 * Writes the verification report Markdown: the verdict, the coverage score, the
 * number of deficiencies of each deficiency type, every deficiency and every
 * consideration. The function reads no file and calls nothing
 * (technical-design.md §5, `transcript-verification`).
 *
 * @param args - The report to write.
 * @param args.report - The stored verification report.
 * @returns The whole verification report Markdown, with a newline at the end.
 * @example
 * renderVerificationReportMarkdown({ report }); // "# Transcript verification\n\nVerdict **fail**, …"
 */
export function renderVerificationReportMarkdown({
	report,
}: {
	readonly report: QaCheckerReport;
}): string {
	const summary = `Verdict **${report.overallVerdict}**, coverage **${report.coverageScore}/100**, **${pluralise({ count: report.deficiencies.length, noun: "deficiency" })}**.`;
	const sections = [
		"# Transcript verification",
		summary,
		...(report.deficiencies.length === 0 ? [] : [renderDeficiencyTypeCounts(report.deficiencies)]),
		renderDeficiencies(report.deficiencies),
		renderConsiderations(report.considered),
	];
	return `${sections.join(BLOCK_BREAK)}\n`;
}
