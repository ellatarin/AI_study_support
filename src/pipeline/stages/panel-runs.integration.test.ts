import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { StageCost } from "../../types/pipeline.js";
import {
	captureError,
	readJsonFile,
	stubbedCallCost,
	stubbedCallsCost,
	trackingInFlight,
	useTempDir,
} from "../fixtures.js";
import { readPanel, runPanel, SavedRunUnreadableError } from "./panel-runs.js";

/**
 * What these tests' runs hold: only the number of the run that made them. The
 * panel machinery never looks inside a run, so a run needs to hold nothing more
 * for these tests to see which run landed where.
 */
type NumberedRun = { readonly madeBy: number };

/** Reads a saved value back as a numbered run, or `null` when it holds no run number. */
function readNumberedRun(value: unknown): NumberedRun | null {
	const madeBy = (value as NumberedRun | null)?.madeBy;
	return typeof madeBy === "number" ? { madeBy } : null;
}

/** What making run `runNumber` produces: the run, at the cost of one stubbed call. */
function numberedRun({ runNumber }: { readonly runNumber: number }): {
	run: NumberedRun;
	cost: StageCost;
} {
	return { run: { madeBy: runNumber }, cost: stubbedCallCost };
}

/** A run maker that records which runs it was asked for, in the order asked. */
function numberedRunMaker(): ReturnType<
	typeof vi.fn<
		(args: { readonly runNumber: number }) => Promise<{ run: NumberedRun; cost: StageCost | null }>
	>
> {
	return vi.fn(({ runNumber }: { readonly runNumber: number }) =>
		Promise.resolve(numberedRun({ runNumber })),
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
	/** Runs a panel of `panelSize` numbered runs in the test's directory. */
	function panelOf({
		panelSize,
		makeRun,
		concurrency,
	}: {
		readonly panelSize: number;
		readonly makeRun: ReturnType<typeof numberedRunMaker>;
		readonly concurrency?: number;
	}): ReturnType<typeof runPanel<NumberedRun>> {
		return runPanel({
			panelSize,
			concurrency,
			directory: directory(),
			readRun: readNumberedRun,
			makeRun,
		});
	}

	it("should return every run in run order when the panel is made from scratch", async () => {
		const makeRun = numberedRunMaker();
		const { runs } = await panelOf({ panelSize: 3, makeRun, concurrency: 3 });
		expect(runs).toEqual([{ madeBy: 1 }, { madeBy: 2 }, { madeBy: 3 }]);
	});

	it("should save each run to its own numbered file when the run completes", async () => {
		const { runFiles } = await panelOf({ panelSize: 2, makeRun: numberedRunMaker() });
		expect(runFiles).toEqual([join(directory(), "run-01.json"), join(directory(), "run-02.json")]);
		expect(await readJsonFile(join(directory(), "run-02.json"))).toEqual({
			madeBy: 2,
		});
	});

	it("should make only the missing runs when some were saved by an earlier launch", async () => {
		await leaveBehind({ name: "run-02.json", contents: JSON.stringify({ madeBy: 99 }) });
		const makeRun = numberedRunMaker();
		const { runs } = await panelOf({ panelSize: 3, makeRun });
		expect(makeRun.mock.calls.map(([args]) => args.runNumber)).toEqual([1, 3]);
		expect(runs).toEqual([{ madeBy: 1 }, { madeBy: 99 }, { madeBy: 3 }]);
	});

	it("should add up the cost of the runs it made when some were saved by an earlier launch", async () => {
		await leaveBehind({ name: "run-01.json", contents: JSON.stringify({ madeBy: 1 }) });
		const { cost } = await panelOf({ panelSize: 3, makeRun: numberedRunMaker() });
		expect(cost).toEqual(stubbedCallsCost({ calls: 2 }));
	});

	it("should report no cost when every run was saved by an earlier launch", async () => {
		await leaveBehind({ name: "run-01.json", contents: JSON.stringify({ madeBy: 1 }) });
		const makeRun = numberedRunMaker();
		const { cost } = await panelOf({ panelSize: 1, makeRun });
		expect(cost).toBeNull();
		expect(makeRun).not.toHaveBeenCalled();
	});

	it("should report no cost when the runs it made needed no calls", async () => {
		const makeRun = numberedRunMaker();
		makeRun.mockImplementation(({ runNumber }) =>
			Promise.resolve({ ...numberedRun({ runNumber }), cost: null }),
		);
		const { cost } = await panelOf({ panelSize: 2, makeRun });
		expect(cost).toBeNull();
	});

	it.each([
		{ problem: "not JSON", contents: "{ half a run" },
		{ problem: "not a run", contents: JSON.stringify({ somethingElse: true }) },
	])("should fail naming the file when a saved run is $problem", async ({ contents }) => {
		await leaveBehind({ name: "run-02.json", contents });
		const error = await captureError(panelOf({ panelSize: 3, makeRun: numberedRunMaker() }));
		expect(error).toBeInstanceOf(SavedRunUnreadableError);
		expect(error.message).toContain(join(directory(), "run-02.json"));
	});

	it("should keep the runs already saved when a later run fails", async () => {
		const makeRun = numberedRunMaker();
		makeRun.mockImplementation(({ runNumber }) =>
			runNumber === 3
				? Promise.reject(new Error("run 3 failed after 3 sends"))
				: Promise.resolve(numberedRun({ runNumber })),
		);
		await captureError(panelOf({ panelSize: 3, makeRun }));
		expect((await readdir(directory())).sort()).toEqual(["run-01.json", "run-02.json"]);
	});

	it("should make one run at a time when the stage sets no concurrency", async () => {
		const { tracked, peak } = trackingInFlight(({ runNumber }: { readonly runNumber: number }) =>
			Promise.resolve(numberedRun({ runNumber })),
		);
		const makeRun = numberedRunMaker();
		makeRun.mockImplementation(tracked);
		await panelOf({ panelSize: 4, makeRun });
		expect(peak()).toBe(1);
	});
});

describe("readPanel", () => {
	/** The error a caller of these tests builds for a missing run. */
	class MissingRunError extends Error {}

	/** Reads a panel of `panelSize` numbered runs from the test's directory. */
	function readingPanel({
		panelSize,
	}: {
		readonly panelSize: number;
	}): Promise<readonly NumberedRun[]> {
		return readPanel({
			panelSize,
			directory: directory(),
			readRun: readNumberedRun,
			fail: (message) => new MissingRunError(message),
		});
	}

	/** Saves the numbered run `runNumber` as a finished panel would have. */
	function save(runNumber: number): Promise<void> {
		return leaveBehind({
			name: `run-0${runNumber}.json`,
			contents: JSON.stringify(numberedRun({ runNumber }).run),
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
