// ESLint config for the pre-commit hook and interactive lint.
// Uses typescript-eslint's recommended flat config so TypeScript files are
// parsed and linted with the standard TS-aware rule set. Substantive
// architectural rules (cross-feature imports, restricted imports) will be
// added in Phase 1 of the implementation plan.
import tseslint from "typescript-eslint";

export default [
  ...tseslint.configs.recommended,
  {
    ignores: ["node_modules/", "dist/", ".claude/"],
  },
];
