import { describe, expect, it } from "vitest";
import {
	changedDate,
	otherLecture,
	otherModuleRoot,
	testLecture,
	testModuleRoot,
	userChosenTitle,
} from "../pipeline/fixtures.js";
import { DEFAULT_BATCH_OPTIONS, DEFAULT_RUN_OPTIONS } from "../types/pipeline.js";
import { type CliCommand, CliUsageError, parseCliArgs, USAGE } from "./args.js";

function parse(argv: readonly string[]): CliCommand {
	return parseCliArgs({ argv });
}

/**
 * Parsing is synchronous, so the rejection helper the async modules use does not
 * apply: this captures the throw directly and fails loudly if there was none.
 */
function usageError(argv: readonly string[]): Error {
	try {
		parseCliArgs({ argv });
	} catch (error: unknown) {
		return error as Error;
	}
	throw new Error(`Expected "${argv.join(" ")}" to be rejected, but it parsed`);
}

describe("parseCliArgs", () => {
	describe("help", () => {
		it.each([
			{ scenario: "no arguments are given", argv: [] },
			{ scenario: "--help is given", argv: ["--help"] },
			{ scenario: "-h is given", argv: ["-h"] },
			{ scenario: "help follows a command", argv: ["run", "--help"] },
		])("should ask for the usage text when $scenario", ({ argv }) => {
			expect(parse(argv)).toEqual({ command: "help" });
		});

		// The command words are written out here, not taken from the table the usage
		// text is rendered from: what this asserts is the vocabulary a user types, and
		// reading it off that table would check the renderer against its own input.
		// The same call as the expected paths in files.test.ts.
		it.each([
			"run",
			"batch",
			"cost-report",
			"rename",
			"delete",
			"change-date",
		])("should describe %s when the usage text is read", (command) => {
			expect(USAGE).toContain(command);
		});
	});

	describe("run", () => {
		it("should address the lecture on the given date when run is invoked", () => {
			expect(parse(["run", testLecture.date])).toEqual({
				command: "run",
				lectureDate: testLecture.date,
				options: DEFAULT_RUN_OPTIONS,
			});
		});

		it("should carry every flag run takes when they are all supplied", () => {
			expect(
				parse(["run", testLecture.date, "--from-stage", "transcription", "--continue-on-error"]),
			).toEqual({
				command: "run",
				lectureDate: testLecture.date,
				options: { fromStage: "transcription", onStageFailure: "continue" },
			});
		});

		it("should reject the invocation when no date is given", () => {
			const error = usageError(["run"]);

			expect(error).toBeInstanceOf(CliUsageError);
			expect(error.message).toContain("run <date>");
		});

		it.each([
			{ scenario: "the date is not ISO formatted", date: "10-10-2025" },
			{ scenario: "the date names an impossible month", date: "2025-13-01" },
			{ scenario: "the date names a day the month does not have", date: "2025-02-30" },
			{ scenario: "the date is a word", date: "yesterday" },
		])("should reject the invocation when $scenario", ({ date }) => {
			const error = usageError(["run", date]);

			expect(error).toBeInstanceOf(CliUsageError);
			expect(error.message).toContain(date);
		});

		it("should reject the invocation when more than one date is given", () => {
			const error = usageError(["run", testLecture.date, otherLecture.date]);

			expect(error).toBeInstanceOf(CliUsageError);
		});
	});

	describe("batch", () => {
		it("should target every configured module when no module is named", () => {
			expect(parse(["batch"])).toEqual({
				command: "batch",
				moduleRoot: null,
				options: DEFAULT_BATCH_OPTIONS,
			});
		});

		it("should target one module when a module root is named", () => {
			expect(parse(["batch", testModuleRoot])).toEqual({
				command: "batch",
				moduleRoot: testModuleRoot,
				options: DEFAULT_BATCH_OPTIONS,
			});
		});

		it("should carry every flag batch takes when they are all supplied", () => {
			expect(
				parse([
					"batch",
					"--concurrency",
					"3",
					"--from-stage",
					"transcription",
					"--continue-on-error",
				]),
			).toEqual({
				command: "batch",
				moduleRoot: null,
				options: { fromStage: "transcription", concurrency: 3, onStageFailure: "continue" },
			});
		});

		it("should reject the invocation when more than one module is named", () => {
			const error = usageError(["batch", testModuleRoot, otherModuleRoot]);

			expect(error).toBeInstanceOf(CliUsageError);
		});
	});

	describe("cost-report", () => {
		it("should report across everything when no narrowing flag is given", () => {
			expect(parse(["cost-report"])).toEqual({
				command: "cost-report",
				lectureDate: null,
				moduleRoot: null,
			});
		});

		it("should narrow to a date when --date is given", () => {
			expect(parse(["cost-report", "--date", testLecture.date])).toEqual({
				command: "cost-report",
				lectureDate: testLecture.date,
				moduleRoot: null,
			});
		});

		it("should narrow to a module when --module is given", () => {
			expect(parse(["cost-report", "--module", otherModuleRoot])).toEqual({
				command: "cost-report",
				lectureDate: null,
				moduleRoot: otherModuleRoot,
			});
		});

		it("should reject the invocation when --date is not a real date", () => {
			const error = usageError(["cost-report", "--date", "2025-99-99"]);

			expect(error).toBeInstanceOf(CliUsageError);
		});
	});

	describe("identity mutations", () => {
		it("should carry the new title when rename is invoked", () => {
			expect(parse(["rename", testLecture.date, userChosenTitle])).toEqual({
				command: "rename",
				lectureDate: testLecture.date,
				title: userChosenTitle,
			});
		});

		it("should reject the invocation when rename is given no title", () => {
			const error = usageError(["rename", testLecture.date]);

			expect(error).toBeInstanceOf(CliUsageError);
			expect(error.message).toContain("rename");
		});

		it("should reject the invocation when the new title is blank", () => {
			const error = usageError(["rename", testLecture.date, "   "]);

			expect(error).toBeInstanceOf(CliUsageError);
		});

		it("should address the lecture on the given date when delete is invoked", () => {
			expect(parse(["delete", testLecture.date])).toEqual({
				command: "delete",
				lectureDate: testLecture.date,
			});
		});

		it("should carry both dates when change-date is invoked", () => {
			expect(parse(["change-date", testLecture.date, changedDate])).toEqual({
				command: "change-date",
				lectureDate: testLecture.date,
				newLectureDate: changedDate,
			});
		});

		it("should reject the invocation when change-date is given only one date", () => {
			const error = usageError(["change-date", testLecture.date]);

			expect(error).toBeInstanceOf(CliUsageError);
			expect(error.message).toContain("change-date");
		});

		it("should reject the invocation when the new date is not a real date", () => {
			const error = usageError(["change-date", testLecture.date, "not-a-date"]);

			expect(error).toBeInstanceOf(CliUsageError);
		});
	});

	describe("invalid invocations", () => {
		it("should reject the invocation when the command is unknown", () => {
			const error = usageError(["publish", testLecture.date]);

			expect(error).toBeInstanceOf(CliUsageError);
			expect(error.message).toContain("publish");
		});

		it("should reject the invocation when an option is unknown", () => {
			const error = usageError(["run", testLecture.date, "--dry-run"]);

			expect(error).toBeInstanceOf(CliUsageError);
		});

		it("should reject the invocation when --from-stage names no known stage", () => {
			const error = usageError(["run", testLecture.date, "--from-stage", "summarising"]);

			expect(error).toBeInstanceOf(CliUsageError);
			expect(error.message).toContain("--from-stage");
			expect(error.message).toContain("summarising");
		});

		it.each([
			{ scenario: "it is not a number", value: "many" },
			{ scenario: "it is zero", value: "0" },
			{ scenario: "it is negative", value: "-2" },
			{ scenario: "it is fractional", value: "1.5" },
		])("should reject --concurrency when $scenario", ({ value }) => {
			const error = usageError(["batch", "--concurrency", value]);

			expect(error).toBeInstanceOf(CliUsageError);
			expect(error.message).toContain("concurrency");
		});

		it.each([
			// --concurrency counts lectures running at once, and only batch runs more than one.
			{ flag: "--concurrency", argv: ["run", testLecture.date, "--concurrency", "4"] },
			{ flag: "--date", argv: ["run", testLecture.date, "--date", otherLecture.date] },
			{ flag: "--module", argv: ["batch", "--module", otherModuleRoot] },
			{
				flag: "--from-stage",
				argv: ["rename", testLecture.date, "Title", "--from-stage", "synthesis"],
			},
			{ flag: "--continue-on-error", argv: ["cost-report", "--continue-on-error"] },
			{ flag: "--concurrency", argv: ["delete", testLecture.date, "--concurrency", "2"] },
		])("should reject $flag when the command does not take it", ({ flag, argv }) => {
			const error = usageError(argv);

			expect(error).toBeInstanceOf(CliUsageError);
			expect(error.message).toContain(flag);
			expect(error.message).toContain(argv[0] as string);
		});

		it("should name the options a command does take when one is rejected", () => {
			const error = usageError(["run", testLecture.date, "--concurrency", "4"]);

			expect(error.message).toContain("--from-stage");
			expect(error.message).toContain("--continue-on-error");
		});

		it("should say a command takes no options when one is rejected", () => {
			const error = usageError(["delete", testLecture.date, "--concurrency", "2"]);

			expect(error.message).toContain("no options");
		});

		it("should still answer with usage when help is asked of a command taking no options", () => {
			expect(parse(["delete", "--help"])).toEqual({ command: "help" });
		});
	});
});
