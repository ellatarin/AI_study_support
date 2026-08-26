import { describe, expect, it } from "vitest";
import type { RunManifest } from "../../types/pipeline.js";
import {
	cellInjuryAsFirst,
	cellInjurySources,
	immunitySources,
	makeManifest,
	vaccinationSources,
} from "../fixtures.js";
import {
	checkSources,
	orderLectures,
	type PairedSources,
	toDatedFiles,
} from "./lecture-resolution.js";

/** The prefix the example module's filenames carry, stripped from a fresh title. */
const MODULE_PREFIXES = ["BOD"] as const;

/**
 * The pairs a listing yields, for the numbering tests.
 *
 * Numbering consumes what matching produced, so the pairs are taken from the
 * matcher rather than hand-built: a hand-built pair could carry a date its two
 * files do not, which is a state the rules cannot reach.
 *
 * @param args - The source listings.
 * @param args.videos - The video file names.
 * @param args.slides - The slide file names.
 * @returns The matched pairs.
 * @throws Error when the listings do not match, which no numbering test intends.
 */
function matchedPairs({
	videos,
	slides,
}: {
	readonly videos: readonly string[];
	readonly slides: readonly string[];
}): readonly PairedSources[] {
	const checked = checkSources({
		videos: toDatedFiles(videos),
		slides: toDatedFiles(slides),
	});
	if (checked.state === "anomalies") {
		throw new Error(`expected matched sources, got: ${checked.anomalies.join("; ")}`);
	}
	return checked.pairs;
}

/**
 * The anomalies a listing produces.
 *
 * @param args - The source listings.
 * @param args.videos - The video file names.
 * @param args.slides - The slide file names.
 * @returns The anomaly lines.
 * @throws Error when the listings match, which no validation test intends.
 */
function anomaliesFor({
	videos,
	slides,
}: {
	readonly videos: readonly string[];
	readonly slides: readonly string[];
}): readonly string[] {
	const checked = checkSources({
		videos: toDatedFiles(videos),
		slides: toDatedFiles(slides),
	});
	if (checked.state === "matched") {
		throw new Error("expected anomalies, but every source matched");
	}
	return checked.anomalies;
}

describe("toDatedFiles", () => {
	it.each([
		{ name: cellInjurySources.video, iso: cellInjurySources.date },
		{ name: "13 Oct 2025 BOD_Immunity to Infection.mp4", iso: immunitySources.date },
	])("should read $iso off $name when the name carries a date", ({ name, iso }) => {
		const { dated, undateable } = toDatedFiles([name]);

		expect(undateable).toEqual([]);
		expect(dated.map((file) => ({ name: file.name, iso: file.iso }))).toEqual([{ name, iso }]);
	});

	it("should classify a name as undateable when it carries no date", () => {
		const { dated, undateable } = toDatedFiles(["Cell Injury.mp4"]);

		expect(dated).toEqual([]);
		expect(undateable).toEqual(["Cell Injury.mp4"]);
	});
});

describe("checkSources", () => {
	it("should pair each video with the slide sharing its date when every date matches", () => {
		const pairs = matchedPairs({
			videos: [vaccinationSources.video, cellInjurySources.video],
			slides: [cellInjurySources.slide, vaccinationSources.slide],
		});

		expect(pairs.map((pair) => ({ video: pair.video.name, slide: pair.slideName }))).toEqual([
			{ video: vaccinationSources.video, slide: vaccinationSources.slide },
			{ video: cellInjurySources.video, slide: cellInjurySources.slide },
		]);
	});

	// Every rule that stops a run, in the order the report puts them: both kinds
	// of undateable file, then both kinds of duplicate date, then both directions
	// of an unmatched pair. One table rather than three, because what each case
	// asks is the same question of a different listing.
	it.each([
		{
			problem: "a video carries no readable date",
			videos: ["Cell Injury.mp4", cellInjurySources.video],
			slides: [cellInjurySources.slide],
			expected: 'video "Cell Injury.mp4" has no extractable date',
		},
		{
			problem: "a slide carries no readable date",
			videos: [cellInjurySources.video],
			slides: ["Cell Injury deck.pdf", cellInjurySources.slide],
			expected: 'slide "Cell Injury deck.pdf" has no extractable date',
		},
		{
			problem: "two videos share a date",
			videos: [cellInjurySources.video, `${cellInjurySources.date} BOD_Cell Injury take two.mp4`],
			slides: [cellInjurySources.slide],
			expected: `two or more videos share the date ${cellInjurySources.date}`,
		},
		{
			problem: "two slides share a date",
			videos: [cellInjurySources.video],
			slides: [cellInjurySources.slide, `${cellInjurySources.date} Cell Injury handout.pdf`],
			expected: `two or more slides share the date ${cellInjurySources.date}`,
		},
		{
			problem: "a video has no slide on its date",
			videos: [cellInjurySources.video, vaccinationSources.video],
			slides: [cellInjurySources.slide],
			expected: `video "${vaccinationSources.video}" has no matching slide (date ${vaccinationSources.date})`,
		},
		{
			problem: "a slide has no video on its date",
			videos: [cellInjurySources.video],
			slides: [cellInjurySources.slide, vaccinationSources.slide],
			expected: `slide "${vaccinationSources.slide}" has no matching video (date ${vaccinationSources.date})`,
		},
	])("should refuse the sources and say so when $problem", ({ videos, slides, expected }) => {
		expect(anomaliesFor({ videos, slides })).toContain(expected);
	});

	it("should report every problem rather than the first when several sources are wrong", () => {
		const anomalies = anomaliesFor({
			videos: ["Cell Injury.mp4", vaccinationSources.video],
			slides: [immunitySources.slide],
		});

		expect(anomalies).toHaveLength(3);
	});
});

