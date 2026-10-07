import { readFileSync } from "node:fs";
import { join } from "node:path";
import { destination, pino } from "pino";
import { describe, expect, it } from "vitest";
import { useTempDir } from "../pipeline/fixtures.js";
import { createDebugLogger, createStageLogger } from "./logger.js";

describe("logger", () => {
	const tempDir = useTempDir({ prefix: "logger-" });

	describe("createDebugLogger", () => {
		it("should hold every entry in the debug log file when the debug log is closed", async () => {
			// The caller gives the whole path. So the debug log goes where the caller
			// says, not into the working directory. Its directory need not exist.
			const debugLogFile = join(tempDir(), "debug-logs", "2025-10-10T09-00-00-000Z-debug.log");

			const { logger, close } = createDebugLogger({ debugLogFile });
			logger.info("pipeline started");
			await close();

			const [firstLine = ""] = readFileSync(debugLogFile, "utf8").trim().split("\n");
			const entry = JSON.parse(firstLine);

			expect(entry.msg).toBe("pipeline started");
			expect(entry.level).toBe(30);
		});
	});

	describe("createStageLogger", () => {
		it("should bind the stage id to every entry when a stage logger logs", () => {
			const capturePath = join(tempDir(), "capture.log");
			const logger = pino({ level: "debug" }, destination({ dest: capturePath, sync: true }));

			const stageLogger = createStageLogger({ logger, stageId: "transcription" });
			stageLogger.info("structuring complete");

			const entry = JSON.parse(readFileSync(capturePath, "utf8").trim());
			expect(entry.stage).toBe("transcription");
			expect(entry.msg).toBe("structuring complete");
		});
	});
});
