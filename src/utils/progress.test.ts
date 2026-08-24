import { Transform } from "node:stream";
import { SingleBar } from "cli-progress";
import { describe, expect, it, vi } from "vitest";
import { createProgressBar, createUploadProgressStream } from "./progress.js";

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

describe("the upload bar's value display", () => {
	// Driven through the bar rather than by calling the formatter, because the
	// formatter is cli-progress's to call: what this suite has to show is that an
	// upload reports itself in megabytes, and that the percentage beside them is
	// left alone rather than being read as a byte count too.
	function renderUploadBar({
		uploaded,
		total,
	}: {
		readonly uploaded: number;
		readonly total: number;
	}): string {
		// A bar renders nothing off a terminal, so the stream is told it is one for
		// the duration of the render, exactly as the in-flight suffix's ANSI test does.
		const realIsTTY = process.stderr.isTTY;
		process.stderr.isTTY = true;
		const written: string[] = [];
		const writeSpy = vi
			.spyOn(process.stderr, "write")
			.mockImplementation((chunk: string | Uint8Array): boolean => {
				written.push(String(chunk));
				return true;
			});
		const { bar } = createUploadProgressStream(total);
		bar.start(total, uploaded);
		bar.stop();
		writeSpy.mockRestore();
		process.stderr.isTTY = realIsTTY;
		return written.join("");
	}

	it("should report the bytes moved and the upload's size in megabytes when the bar renders", () => {
		const rendered = renderUploadBar({ uploaded: 1_048_576, total: 2_621_440 });

		expect(rendered).toContain("1.0 MB");
		expect(rendered).toContain("2.5 MB");
	});

	it("should leave the percentage as a number when the bar renders", () => {
		const rendered = renderUploadBar({ uploaded: 1_048_576, total: 2_097_152 });

		expect(rendered).toContain("50%");
	});
});
