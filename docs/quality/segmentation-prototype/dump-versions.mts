/**
 * Write the grouping prompt registry out as JSON, so the report generator and
 * the ledger read the same version metadata the trial runs use. The registry in
 * `group-prompts.mts` stays the single home; this is a projection of it.
 *
 * Usage: pnpm exec tsx dump-versions.mts
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { GROUP_PROMPTS } from "./group-prompts.mts";

await writeFile(
	join(import.meta.dirname, "group-versions.json"),
	JSON.stringify(
		GROUP_PROMPTS.map((version) => ({
			id: version.id,
			summary: version.summary,
			changed: version.changed,
			promptWithLabels: version.build({ labelsShown: true }),
			promptWithoutLabels: version.build({ labelsShown: false }),
		})),
		null,
		2,
	),
	"utf8",
);
console.log("group-versions.json written");
