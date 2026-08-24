import { Transform } from "node:stream";
import {
	type Options,
	Presets,
	SingleBar,
	type ValueFormatter,
	type ValueType,
} from "cli-progress";

/** cli-progress format for the upload bar, whose value and total render as megabytes. */
const UPLOAD_FORMAT = "Uploading    |{bar}| {percentage}%  {value} / {total}";

/**
 * The stream every progress bar renders to. It is cli-progress's own default,
 * named here so the bars draw somewhere this module states rather than somewhere
 * the library happens to pick, and so stdout stays free for the output the user
 * asked for (technical-design.md §10).
 */
const PROGRESS_STREAM = process.stderr;

/**
 * Formats a byte count as megabytes for the upload bar's value display.
 *
 * @param bytes - The byte count to format.
 * @returns The value formatted as megabytes (e.g. `1.5 MB`).
 */
function formatMegabytes(bytes: number): string {
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * cli-progress value formatter for the upload bar: renders the byte value and
 * total as megabytes, and leaves other tokens (e.g. percentage) unchanged.
 *
 * @param value - The raw numeric value cli-progress is formatting.
 * @param _options - The cli-progress options (unused).
 * @param type - Which token is being formatted.
 * @returns The formatted token string.
 */
// eslint-disable-next-line max-params, @typescript-eslint/prefer-readonly-parameter-types -- cli-progress's ValueFormatter signature is fixed: three positional parameters, the second of them cli-progress's own mutable Options, which this ignores entirely (CLAUDE.md permits dropping readonly where a library requires a mutable type)
function formatUploadValue(value: number, _options: Options, type: ValueType): string {
	return type === "value" || type === "total" ? formatMegabytes(value) : String(value);
}

/**
 * Constructs a cli-progress `SingleBar` with the pipeline's shared preset and
 * cursor handling. The single place bars are built, so every bar shares the same
 * look and no construction is duplicated across stages.
 *
 * @param args - The bar configuration.
 * @param args.format - The cli-progress format string.
 * @param args.formatValue - Optional value formatter (e.g. byte-to-megabyte display).
 * @returns A configured, not-yet-started `SingleBar`.
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
	const bar = createProgressBar({ format: UPLOAD_FORMAT, formatValue: formatUploadValue });

	let uploaded = 0;
	const stream = new Transform({
		// eslint-disable-next-line max-params, @typescript-eslint/prefer-readonly-parameter-types -- Node's Transform.transform signature is fixed: three positional parameters, the first a Buffer, which is mutable through its index signature and is what Node hands us (CLAUDE.md permits dropping readonly where a library requires a mutable type)
		transform(chunk: Buffer, _encoding, callback) {
			uploaded += chunk.length;
			bar.update(uploaded);
			callback(null, chunk);
		},
	});

	bar.start(totalBytes, 0);
	return { stream, bar };
}
