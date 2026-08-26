import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	cellInjuryAsFirst,
	cellInjurySources,
	testModuleRoot,
	vaccinationAsSecond,
	vaccinationSources,
} from "../fixtures.js";
import { moduleDirs } from "../layout.js";
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
 * @param lecture.baseName - The name every one of the lecture's four items should carry.
 * @param lecture.videoName - The source video's current name.
 * @param lecture.slideName - The slide deck's current name.
 * @param lecture.iso - The lecture's `YYYY-MM-DD` date.
 * @returns The lecture.
 */
function lectureNamed({
	baseName,
	videoName,
	slideName,
	iso,
}: Pick<Lecture, "baseName" | "videoName" | "slideName" | "iso">): Lecture {
	return { baseName, videoName, slideName, iso, lectureNumber: 1, provisionalTitle: "" };
}

const cellInjury = lectureNamed({
	baseName: cellInjuryAsFirst,
	videoName: cellInjurySources.video,
	slideName: cellInjurySources.slide,
	iso: cellInjurySources.date,
});

const vaccination = lectureNamed({
	baseName: vaccinationAsSecond,
	videoName: vaccinationSources.video,
	slideName: vaccinationSources.slide,
	iso: vaccinationSources.date,
});

/**
 * What the plan says, as directory-relative moves.
 *
 * @param args - The state to reconcile.
 * @param args.lectures - The target lectures.
 * @param args.existingFolders - Existing workspace folder names, keyed by lecture date.
 * @param args.existingPdfs - Existing `Final output/` PDF names, keyed by lecture date.
 * @returns One `dir/source → target` line per planned move.
 */
function plannedMoves({
	lectures,
	existingFolders = new Map<string, string>(),
	existingPdfs = new Map<string, string>(),
}: {
	readonly lectures: readonly Lecture[];
	readonly existingFolders?: ReadonlyMap<string, string>;
	readonly existingPdfs?: ReadonlyMap<string, string>;
}): readonly string[] {
	return planRenames({ lectures, dirs, existingFolders, existingPdfs }).map(
		(operation) => `${join(operation.dir, operation.source)} → ${operation.target}`,
	);
}

describe("planRenames", () => {
	it("should move a video and its slide onto the lecture's base name when they are freshly named", () => {
		expect(plannedMoves({ lectures: [cellInjury] })).toEqual([
			`${join(dirs.video, cellInjurySources.video)} → ${cellInjuryAsFirst}.mp4`,
			`${join(dirs.slide, cellInjurySources.slide)} → ${cellInjuryAsFirst}.pdf`,
		]);
	});

	it("should plan nothing when every item already sits at the name the numbering wants", () => {
		const settled = lectureNamed({
			baseName: cellInjuryAsFirst,
			videoName: `${cellInjuryAsFirst}.mp4`,
			slideName: `${cellInjuryAsFirst}.pdf`,
			iso: cellInjury.iso,
		});

		expect(
			plannedMoves({
				lectures: [settled],
				existingFolders: new Map([[settled.iso, cellInjuryAsFirst]]),
				existingPdfs: new Map([[settled.iso, `${cellInjuryAsFirst}.pdf`]]),
			}),
		).toEqual([]);
	});

	it("should move the workspace folder and the final PDF too when a lecture is renumbered", () => {
		const renumbered = lectureNamed({
			baseName: vaccinationAsSecond,
			videoName: `${cellInjuryAsFirst}.mp4`,
			slideName: `${cellInjuryAsFirst}.pdf`,
			iso: vaccination.iso,
		});

		expect(
			plannedMoves({
				lectures: [renumbered],
				existingFolders: new Map([[renumbered.iso, cellInjuryAsFirst]]),
				existingPdfs: new Map([[renumbered.iso, `${cellInjuryAsFirst}.pdf`]]),
			}),
		).toEqual([
			`${join(dirs.video, cellInjuryAsFirst)}.mp4 → ${vaccinationAsSecond}.mp4`,
			`${join(dirs.slide, cellInjuryAsFirst)}.pdf → ${vaccinationAsSecond}.pdf`,
			`${join(dirs.processing, cellInjuryAsFirst)} → ${vaccinationAsSecond}`,
			`${join(dirs.finalOutput, cellInjuryAsFirst)}.pdf → ${vaccinationAsSecond}.pdf`,
		]);
	});

	it("should keep the extension each source carried when the names differ between them", () => {
		const mixed = lectureNamed({
			baseName: cellInjuryAsFirst,
			videoName: `${cellInjurySources.date} BOD_Cell Injury.mkv`,
			slideName: `${cellInjurySources.date} Cell Injury deck.pptx`,
			iso: cellInjury.iso,
		});

		expect(plannedMoves({ lectures: [mixed] })).toEqual([
			`${join(dirs.video, mixed.videoName)} → ${cellInjuryAsFirst}.mkv`,
			`${join(dirs.slide, mixed.slideName)} → ${cellInjuryAsFirst}.pptx`,
		]);
	});

	it("should plan a move for every lecture when several are renumbered at once", () => {
		expect(plannedMoves({ lectures: [cellInjury, vaccination] })).toHaveLength(4);
	});
});
