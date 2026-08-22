import { describe, expect, it, vi } from "vitest";
import { makeConfig, makeStubLogger, otherModuleRoot, testModuleRoot } from "./fixtures.js";
import { deriveRunId, PipelineRunner } from "./runner.js";

describe("deriveRunId", () => {
	it("should strip milliseconds and replace colons with hyphens when given a date", () => {
		expect(deriveRunId({ instant: new Date("2025-10-10T09:00:00.123Z") })).toBe(
			"2025-10-10T09-00-00Z",
		);
	});

	it("should produce a filename-safe id when the date is midnight", () => {
		expect(deriveRunId({ instant: new Date("2025-01-02T00:00:00.000Z") })).toBe(
			"2025-01-02T00-00-00Z",
		);
	});
});

describe("PipelineRunner.normaliseSources", () => {
	it("should invoke source normalisation once per module when normalising sources", async () => {
		const normaliseModule = vi.fn(async () => undefined);
		const runner = new PipelineRunner({
			config: makeConfig(),
			sourceNormalisation: { stageId: "source-normalisation", normaliseModule },
			lectureStages: [],
			logger: makeStubLogger().logger,
		});

		const moduleRoots = [testModuleRoot, otherModuleRoot];

		await runner.normaliseSources({ moduleRoots });

		expect(normaliseModule).toHaveBeenCalledTimes(moduleRoots.length);
		for (const moduleRoot of moduleRoots) {
			expect(normaliseModule).toHaveBeenCalledWith({ moduleRoot });
		}
	});
});
