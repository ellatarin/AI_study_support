import { Transform } from "node:stream";
import { SingleBar } from "cli-progress";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { inRed, useCapturedStderr } from "../pipeline/fixtures.js";
import {
	createParallelWorkBar,
	createProgressBar,
	createUploadProgressStream,
	type ParallelWorkBar,
} from "./progress.js";

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
	const stderrText = useCapturedStderr({ isTerminal: true });

	function renderUploadProgressBar({
		uploaded,
		total,
	}: {
		readonly uploaded: number;
		readonly total: number;
	}): string {
		const { progressBar } = createUploadProgressStream(total);
		progressBar.start(total, uploaded);
		progressBar.stop();
		return stderrText();
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

describe("createParallelWorkBar", () => {
	const LABEL = "Slides";
	const TOTAL_ITEMS = 24;
	/** Two item numbers, in the order that the list of items in flight shows them. */
	const FIRST_PICKED = 16;
	const SECOND_PICKED = 17;

	describe("on a terminal", () => {
		const stderrText = useCapturedStderr({ isTerminal: true });
		let work: ParallelWorkBar;

		/** The last render of the bar. Each render starts with the label. */
		function lastRender(): string {
			const text = stderrText();
			return text.slice(text.lastIndexOf(LABEL));
		}

		beforeEach(() => {
			work = createParallelWorkBar({ label: LABEL, total: TOTAL_ITEMS });
			work.start();
		});

		it("should show the label, the items done and the total when the bar starts", () => {
			work.stop();

			expect(lastRender()).toContain(`0/${TOTAL_ITEMS}`);
		});

		it("should list the items in flight when items are picked", () => {
			work.pick(FIRST_PICKED);
			work.pick(SECOND_PICKED);
			work.stop();

			expect(lastRender()).toContain(`in flight: ${FIRST_PICKED}, ${SECOND_PICKED}`);
		});

		it("should count an item done and remove it from the items in flight when it completes", () => {
			work.pick(FIRST_PICKED);
			work.pick(SECOND_PICKED);
			work.complete(FIRST_PICKED);
			work.stop();

			expect(lastRender()).toContain(`1/${TOTAL_ITEMS}`);
			expect(lastRender()).toContain(`in flight: ${SECOND_PICKED}`);
		});

		it("should show a failed item in red when the item fails", () => {
			work.pick(FIRST_PICKED);
			work.fail(FIRST_PICKED);
			work.stop();

			expect(lastRender()).toContain(`in flight: ${inRed(String(FIRST_PICKED))}`);
		});
	});

	describe("off a terminal", () => {
		const stderrText = useCapturedStderr({ isTerminal: false });

		it("should write nothing when stderr is not a terminal", () => {
			const work = createParallelWorkBar({ label: LABEL, total: TOTAL_ITEMS });
			work.start();
			work.pick(FIRST_PICKED);
			work.complete(FIRST_PICKED);
			work.stop();

			expect(stderrText()).toBe("");
		});
	});
});
