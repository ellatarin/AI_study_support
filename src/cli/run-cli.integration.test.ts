import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONFIG_FILENAME } from "../pipeline/config.js";
import {
	corruptJson,
	makeConfig,
	makeTempDir,
	testLecture,
	testModuleName,
} from "../pipeline/fixtures.js";
import { moduleDirs } from "../pipeline/layout.js";
import { runCli } from "./run-cli.js";

describe("runCli", () => {
	let projectRoot: string;
	let moduleRoot: string;
	let previousCwd: string;
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
		// The debug log is written relative to the working directory, so the suite
		// runs from the temporary project rather than scattering logs in the repo.
		previousCwd = process.cwd();
		process.chdir(projectRoot);
		const { video, slide } = moduleDirs({ moduleRoot });
		for (const dir of [video, slide]) {
			await mkdir(dir, { recursive: true });
		}
		out = [];
		errors = [];
	});

	afterEach(async () => {
		process.chdir(previousCwd);
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
		expect(errors.join("")).toContain("pipeline-config.json");
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
});
