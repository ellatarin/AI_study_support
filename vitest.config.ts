import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// CLAUDE.md L53: `foo.test.ts` for unit, `foo.integration.test.ts` for integration.
		// Brace expansion below yields *.test.ts and *.integration.test.ts (and .tsx variants).
		include: ["src/**/*.{test,integration.test}.{ts,tsx}"],

		// Coverage: v8 provider (native, fast). Thresholds are DELIBERATELY left
		// commented out. Once Phase 1 has a baseline of tested code, uncomment and
		// tune to real values — setting them now would either force fake passes
		// (thresholds of 0) or fail every commit until real tests exist.
		//
		// Suggested initial thresholds when uncommenting (adjust to reality):
		//   statements: 80, branches: 75, functions: 80, lines: 80
		coverage: {
			provider: "v8",
			reporter: ["text", "html"],
			include: ["src/**/*.{ts,tsx}"],
			exclude: [
				"src/**/*.{test,integration.test}.{ts,tsx}",
				"src/**/*.d.ts",
				"src/index.ts", // CLI wiring; entry point tested via integration
			],
			// thresholds: {
			// 	statements: 80,
			// 	branches: 75,
			// 	functions: 80,
			// 	lines: 80,
			// },
		},
	},
});
