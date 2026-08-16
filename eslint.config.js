import tseslint from "typescript-eslint";
import jsdoc from "eslint-plugin-jsdoc";
import importPlugin from "eslint-plugin-import";
import vitest from "@vitest/eslint-plugin";

export default [
	...tseslint.configs.recommended,

	// CLAUDE.md L68: architectural rules — use ESLint for cross-module concerns
	{
		files: ["src/**/*.{ts,tsx,js,mjs,cjs}"],
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
		},
	},

	{
		files: ["src/**/*.{ts,tsx,js,mjs,cjs}"],
		languageOptions: {
			parserOptions: {
				// Needed for type-aware rules like use-unknown-in-catch-callback-variable
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			// CLAUDE.md L19: MUST use `type` for all type definitions
			"@typescript-eslint/consistent-type-definitions": ["error", "type"],

			// CLAUDE.md L22, L40: MUST annotate return types on exported functions and async functions
			"@typescript-eslint/explicit-module-boundary-types": "error",

			// CLAUDE.md L39: MUST use typed catch blocks (catch (e: unknown))
			"@typescript-eslint/use-unknown-in-catch-callback-variable": "error",

			// CLAUDE.md L21: MUST use descriptive generic names (TRequest, TResponse); NEVER T, K
			"@typescript-eslint/naming-convention": [
				"error",
				{
					selector: "typeParameter",
					format: ["PascalCase"],
					custom: { regex: "^T[A-Z][a-zA-Z]+$", match: true },
				},
			],

			// CLAUDE.md L34-35: MUST use options object over multiple positional params (proxy: max 1)
			"max-params": ["error", 1],

			// CLAUDE.md L36: Return early to reduce nesting
			"no-else-return": ["error", { allowElseIf: false }],

			// CLAUDE.md L28: MUST use meaningful names; NEVER terse or ambiguous
			// Exceptions: `_` (throwaway), and common Node conventions (`fs`, `os`)
			// where a longer name would fight ecosystem convention rather than clarify
			"id-length": ["warn", { min: 3, exceptions: ["_", "fs", "os"] }],

			// CLAUDE.md L27, L38: NEVER wildcard imports; MUST use async/await (no .then chains)
			"no-restricted-syntax": [
				"error",
				{
					selector: "ImportNamespaceSpecifier",
					message:
						"Wildcard imports (`import * as X`) are forbidden unless namespacing is genuinely necessary — CLAUDE.md L27",
				},
				{
					selector:
						"CallExpression[callee.type='MemberExpression'][callee.property.name='then']",
					message: "Use async/await instead of .then() chains — CLAUDE.md L38",
				},
			],
		},
	},

	// CLAUDE.md L45: MUST write TSDoc for all exported functions, classes, methods
	{
		files: ["src/**/*.{ts,tsx}"],
		ignores: ["src/**/*.test.{ts,tsx}", "src/**/*.integration.test.{ts,tsx}"],
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
						ArrowFunctionExpression: false,
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
			"jsdoc/require-throws": "warn",
		},
	},

	// CLAUDE.md L24: MUST treat data as immutable by default
	// Scoped to Phase 1 domain code where we control the type surface.
	// ignoreInferredTypes silences callbacks whose params TypeScript infers.
	{
		files: ["src/pipeline/**/*.{ts,tsx}", "src/types/**/*.{ts,tsx}"],
		rules: {
			"@typescript-eslint/prefer-readonly-parameter-types": [
				"error",
				{ ignoreInferredTypes: true },
			],
		},
	},

	// CLAUDE.md L56: NEVER create barrel files (index.ts re-exports) inside
	// feature folders; the CLI entry (src/index.ts) is fine.
	// Restates the general no-restricted-syntax entries so the barrel-specific
	// selectors add to them rather than replace them via flat-config precedence.
	{
		files: ["src/**/index.ts"],
		ignores: ["src/index.ts"],
		rules: {
			"no-restricted-syntax": [
				"error",
				{
					selector: "ImportNamespaceSpecifier",
					message:
						"Wildcard imports (`import * as X`) are forbidden unless namespacing is genuinely necessary — CLAUDE.md L27",
				},
				{
					selector:
						"CallExpression[callee.type='MemberExpression'][callee.property.name='then']",
					message: "Use async/await instead of .then() chains — CLAUDE.md L38",
				},
				{
					selector: "ExportAllDeclaration",
					message:
						"Barrel file (index.ts re-exports) forbidden in feature folders — CLAUDE.md L56",
				},
				{
					selector: "ExportNamedDeclaration[source]",
					message:
						"Barrel file (index.ts re-exports) forbidden in feature folders — CLAUDE.md L56",
				},
			],
		},
	},

	// Test files: relax structural rules, enforce test-quality rules via @vitest/eslint-plugin.
	// CLAUDE.md L79: MUST describe tests as `should [behaviour] when [condition]`
	{
		files: ["**/*.test.{ts,tsx}", "**/*.integration.test.{ts,tsx}"],
		plugins: { vitest },
		rules: {
			"max-params": "off",
			"id-length": "off",
			"jsdoc/require-jsdoc": "off",
			"@typescript-eslint/prefer-readonly-parameter-types": "off",

			// Enforce `should [behaviour] when [condition]` title pattern.
			// pattern is a raw regex string; the plugin compiles it and matches
			// against the test/it title argument.
			"vitest/valid-title": [
				"error",
				{
					mustMatch: {
						it: [
							"^should [^\\s].* when [^\\s].*$",
							"CLAUDE.md L79: MUST describe tests as `should [behaviour] when [condition]`",
						],
						test: [
							"^should [^\\s].* when [^\\s].*$",
							"CLAUDE.md L79: MUST describe tests as `should [behaviour] when [condition]`",
						],
					},
				},
			],

			// Other vitest hygiene rules that map to CLAUDE.md testing intent
			"vitest/no-conditional-tests": "error", // Deterministic tests
			"vitest/no-focused-tests": "error", // No stray .only
			"vitest/no-disabled-tests": "warn", // Flag .skip so it doesn't hide
			"vitest/no-identical-title": "error", // Prevents accidental duplicates
			"vitest/expect-expect": "error", // A test with no assertion is silent noise
		},
	},

	{
		// coverage/ is generated output — linting it reports on files nobody edits,
		// and its bundled scripts carry eslint-disable directives that surface as
		// "unused directive" warnings against rules this config never enables.
		ignores: ["node_modules/", "dist/", ".claude/", "coverage/"],
	},
];
