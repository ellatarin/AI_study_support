import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// CLAUDE.md L53: `foo.test.ts` for unit, `foo.integration.test.ts` for integration.
		// Brace expansion below yields *.test.ts and *.integration.test.ts (and .tsx variants).
		include: ["src/**/*.{test,integration.test}.{ts,tsx}"],

		// Coverage: v8 provider (native, fast). Thresholds enabled now that Phase 2
		// has a real baseline (currently stmts/funcs/lines 100%, branches ~97%). Set
		// just below current as a ratchet floor — raise them as coverage climbs, do
		// not lower. Branches sits a little lower than the rest to absorb the odd
		// compiler-required guard for a nullable API that can't run at runtime. The
		// pre-commit gate runs `vitest --coverage`, so these block any eroding commit.
		coverage: {
			provider: "v8",
			reporter: ["text", "html"],
			include: ["src/**/*.{ts,tsx}"],
			exclude: [
				"src/**/*.{test,integration.test}.{ts,tsx}",
				"src/**/*.d.ts",
				// Test-support code, not production code. It is not a *.test.ts file
				// (the tests import from it), but measuring it would be measuring the
				// tests themselves — and it holds deliberately unreachable guards, like
				// captureError's throw for a promise that wrongly resolves.
				"src/**/fixtures.ts",
			],
			thresholds: {
				statements: 95,
				branches: 90,
				functions: 95,
				lines: 95,
			},
		},
	},
});
