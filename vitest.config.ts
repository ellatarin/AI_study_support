import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// CLAUDE.md § File Organisation: `foo.test.ts` for unit,
		// `foo.integration.test.ts` for integration.
		// Brace expansion below yields *.test.ts and *.integration.test.ts (and .tsx variants).
		// Not scoped to src/: a suite beside a script in scripts/ must run too.
		// `mts` is here so a suite can sit beside a .mts script and share its
		// extension. eslint's file patterns do not match .mts, and nor does the
		// TypeScript project, so a .ts suite in such a folder fails type-aware
		// linting for want of a project rather than for anything it does.
		include: ["**/*.{test,integration.test}.{ts,tsx,js,mjs,mts}"],

		// Coverage: v8 provider (native, fast). The thresholds are a ratchet floor,
		// set just under the measurement of the day and raised as coverage climbs,
		// never lowered. Measured 2026-08-22 through Stage 3: 99.56 statements /
		// 97.93 branches / 99.36 functions / 99.55 lines. Branches sits a little
		// lower than the rest to absorb the odd compiler-required guard for a
		// nullable API that cannot run at runtime. The pre-commit gate runs
		// `vitest --coverage`, so these block any eroding commit.
		//
		// These are whole-tree averages, which is what hides `src/index.ts` at 0%
		// and `run-cli.ts` at 60% functions. A `perFile` threshold is the fix and
		// is filed as C9.4, together with widening `include` past `src/**` so that
		// `scripts/**` — 81 tests, no measured coverage — is counted too.
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
				statements: 99,
				branches: 97,
				functions: 99,
				lines: 99,
			},
		},
	},
});
