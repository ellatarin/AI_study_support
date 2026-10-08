import { describe, expect, it } from "vitest";
import { makeConfig, openRouterModelId, openRouterStageConfig } from "../pipeline/fixtures.js";
import { CONFIG_FILENAME } from "../types/pipeline.js";
import { configuredStage, unconfiguredStageMessage } from "./stage-config.js";

describe("configuredStage", () => {
	it("should give the stage's configuration when the file configures it", () => {
		const stageConfig = openRouterStageConfig({ stageId: "judge-lecture-title" });
		const config = makeConfig({ stages: { "judge-lecture-title": stageConfig } });

		expect(configuredStage({ config, stageId: "judge-lecture-title" })).toEqual(stageConfig);
	});

	it("should give nothing when the file configures no such stage", () => {
		const config = makeConfig({
			stages: { "judge-lecture-title": { modelId: openRouterModelId } },
		});

		expect(configuredStage({ config, stageId: "place-slides" })).toBeNull();
	});
});

describe("unconfiguredStageMessage", () => {
	it("should name the stage and the file to edit when a stage is unconfigured", () => {
		const message = unconfiguredStageMessage({ stageId: "place-slides" });

		expect(message).toContain("place-slides");
		expect(message).toContain(CONFIG_FILENAME);
	});
});
