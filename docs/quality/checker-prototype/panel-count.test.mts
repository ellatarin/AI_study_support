import { describe, expect, it } from "vitest";
import type { KeyFault } from "./check-results.mts";
import type { ScoredFault } from "./jev-scores.mts";
import { keepPanelFaults } from "./panel-count.mts";

const JEV_BAR = 0.6;

const mattering: KeyFault = {
	fault: "2.1",
	description: "The rewrite makes two listed things the same.",
	userVerdict: "matters",
	subtopicId: 2,
	sourcePassage: "acetylation or deacetylation and the state of transcription",
	rewritePassage: "acetylation or deacetylation, that is, the state of transcription",
};

const notMattering: KeyFault = {
	fault: "12.1",
	description: "The rewrite adds a correct link.",
	userVerdict: "does not matter",
	subtopicId: 12,
	sourcePassage: "most seeds never sprout and it takes the right soil",
	rewritePassage: "most seeds never sprout because it takes the right soil",
};

const answerKey = [mattering, notMattering];

/**
 * Builds a checker's fault that quotes the passages of a key fault.
 *
 * @param args - The key fault and the Jev score.
 * @param args.keyFault - The key fault whose passages the fault quotes.
 * @param args.jevScore - The Jev score of the fault.
 * @returns The fault.
 */
function faultQuoting({ keyFault, jevScore }: { readonly keyFault: KeyFault; readonly jevScore: number }): ScoredFault {
	const { subtopicId, sourcePassage, rewritePassage } = keyFault;
	return { subtopicId, sourcePassage, rewritePassage, description: "A reported fault.", jevScore };
}

describe("keepPanelFaults", () => {
	it.each([
		{ condition: "its Jev score reaches the bar", jevScore: JEV_BAR, realFaults: ["2.1"] },
		{ condition: "its Jev score is below the bar", jevScore: 0.59, realFaults: [] },
	])("should keep a fault that matters in the run when $condition", ({ jevScore, realFaults }) => {
		const runs = [{ name: "run 1", faults: [faultQuoting({ keyFault: mattering, jevScore })] }];

		const result = keepPanelFaults({ runs, answerKey, jevBar: JEV_BAR, votesNeeded: 1 });

		expect(result.runs[0]?.realFaults).toEqual(realFaults);
	});

	it("should list a kept fault as false when the user marked it as not mattering", () => {
		const runs = [{ name: "run 1", faults: [faultQuoting({ keyFault: notMattering, jevScore: JEV_BAR })] }];

		const result = keepPanelFaults({ runs, answerKey, jevBar: JEV_BAR, votesNeeded: 1 });

		expect(result.runs[0]).toMatchObject({ realFaults: [], falseFaults: ["12.1"] });
	});

	it("should list a kept fault as not marked when the answer key does not hold it", () => {
		const outsideKey = { ...faultQuoting({ keyFault: mattering, jevScore: JEV_BAR }), subtopicId: 3 };
		const runs = [{ name: "run 1", faults: [outsideKey] }];

		const result = keepPanelFaults({ runs, answerKey, jevBar: JEV_BAR, votesNeeded: 1 });

		expect(result.runs[0]).toMatchObject({ realFaults: [], falseFaults: [], notMarked: [outsideKey] });
	});

	it.each([
		{ condition: "enough runs keep them", secondScore: JEV_BAR, panel: { realFaults: ["2.1"], falseFaults: ["12.1"] } },
		{ condition: "too few runs keep them", secondScore: 0.59, panel: { realFaults: [], falseFaults: [] } },
	])("should keep key faults in the panel when $condition", ({ secondScore, panel }) => {
		const runs = [
			{ name: "run 1", faults: [mattering, notMattering].map((keyFault) => faultQuoting({ keyFault, jevScore: JEV_BAR })) },
			{ name: "run 2", faults: [mattering, notMattering].map((keyFault) => faultQuoting({ keyFault, jevScore: secondScore })) },
		];

		const result = keepPanelFaults({ runs, answerKey, jevBar: JEV_BAR, votesNeeded: 2 });

		expect(result.panel).toMatchObject(panel);
	});

	it.each([
		{ condition: "another run keeps the same fault", second: { run: "run 2", subtopicId: 3 }, kept: true },
		{ condition: "the other run keeps it in another subtopic", second: { run: "run 2", subtopicId: 4 }, kept: false },
		{ condition: "only one run keeps it, twice", second: { run: "run 1", subtopicId: 3 }, kept: false },
	])("should keep a fault outside the key in the panel only when $condition", ({ second, kept }) => {
		const quoting = faultQuoting({ keyFault: mattering, jevScore: JEV_BAR });
		const first = { ...quoting, subtopicId: 3 };
		const other = { ...quoting, subtopicId: second.subtopicId };
		const runs = [
			{ name: "run 1", faults: second.run === "run 1" ? [first, other] : [first] },
			{ name: "run 2", faults: second.run === "run 2" ? [other] : [] },
		];

		const result = keepPanelFaults({ runs, answerKey, jevBar: JEV_BAR, votesNeeded: 2 });

		expect(result.panel.notMarked).toEqual(kept ? [first] : []);
	});

	it("should count one vote when a run reports a key fault twice", () => {
		const twice = faultQuoting({ keyFault: mattering, jevScore: JEV_BAR });
		const runs = [{ name: "run 1", faults: [twice, twice] }];

		const result = keepPanelFaults({ runs, answerKey, jevBar: JEV_BAR, votesNeeded: 2 });

		expect(result.panel.realFaults).toEqual([]);
	});
});
