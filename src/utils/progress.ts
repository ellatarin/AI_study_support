import { Transform } from "node:stream";
import { Presets, SingleBar, type ValueFormatter } from "cli-progress";

/** cli-progress format for the parallel-work bar's in-flight suffix (technical-design.md Stage 4). */
const PARALLEL_WORK_FORMAT =
	"{label}  [{bar}] {value}/{total}  ETA {eta_formatted}  | in flight: {inFlight}";

/** ESC control character, built at runtime to avoid embedding a literal control byte in source. */
const ESC = String.fromCharCode(27);

/** ANSI-red wrapper used to highlight a failed item's id in the in-flight suffix. */
function inRed(text: string): string {
	return `${ESC}[31m${text}${ESC}[0m`;
}

/** Formats a byte count as megabytes for the upload bar's value display. */
function formatMegabytes(bytes: number): string {
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Constructs a cli-progress `SingleBar` with the pipeline's shared preset and
 * cursor handling. The single place bars are built, so every bar shares the same
 * look and no construction is duplicated across stages.
 *
 * @param args - The cli-progress format string and an optional value formatter
 * (e.g. for byte-to-megabyte display).
 * @returns A configured, not-yet-started `SingleBar`.
 */
export function createProgressBar({
	format,
	formatValue,
}: {
	readonly format: string;
	readonly formatValue?: ValueFormatter;
}): SingleBar {
	return new SingleBar({ format, formatValue, hideCursor: true }, Presets.shades_classic);
}

/**
 * Builds a pass-through stream that advances an upload progress bar as bytes
 * flow through it, without buffering the payload. Piping an upload through the
 * returned `stream` drives the returned `bar`; the caller stops the bar when the
 * upload settles.
 *
 * @param totalBytes - The total upload size, used as the bar's target.
 * @returns The pass-through `stream` to pipe through and the `bar` it drives.
 */
export function createUploadProgressStream(totalBytes: number): {
	readonly stream: Transform;
	readonly bar: SingleBar;
} {
	const bar = createProgressBar({
		format: "Uploading    |{bar}| {percentage}%  {value} / {total}",
		// eslint-disable-next-line max-params -- cli-progress formatValue signature is fixed
		formatValue: (value, _options, type) =>
			type === "value" || type === "total" ? formatMegabytes(value) : String(value),
	});

	let uploaded = 0;
	const stream = new Transform({
		// eslint-disable-next-line max-params -- Node stream Transform.transform signature is fixed
		transform(chunk: Buffer, _encoding, callback) {
			uploaded += chunk.length;
			bar.update(uploaded);
			callback(null, chunk);
		},
	});

	bar.start(totalBytes, 0);
	return { stream, bar };
}

/**
 * A progress bar for a stage that processes many items concurrently, tracking
 * which item ids are in flight and advancing as each completes (technical-design.md Stage 4).
 */
export type ParallelWorkBar = {
	readonly bar: SingleBar;
	/** Starts the bar with an empty in-flight suffix. */
	start(): void;
	/** Records that a worker has picked up `itemId` and added it to the in-flight set. */
	pick(itemId: number): void;
	/** Marks `itemId` done: removes it from the in-flight set and advances the bar. */
	complete(itemId: number): void;
	/** Marks `itemId` failed: removes it from in-flight and highlights it in red. */
	fail(itemId: number): void;
	/** Stops the bar and moves to the next line. */
	stop(): void;
};

/** Renders the in-flight suffix: active ids plainly, failed ids highlighted in red. */
function renderInFlight({
	active,
	failed,
}: {
	readonly active: ReadonlySet<number>;
	readonly failed: ReadonlySet<number>;
}): string {
	const activeLabels = [...active].map(String);
	const failedLabels = [...failed].map((itemId) => inRed(String(itemId)));
	return [...activeLabels, ...failedLabels].join(", ");
}

/**
 * Creates a {@link ParallelWorkBar} for a concurrent stage. The returned control
 * methods keep the in-flight suffix and completed count in sync as workers pick
 * up, complete, and fail items (used by Stages 4 and 5). Non-TTY output falls
 * back to cli-progress defaults.
 *
 * @param args - The bar label and the total number of items to process.
 * @returns The bar and its `start`/`pick`/`complete`/`fail`/`stop` controls.
 */
export function createParallelWorkBar({
	label,
	total,
}: {
	readonly label: string;
	readonly total: number;
}): ParallelWorkBar {
	const bar = createProgressBar({ format: PARALLEL_WORK_FORMAT });
	const active = new Set<number>();
	const failed = new Set<number>();
	let completed = 0;

	function payload(): { readonly label: string; readonly inFlight: string } {
		return { label, inFlight: renderInFlight({ active, failed }) };
	}

	return {
		bar,
		start(): void {
			bar.start(total, 0, payload());
		},
		pick(itemId: number): void {
			active.add(itemId);
			bar.update(completed, payload());
		},
		complete(itemId: number): void {
			active.delete(itemId);
			completed += 1;
			bar.update(completed, payload());
		},
		fail(itemId: number): void {
			active.delete(itemId);
			failed.add(itemId);
			bar.update(completed, payload());
		},
		stop(): void {
			bar.stop();
		},
	};
}
