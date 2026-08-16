import { readFileSync } from "node:fs";
import { access, rm } from "node:fs/promises";
import { join } from "node:path";
import { destination, pino } from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTempDir } from "../pipeline/fixtures.js";
import { createRootLogger, createStageLogger } from "./logger.js";

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
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await makeTempDir({ prefix: "logger-" });
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	describe("createRootLogger", () => {
		it("should write a JSON debug log named for the timestamp when the root logger logs", async () => {
			const runTimestamp = "2025-10-10T09-00-00-000Z";
			// The directory is a parameter, so the log lands where the test says rather
			// than relative to the working directory — no chdir needed to contain it.
			const runsDir = join(tempDir, "runs");

			const logger = createRootLogger({ runTimestamp, runsDir });
			logger.info("pipeline started");
			logger.flush();

			const logPath = join(runsDir, `${runTimestamp}-debug.log`);
			await waitForFile(logPath);
			// split always yields at least one element, so the default only stands in
			// for an empty log — which JSON.parse then rejects, as it should.
			const [firstLine = ""] = readFileSync(logPath, "utf8").trim().split("\n");
			const entry = JSON.parse(firstLine);

			expect(entry.msg).toBe("pipeline started");
			expect(entry.level).toBe(30);
		});
	});

	describe("createStageLogger", () => {
		it("should bind the stage id to every entry when a stage logger logs", () => {
			const logPath = join(tempDir, "capture.log");
			const logger = pino({ level: "debug" }, destination({ dest: logPath, sync: true }));

			const stageLogger = createStageLogger({ logger, stageId: "transcription" });
			stageLogger.info("structuring complete");

			const entry = JSON.parse(readFileSync(logPath, "utf8").trim());
			expect(entry.stage).toBe("transcription");
			expect(entry.msg).toBe("structuring complete");
		});
	});
});
