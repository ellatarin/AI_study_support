# TypeScript Monorepo

## Core Principles

- **MUST** read relevant existing code before writing new code — check if similar functionality exists or can be refactored
- **NEVER** duplicate functions, helpers, or logic — extract and refactor instead
- **NEVER** add code beyond what is absolutely necessary to solve the problem
- **MUST** review for DRY compliance before marking any task complete

## Project Structure

TBD



## TypeScript

Applies to all packages.

- **MUST** enable strict mode; **NEVER** use `any` — use `unknown` for ambiguous types
- **MUST** use `type` for all type definitions in application code; use `interface` only when a library requires it
- **MUST** use named exports only; **NEVER** use default exports *(enforced by Biome `noDefaultExport`)*
- **MUST** use descriptive generic names: `TRequest`, `TResponse` — **NEVER** single chars `T`, `K`
- **MUST** annotate return types on all exported functions
- **MUST** use `@ts-expect-error` with an explanatory comment; **NEVER** use `@ts-ignore` *(enforced by Biome `noTsIgnore`)*
- **MUST** treat data as immutable by default; use `readonly` and `Readonly<T>` wherever TypeScript allows; only drop when a library requires mutable types
- **NEVER** use optional props that imply different component behaviour — use discriminated unions instead:
  `type Status = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ok'; data: T }`
- **NEVER** use wildcard imports (`import * as X`) unless namespacing is genuinely necessary
- **MUST** use meaningful, descriptive names — **NEVER** terse or ambiguous

## TypeScript: Functions

Applies to all TypeScript functions across all packages.

- Single responsibility; pure and stateless where possible
- One level of abstraction per function — don't mix orchestration with low-level detail; extract named helpers rather than adding inline comments
- **MUST** always use an options object over multiple positional params:
  `fn({ userId, includeDeleted })` not `fn(userId, true)`
- Return early to reduce nesting
- Prefer composition over inheritance
- **MUST** use `async/await`; **NEVER** use `.then()` chains
- **MUST** use typed catch blocks: `catch (e: unknown)` — **NEVER** bare `catch (e)`
- **MUST** annotate all async functions with an explicit `Promise<T>` return type


## Documentation

Applies to all packages.

- **MUST** write TSDoc for all exported functions, classes, and methods — document parameters, return values, and exceptions raised
- Include examples in TSDoc for complex functions
- **MUST** keep comments up to date with code changes — outdated comments are worse than no comments
- **NEVER** leave commented-out code — delete it

## File Organisation

Applies to all packages.

- Utility and hook files: no hard limit, but one clear purpose per file
- **MUST** co-locate tests with source: `Component.test.tsx` for unit, `Component.integration.test.tsx` for integration
- Feature-based colocation: components, hooks, utils, and tests live next to the feature using them
- Move to a shared directory only when used by 2+ unrelated features
- **NEVER** create barrel files (`index.ts` re-exports) inside feature folders; package entry points (`packages/shared/index.ts`) are fine

## Security

Applies to all packages.

- **MUST** store all secrets and credentials in `.env`; **NEVER** in code
- **MUST** add `.env` to `.gitignore`; **NEVER** commit it
- **NEVER** log sensitive data: passwords, tokens, PII, or URLs containing credentials
- **MUST** use environment variables for all sensitive configuration

## Tooling

Applies to all packages.

- **MUST** use Biome for formatting and standard linting; **NEVER** bypass it
- **MUST** use ESLint for architectural rules (cross-feature imports, restricted imports); run alongside Biome
- **MUST** run `biome check --write`, `eslint .`, then `tsc --noEmit` before committing — not during development

## Testing

Applies to all packages.

- **MUST** write unit tests for all new functions and components
- **MUST** write integration tests wherever unit tests require mocking or cannot adequately verify behaviour
- **MUST** mock all external dependencies: APIs, databases, queues, third-party services
- **MUST** use `test.each` for parameterised tests; **NEVER** duplicate test structure for different inputs
- **MUST** extract shared setup into `beforeEach` — if the same setup appears in 2+ tests, extract it
- Test from the user's perspective: given input → assert observable behaviour
- **MUST** describe tests as `should [behaviour] when [condition]`
- **MUST** follow AAA pattern: Arrange, Act, Assert
- **NEVER** use snapshot tests for UI or behaviour — use them only for serialisation format regression
- **MUST** add test output folders to `.gitignore`

## Version Control

Applies to all packages.

- **MUST** write clear, descriptive commit messages in the imperative mood
- **MUST** keep commits atomic — one issue or set of tightly related changes per commit; **NEVER** bundle unrelated fixes
- **NEVER** stage with `git add -A` or `git add .` — **MUST** always stage specific files by name
- **NEVER** commit `.claude/` or `CLAUDE.md`; **MUST** add both to `.gitignore`
- **NEVER** commit credentials or sensitive data

## Before Committing

Also check the relevant subdirectory CLAUDE.md (`frontend/CLAUDE.md`, `backend/CLAUDE.md`) for package-specific checklists.

- [ ] Code reviewed line by line against every rule in this CLAUDE.md and the relevant subdirectory CLAUDE.md
- [ ] All tests pass
- [ ] No duplication introduced — DRY compliance checked
- [ ] Type checking passes (`tsc --noEmit`)
- [ ] Linting and formatting pass (`biome check` and `eslint .`)
- [ ] All exported functions have TSDoc
- [ ] No commented-out code or debug statements
- [ ] No hardcoded credentials
- [ ] No named exports violated — no default exports introduced
- [ ] Typed catch blocks used — no bare `catch (e)`
- [ ] All async functions have explicit `Promise<T>` return types
