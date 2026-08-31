import { describe, expect, it } from "vitest";
import type { QaDeficiency, QaFindingsReport } from "../../types/pipeline.js";
import { verificationCleared, verificationFinding, verificationReport } from "../fixtures.js";
import { renderVerificationReport } from "./transcript-verification.view.js";

/**
 * One finding, with the fields this test's behaviour depends on replaced. Every
 * test here is about one property of a finding — its category, its severity, or
 * whether it anchors to the source — and states only that property.
 *
 * @param overrides - The fields this test is about.
 * @returns A well-formed finding carrying them.
 */
function finding(overrides: Readonly<Partial<QaDeficiency>> = {}): QaDeficiency {
	return { ...verificationFinding, ...overrides };
}

/**
 * Renders a report built from the fixture defaults with the fields this test is
 * about replaced, since every test here renders exactly one report.
 *
 * @param overrides - The report fields this test is about.
 * @returns The rendered document.
 */
function render(overrides: Readonly<Partial<QaFindingsReport>> = {}): string {
	return renderVerificationReport({ report: verificationReport(overrides) });
}

/**
 * Where a passage sits in the rendered document, insisting it is there at all —
 * an ordering assertion between two absent passages would otherwise pass.
 *
 * @param args - The document and the passage to locate.
 * @param args.document - The rendered document.
 * @param args.passage - The text to find in it.
 * @returns The passage's index.
 */
function positionOf({
	document,
	passage,
}: {
	readonly document: string;
	readonly passage: string;
}): number {
	expect(document).toContain(passage);
	return document.indexOf(passage);
}

describe("renderVerificationReport", () => {
	it("should open with the verdict, the coverage score and the count when a report is rendered", () => {
		const document = render({
			overallVerdict: "fail",
			coverageScore: 72,
			deficiencies: [finding(), finding()],
		});

		expect(document).toContain("# Transcript verification");
		expect(document).toContain("**fail**");
		expect(document).toContain("**72/100**");
		expect(document).toContain("**2 findings**");
	});

	it("should say the checker raised nothing when the report carries no findings", () => {
		const document = render({ overallVerdict: "pass", coverageScore: 94, deficiencies: [] });

		expect(document).toContain("# Transcript verification");
		expect(document).toContain("The checker raised nothing");
		expect(document).toContain("**0 findings**");
	});

	it("should count the findings of each category when the report carries several", () => {
		const document = render({
			deficiencies: [
				finding({ type: "distortion" }),
				finding({ type: "omission" }),
				finding({ type: "distortion" }),
			],
		});

		expect(document).toContain("| Distortion | 2 |");
		expect(document).toContain("| Omission | 1 |");
	});

	it("should keep the counts in one table when the report carries several categories", () => {
		const document = render({
			deficiencies: [finding({ type: "distortion" }), finding({ type: "omission" })],
		});

		expect(document).toContain(
			"| Category | Findings |\n| --- | --- |\n| Distortion | 1 |\n| Omission | 1 |",
		);
	});

	it("should put distortions before every other category when the report carries both", () => {
		const document = render({
			deficiencies: [finding({ type: "omission" }), finding({ type: "distortion" })],
		});

		expect(positionOf({ document, passage: "### Distortion" })).toBeLessThan(
			positionOf({ document, passage: "### Omission" }),
		);
	});

	it("should order findings from critical to minor when a category carries several", () => {
		const document = render({
			deficiencies: [
				finding({ severity: "minor", description: "The least of it." }),
				finding({ severity: "critical", description: "The worst of it." }),
				finding({ severity: "major", description: "The middle of it." }),
			],
		});

		expect(positionOf({ document, passage: "The worst of it." })).toBeLessThan(
			positionOf({ document, passage: "The middle of it." }),
		);
		expect(positionOf({ document, passage: "The middle of it." })).toBeLessThan(
			positionOf({ document, passage: "The least of it." }),
		);
	});

	it("should show both locations and the source quote when a finding carries a source", () => {
		const document = render({ deficiencies: [finding()] });

		expect(document).toContain(verificationFinding.outputLocation);
		expect(document).toContain(verificationFinding.source.location);
		expect(document).toContain(verificationFinding.source.evidence);
		expect(document).toContain(verificationFinding.suggestedFix);
		expect(document).toContain("Major");
	});

	it("should say the source carries no such passage when a finding has no source anchor", () => {
		const document = render({
			deficiencies: [finding({ type: "unsourced-addition", source: null })],
		});

		expect(document).toContain("the source carries no such passage");
		expect(document).not.toContain(verificationFinding.source.evidence);
	});

	it("should record what the checker cleared when the report carries considerations", () => {
		const document = render({ considered: [verificationCleared] });

		expect(document).toContain("**1 passage**");
		expect(document).toContain(verificationCleared.source.evidence);
		expect(document).toContain(verificationCleared.source.location);
		expect(document).toContain(verificationCleared.whyNotRaised);
	});

	it("should say nothing was cleared when the checker recorded no considerations", () => {
		const document = render({ considered: [] });

		expect(document).toContain("The checker recorded nothing it examined and cleared");
	});
});
