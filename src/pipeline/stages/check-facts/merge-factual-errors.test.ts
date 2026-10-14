import { describe, expect, it } from "vitest";
import { primaryFactCheckModel, secondaryFactCheckModel } from "../../fixtures.js";
import type { FactualError } from "../factual-errors.js";
import { mergeFactualErrors } from "./merge-factual-errors.js";

const PRIMARY_ID = primaryFactCheckModel.modelId;
const SECONDARY_ID = secondaryFactCheckModel.modelId;

/**
 * Builds a factual error whose text names its model, so that a test can see whose text a merged factual error took.
 *
 * @param args - The subtopic, the passage, and the model whose text it is.
 * @param args.subtopicId - The subtopic.
 * @param args.passage - The passage.
 * @param args.by - The model, for the problem and the correct statement.
 * @returns The factual error.
 */
function factualError({
	subtopicId,
	passage,
	by,
}: {
	readonly subtopicId: number;
	readonly passage: string;
	readonly by: string;
}): FactualError {
	return {
		subtopicId,
		passage,
		problem: `problem by ${by}`,
		correctStatement: `correct statement by ${by}`,
		severity: "serious",
	};
}

describe("mergeFactualErrors", () => {
	it("should make one merged factual error with the primary model's text when two models report the same subtopic and their passages share a run of three words", () => {
		const primary = factualError({
			subtopicId: 2,
			passage: "Tobacco smoke causes most lung cancers.",
			by: PRIMARY_ID,
		});
		const secondary = factualError({
			subtopicId: 2,
			passage: "smoke causes most lung",
			by: SECONDARY_ID,
		});

		const merged = mergeFactualErrors({
			subtopicIds: [1, 2],
			primary: { modelId: PRIMARY_ID, factualErrors: [primary] },
			secondary: { modelId: SECONDARY_ID, factualErrors: [secondary] },
		});

		expect(merged).toStrictEqual([{ ...primary, foundBy: [PRIMARY_ID, SECONDARY_ID] }]);
	});

	/** A factual error in a case: its subtopic and its passage. */
	type Reported = readonly [subtopicId: number, passage: string];

	/** The model ids of `foundBy`, by the role of each model. */
	const BOTH = [PRIMARY_ID, SECONDARY_ID];
	const PRIMARY_ONLY = [PRIMARY_ID];
	const SECONDARY_ONLY = [SECONDARY_ID];

	it.each<{
		readonly condition: string;
		readonly primary: readonly Reported[];
		readonly secondary: readonly Reported[] | undefined;
		readonly expected: readonly (readonly [passage: string, foundBy: readonly string[]])[];
	}>([
		{
			condition: "the two passages share a run but are in different subtopics",
			primary: [[1, "the p53 gene is mutated"]],
			secondary: [[2, "the p53 gene is mutated"]],
			expected: [
				["the p53 gene is mutated", PRIMARY_ONLY],
				["the p53 gene is mutated", SECONDARY_ONLY],
			],
		},
		{
			condition: "the two passages in one subtopic share no run of three words",
			primary: [[1, "the p53 gene is mutated"]],
			secondary: [[1, "gene p53 the mutated is"]],
			expected: [
				["the p53 gene is mutated", PRIMARY_ONLY],
				["gene p53 the mutated is", SECONDARY_ONLY],
			],
		},
		{
			condition: "the two passages differ only in case and punctuation",
			primary: [[1, "The p53-gene, is mutated."]],
			secondary: [[1, "the P53 gene is"]],
			expected: [["The p53-gene, is mutated.", BOTH]],
		},
		{
			condition: "a passage of three words or fewer is inside the other passage",
			primary: [[1, "in most cancers the p53 gene is mutated"]],
			secondary: [[1, "p53 gene"]],
			expected: [
				["in most cancers the p53 gene is mutated", PRIMARY_ONLY],
				["p53 gene", SECONDARY_ONLY],
			],
		},
		{
			condition: "a passage of three words is a run of the other passage",
			primary: [[1, "in most cancers the p53 gene is mutated"]],
			secondary: [[1, "the p53 gene"]],
			expected: [["in most cancers the p53 gene is mutated", BOTH]],
		},
		{
			condition: "a later primary error shares more runs than an earlier one",
			primary: [
				[1, "aflatoxin comes from mould"],
				[1, "aflatoxin comes from mould on stored peanuts"],
			],
			secondary: [[1, "aflatoxin comes from mould on stored grain"]],
			expected: [
				["aflatoxin comes from mould", PRIMARY_ONLY],
				["aflatoxin comes from mould on stored peanuts", BOTH],
			],
		},
		{
			condition: "two primary errors share the same number of runs",
			primary: [
				[1, "benzene causes leukaemia in workers"],
				[1, "benzene causes leukaemia in children"],
			],
			secondary: [[1, "benzene causes leukaemia"]],
			expected: [
				["benzene causes leukaemia in workers", BOTH],
				["benzene causes leukaemia in children", PRIMARY_ONLY],
			],
		},
		{
			condition: "two secondary errors match the same primary error",
			primary: [[1, "asbestos causes mesothelioma of the pleura"]],
			secondary: [
				[1, "asbestos causes mesothelioma"],
				[1, "asbestos causes mesothelioma of the pleura"],
			],
			expected: [
				["asbestos causes mesothelioma of the pleura", BOTH],
				["asbestos causes mesothelioma", SECONDARY_ONLY],
			],
		},
		{
			condition: "the factual errors are in several subtopics",
			primary: [
				[3, "radon is a gas"],
				[1, "UV light causes melanoma"],
			],
			secondary: [
				[2, "HPV causes cervical cancer"],
				[1, "UV light damages DNA"],
			],
			expected: [
				["UV light causes melanoma", PRIMARY_ONLY],
				["UV light damages DNA", SECONDARY_ONLY],
				["HPV causes cervical cancer", SECONDARY_ONLY],
				["radon is a gas", PRIMARY_ONLY],
			],
		},
		{
			condition: "the stage calls one model",
			primary: [
				[1, "the p53 gene is mutated"],
				[1, "the p53 gene is mutated"],
			],
			secondary: undefined,
			expected: [
				["the p53 gene is mutated", PRIMARY_ONLY],
				["the p53 gene is mutated", PRIMARY_ONLY],
			],
		},
	])("should give each factual error with the models that report it when $condition", ({
		primary,
		secondary,
		expected,
	}) => {
		const errorsOf = ({
			reported,
			by,
		}: {
			readonly reported: readonly Reported[];
			readonly by: string;
		}): readonly FactualError[] =>
			reported.map(([subtopicId, passage]) => factualError({ subtopicId, passage, by }));

		const merged = mergeFactualErrors({
			subtopicIds: [1, 2, 3],
			primary: {
				modelId: PRIMARY_ID,
				factualErrors: errorsOf({ reported: primary, by: PRIMARY_ID }),
			},
			secondary:
				secondary === undefined
					? undefined
					: {
							modelId: SECONDARY_ID,
							factualErrors: errorsOf({ reported: secondary, by: SECONDARY_ID }),
						},
		});

		expect(merged.map(({ passage, foundBy }) => [passage, foundBy])).toStrictEqual(expected);
	});
});
