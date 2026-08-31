import vitest from "@vitest/eslint-plugin";
import importPlugin from "eslint-plugin-import";
import jsdoc from "eslint-plugin-jsdoc";
import tseslint from "typescript-eslint";

// The gate covers the whole tree, not just src/: eslint.config.js,
// vitest.config.ts and scripts/*.mjs are code we rely on and had been lint-free
// only because every rule block was scoped to src/**. The ignores block at the
// foot of this file is what keeps generated and vendored trees out.
const CODE_FILES = ["**/*.{ts,tsx,js,mjs,cjs}"];
const TYPESCRIPT_FILES = ["**/*.{ts,tsx}"];
const TEST_FILES = ["**/*.test.{ts,tsx,js,mjs}", "**/*.integration.test.{ts,tsx,js,mjs}"];

// The pattern is a raw regex string; the plugin compiles it and matches it
// against the title argument. Both of vitest's title functions carry the same
// requirement, so it is named once and mapped over rather than restated. The
// rule it enforces is stated once too — in the message below, which is the copy
// a developer actually reads.
const TEST_TITLE_REQUIREMENT = [
	"^should [^\\s].* when [^\\s].*$",
	"CLAUDE.md § Testing: MUST describe tests as `should [behaviour] when [condition]`",
];
const TEST_TITLE_FUNCTIONS = ["it", "test"];

// CLAUDE.md § TypeScript and § TypeScript: Functions: NEVER wildcard imports;
// MUST use async/await (no .then chains).
// Flat config replaces a rule's options wholesale rather than merging
// them, so the barrel-file block below has to carry these two selectors as well
// as its own. They are named here so both blocks spread one list.
const GENERAL_SYNTAX_RESTRICTIONS = [
	{
		selector: "ImportNamespaceSpecifier",
		message:
			"Wildcard imports (`import * as X`) are forbidden unless namespacing is genuinely necessary — CLAUDE.md § TypeScript",
	},
	{
		selector: "CallExpression[callee.type='MemberExpression'][callee.property.name='then']",
		message: "Use async/await instead of .then() chains — CLAUDE.md § TypeScript: Functions",
	},
];

// Two syntaxes say the same thing — `export * from` and `export { x } from` —
// so the two selectors report it in the same words rather than each carrying
// their own copy of the sentence.
const BARREL_RESTRICTIONS = ["ExportAllDeclaration", "ExportNamedDeclaration[source]"].map(
	(selector) => ({
		selector,
		message:
			"Barrel file (index.ts re-exports) forbidden in feature folders — CLAUDE.md § File Organisation",
	}),
);

