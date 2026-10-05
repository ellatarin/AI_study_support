import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	cellInjuryAsFirst,
	cellInjurySources,
	testModuleRoot,
	vaccinationAsSecond,
	vaccinationSources,
} from "../../fixtures.js";
import { moduleDirs } from "../../layout.js";
import type { Lecture } from "./lecture-resolution.js";
import { planRenames } from "./source-renames.js";

const dirs = moduleDirs({ moduleRoot: testModuleRoot });

/**
 * A lecture as the numbering left it, for asking what would be moved.
 *
 * Planning reads only a lecture's number-free parts — where its files are now
 * and what they should be called — so the rest is filled in with settled values
 * rather than restated by each test.
 *
 * @param lecture - The parts the plan turns on.
 * @param lecture.baseName - The name every one of the lecture's four lecture files should carry.
 * @param lecture.videoRecordingName - The source video's current name.
 * @param lecture.slideDeckName - The slide deck's current name.
 * @param lecture.lectureDate - The lecture's `YYYY-MM-DD` date.
 * @returns The lecture.
 */
function lectureNamed({
	baseName,
	videoRecordingName,
	slideDeckName,
	lectureDate,
}: Pick<Lecture, "baseName" | "videoRecordingName" | "slideDeckName" | "lectureDate">): Lecture {
	return {
		baseName,
		videoRecordingName,
		slideDeckName,
		lectureDate,
		lectureNumber: 1,
		provisionalTitle: "",
	};
}

const cellInjury = lectureNamed({
	baseName: cellInjuryAsFirst,
	videoRecordingName: cellInjurySources.videoRecording,
	slideDeckName: cellInjurySources.slideDeck,
	lectureDate: cellInjurySources.date,
});

const vaccination = lectureNamed({
	baseName: vaccinationAsSecond,
	videoRecordingName: vaccinationSources.videoRecording,
	slideDeckName: vaccinationSources.slideDeck,
	lectureDate: vaccinationSources.date,
});

/**
 * What the plan says, as directory-relative moves.
 *
 * @param args - The state to reconcile.
 * @param args.lectures - The target lectures.
 * @param args.existingBaseNames - The base names of the existing workspaces, keyed by lecture date.
 * @param args.existingPdfs - Existing `Final output/` PDF names, keyed by lecture date.
 * @returns One `dir/source → target` line per planned move.
 */
function plannedMoves({
	lectures,
	existingBaseNames = new Map<string, string>(),
	existingPdfs = new Map<string, string>(),
}: {
	readonly lectures: readonly Lecture[];
	readonly existingBaseNames?: ReadonlyMap<string, string>;
	readonly existingPdfs?: ReadonlyMap<string, string>;
}): readonly string[] {
	return planRenames({ lectures, dirs, existingBaseNames, existingPdfs }).map(
		(operation) => `${join(operation.dir, operation.source)} → ${operation.target}`,
	);
}

describe("planRenames", () => {
	it("should move a video recording and its slide deck onto the lecture's base name when they are freshly named", () => {
		expect(plannedMoves({ lectures: [cellInjury] })).toEqual([
			`${join(dirs.videoRecording, cellInjurySources.videoRecording)} → ${cellInjuryAsFirst}.mp4`,
			`${join(dirs.slideDeck, cellInjurySources.slideDeck)} → ${cellInjuryAsFirst}.pdf`,
		]);
	});

	it("should plan nothing when every lecture file already sits at the name the numbering wants", () => {
		const settled = lectureNamed({
			baseName: cellInjuryAsFirst,
			videoRecordingName: `${cellInjuryAsFirst}.mp4`,
			slideDeckName: `${cellInjuryAsFirst}.pdf`,
			lectureDate: cellInjury.lectureDate,
		});

		expect(
			plannedMoves({
				lectures: [settled],
				existingBaseNames: new Map([[settled.lectureDate, cellInjuryAsFirst]]),
				existingPdfs: new Map([[settled.lectureDate, `${cellInjuryAsFirst}.pdf`]]),
			}),
		).toEqual([]);
	});

	it("should move the workspace folder and the final PDF too when a lecture is renumbered", () => {
		const renumbered = lectureNamed({
			baseName: vaccinationAsSecond,
			videoRecordingName: `${cellInjuryAsFirst}.mp4`,
			slideDeckName: `${cellInjuryAsFirst}.pdf`,
			lectureDate: vaccination.lectureDate,
		});

		expect(
			plannedMoves({
				lectures: [renumbered],
				existingBaseNames: new Map([[renumbered.lectureDate, cellInjuryAsFirst]]),
				existingPdfs: new Map([[renumbered.lectureDate, `${cellInjuryAsFirst}.pdf`]]),
			}),
		).toEqual([
			`${join(dirs.videoRecording, cellInjuryAsFirst)}.mp4 → ${vaccinationAsSecond}.mp4`,
			`${join(dirs.slideDeck, cellInjuryAsFirst)}.pdf → ${vaccinationAsSecond}.pdf`,
			`${join(dirs.processing, cellInjuryAsFirst)} → ${vaccinationAsSecond}`,
			`${join(dirs.finalOutput, cellInjuryAsFirst)}.pdf → ${vaccinationAsSecond}.pdf`,
		]);
	});

	it("should keep the extension each source carried when the names differ between them", () => {
		const mixed = lectureNamed({
			baseName: cellInjuryAsFirst,
			videoRecordingName: `${cellInjurySources.date} BOD_Cell Injury.mkv`,
			slideDeckName: `${cellInjurySources.date} Cell Injury deck.pptx`,
			lectureDate: cellInjury.lectureDate,
		});

		expect(plannedMoves({ lectures: [mixed] })).toEqual([
			`${join(dirs.videoRecording, mixed.videoRecordingName)} → ${cellInjuryAsFirst}.mkv`,
			`${join(dirs.slideDeck, mixed.slideDeckName)} → ${cellInjuryAsFirst}.pptx`,
		]);
	});

	it("should plan a move for every lecture when several are renumbered at once", () => {
		expect(plannedMoves({ lectures: [cellInjury, vaccination] })).toHaveLength(4);
	});
});
