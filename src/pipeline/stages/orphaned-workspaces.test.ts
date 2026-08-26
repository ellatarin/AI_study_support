import { describe, expect, it } from "vitest";
import {
	cellInjurySources,
	immunitySources,
	makeManifest,
	vaccinationSources,
} from "../fixtures.js";
import { type ExistingWorkspace, findOrphans } from "./orphaned-workspaces.js";

// Only the dates matter here: what makes a workspace an orphan is that its date
// has no sources left, and the order they are put to the user in is date order.
const CELL_INJURY_DATE = cellInjurySources.date;
const IMMUNITY_DATE = immunitySources.date;
const VACCINATION_DATE = vaccinationSources.date;

/**
 * The workspaces on disk, keyed by the date each one's manifest records.
 *
 * @param dates - The lecture dates workspaces exist for.
 * @returns The workspaces, as discovery hands them over.
 */
function workspacesOn(dates: readonly string[]): ReadonlyMap<string, ExistingWorkspace> {
	return new Map(
		dates.map((lectureDate) => [
			lectureDate,
			{ folder: `workspace ${lectureDate}`, manifest: makeManifest({ lectureDate }) },
		]),
	);
}

/**
 * The folders {@link findOrphans} would put to the user, in the order it asks.
 *
 * @param args - The state to compare.
 * @param args.workspaceDates - The dates workspaces exist for.
 * @param args.sourceDates - The dates a video and slide are still present for.
 * @returns The orphaned folder names.
 */
function orphanedFolders({
	workspaceDates,
	sourceDates,
}: {
	readonly workspaceDates: readonly string[];
	readonly sourceDates: readonly string[];
}): readonly string[] {
	return findOrphans({
		workspaces: workspacesOn(workspaceDates),
		presentIsos: new Set(sourceDates),
	}).map((orphan) => orphan.folder);
}

describe("findOrphans", () => {
	it("should find nothing when every workspace still has its source pair", () => {
		expect(
			orphanedFolders({
				workspaceDates: [CELL_INJURY_DATE, VACCINATION_DATE],
				sourceDates: [CELL_INJURY_DATE, VACCINATION_DATE],
			}),
		).toEqual([]);
	});

	it("should find the workspace whose date has no sources left when one is removed", () => {
		expect(
			orphanedFolders({
				workspaceDates: [CELL_INJURY_DATE, VACCINATION_DATE],
				sourceDates: [VACCINATION_DATE],
			}),
		).toEqual([`workspace ${CELL_INJURY_DATE}`]);
	});

	it("should list orphans in date order when several workspaces have lost their sources", () => {
		expect(
			orphanedFolders({
				workspaceDates: [VACCINATION_DATE, CELL_INJURY_DATE, IMMUNITY_DATE],
				sourceDates: [],
			}),
		).toEqual([
			`workspace ${CELL_INJURY_DATE}`,
			`workspace ${IMMUNITY_DATE}`,
			`workspace ${VACCINATION_DATE}`,
		]);
	});

	it("should find nothing when there are no workspaces at all", () => {
		expect(orphanedFolders({ workspaceDates: [], sourceDates: [CELL_INJURY_DATE] })).toEqual([]);
	});
});
