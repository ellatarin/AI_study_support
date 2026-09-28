import { describe, expect, it } from "vitest";
import { gateHookOutput, summariseGate } from "./gate-summary.mjs";

// The closing lines of a real `pnpm run --silent check:tests` run, as the
// pre-commit hook captures it, each named so a test can take one away.
const FILES_LINE = " Test Files  50 passed (50)";
const TESTS_LINE = "      Tests  910 passed (910)";
const COVERAGE_HEADER =
	"File               | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s ";
const COVERAGE_TOTALS =
	"All files          |   99.42 |    97.58 |   99.53 |    99.4 |                   ";
const PASSING_RUN = [FILES_LINE, TESTS_LINE, COVERAGE_HEADER, COVERAGE_TOTALS].join("\n");

describe("summariseGate", () => {
	it("should give the test count, file count and line coverage when the run reports them", () => {
		expect(summariseGate({ testOutput: PASSING_RUN })).toBe(
			"Gate passed: 910 tests in 50 files, 99.4% line coverage; secrets, format, types, lint and duplication clean.",
		);
	});

	it.each([
		{ missing: "the test counts", line: TESTS_LINE },
		{ missing: "the file count", line: FILES_LINE },
		{ missing: "the coverage table", line: COVERAGE_TOTALS },
	])("should say the counts were not found when the run's output lacks $missing", ({ line }) => {
		const testOutput = PASSING_RUN.replace(line, "");
		expect(summariseGate({ testOutput })).toBe(
			"Gate passed, but the test run's closing summary was not found in its output, so no counts are given; secrets, format, types, lint and duplication clean.",
		);
	});
});

describe("gateHookOutput", () => {
	const summary = "Gate passed: 910 tests in 50 files.";

	// Compared whole, so a `permissionDecision` creeping in fails here: "allow"
	// would skip the permission prompt for the commit, which reporting must never do.
	it("should show the summary to the user and to Claude when the gate passed", () => {
		expect(JSON.parse(gateHookOutput({ summary }))).toEqual({
			systemMessage: summary,
			hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: summary },
		});
	});
});
