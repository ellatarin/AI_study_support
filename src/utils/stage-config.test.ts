import { describe, expect, it } from "vitest";
import { makeConfig, openRouterModelId, openRouterStageConfig } from "../pipeline/fixtures.js";
import { CONFIG_FILENAME } from "../types/pipeline.js";
import { configuredStage, unconfiguredStageMessage } from "./stage-config.js";

describe("configuredStage", () => {
	it("should give the stage's configuration when the file configures it", () => {
		const stageConfig = openRouterStageConfig({ stageId: "transcript-structuring" });
		const config = makeConfig({ stages: { "transcript-structuring": stageConfig } });

		expect(configuredStage({ config, stageId: "transcript-structuring" })).toEqual(stageConfig);
	});

	it("should give nothing when the file configures no such stage", () => {
		const config = makeConfig({
			stages: { "transcript-structuring": { modelId: openRouterModelId } },
		});

		expect(configuredStage({ config, stageId: "synthesis" })).toBeNull();
	});
});

describe("unconfiguredStageMessage", () => {
	it("should name the stage and the file to edit when a stage is unconfigured", () => {
		const message = unconfiguredStageMessage({ stageId: "synthesis" });

		expect(message).toContain("synthesis");
		expect(message).toContain(CONFIG_FILENAME);
	});
});
