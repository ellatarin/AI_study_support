import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { StageCost } from "../../types/pipeline.js";
import { captureError, stubbedCallCost, stubbedCallsCost, useTempDir } from "../fixtures.js";
import { runPanel, SavedRunUnreadableError } from "./panel-runs.js";

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
		(args: { readonly runNumber: number }) => Promise<{ run: StandInRun; cost: StageCost }>
	>
> {
	return vi.fn(({ runNumber }: { readonly runNumber: number }) =>
		Promise.resolve(standInRun({ runNumber })),
	);
}

describe("runPanel", () => {
	const directory = useTempDir({ prefix: "panel-" });

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
		let inFlight = 0;
		let peak = 0;
		const makeRun = standInMaker();
		makeRun.mockImplementation(async ({ runNumber }) => {
			inFlight += 1;
			peak = Math.max(peak, inFlight);
			await new Promise((resolve) => {
				setImmediate(resolve);
			});
			inFlight -= 1;
			return standInRun({ runNumber });
		});
		await panelOf({ panelSize: 4, makeRun });
		expect(peak).toBe(1);
	});
});
