import { describe, expect, it, vi } from "vitest";
import { makeConfig, makeStubLogger, otherModuleRoot, testModuleRoot } from "./fixtures.js";
import { deriveRunId, PipelineRunner } from "./runner.js";

describe("deriveRunId", () => {
	it.each([
		{
			scenario: "the instant carries milliseconds",
			instant: "2025-10-10T09:00:00.123Z",
			expected: "2025-10-10T09-00-00Z",
		},
		{
			scenario: "the instant is midnight",
			instant: "2025-01-02T00:00:00.000Z",
			expected: "2025-01-02T00-00-00Z",
		},
	])("should strip milliseconds and replace colons with hyphens when $scenario", ({
		instant,
		expected,
	}) => {
		expect(deriveRunId({ instant: new Date(instant) })).toBe(expected);
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
			// Normalising sources runs no stage, so this test has nothing to report.
			reporter: () => undefined,
		});

		const moduleRoots = [testModuleRoot, otherModuleRoot];

		await runner.normaliseSources({ moduleRoots });

		expect(normaliseModule).toHaveBeenCalledTimes(moduleRoots.length);
		for (const moduleRoot of moduleRoots) {
			expect(normaliseModule).toHaveBeenCalledWith({ moduleRoot });
		}
	});
});
