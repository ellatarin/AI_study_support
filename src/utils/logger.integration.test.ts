import { readFileSync } from "node:fs";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { destination, pino } from "pino";
import { describe, expect, it } from "vitest";
import { useTempDir } from "../pipeline/fixtures.js";
import { createDebugLogger, createStageLogger } from "./logger.js";

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForFile(target: string): Promise<void> {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		try {
			await access(target);
			return;
		} catch {
			await delay(20);
		}
	}
	throw new Error(`Timed out waiting for ${target}`);
}

describe("logger", () => {
	const tempDir = useTempDir({ prefix: "logger-" });

	describe("createDebugLogger", () => {
		it("should write a JSON debug log at the given path when the debug logger logs", async () => {
			// The whole path is a parameter, so the debug log lands where the caller
			// says rather than relative to the working directory, and the directory it
			// names is created rather than having to exist.
			const debugLogFile = join(tempDir(), "debug-logs", "2025-10-10T09-00-00-000Z-debug.log");

			const logger = createDebugLogger({ debugLogFile });
			logger.info("pipeline started");
			logger.flush();

			await waitForFile(debugLogFile);
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
