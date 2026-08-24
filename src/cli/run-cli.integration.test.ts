import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	corruptJson,
	makeConfig,
	makeTempDir,
	testLecture,
	testModuleName,
} from "../pipeline/fixtures.js";
import { moduleDirs, RUNS_DIR } from "../pipeline/layout.js";
import { CONFIG_FILENAME } from "../types/pipeline.js";
import { listFileNames } from "../utils/files.js";
import { runCli } from "./run-cli.js";

describe("runCli", () => {
	let projectRoot: string;
	let moduleRoot: string;
	let out: string[];
	let errors: string[];

	function invoke(argv: readonly string[]): Promise<number> {
		return runCli({
			argv,
			projectRoot,
			write: (text: string) => {
				out.push(text);
			},
			writeError: (text: string) => {
				errors.push(text);
			},
		});
	}

	async function writeConfig(moduleRoots: readonly string[]): Promise<void> {
		await writeFile(
			join(projectRoot, CONFIG_FILENAME),
			JSON.stringify(makeConfig({ moduleRoots })),
		);
	}

	beforeEach(async () => {
		projectRoot = await makeTempDir({ prefix: "run-cli-" });
		moduleRoot = join(projectRoot, testModuleName);
		const { video, slide } = moduleDirs({ moduleRoot });
		for (const dir of [video, slide]) {
			await mkdir(dir, { recursive: true });
		}
		out = [];
		errors = [];
	});

	afterEach(async () => {
		await rm(projectRoot, { recursive: true, force: true });
	});

	it("should print the usage text without reading the config when help is asked for", async () => {
		const code = await invoke(["--help"]);

		expect(code).toBe(0);
		expect(out.join("")).toContain("lecture-notes run <date>");
		expect(errors).toEqual([]);
	});

	it("should print usage and fail when the command line cannot be understood", async () => {
		const code = await invoke(["publish"]);

		expect(code).toBe(1);
		expect(errors.join("")).toContain("publish");
		expect(out.join("")).toContain("Usage:");
	});

	it("should report the problem plainly and fail when the config cannot be read", async () => {
		const code = await invoke(["cost-report"]);

		expect(code).toBe(1);
		expect(errors.join("")).toContain(CONFIG_FILENAME);
		expect(errors.join("")).not.toContain("    at ");
	});

	it("should report the problem plainly and fail when the config is malformed", async () => {
		await writeFile(join(projectRoot, CONFIG_FILENAME), corruptJson);

		const code = await invoke(["cost-report"]);

		expect(code).toBe(1);
		expect(errors.join("")).toContain("not valid JSON");
	});

	it("should report on the configured modules when a cost report is asked for", async () => {
		await writeConfig([moduleRoot]);

		const code = await invoke(["cost-report"]);

		expect(code).toBe(0);
		expect(errors).toEqual([]);
	});

	it("should normalise the module and report no match when the date names no lecture", async () => {
		await writeConfig([moduleRoot]);

		const code = await invoke(["run", testLecture.date]);

		expect(code).toBe(1);
		expect(out.join("")).toContain(testLecture.date);
	});

	// The suite never changes directory, so this fails if the log is placed
	// relative to wherever the process happens to be running — which would
	// scatter a user's logs across whatever directory they invoked from.
	it("should write the debug log under the project root when a command runs", async () => {
		await writeConfig([moduleRoot]);

		await invoke(["run", testLecture.date]);

		const logs = await listFileNames(join(projectRoot, RUNS_DIR));
		expect(logs.filter((name) => name.endsWith("-debug.log"))).toHaveLength(1);
	});
});
