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
 * Builds a lecture as the numbering gives it, for the planning tests. The plan
 * does not read the lecture number or the provisional title, so they have fixed
 * values here.
 *
 * @param lecture - The parts that the plan reads.
 * @param lecture.baseName - The target base name of the four lecture files.
 * @param lecture.videoRecordingName - The current name of the video recording.
 * @param lecture.slideDeckName - The current name of the slide deck.
 * @param lecture.lectureDate - The `YYYY-MM-DD` lecture date.
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
 * Gives the planned renames as lines of text.
 *
 * @param args - The lectures, and the existing workspaces and PDFs.
 * @param args.lectures - The lectures with their new numbers.
 * @param args.existingBaseNames - The base names of the existing workspaces, keyed by lecture date.
 * @param args.existingPdfs - The names of the PDFs in the final output folder, keyed by lecture date.
 * @returns One `dir/source → target` line for each planned rename.
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
