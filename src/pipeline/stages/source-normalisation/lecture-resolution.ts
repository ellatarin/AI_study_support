/**
 * Turning a module's raw source filenames into numbered lectures.
 *
 * Two lists of names go in — the video recordings and the slide decks a lecturer dropped
 * into their module — and either every problem that stops the run comes back, or
 * the lectures those names describe: numbered from one in date order, each
 * carrying the title and canonical name it will be renamed to.
 *
 * Nothing here touches the disk, which is the point of it having a home of its
 * own. These are the rules a run is judged by — what counts as a readable date,
 * what counts as a matched source pair, and which lecture is Lecture 1 — and checking
 * one should not mean laying out video recordings in a directory tree.
 *
 * See technical-design.md §3.2 (naming) and §5, `source-normalisation`.
 */

import type { Manifest } from "../../../types/pipeline.js";
import { extractDate, formatDateISO } from "../../../utils/date.js";
import { extractProvisionalTitle, lectureBaseName } from "../../../utils/naming.js";

/** A source file identified only by its name and extracted `YYYY-MM-DD` date. */
type SourceRef = { readonly name: string; readonly lectureDate: string };

/** A source file that also carries its parsed `Date` (for local-safe formatting). */
export type DatedFile = SourceRef & { readonly date: Date };

/** The dated files in one source directory, split from those with no date. */
export type DatedListing = {
	readonly dated: readonly DatedFile[];
	readonly undated: readonly string[];
};

/** A dated video recording and the slide deck sharing its date. */
export type SourcePair = { readonly videoRecording: DatedFile; readonly slideDeckName: string };

/**
 * What checking a module's sources concluded: either the problems that stop the
 * run, or the source pairs the check proved are there.
 *
 * The source pairs are carried out of the check rather than looked up again afterwards.
 * The 1:1 date match is established by the check and nowhere else, so anything
 * that re-derives it from the two listings has to assert an invariant it cannot
 * see — which is what a cast here used to do.
 */
export type SourceRuleCheck =
	| { readonly state: "rules-broken"; readonly brokenRules: readonly string[] }
	| { readonly state: "matched"; readonly sourcePairs: readonly SourcePair[] };

/** A fully-resolved lecture: its number, date, title, and current source names. */
export type Lecture = {
	readonly lectureNumber: number;
	readonly lectureDate: string;
	readonly provisionalTitle: string;
	readonly baseName: string;
	readonly videoRecordingName: string;
	readonly slideDeckName: string;
};

/**
 * Splits file names into those with a confidently extractable date and those
 * without.
 *
 * @param names - The source file names to classify.
 * @returns The dated files (with parsed date and ISO string) and the undated names.
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
 * Finds the ISO dates that appear on more than one file.
 *
 * @param files - The dated files to inspect.
 * @returns The ISO dates shared by two or more files.
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
 * The dates a listing's dateable files carry, for asking what the other side
 * matched.
 *
 * @param listing - One source directory's classified files.
 * @returns The `YYYY-MM-DD` dates present in it.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- DatedFile carries a parsed Date, whose mutators leave it un-readonly to this rule however it is declared; it is only read here
function lectureDatesIn(listing: DatedListing): ReadonlySet<string> {
	return new Set(listing.dated.map((file) => file.lectureDate));
}

/**
 * The one sentence reporting a source with nothing on the other side to match.
 *
 * @param args - Which source is unmatched.
 * @param args.kind - The kind of source that is unmatched.
 * @param args.counterpart - The kind it should have been matched with.
 * @param args.file - The unmatched file.
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
 * Checks every source rule that must stop the run — undated files, duplicate
 * dates within video recordings or slide decks, and any video recording or slide deck
 * without a 1:1 date match — and, when they all hold, hands back the source pairs it matched.
 *
 * @param args - The dated video recording and slide deck listings.
 * @param args.videoRecordings - The classified video recordings.
 * @param args.slideDecks - The classified slide decks.
 * @returns Every broken rule found, or the matched source pairs when there are none.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- DatedFile carries a parsed Date, whose mutators leave it un-readonly to this rule however it is declared; both listings are only read here
export function checkSourceRules({
	videoRecordings,
	slideDecks,
}: {
	readonly videoRecordings: DatedListing;
	readonly slideDecks: DatedListing;
}): SourceRuleCheck {
	// The first two rules hold of both kinds of source, and the report keeps the
	// rules in order rather than the kinds, so the reader meets every undated
	// file before the first missing match.
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

	// The matching rule is written out per side rather than shared, because the
	// video recording side has something to keep: the slide deck it just found. Its
	// order is the same as the loops above, every video recording before the first slide deck.
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
 * Orders dated video recordings by date, assigns sequential lecture numbers, and resolves
 * each lecture's title, base name, and matched slide deck. A new lecture's title is
 * freshly extracted from its raw filename; an existing lecture's title is taken
 * from its manifest, so a re-run neither re-parses an already-canonical filename
 * (which would corrupt the title) nor reverts a `transcript-structuring` AI-derived rename.
 *
 * @param args - The matched sources, the manifests already on disk, and what counts as a module prefix.
 * @param args.sourcePairs - Each video recording with the slide deck {@link checkSourceRules} matched to it.
 * @param args.existingManifests - Existing lectures' manifests keyed by date, for title continuity.
 * @param args.modulePrefixes - The configured module prefixes, stripped from a freshly extracted title.
 * @returns The lectures in date order, numbered from 1.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- SourcePair carries a parsed Date, and a ReadonlyMap is already the readonly form the rule declines to recognise; both are only read here
export function orderLectures({
	sourcePairs,
	existingManifests,
	modulePrefixes,
}: {
	readonly sourcePairs: readonly SourcePair[];
	readonly existingManifests: ReadonlyMap<string, Manifest>;
	readonly modulePrefixes: readonly string[];
}): readonly Lecture[] {
	// `YYYY-MM-DD` sorts lexicographically into date order, which is why the lecture
	// dates are what is compared rather than the parsed dates beside them.
	const ordered = [...sourcePairs].sort(
		// eslint-disable-next-line max-params -- Array.prototype.sort defines this comparator's signature: two positional arguments
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
