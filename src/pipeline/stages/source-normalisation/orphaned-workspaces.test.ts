import { describe, expect, it } from "vitest";
import {
	cellInjurySources,
	immunitySources,
	makeManifest,
	vaccinationSources,
} from "../../fixtures.js";
import { type ExistingWorkspace, findOrphanedWorkspaces } from "./orphaned-workspaces.js";

// Only the dates matter here. A workspace is orphaned when its lecture date has
// no sources, and the questions to the user are in date order.
const CELL_INJURY_DATE = cellInjurySources.date;
const IMMUNITY_DATE = immunitySources.date;
const VACCINATION_DATE = vaccinationSources.date;

/**
 * Builds the existing workspaces, keyed by the lecture date in each manifest.
 *
 * @param dates - The lecture dates that have a workspace.
 * @returns The workspaces, in the form that `discoverWorkspaces` gives them.
 */
function workspacesOn(dates: readonly string[]): ReadonlyMap<string, ExistingWorkspace> {
	return new Map(
		dates.map((lectureDate) => [
			lectureDate,
			{ baseName: `workspace ${lectureDate}`, manifest: makeManifest({ lectureDate }) },
		]),
	);
}

/**
 * Gives the base names of the orphaned workspaces that {@link findOrphanedWorkspaces}
 * finds, in the order of the questions to the user.
 *
 * @param args - The lecture dates to compare.
 * @param args.workspaceDates - The lecture dates that have a workspace.
 * @param args.sourceDates - The lecture dates that still have a video recording and a slide deck.
 * @returns The base names of the orphaned workspaces.
 */
function baseNamesOfOrphanedWorkspaces({
	workspaceDates,
	sourceDates,
}: {
	readonly workspaceDates: readonly string[];
	readonly sourceDates: readonly string[];
}): readonly string[] {
	return findOrphanedWorkspaces({
		workspaces: workspacesOn(workspaceDates),
		presentLectureDates: new Set(sourceDates),
	}).map((orphanedWorkspace) => orphanedWorkspace.baseName);
}

describe("findOrphanedWorkspaces", () => {
	it("should find nothing when every workspace still has its source pair", () => {
		expect(
			baseNamesOfOrphanedWorkspaces({
				workspaceDates: [CELL_INJURY_DATE, VACCINATION_DATE],
				sourceDates: [CELL_INJURY_DATE, VACCINATION_DATE],
			}),
		).toEqual([]);
	});

	it("should find the workspace whose date has no sources left when one is removed", () => {
		expect(
			baseNamesOfOrphanedWorkspaces({
				workspaceDates: [CELL_INJURY_DATE, VACCINATION_DATE],
				sourceDates: [VACCINATION_DATE],
			}),
		).toEqual([`workspace ${CELL_INJURY_DATE}`]);
	});

	it("should list orphaned workspaces in date order when several workspaces have lost their sources", () => {
		expect(
			baseNamesOfOrphanedWorkspaces({
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
		expect(
			baseNamesOfOrphanedWorkspaces({ workspaceDates: [], sourceDates: [CELL_INJURY_DATE] }),
		).toEqual([]);
	});
});