describe("orderLectures", () => {
	/**
	 * Numbers a listing, with no lecture already on disk.
	 *
	 * @param args - The source listings.
	 * @param args.videos - The video file names.
	 * @param args.slides - The slide file names.
	 * @returns The numbered lectures.
	 */
	function numberFresh({
		videos,
		slides,
	}: {
		readonly videos: readonly string[];
		readonly slides: readonly string[];
	}): ReturnType<typeof orderLectures> {
		return orderLectures({
			pairs: matchedPairs({ videos, slides }),
			existingManifests: new Map<string, RunManifest>(),
			modulePrefixes: MODULE_PREFIXES,
		});
	}

	it("should number lectures from one in date order when the listing is in another order", () => {
		const lectures = numberFresh({
			videos: [vaccinationSources.video, immunitySources.video, cellInjurySources.video],
			slides: [immunitySources.slide, cellInjurySources.slide, vaccinationSources.slide],
		});

		expect(
			lectures.map((lecture) => ({ number: lecture.lectureNumber, iso: lecture.iso })),
		).toEqual([
			{ number: 1, iso: cellInjurySources.date },
			{ number: 2, iso: immunitySources.date },
			{ number: 3, iso: vaccinationSources.date },
		]);
	});

	it("should name a lecture from its number, title and date when it is new", () => {
		const [lecture] = numberFresh({
			videos: [cellInjurySources.video],
			slides: [cellInjurySources.slide],
		});

		expect(lecture?.baseName).toBe(cellInjuryAsFirst);
	});

	it("should strip a configured module prefix when it reads a title off a filename", () => {
		const [lecture] = numberFresh({
			videos: [cellInjurySources.video],
			slides: [cellInjurySources.slide],
		});

		expect(lecture?.provisionalTitle).toBe("Cell Injury");
	});

	// A lecture of its own, on a date none of the fixtures use: what it shows is
	// that a filename with nothing left after the noise is stripped still gets a
	// name, and nothing about it should look tied to the other three.
	it("should name a lecture by its number and date alone when the filename yields no title", () => {
		const [lecture] = numberFresh({
			videos: ["2025-11-07 Lecture 1.mp4"],
			slides: ["2025-11-07 deck.pdf"],
		});

		expect(lecture?.provisionalTitle).toBe("");
		expect(lecture?.baseName).toBe("Lecture 1 - 2025-11-07");
	});

	it("should take an existing lecture's name from its manifest title when it has been retitled", () => {
		const lectureDate = cellInjurySources.date;

		const [lecture] = orderLectures({
			pairs: matchedPairs({
				videos: [cellInjurySources.video],
				slides: [cellInjurySources.slide],
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
			pairs: matchedPairs({
				videos: [`${cellInjuryAsFirst}.mp4`],
				slides: [`${cellInjuryAsFirst}.pdf`],
			}),
			existingManifests: new Map([
				[lectureDate, makeManifest({ lectureDate, provisionalTitle: "Cell Injury" })],
			]),
			modulePrefixes: MODULE_PREFIXES,
		});

		expect(lecture?.provisionalTitle).toBe("Cell Injury");
	});

	it("should carry the matched video and slide names through when a lecture is numbered", () => {
		const [lecture] = numberFresh({
			videos: [cellInjurySources.video],
			slides: [cellInjurySources.slide],
		});

		expect(lecture).toMatchObject({
			videoName: cellInjurySources.video,
			slideName: cellInjurySources.slide,
		});
	});
});
