/**
 * The rules that turn the file names of a module's sources into numbered
 * lectures. The input is the names of the video recordings and the slide decks.
 * The output is each broken source rule, or the lectures in date order, numbered
 * from 1, each with its title and base name.
 *
 * Nothing here reads or writes the disk, so a test can check each rule with two
 * lists of names (technical-design.md §3.2 and §5, `source-normalisation`).
 */

import type { Manifest } from "../../../types/pipeline.js";
import { extractDate, formatDateISO } from "../../../utils/date.js";
import { extractProvisionalTitle, lectureBaseName } from "../../../utils/naming.js";

/** A source file: its name and its `YYYY-MM-DD` lecture date. */
type SourceRef = { readonly name: string; readonly lectureDate: string };

/** A source file with its parsed date. `lectureBaseName` takes the `Date` (technical-design.md §3.2). */
export type DatedFile = SourceRef & { readonly date: Date };

/** The files of one source folder: those with a lecture date, and the names of those without one. */
export type DatedListing = {
	readonly dated: readonly DatedFile[];
	readonly undated: readonly string[];
};

/** A video recording and the slide deck of the same lecture date. */
export type SourcePair = { readonly videoRecording: DatedFile; readonly slideDeckName: string };

/**
 * The result of the source rule check: each broken rule, or the source pairs.
 * The check returns the source pairs because only the check proves the 1:1 date
 * match. Code that matched the dates again would have to assume that match.
 */
export type SourceRuleCheck =
	| { readonly state: "rules-broken"; readonly brokenRules: readonly string[] }
	| { readonly state: "matched"; readonly sourcePairs: readonly SourcePair[] };

/** A numbered lecture, with its provisional title, its base name and the current names of its source pair. */
export type Lecture = {
	readonly lectureNumber: number;
	readonly lectureDate: string;
	readonly provisionalTitle: string;
	readonly baseName: string;
	readonly videoRecordingName: string;
	readonly slideDeckName: string;
};

/**
 * Splits file names into those with a lecture date and those without one.
 *
 * @param names - The names of the source files.
 * @returns The dated files, with the parsed date and the lecture date, and the undated names.
 */
export function toDatedFiles(names: readonly string[]): DatedListing {
	const dated: DatedFile[] = [];
	const undated: string[] = [];
	for (const name of names) {
		const date = extractDate(name);
		if (date === null) {
			undated.push(name);
			continue;
		}
		dated.push({ name, lectureDate: formatDateISO(date), date });
	}
	return { dated, undated };
}

/**
 * Finds the lecture dates that two or more files share.
 *
 * @param files - The dated files of one kind.
 * @returns The lecture dates that two or more files share.
 */
function duplicateLectureDates(files: readonly SourceRef[]): readonly string[] {
	const seen = new Set<string>();
	const duplicates = new Set<string>();
	for (const file of files) {
		if (seen.has(file.lectureDate)) {
			duplicates.add(file.lectureDate);
		} else {
			seen.add(file.lectureDate);
		}
	}
	return [...duplicates];
}

/**
 * Collects the lecture dates of the dated files in one source folder.
 *
 * @param listing - The files of one source folder.
 * @returns The lecture dates.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- DatedFile holds a parsed Date. A Date has mutator methods, so the rule never accepts it as readonly. This function only reads it.
function lectureDatesIn(listing: DatedListing): ReadonlySet<string> {
	return new Set(listing.dated.map((file) => file.lectureDate));
}

/**
 * Writes the broken-rule line for a source file that has no match of the other
 * kind on its lecture date.
 *
 * @param args - The source file without a match.
 * @param args.kind - The kind of the source file.
 * @param args.counterpart - The kind of the missing match.
 * @param args.file - The source file.
 * @returns The broken-rule line.
 */
function missingCounterpart({
	kind,
	counterpart,
	file,
}: {
	readonly kind: string;
	readonly counterpart: string;
	readonly file: SourceRef;
}): string {
	return `${kind} "${file.name}" has no matching ${counterpart} (date ${file.lectureDate})`;
}

