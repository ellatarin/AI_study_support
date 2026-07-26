import { readFileSync } from "node:fs";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { destination, pino } from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
		tempDir = await mkdtemp(join(tmpdir(), "logger-"));
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	describe("createRootLogger", () => {
		it("should write a JSON debug log to runs/<timestamp> when the root logger logs", async () => {
			const runTimestamp = "2025-10-10T09-00-00-000Z";
			const originalCwd = process.cwd();
			process.chdir(tempDir);

			try {
				const logger = createRootLogger({ runTimestamp });
				logger.info("pipeline started");
				logger.flush();

				const logPath = join(tempDir, "runs", `${runTimestamp}-debug.log`);
				await waitForFile(logPath);
				const [firstLine] = readFileSync(logPath, "utf8").trim().split("\n");
				const entry = JSON.parse(firstLine);

				expect(entry.msg).toBe("pipeline started");
				expect(entry.level).toBe(30);
			} finally {
				process.chdir(originalCwd);
			}
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
