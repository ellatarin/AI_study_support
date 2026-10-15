import { join } from "node:path";
import { describe } from "vitest";
import {
	factualErrorsFile,
	itFailsNamingAnUnusableLectureFile,
	seededFactualErrors,
	useTempDir,
} from "../fixtures.js";
import { readFactualErrorsFile } from "./factual-errors.js";

describe("readFactualErrorsFile", () => {
	const workspaceRoot = useTempDir({ prefix: "factual-errors-" });

	itFailsNamingAnUnusableLectureFile({
		reader: readFactualErrorsFile,
		workspaceRoot,
		path: (root) => join(root, factualErrorsFile),
		wrongEntries: [
			{
				state: "a file without its bypass mark",
				contents: JSON.stringify({ ...seededFactualErrors, bypassed: undefined }),
			},
		],
	});
});
