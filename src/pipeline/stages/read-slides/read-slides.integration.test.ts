import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	configuringStage,
	driveModelStage,
	expectJsonModeRequest,
	openRouterClientFor,
	resetStubbedApi,
	seedSlideImages,
	slideReadingReply,
	stubModelReply,
	stubOpenRouterApi,
	useStubLogger,
	useTranscribedWorkspace,
} from "../../fixtures.js";
import { createReadSlidesStage } from "./read-slides.js";

const STAGE_ID = "read-slides";

describe("read-slides against the OpenRouter API", () => {
	const workspace = useTranscribedWorkspace({ prefix: `${STAGE_ID}-int-` });
	const logged = useStubLogger();

	beforeEach(() => {
		stubOpenRouterApi();
	});

	afterEach(() => {
		resetStubbedApi();
	});

	it("should send the slide image as image content in a JSON-mode request when the stage reads a slide", async () => {
		const [image] = await seedSlideImages({ workspaceRoot: workspace().workspaceRoot, count: 1 });
		const sentRequest = stubModelReply(slideReadingReply());

		const config = configuringStage({ stageId: STAGE_ID });
		await driveModelStage({
			factory: createReadSlidesStage,
			client: openRouterClientFor({ config }),
			config,
			workspaceRoot: workspace().workspaceRoot,
			logger: logged().logger,
		});

		expectJsonModeRequest(sentRequest());
		const [, userMessage] = sentRequest().messages as readonly { content: unknown }[];
		expect(userMessage?.content).toStrictEqual([
			{
				type: "image_url",
				image_url: { url: `data:image/png;base64,${image?.toString("base64")}` },
			},
		]);
	});
});