export default [
	...tseslint.configs.recommended,

	// CLAUDE.md § Tooling: architectural rules — use ESLint for cross-module concerns
	{
		files: CODE_FILES,
		plugins: { import: importPlugin },
		settings: {
			"import/resolver": {
				typescript: {
					alwaysTryTypes: true,
					project: "./tsconfig.json",
				},
			},
		},
		rules: {
			// Detects circular import chains (a -> b -> c -> a).
			// maxDepth: Infinity — fully walks the graph. Slow on large trees;
			// fine here. Revisit if lint times get painful.
			"import/no-cycle": ["error", { maxDepth: Infinity, ignoreExternal: true }],

			// The pipeline's dependency direction, which was a convention nothing
			// checked: stages are built on the pipeline, so pipeline infrastructure
			// must never import from one. lecture-files.ts had been importing a
			// naming helper straight out of Stage 0.
			"import/no-restricted-paths": [
				"error",
				{
					zones: [
						{
							target: "./src/pipeline/*.ts",
							from: "./src/pipeline/stages",
							message:
								"Pipeline infrastructure must not import from a stage — stages depend on the pipeline, not the other way round. Move the shared code into src/utils or src/pipeline.",
						},
					],
				},
			],
		},
	},

	{
		files: CODE_FILES,
		languageOptions: {
			parserOptions: {
				// Needed for type-aware rules like use-unknown-in-catch-callback-variable
				// tsconfig.json covers every linted file — src/, vitest.config.ts,
				// this file and scripts/, the last two via allowJs. Listing them in
				// allowDefaultProject instead runs into its eight-file ceiling.
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			// CLAUDE.md § TypeScript: MUST use `type` for all type definitions
			"@typescript-eslint/consistent-type-definitions": ["error", "type"],

			// CLAUDE.md § TypeScript: Functions: MUST use async/await, and annotate
			// async functions with Promise<T>. These three keep `await` meaning what
			// it says.
			//
			// Enabled while all three report zero, so they carry no backlog and no
			// suppressions: they pin the current standard rather than asking for a
			// cleanup. Stages 4-8 are still to be built, all async over the
			// filesystem and network, which is where a floating promise gets
			// written. Type information is already computed for src/** by
			// projectService above, so the marginal cost is ~0.5s on the lint.
			//
			// no-floating-promises is the one that catches a defect: an un-awaited
			// promise races ahead of the code that needed it and its rejection goes
			// unhandled. await-thenable catches the inverse — an await on a value
			// that was never a promise, which reads as IO to the next person and
			// dilutes the signal everywhere else.
			"@typescript-eslint/await-thenable": "error",
			"@typescript-eslint/no-floating-promises": "error",
			"@typescript-eslint/return-await": "error",

			// CLAUDE.md § TypeScript: MUST use descriptive generic names (TRequest, TResponse); NEVER T, K
			"@typescript-eslint/naming-convention": [
				"error",
				{
					selector: "typeParameter",
					format: ["PascalCase"],
					custom: { regex: "^T[A-Z][a-zA-Z]+$", match: true },
				},
			],

			// CLAUDE.md § TypeScript: Functions: MUST use options object over multiple positional params (proxy: max 1)
			"max-params": ["error", 1],

			// CLAUDE.md § TypeScript: Functions: Return early to reduce nesting
			"no-else-return": ["error", { allowElseIf: false }],

			// CLAUDE.md § TypeScript: MUST use meaningful names; NEVER terse or ambiguous
			// Exceptions: `_` (throwaway), and common Node conventions (`fs`, `os`)
			// where a longer name would fight ecosystem convention rather than clarify
			"id-length": ["error", { min: 3, exceptions: ["_", "fs", "os"] }],

			"no-restricted-syntax": ["error", ...GENERAL_SYNTAX_RESTRICTIONS],
		},
	},

	// fixtures.ts sits in src/pipeline but is test scaffolding, not pipeline
	// infrastructure: it exists to serve the stages' own suites, so importing a
	// stage is its job rather than an inverted dependency. Coverage and jscpd
	// already carve it out on the same grounds.
	//
	// The suites beside it are exempt for the same reason, and the rule loses
	// nothing by it: what the zone protects is the direction production code
	// depends in, and a suite is not depended on. The runner's own suite drives
	// stub stages through the real `isStageComplete` precisely so its assertions
	// about re-running cannot pass against a stand-in that has drifted from it —
	// which a test-local copy of that check had let happen.
	{
		files: ["src/pipeline/fixtures.ts", "src/pipeline/*.test.ts"],
		rules: {
			"import/no-restricted-paths": "off",
		},
	},

	// Rules that require a type annotation to satisfy, so they can only be met in
	// TypeScript. Asking them of eslint.config.js or scripts/*.mjs would demand
	// syntax those files cannot carry.
	{
		files: TYPESCRIPT_FILES,
		rules: {
			// CLAUDE.md § TypeScript and § TypeScript: Functions: MUST annotate return
			// types on exported functions and async functions
			"@typescript-eslint/explicit-module-boundary-types": "error",

			// CLAUDE.md § TypeScript: Functions: MUST use typed catch blocks (catch (e: unknown))
			"@typescript-eslint/use-unknown-in-catch-callback-variable": "error",
		},
	},

	// CLAUDE.md § Documentation: MUST write TSDoc for all exported functions, classes, methods
	{
		files: TYPESCRIPT_FILES,
		ignores: TEST_FILES,
		plugins: { jsdoc },
		rules: {
			"jsdoc/require-jsdoc": [
				"error",
				{
					publicOnly: true,
					require: {
						FunctionDeclaration: true,
						MethodDefinition: true,
						ClassDeclaration: true,
						// CLAUDE.md asks for TSDoc on all exported functions, and an
						// exported arrow function is one. Left off, the rule was silent
						// on `export const foo = () => {}` entirely.
						ArrowFunctionExpression: true,
						FunctionExpression: false,
					},
					contexts: [
						"ExportNamedDeclaration > TSTypeAliasDeclaration",
						"ExportNamedDeclaration > TSInterfaceDeclaration",
					],
				},
			],
			"jsdoc/require-param": "error",
			"jsdoc/require-returns": "error",
			// "error", not "warn": CLAUDE.md's documentation rule says exceptions
			// raised are documented, and a warning enforces nothing.
			"jsdoc/require-throws": "error",
		},
	},

	// CLAUDE.md § TypeScript: MUST treat data as immutable by default, using
	// `readonly` wherever TypeScript allows. "Wherever" is the whole typed tree,
	// so this is scoped to TypeScript rather than to a subset of src/ — a scope
	// naming two directories silently exempted src/cli and src/utils.
	// ignoreInferredTypes silences callbacks whose params TypeScript infers.
	{
		files: TYPESCRIPT_FILES,
		rules: {
			"@typescript-eslint/prefer-readonly-parameter-types": [
				"error",
				{ ignoreInferredTypes: true },
			],
		},
	},

	// CLAUDE.md § File Organisation: NEVER create barrel files (index.ts
	// re-exports) inside feature folders; the CLI entry (src/index.ts) is fine.
	{
		files: ["src/**/index.ts"],
		ignores: ["src/index.ts"],
		rules: {
			"no-restricted-syntax": ["error", ...GENERAL_SYNTAX_RESTRICTIONS, ...BARREL_RESTRICTIONS],
		},
	},

	// Test files: relax structural rules, enforce test-quality rules via
	// @vitest/eslint-plugin (CLAUDE.md § Testing).
	{
		files: TEST_FILES,
		plugins: { vitest },
		rules: {
			"max-params": "off",
			"id-length": "off",
			"jsdoc/require-jsdoc": "off",
			"@typescript-eslint/prefer-readonly-parameter-types": "off",

			// Enforce the `should [behaviour] when [condition]` title pattern on
			// every one of vitest's title functions.
			"vitest/valid-title": [
				"error",
				{
					mustMatch: Object.fromEntries(
						TEST_TITLE_FUNCTIONS.map((titleFunction) => [titleFunction, TEST_TITLE_REQUIREMENT]),
					),
				},
			],

			// Other vitest hygiene rules that map to CLAUDE.md testing intent
			"vitest/no-conditional-tests": "error", // Deterministic tests
			"vitest/no-focused-tests": "error", // No stray .only
			"vitest/no-disabled-tests": "warn", // Flag .skip so it doesn't hide
			"vitest/no-identical-title": "error", // Prevents accidental duplicates
			// A test with no assertion is silent noise. `expect*` is named as well as
			// `expect` so a shared assertion helper from the fixtures — which is how
			// an assertion made in several suites is stated once — still counts as
			// asserting. The rule sees only the call, not what it does.
			"vitest/expect-expect": ["error", { assertFunctionNames: ["expect", "expect*"] }],
		},
	},

	{
		// coverage/ is generated output — linting it reports on files nobody edits,
		// and its bundled scripts carry eslint-disable directives that surface as
		// "unused directive" warnings against rules this config never enables.
		ignores: ["node_modules/", ".claude/", "coverage/"],
	},
];
