import { Transform } from "node:stream";
import { SingleBar, type ValueType } from "cli-progress";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createParallelWorkBar,
	createProgressBar,
	createUploadProgressStream,
	formatUploadValue,
	type ParallelWorkBar,
} from "./progress.js";

/**
 * ESC control character, built at runtime so no literal control byte enters this file.
 *
 * Written out here rather than shared with the module under test: the expectation
 * states the escape sequence a terminal should receive, and deriving it from the
 * code that produces it would assert that code against itself.
 */
const ESC = String.fromCharCode(27);

describe("createProgressBar", () => {
	const barCases: readonly {
		readonly scenario: string;
		readonly options: Parameters<typeof createProgressBar>[0];
	}[] = [
		{ scenario: "only a format is given", options: { format: "Task |{bar}| {percentage}%" } },
		{
			scenario: "a value formatter is also provided",
			options: {
				format: "Task |{bar}| {value}",
				formatValue: (value, _options, type) => (type === "value" ? `${value}b` : String(value)),
			},
		},
	];

	it.each(barCases)("should return a configured SingleBar when $scenario", ({ options }) => {
		expect(createProgressBar(options)).toBeInstanceOf(SingleBar);
	});
});

describe("createUploadProgressStream", () => {
	it("should pass bytes through unchanged and advance the bar when data flows", async () => {
		const { stream, bar } = createUploadProgressStream(10);
		expect(stream).toBeInstanceOf(Transform);
		const updateSpy = vi.spyOn(bar, "update");

		const received: Buffer[] = [];
		stream.on("data", (chunk: Buffer) => received.push(chunk));
		const finished = new Promise<void>((resolve) => stream.on("end", () => resolve()));
		stream.end(Buffer.from("hello"));
		await finished;

		expect(Buffer.concat(received).toString()).toBe("hello");
		expect(updateSpy).toHaveBeenCalledWith(5);
		bar.stop();
	});
});

describe("createParallelWorkBar", () => {
	const label = "Slide conversion";
	/** The item count every bar in this suite is built for, and the total `start` is asserted to carry. */
	const TOTAL_ITEMS = 24;
	/** Two item ids, named in the order the in-flight suffix lists them. */
	const FIRST_PICKED = 16;
	const SECOND_PICKED = 17;
	let realIsTTY: boolean;
	let work: ParallelWorkBar;

	beforeEach(() => {
		realIsTTY = process.stderr.isTTY;
		work = createParallelWorkBar({ label, total: TOTAL_ITEMS });
	});

	afterEach(() => {
		process.stderr.isTTY = realIsTTY;
	});

	it("should start the bar with an empty in-flight suffix when started", () => {
		const startSpy = vi.spyOn(work.bar, "start");

		work.start();

		expect(startSpy).toHaveBeenCalledWith(TOTAL_ITEMS, 0, { label, inFlight: "" });
	});

	describe("once started", () => {
		beforeEach(() => {
			work.start();
		});

		it("should list picked ids in the in-flight suffix when workers pick up items", () => {
			const updateSpy = vi.spyOn(work.bar, "update");

			work.pick(FIRST_PICKED);
			work.pick(SECOND_PICKED);

			expect(updateSpy).toHaveBeenLastCalledWith(0, {
				label,
				inFlight: `${FIRST_PICKED}, ${SECOND_PICKED}`,
			});
		});

		it("should advance the value and drop the id from in-flight when an item completes", () => {
			work.pick(FIRST_PICKED);
			work.pick(SECOND_PICKED);
			const updateSpy = vi.spyOn(work.bar, "update");

			work.complete(FIRST_PICKED);

			expect(updateSpy).toHaveBeenLastCalledWith(1, { label, inFlight: String(SECOND_PICKED) });
		});

		const failureCases: readonly {
			readonly renders: string;
			readonly outputIs: string;
			readonly isTTY: boolean;
			readonly expected: string;
		}[] = [
			{
				renders: "in red",
				outputIs: "a terminal",
				isTTY: true,
				expected: `${ESC}[31m${FIRST_PICKED}${ESC}[0m`,
			},
			{
				renders: "plainly",
				outputIs: "a captured log",
				isTTY: false,
				expected: String(FIRST_PICKED),
			},
		];

		it.each(failureCases)("should render a failed id $renders when the output is $outputIs", ({
			isTTY,
			expected,
		}) => {
			process.stderr.isTTY = isTTY;
			work.pick(FIRST_PICKED);
			const updateSpy = vi.spyOn(work.bar, "update");

			work.fail(FIRST_PICKED);

			const lastCall = updateSpy.mock.lastCall as unknown as readonly [
				number,
				{ readonly inFlight: string },
			];
			expect(lastCall[1].inFlight).toBe(expected);
		});

		it("should stop the underlying bar when stopped", () => {
			const stopSpy = vi.spyOn(work.bar, "stop");

			work.stop();

			expect(stopSpy).toHaveBeenCalled();
		});
	});
});

describe("formatUploadValue", () => {
	const byteCases: readonly { type: ValueType; input: number; expected: string }[] = [
		{ type: "value", input: 1_048_576, expected: "1.0 MB" },
		{ type: "total", input: 2_621_440, expected: "2.5 MB" },
	];

	it.each(byteCases)("should render bytes as MB when the token is $type", ({
		type,
		input,
		expected,
	}) => {
		expect(formatUploadValue(input, {}, type)).toBe(expected);
	});

	it("should stringify the value unchanged when the token is not a byte column", () => {
		expect(formatUploadValue(42, {}, "percentage")).toBe("42");
	});
});
