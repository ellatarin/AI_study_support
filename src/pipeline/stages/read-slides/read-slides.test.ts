import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { pathExists } from "../../../utils/files.js";
import {
	captureError,
	configuringStage,
	driveModelStage,
	openRouterReplyBody,
	readingFile,
	readJsonFile,
	resendPausesTimeoutMs,
	seedSlideImages,
	sentSystemMessage,
	sentUserContents,
	slideReadingReply,
	trackingInFlight,
	useCapturedStderr,
	useStubbedOpenRouter,
	useStubLogger,
	useTranscribedWorkspace,
} from "../../fixtures.js";
import { ResendsExhaustedError } from "../model-stage.js";
import { createReadSlidesStage, ReadSlidesError } from "./read-slides.js";

const STAGE_ID = "read-slides";

describe("createReadSlidesStage", () => {
	const workspace = useTranscribedWorkspace({ prefix: `${STAGE_ID}-` });
	const logged = useStubLogger();
	const config = configuringStage({ stageId: STAGE_ID });
	const { client, create } = useStubbedOpenRouter();

	beforeEach(() => {
		create().mockResolvedValue(
			openRouterReplyBody({ content: JSON.stringify(slideReadingReply()) }),
		);
	});

	/** Runs the stage on the prepared workspace, as the runner does. */
	function run(): ReturnType<typeof driveModelStage> {
		return driveModelStage({
			factory: createReadSlidesStage,
			client: client(),
			config,
			workspaceRoot: workspace().workspaceRoot,
			logger: logged().logger,
		});
	}

	it("should send the slide image alone, with no slide number and no transcript, when the stage reads a slide", async () => {
		const [image] = await seedSlideImages({ workspaceRoot: workspace().workspaceRoot, count: 1 });

		await run();

		expect(sentUserContents(create().mock.calls)).toStrictEqual([
			[
				{
					type: "image_url",
					image_url: { url: `data:image/png;base64,${image?.toString("base64")}` },
				},
			],
		]);
	});

	it("should include the language rule for the caption and the figure descriptions when the stage reads a slide", async () => {
		await seedSlideImages({ workspaceRoot: workspace().workspaceRoot, count: 1 });

		await run();

		expect(sentSystemMessage(create().mock.calls)).toContain(
			"The caption and the figure descriptions follow this language rule: Write in British English.",
		);
	});

	it("should write each reading with its slide number and the six fields of the reply when the reply is usable", async () => {
		await seedSlideImages({ workspaceRoot: workspace().workspaceRoot, count: 2 });

		const result = await run();

		expect(result.filesWritten).toStrictEqual([readingFile(1), readingFile(2)]);
		expect(await readJsonFile(join(workspace().workspaceRoot, readingFile(2)))).toStrictEqual({
			slideNumber: 2,
			...slideReadingReply(),
		});
	});

	describe("on a terminal", () => {
		const stderrText = useCapturedStderr({ isTerminal: true });

		it("should count each slide on the progress bar when the stage reads the slides", async () => {
			await seedSlideImages({ workspaceRoot: workspace().workspaceRoot, count: 2 });

			await run();

			expect(stderrText()).toMatch(/Slides .*2\/2/);
		});
	});

	it.each([
		{ problem: "is not the documented JSON object", reply: { caption: "A slide." } },
		{ problem: "gives an empty caption", reply: slideReadingReply({ caption: " " }) },
		{ problem: "gives an unknown kind", reply: slideReadingReply({ kind: "title" }) },
		{
			problem: "gives a figure of an unknown type",
			reply: slideReadingReply({ figures: [{ type: "picture", description: "A cell." }] }),
		},
	])("should resend the call and use the next reply when the reply $problem", async ({ reply }) => {
		await seedSlideImages({ workspaceRoot: workspace().workspaceRoot, count: 1 });
		create().mockResolvedValueOnce(openRouterReplyBody({ content: JSON.stringify(reply) }));

		await run();

		expect(create()).toHaveBeenCalledTimes(2);
		expect(await readJsonFile(join(workspace().workspaceRoot, readingFile(1)))).toStrictEqual({
			slideNumber: 1,
			...slideReadingReply(),
		});
	});

	it("should fail after the third send, and keep the readings already written, when a slide's reply is still unusable", {
		timeout: resendPausesTimeoutMs,
	}, async () => {
		const [, secondImage] = await seedSlideImages({
			workspaceRoot: workspace().workspaceRoot,
			count: 2,
		});
		const unusable = openRouterReplyBody({
			content: JSON.stringify(slideReadingReply({ caption: "" })),
		});
		const usable = openRouterReplyBody({ content: JSON.stringify(slideReadingReply()) });
		// The slides are read at the same time, so the reply follows the image and not the call order.
		create().mockImplementation((body) =>
			Promise.resolve(
				JSON.stringify(body).includes(secondImage?.toString("base64") ?? "") ? unusable : usable,
			),
		);

		const error = await captureError(run());

		expect(error).toBeInstanceOf(ResendsExhaustedError);
		expect(create()).toHaveBeenCalledTimes(4);
		expect(await pathExists(join(workspace().workspaceRoot, readingFile(1)))).toBe(true);
		expect(await pathExists(join(workspace().workspaceRoot, readingFile(2)))).toBe(false);
	});

	/** Writes the reading of slide 1 into the workspace, as an earlier invocation left it. */
	async function leaveReadingOfFirstSlide(contents: string): Promise<string> {
		const path = join(workspace().workspaceRoot, readingFile(1));
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, contents);
		return path;
	}

	it("should read only the slides that have no reading when the stage starts again", async () => {
		await seedSlideImages({ workspaceRoot: workspace().workspaceRoot, count: 2 });
		const earlier = { slideNumber: 1, ...slideReadingReply({ title: "Read earlier" }) };
		await leaveReadingOfFirstSlide(JSON.stringify(earlier));

		const result = await run();

		expect(create()).toHaveBeenCalledTimes(1);
		expect(result.output).toStrictEqual({
			readings: [earlier, { slideNumber: 2, ...slideReadingReply() }],
		});
	});

	it("should fail naming the file, without calling the model, when a saved reading holds no readable reading", async () => {
		await seedSlideImages({ workspaceRoot: workspace().workspaceRoot, count: 1 });
		const path = await leaveReadingOfFirstSlide(JSON.stringify({ slideNumber: 1 }));

		const error = await captureError(run());

		expect(error).toBeInstanceOf(ReadSlidesError);
		expect(error.message).toContain(path);
		expect(create()).not.toHaveBeenCalled();
	});

	it.each([
		{ problem: "are missing", count: null },
		{ problem: "are an empty folder", count: 0 },
	])("should fail naming the folder, without calling the model, when the slide images $problem", async ({
		count,
	}) => {
		if (count !== null) {
			await seedSlideImages({ workspaceRoot: workspace().workspaceRoot, count });
		}

		const error = await captureError(run());

		expect(error).toBeInstanceOf(ReadSlidesError);
		expect(error.message).toContain(join(workspace().workspaceRoot, "Slide images"));
		expect(create()).not.toHaveBeenCalled();
	});

	it("should have at most the configured number of calls in flight when the stage reads the slides", async () => {
		const limit = config.stages[STAGE_ID]?.concurrency ?? 1;
		await seedSlideImages({ workspaceRoot: workspace().workspaceRoot, count: limit + 2 });
		// Each of the first `limit` calls waits until all of them have arrived. Each
		// slide reads its image file before its call, so without this wait the calls
		// would not all overlap.
		let arrived = 0;
		let releaseAll: () => void = () => undefined;
		const allArrived = new Promise<void>((resolve) => {
			releaseAll = resolve;
		});
		const { tracked, peak } = trackingInFlight(async () => {
			arrived += 1;
			if (arrived === limit) {
				releaseAll();
			}
			if (arrived <= limit) {
				await allArrived;
			}
			return openRouterReplyBody({ content: JSON.stringify(slideReadingReply()) });
		});
		create().mockImplementation(tracked);

		await run();

		expect(peak()).toBe(limit);
	});
});
