import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { NamedError } from "../../utils/errors.js";
import { readJsonFile, seedJsonFile, useTempDir } from "../fixtures.js";
import { readOrMakeSubtopicFiles, runUnlistedSubtopicFileStage } from "./subtopic-files.js";

/** The error of the stage in this suite. */
class SubtopicStageError extends NamedError {}

/** The content of the file of one subtopic in this suite. */
type SubtopicEntry = { readonly subtopicId: number; readonly paragraphs: readonly string[] };

/**
 * Checks that a parsed saved file is the file of one subtopic in this suite.
 *
 * @param value - The parsed file.
 * @returns `true` when the value has a subtopic id and paragraphs.
 */
function isSubtopicEntry(value: unknown): value is SubtopicEntry {
	return (
		typeof value === "object" && value !== null && "subtopicId" in value && "paragraphs" in value
	);
}

const subtopics = [{ subtopicId: 1 }, { subtopicId: 2 }];

/**
 * Makes the file of one subtopic of this suite.
 *
 * @param subtopic - The subtopic.
 * @param subtopic.subtopicId - The subtopic.
 * @returns The entry of the subtopic.
 */
function madeEntry({ subtopicId }: { readonly subtopicId: number }): SubtopicEntry {
	return { subtopicId, paragraphs: [`Made ${subtopicId}.`] };
}

/** The folder of the stage in the test workspace. */
const STAGE_FOLDER = "Stage folder";

const workspaceRoot = useTempDir({ prefix: "subtopic-files-" });

/**
 * Gives the folder of the stage in the workspace of the current test.
 *
 * @returns The absolute path of {@link STAGE_FOLDER}.
 */
function stageDirectory(): string {
	return join(workspaceRoot(), STAGE_FOLDER);
}

/**
 * Gives the arguments that both functions of this suite take, for the test subtopics.
 *
 * @returns The workspace, the folder, the subtopics, the saved-file check, the error and no `concurrency`.
 */
function sharedArgs(): Omit<Parameters<typeof readOrMakeSubtopicFiles>[0], "make"> {
	return {
		workspaceRoot: workspaceRoot(),
		directory: stageDirectory(),
		subtopics,
		isSaved: isSubtopicEntry,
		saved: { content: "entry", remake: "make the entry" },
		fail: (message) => new SubtopicStageError(message),
		concurrency: undefined,
	};
}

describe("readOrMakeSubtopicFiles", () => {
	it("should read a saved file back, and make only the file that is missing, when one subtopic has a saved file", async () => {
		const savedEntry = { subtopicId: 1, paragraphs: ["Saved 1."] };
		await seedJsonFile({ path: join(stageDirectory(), "subtopic-1.json"), contents: savedEntry });
		const make = vi.fn(async (subtopic: { readonly subtopicId: number }) => madeEntry(subtopic));

		const { contents } = await readOrMakeSubtopicFiles({ ...sharedArgs(), make });

		expect(contents).toStrictEqual([savedEntry, madeEntry({ subtopicId: 2 })]);
		expect(make.mock.calls).toStrictEqual([[{ subtopicId: 2 }]]);
	});
});

describe("runUnlistedSubtopicFileStage", () => {
	it("should make the folder, write the file of each subtopic and the entries in lecture order under the key, and give the filesWritten entry of each file, when no file is saved", async () => {
		const entriesPath = join(stageDirectory(), "entries.json");

		const { output, filesWritten } = await runUnlistedSubtopicFileStage({
			...sharedArgs(),
			make: async (subtopic) => madeEntry(subtopic),
			entriesPath,
			key: "entries",
		});

		const entries = subtopics.map(madeEntry);
		expect(output).toStrictEqual({ entries });
		expect(await readJsonFile(entriesPath)).toStrictEqual({ entries });
		expect(await readJsonFile(join(stageDirectory(), "subtopic-2.json"))).toStrictEqual(entries[1]);
		expect(filesWritten).toStrictEqual([
			join(STAGE_FOLDER, "subtopic-1.json"),
			join(STAGE_FOLDER, "subtopic-2.json"),
			join(STAGE_FOLDER, "entries.json"),
		]);
	});
});
