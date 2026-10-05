import { describe, expect, it } from "vitest";
import type { Manifest } from "../../../types/pipeline.js";
import {
	cellInjuryAsFirst,
	cellInjurySources,
	immunitySources,
	makeManifest,
	vaccinationSources,
} from "../../fixtures.js";
import {
	checkSourceRules,
	orderLectures,
	type SourcePair,
	toDatedFiles,
} from "./lecture-resolution.js";

/** The prefix the example module's filenames carry, stripped from a fresh title. */
const MODULE_PREFIXES = ["BOD"] as const;

/**
 * The source pairs a listing yields, for the numbering tests.
 *
 * Numbering consumes what matching produced, so the source pairs are taken from the
 * matcher rather than hand-built: a hand-built source pair could carry a date its two
 * files do not, which is a state the rules cannot reach.
 *
 * @param args - The source listings.
 * @param args.videoRecordings - The video recording file names.
 * @param args.slideDecks - The slide deck file names.
 * @returns The matched source pairs.
 * @throws Error when the listings do not match, which no numbering test intends.
 */
function matchedSourcePairs({
	videoRecordings,
	slideDecks,
}: {
	readonly videoRecordings: readonly string[];
	readonly slideDecks: readonly string[];
}): readonly SourcePair[] {
	const checked = checkSourceRules({
		videoRecordings: toDatedFiles(videoRecordings),
		slideDecks: toDatedFiles(slideDecks),
	});
	if (checked.state === "rules-broken") {
		throw new Error(`expected matched sources, got: ${checked.brokenRules.join("; ")}`);
	}
	return checked.sourcePairs;
}

/**
 * The broken rules a listing produces.
 *
 * @param args - The source listings.
 * @param args.videoRecordings - The video recording file names.
 * @param args.slideDecks - The slide deck file names.
 * @returns The broken-rule lines.
 * @throws Error when the listings match, which no source-rule test intends.
 */
function brokenRulesFor({
	videoRecordings,
	slideDecks,
}: {
	readonly videoRecordings: readonly string[];
	readonly slideDecks: readonly string[];
}): readonly string[] {
	const checked = checkSourceRules({
		videoRecordings: toDatedFiles(videoRecordings),
		slideDecks: toDatedFiles(slideDecks),
	});
	if (checked.state === "matched") {
		throw new Error("expected broken rules, but every source matched");
	}
	return checked.brokenRules;
}

describe("toDatedFiles", () => {
	it.each([
		{ name: cellInjurySources.videoRecording, lectureDate: cellInjurySources.date },
		{ name: "13 Oct 2025 BOD_Immunity to Infection.mp4", lectureDate: immunitySources.date },
	])("should read $lectureDate off $name when the name carries a date", ({ name, lectureDate }) => {
		const { dated, undated } = toDatedFiles([name]);

		expect(undated).toEqual([]);
		expect(dated.map((file) => ({ name: file.name, lectureDate: file.lectureDate }))).toEqual([
			{ name, lectureDate },
		]);
	});

	it("should classify a name as undated when it carries no date", () => {
		const { dated, undated } = toDatedFiles(["Cell Injury.mp4"]);

		expect(dated).toEqual([]);
		expect(undated).toEqual(["Cell Injury.mp4"]);
	});
});

describe("checkSourceRules", () => {
	it("should pair each video recording with the slide deck sharing its date when every date matches", () => {
		const sourcePairs = matchedSourcePairs({
			videoRecordings: [vaccinationSources.videoRecording, cellInjurySources.videoRecording],
			slideDecks: [cellInjurySources.slideDeck, vaccinationSources.slideDeck],
		});

		expect(
			sourcePairs.map((sourcePair) => ({
				videoRecording: sourcePair.videoRecording.name,
				slideDeck: sourcePair.slideDeckName,
			})),
		).toEqual([
			{
				videoRecording: vaccinationSources.videoRecording,
				slideDeck: vaccinationSources.slideDeck,
			},
			{ videoRecording: cellInjurySources.videoRecording, slideDeck: cellInjurySources.slideDeck },
		]);
	});

	// Every rule that stops a run, in the order the report puts them: both kinds
	// of undated file, then both kinds of duplicate date, then both directions
	// of an unmatched source pair. One table rather than three, because what each case
	// asks is the same question of a different listing.
	it.each([
		{
			problem: "a video recording carries no readable date",
			videoRecordings: ["Cell Injury.mp4", cellInjurySources.videoRecording],
			slideDecks: [cellInjurySources.slideDeck],
			expected: 'video recording "Cell Injury.mp4" has no extractable date',
		},
		{
			problem: "a slide deck carries no readable date",
			videoRecordings: [cellInjurySources.videoRecording],
			slideDecks: ["Cell Injury deck.pdf", cellInjurySources.slideDeck],
			expected: 'slide deck "Cell Injury deck.pdf" has no extractable date',
		},
		{
			problem: "two video recordings share a date",
			videoRecordings: [
				cellInjurySources.videoRecording,
				`${cellInjurySources.date} BOD_Cell Injury take two.mp4`,
			],
			slideDecks: [cellInjurySources.slideDeck],
			expected: `two or more video recordings share the date ${cellInjurySources.date}`,
		},
		{
			problem: "two slide decks share a date",
			videoRecordings: [cellInjurySources.videoRecording],
			slideDecks: [
				cellInjurySources.slideDeck,
				`${cellInjurySources.date} Cell Injury handout.pdf`,
			],
			expected: `two or more slide decks share the date ${cellInjurySources.date}`,
		},
		{
			problem: "a video recording has no slide deck on its date",
			videoRecordings: [cellInjurySources.videoRecording, vaccinationSources.videoRecording],
			slideDecks: [cellInjurySources.slideDeck],
			expected: `video recording "${vaccinationSources.videoRecording}" has no matching slide deck (date ${vaccinationSources.date})`,
		},
		{
			problem: "a slide deck has no video recording on its date",
			videoRecordings: [cellInjurySources.videoRecording],
			slideDecks: [cellInjurySources.slideDeck, vaccinationSources.slideDeck],
			expected: `slide deck "${vaccinationSources.slideDeck}" has no matching video recording (date ${vaccinationSources.date})`,
		},
	])("should refuse the sources and say so when $problem", ({
		videoRecordings,
		slideDecks,
		expected,
	}) => {
		expect(brokenRulesFor({ videoRecordings, slideDecks })).toContain(expected);
	});

	it("should report every problem rather than the first when several sources are wrong", () => {
		const brokenRules = brokenRulesFor({
			videoRecordings: ["Cell Injury.mp4", vaccinationSources.videoRecording],
			slideDecks: [immunitySources.slideDeck],
		});

		expect(brokenRules).toHaveLength(3);
	});
});

