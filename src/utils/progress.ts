import { Transform } from "node:stream";
import {
	type Options,
	Presets,
	SingleBar,
	type ValueFormatter,
	type ValueType,
} from "cli-progress";

/** The cli-progress format of the upload progress bar. Its value and total show as megabytes. */
const UPLOAD_FORMAT = "Uploading    |{bar}| {percentage}%  {value} / {total}";

const PARALLEL_WORK_FORMAT =
	"{label}  |{bar}| {value}/{total}  ETA {eta_formatted}  in flight: {inFlight}";

/** The ESC control character, made at run time so that the source holds no control byte. */
const ESC = String.fromCharCode(27);

/**
 * The stream that every progress bar writes to. It is the default of
 * cli-progress, named here so that this module, not the library, sets it. So
 * stdout stays free for the output that the user asked for.
 */
const PROGRESS_STREAM = process.stderr;

/**
 * Writes a byte count as megabytes.
 *
 * @param bytes - The byte count to format.
 * @returns The value as megabytes, such as `1.5 MB`.
 */
function formatMegabytes(bytes: number): string {
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Formats the tokens of the upload progress bar. The value and the total show as
 * megabytes. Other tokens, such as the percentage, do not change.
 *
 * @param value - The number that cli-progress formats.
 * @param _options - The cli-progress options. This function does not read them.
 * @param type - The token that is formatted.
 * @returns The formatted token.
 */
// eslint-disable-next-line max-params, @typescript-eslint/prefer-readonly-parameter-types -- cli-progress sets the ValueFormatter signature: three positional parameters. The second is the mutable Options of cli-progress, which this function does not read. CLAUDE.md permits a mutable type that a library requires.
function formatUploadValue(value: number, _options: Options, type: ValueType): string {
	return type === "value" || type === "total" ? formatMegabytes(value) : String(value);
}

/**
 * Creates a cli-progress `SingleBar` with the shared preset, stream and cursor
 * setting. Every progress bar is built here, so all of them look the same
 * (technical-design.md §10, "Logging and Progress Helpers").
 *
 * @param args - The progress bar configuration.
 * @param args.format - The cli-progress format string.
 * @param args.formatValue - An optional value formatter, such as one that shows megabytes.
 * @returns A progress bar that is not started.
 */
export function createProgressBar({
	format,
	formatValue,
}: {
	readonly format: string;
	readonly formatValue?: ValueFormatter;
}): SingleBar {
	return new SingleBar(
		{ format, formatValue, hideCursor: true, stream: PROGRESS_STREAM },
		Presets.shades_classic,
	);
}

/**
 * Creates a pass-through stream that moves an upload progress bar as the bytes
 * pass through it. The stream does not buffer the upload. The progress bar starts
 * at once. The caller stops it when the upload ends.
 *
 * @param totalBytes - The size of the upload, which is the end of the progress bar.
 * @returns The `stream` to pipe the upload through, and the `progressBar` that it moves.
 */
export function createUploadProgressStream(totalBytes: number): {
	readonly stream: Transform;
	readonly progressBar: SingleBar;
} {
	const progressBar = createProgressBar({ format: UPLOAD_FORMAT, formatValue: formatUploadValue });

	let uploaded = 0;
	const stream = new Transform({
		// eslint-disable-next-line max-params, @typescript-eslint/prefer-readonly-parameter-types -- Node sets the Transform.transform signature: three positional parameters. The first is a Buffer, which is mutable through its index signature. CLAUDE.md permits a mutable type that a library requires.
		transform(chunk: Buffer, _encoding, callback) {
			uploaded += chunk.length;
			progressBar.update(uploaded);
			callback(null, chunk);
		},
	});

	progressBar.start(totalBytes, 0);
	return { stream, progressBar };
}

/**
 * A progress bar for work on many numbered items at the same time. It shows the
 * items done, the total, and the number of each item in flight. A failed item
 * stays in the list, in red (technical-design.md §10, "Logging and Progress Helpers").
 */
export type ParallelWorkBar = {
	/** Starts the bar, with no item done and no item in flight. */
	readonly start: () => void;
	/** Adds the item to the items in flight. */
	readonly pick: (itemNumber: number) => void;
	/** Removes the item from the items in flight, and counts it done. */
	readonly complete: (itemNumber: number) => void;
	/** Removes the item from the items in flight, and shows it in red. */
	readonly fail: (itemNumber: number) => void;
	/** Stops the bar, and moves the cursor to the next line. */
	readonly stop: () => void;
};

/**
 * Creates a {@link ParallelWorkBar}. The bar writes only to a terminal, so the
 * red of a failed item never gets into a captured log.
 *
 * @param args - The bar configuration.
 * @param args.label - The word in front of the bar, such as `Slides`.
 * @param args.total - The number of items.
 * @returns The controls of the bar. The bar is not started.
 */
export function createParallelWorkBar({
	label,
	total,
}: {
	readonly label: string;
	readonly total: number;
}): ParallelWorkBar {
	const progressBar = createProgressBar({ format: PARALLEL_WORK_FORMAT });
	const inFlight = new Set<number>();
	const failed = new Set<number>();
	let done = 0;

	function payload(): { readonly label: string; readonly inFlight: string } {
		const failedInRed = [...failed].map((itemNumber) => `${ESC}[31m${itemNumber}${ESC}[0m`);
		return { label, inFlight: [...[...inFlight].map(String), ...failedInRed].join(", ") };
	}

	return {
		start: () => {
			progressBar.start(total, done, payload());
		},
		pick: (itemNumber) => {
			inFlight.add(itemNumber);
			progressBar.update(done, payload());
		},
		complete: (itemNumber) => {
			inFlight.delete(itemNumber);
			done += 1;
			progressBar.update(done, payload());
		},
		fail: (itemNumber) => {
			inFlight.delete(itemNumber);
			failed.add(itemNumber);
			progressBar.update(done, payload());
		},
		stop: () => {
			progressBar.stop();
		},
	};
}
