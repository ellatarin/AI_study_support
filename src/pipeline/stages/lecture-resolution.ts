/**
 * Turning a module's raw source filenames into numbered lectures.
 *
 * Two lists of names go in — the videos and the slide decks a lecturer dropped
 * into their module — and either every problem that stops the run comes back, or
 * the lectures those names describe: numbered from one in date order, each
 * carrying the title and canonical name it will be renamed to.
 *
 * Nothing here touches the disk, which is the point of it having a home of its
 * own. These are the rules a run is judged by — what counts as a readable date,
 * what counts as a matched pair, and which lecture is Lecture 1 — and checking
 * one should not mean laying out video files in a directory tree.
 *
 * See technical-design.md §3.2 (naming) and §5, Stage 0.
 */

import type { RunManifest } from "../../types/pipeline.js";
import { extractDate, formatDateISO } from "../../utils/date.js";
import { extractProvisionalTitle, lectureBaseName } from "../../utils/naming.js";

/** A source file identified only by its name and extracted `YYYY-MM-DD` date. */
type SourceRef = { readonly name: string; readonly iso: string };

/** A source file that also carries its parsed `Date` (for local-safe formatting). */
export type DatedFile = SourceRef & { readonly date: Date };

/** The dated files in one source directory, split from those with no date. */
export type DatedListing = {
	readonly dated: readonly DatedFile[];
	readonly undateable: readonly string[];
};

/** A dated video and the slide sharing its date. */
export type PairedSources = { readonly video: DatedFile; readonly slideName: string };

/**
 * What checking a module's sources concluded: either the problems that stop the
 * run, or the video/slide pairs the check proved are there.
 *
 * The pairs are carried out of the check rather than looked up again afterwards.
 * The 1:1 date match is established by the check and nowhere else, so anything
 * that re-derives it from the two listings has to assert an invariant it cannot
 * see — which is what a cast here used to do.
 */
export type SourceCheck =
	| { readonly state: "anomalies"; readonly anomalies: readonly string[] }
	| { readonly state: "matched"; readonly pairs: readonly PairedSources[] };

/** A fully-resolved lecture: its number, date, title, and current source names. */
export type Lecture = {
	readonly lectureNumber: number;
	readonly iso: string;
	readonly provisionalTitle: string;
	readonly baseName: string;
	readonly videoName: string;
	readonly slideName: string;
};

/**
 * Splits file names into those with a confidently extractable date and those
 * without.
 *
 * @param names - The source file names to classify.
 * @returns The dated files (with parsed date and ISO string) and the undateable names.
 */
export function toDatedFiles(names: readonly string[]): DatedListing {
	const dated: DatedFile[] = [];
	const undateable: string[] = [];
	for (const name of names) {
		const date = extractDate(name);
		if (date === null) {
			undateable.push(name);
			continue;
		}
		dated.push({ name, iso: formatDateISO(date), date });
	}
	return { dated, undateable };
}

/**
 * Finds the ISO dates that appear on more than one file.
 *
 * @param files - The dated files to inspect.
 * @returns The ISO dates shared by two or more files.
 */