describe("orderLectures", () => {
	/**
	 * Numbers a listing, with no lecture already on disk.
	 *
	 * @param args - The source listings.
	 * @param args.videoRecordings - The video file names.
	 * @param args.slideDecks - The slide file names.
	 * @returns The numbered lectures.
	 */
	function numberFresh({
		videoRecordings,
		slideDecks,
	}: {
		readonly videoRecordings: readonly string[];
		readonly slideDecks: readonly string[];
	}): ReturnType<typeof orderLectures> {
		return orderLectures({
			sourcePairs: matchedSourcePairs({ videoRecordings, slideDecks }),
			existingManifests: new Map<string, Manifest>(),
			modulePrefixes: MODULE_PREFIXES,
		});
	}

	it("should number lectures from one in date order when the listing is in another order", () => {
		const lectures = numberFresh({
			videoRecordings: [
				vaccinationSources.videoRecording,
				immunitySources.videoRecording,
				cellInjurySources.videoRecording,
			],
			slideDecks: [
				immunitySources.slideDeck,
				cellInjurySources.slideDeck,
				vaccinationSources.slideDeck,
			],
		});

		expect(
			lectures.map((lecture) => ({ number: lecture.lectureNumber, iso: lecture.lectureDate })),
		).toEqual([
			{ number: 1, iso: cellInjurySources.date },
			{ number: 2, iso: immunitySources.date },
			{ number: 3, iso: vaccinationSources.date },
		]);
	});

	it("should name a lecture from its number, title and date when it is new", () => {
		const [lecture] = numberFresh({
			videoRecordings: [cellInjurySources.videoRecording],
			slideDecks: [cellInjurySources.slideDeck],
		});

		expect(lecture?.baseName).toBe(cellInjuryAsFirst);
	});

	it("should strip a configured module prefix when it reads a title off a filename", () => {
		const [lecture] = numberFresh({
			videoRecordings: [cellInjurySources.videoRecording],
			slideDecks: [cellInjurySources.slideDeck],
		});

		expect(lecture?.provisionalTitle).toBe("Cell Injury");
	});

	// A lecture of its own, on a date none of the fixtures use: what it shows is
	// that a filename with nothing left after the noise is stripped still gets a
	// name, and nothing about it should look tied to the other three.
	it("should name a lecture by its number and date alone when the filename yields no title", () => {
		const [lecture] = numberFresh({
			videoRecordings: ["2025-11-07 Lecture 1.mp4"],
			slideDecks: ["2025-11-07 deck.pdf"],
		});

		expect(lecture?.provisionalTitle).toBe("");
		expect(lecture?.baseName).toBe("Lecture 1 - 2025-11-07");
	});

	it("should take an existing lecture's name from its manifest title when it has been retitled", () => {
		const lectureDate = cellInjurySources.date;

		const [lecture] = orderLectures({
			sourcePairs: matchedSourcePairs({
				videoRecordings: [cellInjurySources.videoRecording],
				slideDecks: [cellInjurySources.slideDeck],
			}),
			existingManifests: new Map([
				[lectureDate, makeManifest({ lectureDate, lectureTitle: "Innate Immune Response" })],
			]),
			modulePrefixes: MODULE_PREFIXES,
		});

		expect(lecture?.baseName).toBe("Lecture 1 - Innate Immune Response - 2025-10-10");
	});

	it("should keep an existing lecture's recorded provisional title when its filename is now canonical", () => {
		const lectureDate = cellInjurySources.date;

		const [lecture] = orderLectures({
			sourcePairs: matchedSourcePairs({
				videoRecordings: [`${cellInjuryAsFirst}.mp4`],
				slideDecks: [`${cellInjuryAsFirst}.pdf`],
			}),
			existingManifests: new Map([
				[lectureDate, makeManifest({ lectureDate, provisionalTitle: "Cell Injury" })],
			]),
			modulePrefixes: MODULE_PREFIXES,
		});

		expect(lecture?.provisionalTitle).toBe("Cell Injury");
	});

	it("should carry the matched video recording and slide deck names through when a lecture is numbered", () => {
		const [lecture] = numberFresh({
			videoRecordings: [cellInjurySources.videoRecording],
			slideDecks: [cellInjurySources.slideDeck],
		});

		expect(lecture).toMatchObject({
			videoRecordingName: cellInjurySources.videoRecording,
			slideDeckName: cellInjurySources.slideDeck,
		});
	});
});
