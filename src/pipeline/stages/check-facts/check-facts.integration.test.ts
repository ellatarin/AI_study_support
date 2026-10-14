import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FactCheckModel } from "../../../types/pipeline.js";
import { type CostTallyByModel, createCostTallyByModel } from "../../../utils/cost.js";
import {
	arrivingTogether,
	captureError,
	disabledFactCheckModel,
	driveModelStage,
	factCheckedSubtopics,
	factCheckModelFile,
	factCheckModelIds,
	factualErrorsFile,
	makeConfig,
	makeStageContext,
	openRouterReplyBody,
	primaryFactCheckModel,
	resendPausesTimeoutMs,
	rewriteFile,
	secondaryFactCheckModel,
	seedEarlierOutputs,
	seededTitledRewrites,
	seedJsonFile,
	snuffFactualError,
	stubbedCallCost,
	stubbedCallsCost,
	testLecture,
	useCostTally,
	useStubbedOpenRouter,
	useStubLogger,
	useTempDir,
	useTranscribedWorkspace,
	waitTurns,
	workspaceJsonReader,
} from "../../fixtures.js";
import type { FactualError } from "../factual-errors.js";
import {
	CheckFactsError,
	checkFacts,
	createCheckFactsStage,
	readFactCheckInput,
	type SendToListedModel,
} from "./check-facts.js";
import { FACT_CHECK_PROMPT_VERSION } from "./check-facts.prompt.js";

/** The file of each model: its model id without the provider. */
const PRIMARY_MODEL_FILE = "gpt-5.6-sol-pro.json";
const SECONDARY_MODEL_FILE = "claude-opus-5.5.json";

/** One factual error as the reply of a fact check gives it. */
type ReplyError = {
	readonly subtopic: number;
	readonly passage: string;
	readonly problem: string;
	readonly correction: string;
	readonly severity: FactualError["severity"];
};

/**
 * Gives a reply error in the project's words, as the stage writes it.
 *
 * @param error - The reply error.
 * @returns The factual error.
 */
function asFactualError(error: ReplyError): FactualError {
	return {
		subtopicId: error.subtopic,
		passage: error.passage,
		problem: error.problem,
		correctStatement: error.correction,
		severity: error.severity,
	};
}

/**
 * Gives a factual error in the words of a fact-check reply.
 *
 * @param error - The factual error.
 * @returns The reply error.
 */
function asReplyError(error: FactualError): ReplyError {
	return {
		subtopic: error.subtopicId,
		passage: error.passage,
		problem: error.problem,
		correction: error.correctStatement,
		severity: error.severity,
	};
}

const snuffError = asReplyError(snuffFactualError);

/**
 * Builds the text of a fact-check reply in the shape that prompt f2 asks for.
 *
 * @param errors - The errors of the reply.
 * @returns The reply text.
 */
function factCheckReply(
	errors: readonly (Omit<ReplyError, "subtopic"> & { readonly subtopic: unknown })[],
): string {
	return JSON.stringify({
		errors,
		checked: factCheckedSubtopics.map(({ subtopicId }) => ({
			subtopic: subtopicId,
			result: "errors",
		})),
	});
}