function duplicateIsos(files: readonly SourceRef[]): readonly string[] {
	const seen = new Set<string>();
	const duplicates = new Set<string>();
	for (const file of files) {
		if (seen.has(file.iso)) {
			duplicates.add(file.iso);
		} else {
			seen.add(file.iso);
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
function datedIsos(listing: DatedListing): ReadonlySet<string> {
	return new Set(listing.dated.map((file) => file.iso));
}

/**
 * The one sentence reporting a source with nothing on the other side to match.
 *
 * @param args - Which source is unmatched.
 * @param args.kind - The kind of source that is unmatched.
 * @param args.counterpart - The kind it should have been matched with.
 * @param args.file - The unmatched file.
 * @returns The anomaly line.
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
	return `${kind} "${file.name}" has no matching ${counterpart} (date ${file.iso})`;
}

/**
 * Checks every source rule that must stop the run — undateable files, duplicate
 * dates within videos or slides, and any video or slide without a 1:1 date match
 * — and, when they all hold, hands back the video/slide pairs it matched.
 *
 * @param args - The dated video and slide listings.
 * @param args.videos - The classified video files.
 * @param args.slides - The classified slide files.
 * @returns Every anomaly found, or the matched pairs when there are none.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- DatedFile carries a parsed Date, whose mutators leave it un-readonly to this rule however it is declared; both listings are only read here
export function checkSources({
	videos,
	slides,
}: {
	readonly videos: DatedListing;
	readonly slides: DatedListing;
}): SourceCheck {
	// The first two rules hold of both kinds of source, and the report keeps the
	// rules in order rather than the kinds, so the reader meets every undateable
	// file before the first missing match.
	const sides = [
		{ kind: "video", listing: videos },
		{ kind: "slide", listing: slides },
	] as const;

	const anomalies: string[] = [];
	for (const { kind, listing } of sides) {
		for (const name of listing.undateable) {
			anomalies.push(`${kind} "${name}" has no extractable date`);
		}
	}
	for (const { kind, listing } of sides) {
		for (const iso of duplicateIsos(listing.dated)) {
			anomalies.push(`two or more ${kind}s share the date ${iso}`);
		}
	}

	// The matching rule is written out per side rather than shared, because the
	// video side has something to keep: the slide it just found. Its order is the
	// same as the loops above, every video before the first slide.
	const slideNameByIso = new Map(slides.dated.map((slide) => [slide.iso, slide.name] as const));
	const pairs: PairedSources[] = [];
	for (const video of videos.dated) {
		const slideName = slideNameByIso.get(video.iso);
		if (slideName === undefined) {
			anomalies.push(missingCounterpart({ kind: "video", counterpart: "slide", file: video }));
			continue;
		}
		pairs.push({ video, slideName });
	}
	const videoIsos = datedIsos(videos);
	for (const slide of slides.dated) {
		if (!videoIsos.has(slide.iso)) {
			anomalies.push(missingCounterpart({ kind: "slide", counterpart: "video", file: slide }));
		}
	}

	return anomalies.length > 0 ? { state: "anomalies", anomalies } : { state: "matched", pairs };
}

/**
 * Orders dated videos by date, assigns sequential lecture numbers, and resolves
 * each lecture's title, base name, and matched slide. A new lecture's title is
 * freshly extracted from its raw filename; an existing lecture's title is taken
 * from its manifest, so a re-run neither re-parses an already-canonical filename
 * (which would corrupt the title) nor reverts a Stage 3 AI-derived rename.
 *
 * @param args - The matched sources, the manifests already on disk, and what counts as a module prefix.
 * @param args.pairs - Each video with the slide {@link checkSources} matched to it.
 * @param args.existingManifests - Existing lectures' manifests keyed by date, for title continuity.
 * @param args.modulePrefixes - The configured module prefixes, stripped from a freshly extracted title.
 * @returns The lectures in date order, numbered from 1.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- PairedSources carries a parsed Date, and a ReadonlyMap is already the readonly form the rule declines to recognise; both are only read here
export function orderLectures({
	pairs,
	existingManifests,
	modulePrefixes,
}: {
	readonly pairs: readonly PairedSources[];
	readonly existingManifests: ReadonlyMap<string, RunManifest>;
	readonly modulePrefixes: readonly string[];
}): readonly Lecture[] {
	// `YYYY-MM-DD` sorts lexicographically into date order, which is why the isos
	// are what is compared rather than the parsed dates beside them.
	const ordered = [...pairs].sort(
		// eslint-disable-next-line max-params -- Array.prototype.sort defines this comparator's signature: two positional arguments
		(left, right) => left.video.iso.localeCompare(right.video.iso),
	);
	return Array.from(ordered.entries(), ([index, { video, slideName }]) => {
		const iso = video.iso;
		const priorManifest = existingManifests.get(iso);
		const provisionalTitle =
			priorManifest?.provisionalTitle ??
			extractProvisionalTitle({ filename: video.name, modulePrefixes });
		const title = priorManifest?.lectureTitle ?? provisionalTitle;
		const lectureNumber = index + 1;
		return {
			lectureNumber,
			iso,
			provisionalTitle,
			baseName: lectureBaseName({ lectureNumber, title, date: video.date }),
			videoName: video.name,
			slideName,
		};
	});
}
