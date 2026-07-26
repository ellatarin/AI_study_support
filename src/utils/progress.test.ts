import { Transform } from "node:stream";
import { SingleBar, type ValueType } from "cli-progress";
import { describe, expect, it, vi } from "vitest";
import {
	createParallelWorkBar,
	createProgressBar,
	createUploadProgressStream,
	formatUploadValue,
} from "./progress.js";

describe("createProgressBar", () => {
	it("should return a configured SingleBar when only a format is given", () => {
		expect(createProgressBar({ format: "Task |{bar}| {percentage}%" })).toBeInstanceOf(SingleBar);
	});

	it("should return a SingleBar when a value formatter is also provided", () => {
		const bar = createProgressBar({
			format: "Task |{bar}| {value}",
			formatValue: (value, _options, type) => (type === "value" ? `${value}b` : String(value)),
		});

		expect(bar).toBeInstanceOf(SingleBar);
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

	it("should start the bar with an empty in-flight suffix when started", () => {
		const work = createParallelWorkBar({ label, total: 24 });
		const startSpy = vi.spyOn(work.bar, "start");

		work.start();

		expect(startSpy).toHaveBeenCalledWith(24, 0, { label, inFlight: "" });
	});

	it("should list picked ids in the in-flight suffix when workers pick up items", () => {
		const work = createParallelWorkBar({ label, total: 24 });
		work.start();
		const updateSpy = vi.spyOn(work.bar, "update");

		work.pick(16);
		work.pick(17);

		expect(updateSpy).toHaveBeenLastCalledWith(0, { label, inFlight: "16, 17" });
	});

	it("should advance the value and drop the id from in-flight when an item completes", () => {
		const work = createParallelWorkBar({ label, total: 24 });
		work.start();
		work.pick(16);
		work.pick(17);
		const updateSpy = vi.spyOn(work.bar, "update");

		work.complete(16);

		expect(updateSpy).toHaveBeenLastCalledWith(1, { label, inFlight: "17" });
	});

	it("should highlight the id with a red control sequence when an item fails", () => {
		const work = createParallelWorkBar({ label, total: 24 });
		work.start();
		work.pick(16);
		const updateSpy = vi.spyOn(work.bar, "update");

		work.fail(16);

		const lastCall = updateSpy.mock.lastCall as unknown as readonly [
			number,
			{ readonly inFlight: string },
		];
		expect(lastCall[1].inFlight).toContain("16");
		expect(lastCall[1].inFlight).toContain(String.fromCharCode(27));
	});

	it("should stop the underlying bar when stopped", () => {
		const work = createParallelWorkBar({ label, total: 24 });
		work.start();
		const stopSpy = vi.spyOn(work.bar, "stop");

		work.stop();

		expect(stopSpy).toHaveBeenCalled();
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