describe("checkFacts", () => {
	const workspaceRoot = useTempDir({ prefix: "check-facts-" });
	const stubLogger = useStubLogger();
	const costTally = useCostTally();
	let sendToModel: ReturnType<typeof vi.fn<SendToListedModel>>;
	let modelCostTallies: CostTallyByModel;
	const readFile = workspaceJsonReader(workspaceRoot);

	beforeEach(async () => {
		sendToModel = vi
			.fn<SendToListedModel>()
			.mockResolvedValue({ content: factCheckReply([snuffError]) });
		modelCostTallies = createCostTallyByModel();
		// The stage factory makes the folder before a stage run. This suite runs the fact check alone.
		await mkdir(join(workspaceRoot(), "Fact checks"), { recursive: true });
	});

	/**
	 * Gives the cost tally of each model of the current test.
	 *
	 * @returns The cost tally of each model.
	 */
	function costTallyByModel(): CostTallyByModel {
		return modelCostTallies;
	}

	/**
	 * Runs the fact check of the test lecture.
	 *
	 * @param models - The `models` list of the stage.
	 * @returns The result of the fact check.
	 */
	function run(models: readonly FactCheckModel[]): ReturnType<typeof checkFacts> {
		return checkFacts({
			lectureTitle: testLecture.title,
			subtopics: factCheckedSubtopics,
			models,
			workspaceRoot: workspaceRoot(),
			sendToModel,
			logger: stubLogger().logger,
			costTally: costTally(),
			costTallyByModel: costTallyByModel(),
		});
	}

	/**
	 * Gives the model id of each call of the stubbed send, in the order of the calls.
	 *
	 * @returns The model ids.
	 */
	function calledModelIds(): readonly string[] {
		return sendToModel.mock.calls.map(([{ model }]) => model.modelId);
	}

	/**
	 * Gives the `foundBy` of each merged factual error.
	 *
	 * @param output - The merged file.
	 * @returns The model ids that report each factual error, in the order of the file.
	 */
	function foundByOf(
		output: Awaited<ReturnType<typeof checkFacts>>["output"],
	): readonly (readonly string[])[] {
		return output.factualErrors.map(({ foundBy }) => foundBy);
	}

	it("should write the factual errors of the model to the file named by the model, and the merged file, when the stage calls one model", async () => {
		await run([primaryFactCheckModel]);

		expect(await readFile(factCheckModelFile(PRIMARY_MODEL_FILE))).toStrictEqual({
			modelId: primaryFactCheckModel.modelId,
			factCheckPromptVersion: FACT_CHECK_PROMPT_VERSION,
			factualErrors: [snuffFactualError],
		});
		expect(await readFile(factualErrorsFile)).toStrictEqual({
			factCheckPromptVersion: FACT_CHECK_PROMPT_VERSION,
			checkedBy: [primaryFactCheckModel.modelId],
			factualErrors: [
				{ ...snuffFactualError, foundBy: [primaryFactCheckModel.modelId], wordsFound: true },
			],
		});
	});

	it(
		"should resend the call when the reply names a subtopic id that is not in the lecture",
		async () => {
			sendToModel
				.mockResolvedValueOnce({ content: factCheckReply([{ ...snuffError, subtopic: 9 }]) })
				.mockResolvedValueOnce({ content: factCheckReply([snuffError]) });

			const { output } = await run([primaryFactCheckModel]);

			expect(sendToModel).toHaveBeenCalledTimes(2);
			expect(output.factualErrors.map(({ subtopicId }) => subtopicId)).toStrictEqual([2]);
		},
		resendPausesTimeoutMs,
	);

	it("should read the subtopic as a number when the reply gives it as a string of digits", async () => {
		sendToModel.mockResolvedValue({
			content: factCheckReply([{ ...snuffError, subtopic: "2" }]),
		});

		const { output } = await run([primaryFactCheckModel]);

		expect(sendToModel).toHaveBeenCalledTimes(1);
		expect(output.factualErrors).toStrictEqual([
			{ ...snuffFactualError, foundBy: [primaryFactCheckModel.modelId], wordsFound: true },
		]);
	});

	it.each(["three", "3a", "2.5", ""])(
		'should resend the call when the reply gives the subtopic as "%s"',
		async (subtopic) => {
			sendToModel
				.mockResolvedValueOnce({
					content: factCheckReply([{ ...snuffError, subtopic }]),
				})
				.mockResolvedValueOnce({ content: factCheckReply([snuffError]) });

			await run([primaryFactCheckModel]);

			expect(sendToModel).toHaveBeenCalledTimes(2);
		},
		resendPausesTimeoutMs,
	);

	it.each([
		{
			condition: "the passage runs across two paragraphs of its subtopic",
			passage: "lung cancers. Snuff   is",
			wordsFound: true,
			notices: [],
		},
		{
			condition: "the model changed a word of the passage",
			passage: "Snuff is safe.",
			wordsFound: false,
			notices: ['The passage of a factual error is not in subtopic 2: "Snuff is safe."'],
		},
	])("should give wordsFound $wordsFound when $condition", async ({
		passage,
		wordsFound,
		notices,
	}) => {
		sendToModel.mockResolvedValue({ content: factCheckReply([{ ...snuffError, passage }]) });

		const result = await run([primaryFactCheckModel]);

		expect(result.output.factualErrors.map((error) => error.wordsFound)).toStrictEqual([
			wordsFound,
		]);
		expect(result.notices).toStrictEqual(notices);
	});

	/**
	 * Makes the stubbed send answer each model with its own reply.
	 *
	 * @param replies - The reply text of each model id.
	 */
	function replyByModel(replies: Readonly<Record<string, string>>): void {
		sendToModel.mockImplementation(async ({ model }) => ({
			content: replies[model.modelId] ?? "",
		}));
	}

	it("should send to the two models at the same time when the stage calls a primary and a secondary model", async () => {
		// A send that waits for a send that has not started never ends. The test
		// timeout then fails the test.
		sendToModel.mockImplementation(
			arrivingTogether({ count: 2, reply: () => ({ content: factCheckReply([]) }) }),
		);

		await run([primaryFactCheckModel, secondaryFactCheckModel]);

		// Each model looks for its saved file before its call, and either look can
		// end first. So the order of the calls is not fixed.
		expect(new Set(calledModelIds())).toStrictEqual(new Set(factCheckModelIds));
	});

	const providerFailure = new Error("Model returned an error on each send");

	/**
	 * Makes the stubbed send fail for the primary model. The secondary model's reply
	 * comes after the primary failure.
	 *
	 * @param secondaryReply - The reply text of the secondary model.
	 */
	function failPrimaryModel(secondaryReply: string): void {
		sendToModel.mockImplementation(async ({ model }) => {
			if (model.role === "primary") {
				throw providerFailure;
			}
			await waitTurns({ turns: 5 });
			return { content: secondaryReply };
		});
	}

	it("should fail and keep the file of the other model when one model fails each send", async () => {
		failPrimaryModel(factCheckReply([snuffError]));

		const error = await captureError(run([primaryFactCheckModel, secondaryFactCheckModel]));

		expect(error).toBe(providerFailure);
		expect(await readFile(factCheckModelFile(SECONDARY_MODEL_FILE))).toMatchObject({
			modelId: secondaryFactCheckModel.modelId,
		});
	});

	const oneCallCostOfEachModel = factCheckModelIds.map((modelId) => ({
		modelId,
		cost: stubbedCallCost,
	}));

	it("should keep the cost of each model when one model fails each send", async () => {
		sendToModel.mockImplementation(async ({ model, costTally: modelCostTally }) => {
			modelCostTally.add(stubbedCallCost);
			if (model.role === "primary") {
				throw providerFailure;
			}
			await waitTurns({ turns: 5 });
			return { content: factCheckReply([]) };
		});

		await captureError(run([primaryFactCheckModel, secondaryFactCheckModel]));

		expect(costTallyByModel().costByModel()).toStrictEqual(oneCallCostOfEachModel);
	});

	it("should call only the model with no saved file, and merge the saved factual errors, when the stage starts again", async () => {
		failPrimaryModel(factCheckReply([cellsError]));
		await captureError(run([primaryFactCheckModel, secondaryFactCheckModel]));
		replyByModel({ [primaryFactCheckModel.modelId]: factCheckReply([snuffError]) });
		sendToModel.mockClear();

		const { output } = await run([primaryFactCheckModel, secondaryFactCheckModel]);

		expect(calledModelIds()).toStrictEqual([primaryFactCheckModel.modelId]);
		expect(foundByOf(output)).toStrictEqual([
			[secondaryFactCheckModel.modelId],
			[primaryFactCheckModel.modelId],
		]);
	});

	it("should not use the saved file of a model when the model is now disabled", async () => {
		replyByModel({
			[primaryFactCheckModel.modelId]: factCheckReply([snuffError]),
			[secondaryFactCheckModel.modelId]: factCheckReply([cellsError]),
		});
		await run([primaryFactCheckModel, secondaryFactCheckModel]);

		const { output } = await run([
			primaryFactCheckModel,
			{ ...secondaryFactCheckModel, role: "disabled" },
		]);

		expect(foundByOf(output)).toStrictEqual([[primaryFactCheckModel.modelId]]);
	});

	it("should fail with CheckFactsError that names the file when a saved file holds nothing readable", async () => {
		const path = join(workspaceRoot(), factCheckModelFile(PRIMARY_MODEL_FILE));
		await seedJsonFile({ path, contents: { modelId: primaryFactCheckModel.modelId } });

		const error = await captureError(run([primaryFactCheckModel]));

		expect(error).toBeInstanceOf(CheckFactsError);
		expect(error.message).toContain(path);
	});

	it("should give the cost of each called model, and the config of each model that is not disabled, when the stage completes", async () => {
		sendToModel.mockImplementation(({ costTally: modelCostTally }) => {
			modelCostTally.add(stubbedCallCost);
			return Promise.resolve({ content: factCheckReply([]) });
		});

		const result = await run([
			primaryFactCheckModel,
			disabledFactCheckModel,
			secondaryFactCheckModel,
		]);

		expect(costTallyByModel().costByModel()).toStrictEqual(oneCallCostOfEachModel);
		expect(result.configUsed).toStrictEqual({
			models: [primaryFactCheckModel, secondaryFactCheckModel],
		});
		expect(costTally().total()).toStrictEqual(stubbedCallsCost({ calls: 2 }));
	});

	it("should not call a disabled model when the models list has one", async () => {
		await run([primaryFactCheckModel, { ...secondaryFactCheckModel, role: "disabled" }]);

		expect(calledModelIds()).toStrictEqual([primaryFactCheckModel.modelId]);
	});

	it("should fail with CheckFactsError and call no model when the models list has no primary model", async () => {
		const error = await captureError(run([secondaryFactCheckModel]));

		expect(error).toStrictEqual(new CheckFactsError("The models list has no primary model"));
		expect(sendToModel).not.toHaveBeenCalled();
	});

	const secondarySnuffError: ReplyError = {
		...snuffError,
		passage: "Snuff is harmless",
		problem: "Snuff is not harmless.",
		correction: "Snuff is a cause of cancer.",
	};
	const cellsError: ReplyError = {
		subtopic: 1,
		passage: "Cancer is a disease of cells.",
		problem: "Doubtful.",
		correction: "Cancer is a disease of the genome.",
		severity: "minor",
	};

	it("should merge the factual errors of the two models with the primary model's text when the stage calls a primary and a secondary model", async () => {
		replyByModel({
			[primaryFactCheckModel.modelId]: factCheckReply([snuffError]),
			[secondaryFactCheckModel.modelId]: factCheckReply([secondarySnuffError, cellsError]),
		});

		const { output } = await run([secondaryFactCheckModel, primaryFactCheckModel]);

		expect(output.checkedBy).toStrictEqual(factCheckModelIds);
		expect(output.factualErrors).toStrictEqual([
			{
				...asFactualError(cellsError),
				foundBy: [secondaryFactCheckModel.modelId],
				wordsFound: true,
			},
			{ ...snuffFactualError, foundBy: factCheckModelIds, wordsFound: true },
		]);
		expect(await readFile(factCheckModelFile(SECONDARY_MODEL_FILE))).toMatchObject({
			modelId: secondaryFactCheckModel.modelId,
			factualErrors: [{ passage: secondarySnuffError.passage }, { passage: cellsError.passage }],
		});
	});
});

