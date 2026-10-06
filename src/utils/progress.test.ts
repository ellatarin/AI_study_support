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
	it("should pass bytes through unchanged and advance the progress bar when data flows", async () => {
		const { stream, progressBar } = createUploadProgressStream(10);
		expect(stream).toBeInstanceOf(Transform);
		const updateSpy = vi.spyOn(progressBar, "update");

		const received: Buffer[] = [];
		stream.on("data", (chunk: Buffer) => received.push(chunk));
		const finished = new Promise<void>((resolve) => stream.on("end", () => resolve()));
		stream.end(Buffer.from("hello"));
		await finished;

		expect(Buffer.concat(received).toString()).toBe("hello");
		expect(updateSpy).toHaveBeenCalledWith(5);
		progressBar.stop();
	});
});

describe("the upload progress bar's value display", () => {
	// These tests render the progress bar and do not call the formatter, because
	// cli-progress calls the formatter. They show that an upload shows megabytes,
	// and that the percentage is not read as a byte count.
	function renderUploadProgressBar({
		uploaded,
		total,
	}: {
		readonly uploaded: number;
		readonly total: number;
	}): string {
		// A progress bar renders nothing when the stream is not a terminal. So the
		// stream claims to be a terminal while the progress bar renders.
		const realIsTTY = process.stderr.isTTY;
		process.stderr.isTTY = true;
		const written: string[] = [];
		const writeSpy = vi
			.spyOn(process.stderr, "write")
			.mockImplementation((chunk: string | Uint8Array): boolean => {
				written.push(String(chunk));
				return true;
			});
		const { progressBar } = createUploadProgressStream(total);
		progressBar.start(total, uploaded);
		progressBar.stop();
		writeSpy.mockRestore();
		process.stderr.isTTY = realIsTTY;
		return written.join("");
	}

	it("should report the bytes moved and the upload's size in megabytes when the progress bar renders", () => {
		const rendered = renderUploadProgressBar({ uploaded: 1_048_576, total: 2_621_440 });

		expect(rendered).toContain("1.0 MB");
		expect(rendered).toContain("2.5 MB");
	});

	it("should leave the percentage as a number when the progress bar renders", () => {
		const rendered = renderUploadProgressBar({ uploaded: 1_048_576, total: 2_097_152 });

		expect(rendered).toContain("50%");
	});
});
