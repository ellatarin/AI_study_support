import { describe, expect, it } from "vitest";
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

		it("should describe every command when the usage text is read", () => {
			for (const command of ["run", "batch", "cost-report", "rename", "delete", "change-date"]) {
				expect(USAGE).toContain(command);
			}
		});
	});

	describe("run", () => {
		it("should address the lecture on the given date when run is invoked", () => {
			expect(parse(["run", "2025-10-10"])).toEqual({
				command: "run",
				lectureDate: "2025-10-10",
				options: {},
			});
		});

		it("should carry every run flag when they are all supplied", () => {
			expect(
				parse([
					"run",
					"2025-10-10",
					"--from-stage",
					"transcription",
					"--concurrency",
					"4",
					"--continue-on-error",
				]),
			).toEqual({
				command: "run",
				lectureDate: "2025-10-10",
				options: { fromStage: "transcription", concurrency: 4, continueOnError: true },
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
			const error = usageError(["run", "2025-10-10", "2025-10-17"]);

			expect(error).toBeInstanceOf(CliUsageError);
		});
	});

	describe("batch", () => {
		it("should target every configured module when no module is named", () => {
			expect(parse(["batch"])).toEqual({ command: "batch", moduleRoot: null, options: {} });
		});

		it("should target one module when a module root is named", () => {
			expect(parse(["batch", "/modules/Biology of Disease"])).toEqual({
				command: "batch",
				moduleRoot: "/modules/Biology of Disease",
				options: {},
			});
		});

		it("should carry the concurrency flag when it is supplied", () => {
			expect(parse(["batch", "--concurrency", "3"])).toEqual({
				command: "batch",
				moduleRoot: null,
				options: { concurrency: 3 },
			});
		});

		it("should reject the invocation when more than one module is named", () => {
			const error = usageError(["batch", "/modules/A", "/modules/B"]);

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
			expect(parse(["cost-report", "--date", "2025-10-10"])).toEqual({
				command: "cost-report",
				lectureDate: "2025-10-10",
				moduleRoot: null,
			});
		});

		it("should narrow to a module when --module is given", () => {
			expect(parse(["cost-report", "--module", "/modules/Immunology"])).toEqual({
				command: "cost-report",
				lectureDate: null,
				moduleRoot: "/modules/Immunology",
			});
		});

		it("should reject the invocation when --date is not a real date", () => {
			const error = usageError(["cost-report", "--date", "2025-99-99"]);

			expect(error).toBeInstanceOf(CliUsageError);
		});
	});

	describe("identity mutations", () => {
		it("should carry the new title when rename is invoked", () => {
			expect(parse(["rename", "2025-10-10", "Cell Injury and Death"])).toEqual({
				command: "rename",
				lectureDate: "2025-10-10",
				title: "Cell Injury and Death",
			});
		});

		it("should reject the invocation when rename is given no title", () => {
			const error = usageError(["rename", "2025-10-10"]);

			expect(error).toBeInstanceOf(CliUsageError);
			expect(error.message).toContain("rename");
		});

		it("should reject the invocation when the new title is blank", () => {
			const error = usageError(["rename", "2025-10-10", "   "]);

			expect(error).toBeInstanceOf(CliUsageError);
		});

		it("should address the lecture on the given date when delete is invoked", () => {
			expect(parse(["delete", "2025-10-10"])).toEqual({
				command: "delete",
				lectureDate: "2025-10-10",
			});
		});

		it("should carry both dates when change-date is invoked", () => {
			expect(parse(["change-date", "2025-10-10", "2025-10-24"])).toEqual({
				command: "change-date",
				lectureDate: "2025-10-10",
				newLectureDate: "2025-10-24",
			});
		});

		it("should reject the invocation when change-date is given only one date", () => {
			const error = usageError(["change-date", "2025-10-10"]);

			expect(error).toBeInstanceOf(CliUsageError);
			expect(error.message).toContain("change-date");
		});

		it("should reject the invocation when the new date is not a real date", () => {
			const error = usageError(["change-date", "2025-10-10", "not-a-date"]);

			expect(error).toBeInstanceOf(CliUsageError);
		});
	});

	describe("invalid invocations", () => {
		it("should reject the invocation when the command is unknown", () => {
			const error = usageError(["publish", "2025-10-10"]);

			expect(error).toBeInstanceOf(CliUsageError);
			expect(error.message).toContain("publish");
		});

		it("should reject the invocation when an option is unknown", () => {
			const error = usageError(["run", "2025-10-10", "--dry-run"]);

			expect(error).toBeInstanceOf(CliUsageError);
		});

		it("should reject the invocation when --from-stage names no known stage", () => {
			const error = usageError(["run", "2025-10-10", "--from-stage", "summarising"]);

			expect(error).toBeInstanceOf(CliUsageError);
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
	});
});