describe("createCheckFactsStage", () => {
	const workspace = useTranscribedWorkspace({ prefix: "check-facts-stage-" });
	const logged = useStubLogger();
	const { client, create } = useStubbedOpenRouter();
	const config = makeConfig({
		stages: { "check-facts": { models: [primaryFactCheckModel, disabledFactCheckModel] } },
	});

	beforeEach(async () => {
		create().mockResolvedValue(openRouterReplyBody({ content: factCheckReply([snuffError]) }));
		await seedEarlierOutputs({
			workspaceRoot: workspace().workspaceRoot,
			readsFrom: ["structure-transcript", "rewrite-subtopics"],
		});
	});

	it("should send each call to the model of the models list, and record the file of the model and the merged file, when the stage runs", async () => {
		const result = await driveModelStage({
			factory: createCheckFactsStage,
			client: client(),
			config,
			workspaceRoot: workspace().workspaceRoot,
			logger: logged().logger,
		});

		expect(create().mock.calls.map(([body]) => body.model)).toStrictEqual([
			primaryFactCheckModel.modelId,
		]);
		expect(result.filesWritten).toStrictEqual([
			factCheckModelFile(PRIMARY_MODEL_FILE),
			factualErrorsFile,
		]);
	});

	it("should fail with CheckFactsError that names the config file, and call no model, when the config has no entry for check-facts", async () => {
		const error = await captureError(
			driveModelStage({
				factory: createCheckFactsStage,
				client: client(),
				config: makeConfig(),
				workspaceRoot: workspace().workspaceRoot,
				logger: logged().logger,
			}),
		);

		expect(error).toBeInstanceOf(CheckFactsError);
		expect(error.message).toContain('stage "check-facts" in pipeline-config.json');
		expect(create()).not.toHaveBeenCalled();
	});
});

describe("readFactCheckInput", () => {
	const workspaceRoot = useTempDir({ prefix: "check-facts-input-" });

	/**
	 * Reads the input of the stage from the test workspace.
	 *
	 * @returns What {@link readFactCheckInput} gives.
	 */
	function readInput(): ReturnType<typeof readFactCheckInput> {
		return readFactCheckInput(makeStageContext({ workspaceRoot: workspaceRoot() }));
	}

	it("should give the rewrite of each subtopic in lecture order, with its id and title, when the structured transcript and the rewrites are on disk", async () => {
		await seedEarlierOutputs({
			workspaceRoot: workspaceRoot(),
			readsFrom: ["structure-transcript", "rewrite-subtopics"],
		});

		const input = await readInput();

		expect(input).toStrictEqual({
			lectureTitle: testLecture.title,
			subtopics: seededTitledRewrites,
		});
	});

	it("should fail with CheckFactsError that names the file when the rewrite of a subtopic is missing", async () => {
		await seedEarlierOutputs({
			workspaceRoot: workspaceRoot(),
			readsFrom: ["structure-transcript"],
		});

		const error = await captureError(readInput());

		expect(error).toBeInstanceOf(CheckFactsError);
		expect(error.message).toContain(rewriteFile(1));
	});
});