/**
 * Checks the source rules. Each file must have a lecture date. No two files of
 * one kind may share a date. Each video recording and each slide deck must have a
 * match on its date. When each rule holds, the result holds the source pairs.
 *
 * @param args - The video recordings and the slide decks.
 * @param args.videoRecordings - The video recordings, split by lecture date.
 * @param args.slideDecks - The slide decks, split by lecture date.
 * @returns Each broken rule, or the source pairs when no rule is broken.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- DatedFile holds a parsed Date. A Date has mutator methods, so the rule never accepts it as readonly. This function only reads both listings.
export function checkSourceRules({
	videoRecordings,
	slideDecks,
}: {
	readonly videoRecordings: DatedListing;
	readonly slideDecks: DatedListing;
}): SourceRuleCheck {
	// The report gives the broken rules in rule order, not in order of the kind of
	// file. So a reader sees each undated file before the first missing match.
	const sides = [
		{ kind: "video recording", listing: videoRecordings },
		{ kind: "slide deck", listing: slideDecks },
	] as const;

	const brokenRules: string[] = [];
	for (const { kind, listing } of sides) {
		for (const name of listing.undated) {
			brokenRules.push(`${kind} "${name}" has no extractable date`);
		}
	}
	for (const { kind, listing } of sides) {
		for (const lectureDate of duplicateLectureDates(listing.dated)) {
			brokenRules.push(`two or more ${kind}s share the date ${lectureDate}`);
		}
	}

	// The match rule has one loop for each kind, not one shared loop. The video
	// recording loop also keeps the slide deck that it finds. The missing-match lines
	// have the same order as the undated and shared-date lines: each video recording
	// line before the first slide deck line.
	const slideDeckNameByDate = new Map(
		slideDecks.dated.map((slideDeck) => [slideDeck.lectureDate, slideDeck.name] as const),
	);
	const sourcePairs: SourcePair[] = [];
	for (const videoRecording of videoRecordings.dated) {
		const slideDeckName = slideDeckNameByDate.get(videoRecording.lectureDate);
		if (slideDeckName === undefined) {
			brokenRules.push(
				missingCounterpart({
					kind: "video recording",
					counterpart: "slide deck",
					file: videoRecording,
				}),
			);
			continue;
		}
		sourcePairs.push({ videoRecording, slideDeckName });
	}
	const videoRecordingDates = lectureDatesIn(videoRecordings);
	for (const slideDeck of slideDecks.dated) {
		if (!videoRecordingDates.has(slideDeck.lectureDate)) {
			brokenRules.push(
				missingCounterpart({ kind: "slide deck", counterpart: "video recording", file: slideDeck }),
			);
		}
	}

	return brokenRules.length > 0
		? { state: "rules-broken", brokenRules }
		: { state: "matched", sourcePairs };
}

/**
 * Sorts the source pairs by lecture date, numbers them from 1, and gives each
 * lecture its title and base name. A new lecture takes its provisional title
 * from the file name of its video recording. An existing lecture takes its titles
 * from its manifest, so a later title change stays (technical-design.md §5,
 * `source-normalisation`, step 4).
 *
 * @param args - The source pairs, the existing manifests and the module prefixes.
 * @param args.sourcePairs - The source pairs from {@link checkSourceRules}.
 * @param args.existingManifests - The manifests of the existing lectures, keyed by lecture date.
 * @param args.modulePrefixes - The module prefixes to remove from a new provisional title.
 * @returns The lectures in date order, numbered from 1.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- SourcePair holds a parsed Date, and a ReadonlyMap is readonly, but the rule accepts neither. This function only reads them.
export function orderLectures({
	sourcePairs,
	existingManifests,
	modulePrefixes,
}: {
	readonly sourcePairs: readonly SourcePair[];
	readonly existingManifests: ReadonlyMap<string, Manifest>;
	readonly modulePrefixes: readonly string[];
}): readonly Lecture[] {
	// A `YYYY-MM-DD` lecture date sorts as text into date order. So the code
	// compares the lecture dates, not the parsed dates.
	const ordered = [...sourcePairs].sort(
		// eslint-disable-next-line max-params -- Array.prototype.sort sets the signature of this comparator: two arguments, in order.
		(left, right) =>
			left.videoRecording.lectureDate.localeCompare(right.videoRecording.lectureDate),
	);
	return Array.from(ordered.entries(), ([index, { videoRecording, slideDeckName }]) => {
		const lectureDate = videoRecording.lectureDate;
		const priorManifest = existingManifests.get(lectureDate);
		const provisionalTitle =
			priorManifest?.provisionalTitle ??
			extractProvisionalTitle({ filename: videoRecording.name, modulePrefixes });
		const title = priorManifest?.lectureTitle ?? provisionalTitle;
		const lectureNumber = index + 1;
		return {
			lectureNumber,
			lectureDate,
			provisionalTitle,
			baseName: lectureBaseName({ lectureNumber, title, date: videoRecording.date }),
			videoRecordingName: videoRecording.name,
			slideDeckName,
		};
	});
}
