import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { StageCost } from "../../types/pipeline.js";
import {
	captureError,
	stubbedCallCost,
	stubbedCallsCost,
	trackingInFlight,
	useTempDir,
} from "../fixtures.js";
import { readPanel, runPanel, SavedRunUnreadableError } from "./panel-runs.js";

/** What these tests' runs hold: which run made them. */
type StandInRun = { readonly madeBy: number };

function isStandInRun(value: unknown): value is StandInRun {
	return typeof (value as StandInRun | null)?.madeBy === "number";
}

/** What making run `runNumber` produces: the run, at the cost of one stubbed call. */
function standInRun({ runNumber }: { readonly runNumber: number }): {
	run: StandInRun;
	cost: StageCost;
} {
	return { run: { madeBy: runNumber }, cost: stubbedCallCost };
}

/** A run maker that records which runs it was asked for, in the order asked. */
function standInMaker(): ReturnType<
	typeof vi.fn<
		(args: { readonly runNumber: number }) => Promise<{ run: StandInRun; cost: StageCost | null }>
	>
> {
	return vi.fn(({ runNumber }: { readonly runNumber: number }) =>
		Promise.resolve(standInRun({ runNumber })),
	);
}

const directory = useTempDir({ prefix: "panel-" });

/** Writes a file into the panel's directory as a previous launch would have left it. */
function leaveBehind({
	name,
	contents,
}: {
	readonly name: string;
	readonly contents: string;
}): Promise<void> {
	return writeFile(join(directory(), name), contents, "utf8");
}

describe("runPanel", () => {
	/** Runs a panel of `panelSize` stand-in runs in the test's directory. */
	function panelOf({
		panelSize,
		makeRun,
		concurrency,
	}: {
		readonly panelSize: number;
		readonly makeRun: ReturnType<typeof standInMaker>;
		readonly concurrency?: number;
	}): ReturnType<typeof runPanel<StandInRun>> {
		return runPanel({
			panelSize,
			concurrency,
			directory: directory(),
			isRun: isStandInRun,
			makeRun,
		});
	}

	it("should return every run in run order when the panel is made from scratch", async () => {
		const makeRun = standInMaker();
		const { runs } = await panelOf({ panelSize: 3, makeRun, concurrency: 3 });
		expect(runs).toEqual([{ madeBy: 1 }, { madeBy: 2 }, { madeBy: 3 }]);
	});

	it("should save each run to its own numbered file when the run completes", async () => {
		const { runFiles } = await panelOf({ panelSize: 2, makeRun: standInMaker() });
		expect(runFiles).toEqual([join(directory(), "run-01.json"), join(directory(), "run-02.json")]);
		expect(JSON.parse(await readFile(join(directory(), "run-02.json"), "utf8"))).toEqual({
			madeBy: 2,
		});
	});

	it("should make only the missing runs when some were saved by an earlier launch", async () => {
		await leaveBehind({ name: "run-02.json", contents: JSON.stringify({ madeBy: 99 }) });
		const makeRun = standInMaker();
		const { runs } = await panelOf({ panelSize: 3, makeRun });
		expect(makeRun.mock.calls.map(([args]) => args.runNumber)).toEqual([1, 3]);
		expect(runs).toEqual([{ madeBy: 1 }, { madeBy: 99 }, { madeBy: 3 }]);
	});

	it("should add up the cost of the runs it made when some were saved by an earlier launch", async () => {
		await leaveBehind({ name: "run-01.json", contents: JSON.stringify({ madeBy: 1 }) });
		const { cost } = await panelOf({ panelSize: 3, makeRun: standInMaker() });
		expect(cost).toEqual(stubbedCallsCost({ calls: 2 }));
	});

	it("should report no cost when every run was saved by an earlier launch", async () => {
		await leaveBehind({ name: "run-01.json", contents: JSON.stringify({ madeBy: 1 }) });
		const makeRun = standInMaker();
		const { cost } = await panelOf({ panelSize: 1, makeRun });
		expect(cost).toBeNull();
		expect(makeRun).not.toHaveBeenCalled();
	});

	it("should report no cost when the runs it made needed no calls", async () => {
		const makeRun = standInMaker();
		makeRun.mockImplementation(({ runNumber }) =>
			Promise.resolve({ ...standInRun({ runNumber }), cost: null }),
		);
		const { cost } = await panelOf({ panelSize: 2, makeRun });
		expect(cost).toBeNull();
	});

	it.each([
		{ problem: "not JSON", contents: "{ half a run" },
		{ problem: "not a run", contents: JSON.stringify({ somethingElse: true }) },
	])("should fail naming the file when a saved run is $problem", async ({ contents }) => {
		await leaveBehind({ name: "run-02.json", contents });
		const error = await captureError(panelOf({ panelSize: 3, makeRun: standInMaker() }));
		expect(error).toBeInstanceOf(SavedRunUnreadableError);
		expect(error.message).toContain(join(directory(), "run-02.json"));
	});

	it("should keep the runs already saved when a later run fails", async () => {
		const makeRun = standInMaker();
		makeRun.mockImplementation(({ runNumber }) =>
			runNumber === 3
				? Promise.reject(new Error("run 3 failed after 3 sends"))
				: Promise.resolve(standInRun({ runNumber })),
		);
		await captureError(panelOf({ panelSize: 3, makeRun }));
		expect((await readdir(directory())).sort()).toEqual(["run-01.json", "run-02.json"]);
	});

	it("should make one run at a time when the stage sets no concurrency", async () => {
		const { tracked, peak } = trackingInFlight(({ runNumber }: { readonly runNumber: number }) =>
			Promise.resolve(standInRun({ runNumber })),
		);
		const makeRun = standInMaker();
		makeRun.mockImplementation(tracked);
		await panelOf({ panelSize: 4, makeRun });
		expect(peak()).toBe(1);
	});
});

describe("readPanel", () => {
	/** The error a caller of these tests builds for a missing run. */
	class MissingRunError extends Error {}

	/** Reads a panel of `panelSize` stand-in runs from the test's directory. */
	function readingPanel({
		panelSize,
	}: {
		readonly panelSize: number;
	}): Promise<readonly StandInRun[]> {
		return readPanel({
			panelSize,
			directory: directory(),
			isRun: isStandInRun,
			fail: (message) => new MissingRunError(message),
		});
	}

	/** Saves the stand-in run `runNumber` as a finished panel would have. */
	function save(runNumber: number): Promise<void> {
		return leaveBehind({
			name: `run-0${runNumber}.json`,
			contents: JSON.stringify(standInRun({ runNumber }).run),
		});
	}

	it("should return every saved run in run order when the panel is complete", async () => {
		await save(2);
		await save(1);
		expect(await readingPanel({ panelSize: 2 })).toEqual([{ madeBy: 1 }, { madeBy: 2 }]);
	});

	it("should fail with the caller's error naming the file when a run is missing", async () => {
		await save(1);
		const error = await captureError(readingPanel({ panelSize: 2 }));
		expect(error).toBeInstanceOf(MissingRunError);
		expect(error.message).toContain(join(directory(), "run-02.json"));
	});

	it("should fail naming the file when a saved run is not a run", async () => {
		await leaveBehind({ name: "run-01.json", contents: JSON.stringify({ somethingElse: true }) });
		expect(await captureError(readingPanel({ panelSize: 1 }))).toBeInstanceOf(
			SavedRunUnreadableError,
		);
	});
});
