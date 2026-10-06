import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { makeConfig, makeManifest, testModuleName } from "./fixtures.js";
import { workspaceRootFor } from "./layout.js";
import { assembleContext } from "./stage-context.js";

describe("assembleContext", () => {
	const moduleRoot = resolve("/base", testModuleName);
	const workspaceRoot = workspaceRootFor({ moduleRoot, baseName: "L1" });

	it("should derive moduleRoot two levels up and attach config and manifest when assembling a context", () => {
		const manifest = makeManifest({ lectureNumber: 3, lectureTitle: "Cellular Respiration" });
		const config = makeConfig();

		const context = assembleContext({ workspaceRoot, manifest, config });

		// The expected value is the module root that the workspace was built in. It
		// does not repeat the "../.." step that assembleContext uses.
		expect(context.moduleRoot).toBe(moduleRoot);
		expect(context.workspaceRoot).toBe(workspaceRoot);
		expect(context.config).toBe(config);
		expect(context.manifest).toBe(manifest);
		expect(context.lectureNumber).toBe(3);
		expect(context.lectureTitle).toBe("Cellular Respiration");
	});

	it("should return a frozen context when assembling a context", () => {
		const context = assembleContext({
			workspaceRoot,
			manifest: makeManifest(),
			config: makeConfig(),
		});

		expect(Object.isFrozen(context)).toBe(true);
	});
});
