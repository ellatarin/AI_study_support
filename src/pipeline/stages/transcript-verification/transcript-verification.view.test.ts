import { describe, expect, it } from "vitest";
import type { QaCheckerReport, QaDeficiency } from "../../../types/pipeline.js";
import {
	verificationConsideration,
	verificationDeficiency,
	verificationReport,
} from "../../fixtures.js";
import { renderVerificationReport } from "./transcript-verification.view.js";

/**
 * One deficiency, with the fields this test's behaviour depends on replaced. Every
 * test here is about one property of a deficiency — its deficiency type, its severity, or
 * whether it names a source passage — and states only that property.
 *
 * @param overrides - The fields this test is about.
 * @returns A well-formed deficiency carrying them.
 */
function deficiency(overrides: Readonly<Partial<QaDeficiency>> = {}): QaDeficiency {
	return { ...verificationDeficiency, ...overrides };
}

/**
 * Renders a report built from the fixture defaults with the fields this test is
 * about replaced, since every test here renders exactly one report.
 *
 * @param overrides - The report fields this test is about.
 * @returns The rendered document.
 */
function render(overrides: Readonly<Partial<QaCheckerReport>> = {}): string {
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
			deficiencies: [deficiency(), deficiency()],
		});

		expect(document).toContain("# Transcript verification");
		expect(document).toContain("**fail**");
		expect(document).toContain("**72/100**");
		expect(document).toContain("**2 findings**");
	});

	it("should say the checker raised nothing when the report carries no deficiencies", () => {
		const document = render({ overallVerdict: "pass", coverageScore: 94, deficiencies: [] });

		expect(document).toContain("# Transcript verification");
		expect(document).toContain("The checker raised nothing");
		expect(document).toContain("**0 findings**");
	});

	it("should count the deficiencies of each deficiency type when the report carries several", () => {
		const document = render({
			deficiencies: [
				deficiency({ type: "distortion" }),
				deficiency({ type: "omission" }),
				deficiency({ type: "distortion" }),
			],
		});

		expect(document).toContain("| Distortion | 2 |");
		expect(document).toContain("| Omission | 1 |");
	});

	it("should keep the counts in one table when the report carries several deficiency types", () => {
		const document = render({
			deficiencies: [deficiency({ type: "distortion" }), deficiency({ type: "omission" })],
		});

		expect(document).toContain(
			"| Category | Findings |\n| --- | --- |\n| Distortion | 1 |\n| Omission | 1 |",
		);
	});

	it("should put distortions before every other deficiency type when the report carries both", () => {
		const document = render({
			deficiencies: [deficiency({ type: "omission" }), deficiency({ type: "distortion" })],
		});

		expect(positionOf({ document, passage: "### Distortion" })).toBeLessThan(
			positionOf({ document, passage: "### Omission" }),
		);
	});

	it("should order deficiencies from critical to minor when a deficiency type carries several", () => {
		const document = render({
			deficiencies: [
				deficiency({ severity: "minor", description: "The least of it." }),
				deficiency({ severity: "critical", description: "The worst of it." }),
				deficiency({ severity: "major", description: "The middle of it." }),
			],
		});

		expect(positionOf({ document, passage: "The worst of it." })).toBeLessThan(
			positionOf({ document, passage: "The middle of it." }),
		);
		expect(positionOf({ document, passage: "The middle of it." })).toBeLessThan(
			positionOf({ document, passage: "The least of it." }),
		);
	});

	it("should show both locations and the source quote when a deficiency carries a source", () => {
		const document = render({ deficiencies: [deficiency()] });

		expect(document).toContain(verificationDeficiency.outputLocation);
		expect(document).toContain(verificationDeficiency.source.location);
		expect(document).toContain(verificationDeficiency.source.evidence);
		expect(document).toContain(verificationDeficiency.suggestedFix);
		expect(document).toContain("Major");
	});

	it("should say the source carries no such passage when a deficiency has no source passage", () => {
		const document = render({
			deficiencies: [deficiency({ type: "unsourced-addition", source: null })],
		});

		expect(document).toContain("the source carries no such passage");
		expect(document).not.toContain(verificationDeficiency.source.evidence);
	});

	it("should record what the checker cleared when the report carries considerations", () => {
		const document = render({ considered: [verificationConsideration] });

		expect(document).toContain("**1 passage**");
		expect(document).toContain(verificationConsideration.source.evidence);
		expect(document).toContain(verificationConsideration.source.location);
		expect(document).toContain(verificationConsideration.whyNotRaised);
	});

	it("should say nothing was cleared when the checker recorded no considerations", () => {
		const document = render({ considered: [] });

		expect(document).toContain("The checker recorded nothing it examined and cleared");
	});
});
