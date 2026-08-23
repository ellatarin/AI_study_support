# Code-review worklist

Every finding from both whole-tree reviews of 2026-08-22, grouped and labelled. Source column: `R1` is
`code-review-2026-08-22.md`, `R2` is `code-review-2026-08-22-run2.md`. **Where the two disagree, R1
wins** — it cites every line.

Two groups came from neither review, raised by the user while the work was being done: **C2.5** (the
runner's test-only exports) and **C10** (the technical design's register). They carry no source
citation for that reason.

**Status key**

| Marker | Meaning |
|---|---|
| `- [ ]` | Open |
| `- [x]` | Done — the commit that closed it names the item id |
| `REJECTED` | Verified against the code and found not to hold; the reason is recorded inline |
| `FILED #n` | Real, but deliberately not worked now |
| `PARKED` | Started as AUTO, turned out to have two defensible answers; moved to COLLAB |
| `VERIFIED` | Hand-checked by a human, not agent output. Ten findings only |

**Everything not marked `VERIFIED` is unverified agent output** and is confirmed against the code before
it is edited. A finding that does not survive contact is marked `REJECTED` with the reason, never
silently dropped.

---

# AUTO

Worked unattended, checkpointed per group cluster.

## A1 — Gate bypasses

- [x] **A1.1** `scripts/hooks/pre-commit-check:38-41` matches the literal substring `"git commit"`, so `git -C . commit` and `git -c user.name=x commit` take the `exit 0` branch and skip secretlint, Biome, tsc, ESLint, both jscpd passes and the whole suite — R2 §1.1 — VERIFIED. **Done: the trigger is now `lib/is-git-commit.mjs`, which lexes the command and skips git's global options to find the real subcommand. Re-ran run 2's own check and got the opposite result: `git -C . commit`, `git -c user.name=x commit` and plain `git commit` all now run the gate; `git status` and `git -C . log` pass through. The old substring test is kept as an additional trigger, so the new test can only ever fire more often than the old one, never less.**
- [x] **A1.2** `.git/hooks/` holds only `.sample` files and `core.hooksPath` is unset, so the Claude Code hook is the *entire* gate — a terminal or IDE commit has none — R2 §1.1 — VERIFIED — **PARKED, moved to COLLAB.** The finding holds, but the fix is a policy call with two defensible answers: install a real git hook (every hand-made commit then pays the full suite, tens of seconds, and it edits the user's local git setup) or accept that Claude Code sessions are the gate and say so in the docs. Not something to decide unattended. **SETTLED 2026-08-22 by the user: accept Claude Code sessions as the gate.** No git hook is installed. `implementation-plan.md` Phase 1 now states the reach and the consequence — a commit that did not come from a session has not been through the gate — and points at `pnpm check` as the on-demand equivalent. Suite version bumped to 1.27-draft. **The bullet above it is still stale in other ways (it names two hooks and three checks); that is A14.2's, not this item's.**
- [x] **A1.3** `scripts/hooks/block-bash-grep` exits 0 for `git -C . grep`, `git --no-pager grep`, `git ls-files | xargs grep`, `find . -exec grep`, and `ag`. `shouldBlock` requires `args[0] === "grep"`; `SEARCH_TOOLS` omits `ag`/`ack`/`ugrep`; a command starting `xargs` or `find` is never inspected — R2 §1.10 — VERIFIED. **Done: git's global options are skipped before reading the subcommand; `xargs` is a recognised prefix and cancels the piped-input exemption, because xargs passes file names as arguments rather than content; `find -exec`/`-execdir` is inspected for a search tool and judged on find's own starting points; `ag`, `ack`, `ack-grep` and `ugrep` joined the tool list. 22 tests over the blocked and allowed cases.**
- [x] **A1.4** `scripts/claude-hooks.json:38-46` registers `block-webfetch` for `WebFetch` only, leaving WebSearch unblocked; the PostToolUse matcher `Edit|Write` omits `MultiEdit`/`NotebookEdit` — R2 §1.11. **Done: matchers are now `WebFetch|WebSearch` and `Edit|Write|MultiEdit`. `NotebookEdit` deliberately left out — its payload carries `notebook_path`, not `file_path`, and Biome cannot process a notebook, so registering it would add a matcher that could only ever no-op. Takes effect on the next `pnpm setup`, which A2.2 made safe to run.**
- [x] **A1.5** The override token resolves three ways: `block-webfetch:2` uses a relative `.claude/tool-override` (dead when cwd ≠ repo root), `block-bash-grep:33` resolves against `repoRoot`, `block-grep` has no override at all — R2 §1.12. **Done: one implementation in `lib/tool-override.mjs`, resolving against the repo root derived from the file's own location. It is importable by the node hook and runnable by the two shell hooks, so all three share the same code rather than three spellings of it. `block-grep` has an escape hatch for the first time.**

> **New finding, not from either review — found while fixing A1.1.** `pre-commit-check` left the hook
> payload on stdin for a child `node` to read, and the child consistently found stdin empty even though
> bash itself could read all 601 bytes. Every command therefore looked unclassifiable. The hook now
> reads the payload itself and pipes it to the classifier. Worth knowing because **`block-bash-grep`
> reads stdin the same way and does work** — so whatever the mechanism, it is not simply "hooks get no
> stdin", and any future hook that shells out to read the payload should read it in the hook instead.

## A2 — Every hook installed twice

**Worked first, ahead of A1: the doubled gate is the largest single cost in the whole plan.**
`pre-commit-check` ran the full `vitest --coverage` suite, tsc and both jscpd passes **twice per commit**,
and there are well over a hundred commits ahead of us.

- [x] **A2.1** `.claude/settings.local.json` held two identical `Bash`, `Grep` and `WebFetch` PreToolUse groups and two `Edit|Write` PostToolUse groups. **Deduped 2026-08-22 — one of each now, permissions untouched.** That file is gitignored, so this was a local edit with immediate effect and no commit — R2 §1.5 — VERIFIED
- [x] **A2.2** `scripts/setup:96-98` dedupes on a `__project` key that Claude Code strips when it re-serialises the settings file, so **every `pnpm setup` re-appends another copy** and undoes A2.1. Dedupe on the command string instead. *Until this lands, do not run `pnpm setup`* — R2 §1.5 — VERIFIED. **Done: dedupe is now on the command string and depends on no marker at all; three consecutive runs against a throwaway repo leave one copy of each hook, with a hand-added hook and `permissions.allow` untouched. `pnpm setup` is safe to run again.**
- [x] **A2.3** `scripts/setup:56-58` claims the template "carries a `__project` marker inside each hook entry". It does not; there is one top-level marker. This is the cause of A2.2 — R2 §4. **Done: comment rewritten to describe the command-string dedupe and why a marker cannot work; the unused top-level marker deleted from `claude-hooks.json`, and the two places `implementation-plan.md` documented the marker mechanism reduced to one corrected description.**

## A3 — Rules configured toothless

- [x] **A3.1** Neither `package.json:10` nor the gate passes `--max-warnings 0`, so `pnpm exec eslint .` exits 0 with live violations. Biome is invoked with `--error-on-warnings`; ESLint is not — R2 §1.2 — VERIFIED. **Done: `--max-warnings 0` lives in the `check:lint` script, which is now the only way the gate or `pnpm check` invokes ESLint. Verified with a planted warning: `check:lint` exits 1 where bare `eslint` exits 0.**
- [x] **A3.2** `eslint.config.js:86` sets `id-length` to `warn` against CLAUDE.md's "**MUST** use meaningful, descriptive names". Currently violated at `src/pipeline/fixtures.ts:275` — R2 §1.2 — VERIFIED. **Done: promoted to `error`. The one live violation is OpenRouter's own `id` response field, so it carries a one-line disable naming the reason rather than a rename we do not control.**
- [x] **A3.3** `eslint.config.js:130` sets `jsdoc/require-throws` to `warn` against "document … exceptions raised" — R2 §1.2 — VERIFIED. **Done: promoted to `error`, zero violations.**
- [x] **A3.4** `require-jsdoc` exempts `ArrowFunctionExpression`, so **TSDoc on exported arrow functions is unenforced** against "MUST write TSDoc for all exported functions" — R2 §1 "Consequence". **Done: `ArrowFunctionExpression: true`, zero violations.**

> **Consequence of A3.1 worth knowing:** `vitest/no-disabled-tests` is a `warn`, so with `--max-warnings 0`
> a `.skip` now fails the gate outright rather than printing a note. That is the intended direction, but
> it is a stricter rule than it looks.

## A4 — The architectural rule that does not exist

- [x] **A4.1** `no-restricted-imports` and `import/no-restricted-paths` both resolve to `undefined`, though CLAUDE.md names architectural rules (cross-feature imports, restricted imports) as ESLint's whole purpose. `eslint-plugin-import` is already a devDependency — R2 §1.3 — VERIFIED. **Done: `eslint --print-config src/utils/naming.ts` now shows the rule defined where it showed `undefined`.**
- [x] **A4.2** Add the rule forbidding `src/pipeline/*.ts` importing from `src/pipeline/stages/**`, which makes **A20.1** a lint error rather than a convention — R2 §1.3. **Done — and it caught A20.1 the moment it was switched on, so that is closed here too (see A20.1). `fixtures.ts` is exempted by its own config block: it is test scaffolding serving the stages' suites, which coverage and jscpd already carve out on the same grounds. Negating a path inside the rule's `target` array does not work in this plugin version — the exemption has to be a separate config block.**

## A5 — Immutability rule covering half the tree

- [x] **A5.1** `eslint.config.js:138` scopes `prefer-readonly-parameter-types` to `src/pipeline/**` + `src/types/**`; it resolves to `undefined` for `src/utils/**` and `src/cli/**`, against "use `readonly` … **wherever** TypeScript allows" — R2 §1.4 — VERIFIED. **Done: the rule's scope is now `TYPESCRIPT_FILES`, the same list every other type-dependent rule uses, rather than a hand-listed pair of directories. "Wherever TypeScript allows" is the whole typed tree, so naming directories is what let two of them out.**
- [x] **A5.2** 38 production sites: `commands.ts` 13, `date.ts` 14, `files.ts` 5, `progress.ts` 3, `prompts.ts` 1, `naming.ts` 1, `logger.ts` 1 — measured 2026-08-22. **Re-measured on the day: 27, not 38** — `commands.ts` 13, `date.ts` 6, `progress.ts` 3, `files.ts` 2, `naming.ts` 2, `logger.ts` 1, and `prompts.ts` 0. **All 27 closed: 22 by restructuring, 5 by a disable naming the library type.** The five are `writeFileAtomic`'s `Uint8Array`, pino's `Logger`, cli-progress's `Options`, Node's `Buffer`, and `renderInFlight`'s `ReadonlySet` — the last a rule limitation rather than a mutable type, since `ReadonlySet` is immutable by construction and the rule still reports it. The restructures were:
	- **`PipelineRunnerFacade` is mapped, not `Pick`ed.** `Pick` copies a class's *method* signatures, and a type carrying methods is not deeply readonly, so **all 13 `commands.ts` reports were one cause** — every function taking `CliDeps`. A mapped type yields readonly properties holding the same functions, which is what an injected dependency is.
	- **`date.ts` gained a `TextSpan` type.** `byIndex` and `overlaps` took a whole `DateSpan` but read only `index` and `length`; typed to what they use, the `Date` inside never reaches them. This was preferred to making `DateSpan.date` a `Readonly<Date>`, which would have changed `extractDate`'s public return type and rippled into three call sites in `src/pipeline`.
	- **`Readonly<T>` where the type is only read**: `formatDateISO(date)`, `LectureIdentity.date`, `claimedSpans`'s `pattern`, and `readEntryNames`'s `Dirent`. A real `Date`/`RegExp`/`Dirent` is assignable to its `Readonly<…>`, so no caller changed. Probed first: `Readonly<T>` satisfies the rule for `Date`, `RegExp` and `Dirent`, and does **not** for `Logger`, `Options`, `Buffer`, `RegExpMatchArray` or `Uint8Array` — those carry mutable properties or a mutable index signature that a homomorphic mapped type cannot remove.
	- **`claimedSpans`'s `read` callback takes `readonly string[]`**, not `RegExpMatchArray`: the readers only index the captured groups.
	- **`renderInFlight` takes arrays, not sets.** It spread both sets on entry anyway, so moving the spread to the one call site allocates exactly what it did before.
- [x] **A5.3** 25 test sites across `args.test.ts`, `commands.integration.test.ts`, `lecture-identity.integration.test.ts`, `prompts.test.ts`, `cost.test.ts`, `date.test.ts`, `errors.test.ts`, `files.integration.test.ts`, `files.test.ts`, `naming.test.ts`, `progress.test.ts` — measured 2026-08-22. **Not worked, and none of them report: `eslint.config.js`'s `TEST_FILES` block already turns this rule off for tests, deliberately and in company with `max-params`, `id-length` and `require-jsdoc`.** Widening the rule's scope therefore changed nothing in test code. Turning it *on* for tests is a separate decision with a real cost (~25 sites in scaffolding, for a rule about the immutability of production data) and is not what A5.1 found; **if it is wanted, it is a new item, not this one.**
- [x] **A5.4** `eslint.config.js:135`'s justifying comment ("Scoped to **Phase 1** domain code") is five phases stale — R2 §1.4. **Done: rewritten to say why the scope is the whole typed tree, and to record that naming directories is what exempted two of them. It also cites `CLAUDE.md § TypeScript` rather than a line number — A9.4's fix, applied here early so the same comment is not rewritten twice.**

> **Rule for A5: restructure, never assert or disable.** Any site fixable only with a disable comment is
> `PARKED` and reported, not suppressed. This is what worked for `noUncheckedIndexedAccess`.
>
> **How that rule was applied.** Five sites were fixable only with a disable and were **not** parked,
> because the repo already has a settled answer for them: six existing disables in `src/pipeline` carry
> the same reason, and CLAUDE.md's immutability rule ends "only drop when a library requires mutable
> types". Each of the five names its library type and why no wrapper removes the mutability. What was
> refused instead was the *global* escape hatch: setting `treatMethodsAsReadonly: true` would have
> cleared 14 of the 27 at a stroke and made four existing disables unnecessary, but it also stops the
> rule reporting a `Set` or `Map` parameter that should have been `ReadonlySet`/`ReadonlyMap` — it buys
> the fix by switching off the part of the rule CLAUDE.md most wants.

## A6 — The gate is blind outside `src/`

- [x] **A6.1** Biome's `files.includes` is `["src/**/*"]`; `biome check vitest.config.ts eslint.config.js` reports both as "provided but ignored" — R2 §1.6 — VERIFIED. **Done: `*.ts`, `*.js`, `*.json` and `scripts/**/*.mjs` added. `noDefaultExport` is `off` for `vitest.config.ts`/`eslint.config.js` in an override — both tools require a default export.**
- [x] **A6.2** Every ESLint rule block is `files: ["src/**"]` — R2 §1.6. **Done: the three globs are named (`CODE_FILES`, `TYPESCRIPT_FILES`, `TEST_FILES`) and widened to the tree. `explicit-module-boundary-types` and `use-unknown-in-catch-callback-variable` moved to a TypeScript-only block — they can only be satisfied by an annotation, which `.mjs` cannot carry. `projectService.allowDefaultProject` lists the JS the compiler never sees; `tsconfig.json` gained `vitest.config.ts`, so tsc checks it now too.**
- [x] **A6.3** jscpd's pattern is `src/**` — R2 §1.6. **Done: both configs widened to `**/*.{ts,tsx,js,mjs}` with `javascript` added to `format`. This immediately found two real clones — see A10.1 and the `no-restricted-syntax` block restated in `eslint.config.js`, both now extracted.**
- [x] **A6.4** vitest's `include` is `src/**`, so a test placed beside a script would not run — R2 §1.6, §1.17. **Done: `**/*.{test,integration.test}.{ts,tsx,js,mjs}`. The first suites outside `src/` are A10.6's.**
- [x] **A6.5** The gate passes `--no-errors-on-unmatched`, so a miss becomes a success — R2 §1.6. **Done: flag removed. The gate's file filter is split in two — biome's set (which excludes `.md`, since Biome does not read it and would fail the whole run) and eslint's, which now includes `.js`/`.mjs`/`.cjs` rather than TypeScript alone. With biome.json covering every path the filter can produce, "provided but ignored" now means a real hole and fails.**

> **Still open from A6:** vitest's *coverage* `include` remains `src/**`, so `scripts/**` has tests but
> no measured coverage. Widening it before `scripts/` is fully covered would sink the A8 ratchet, so it
> is sequenced after A10 and recorded with **C9.4** (`perFile`).

> Scope agreed: `.ts`/`.js`/`.mjs` outside `src/` now (`eslint.config.js`, `vitest.config.ts`,
> `scripts/audit-constants.mjs`, `bin/`). Shell scripts are **C9** (shellcheck).

## A7 — Two competing definitions of "the checks"

- [x] **A7.1** `package.json:10` runs biome + eslint + jscpd, omitting `tsc --noEmit`, the tests and the `.jscpd.tests.json` pass. The full gate exists only inside the Claude Code hook — R2 §1.7. **Done: each check is now one `check:*` script in `package.json`, and both `pnpm check` and the hook invoke those scripts rather than spelling out tools and flags. The two are the same gate; they differ only in scope, the hook narrowing the file-based checks to what changed. `pnpm lint` is an alias of `pnpm check`, and the old auto-fixing behaviour is now `pnpm format`.**
- [x] **A7.2** secretlint is a devDependency with a config and **no script at all** — R2 §1.7. **Done: `check:secrets`, called by both the hook and `pnpm check`.**

## A8 — Coverage ratchet

- [x] **A8.1** `vitest.config.ts:28-33` sets 95/90/95/95 with a comment saying to raise them. Measured: 99.56 / 97.93 / 99.36 / 99.55. Ratchet to 99/97/99/99 — R2 §1.8 — *decided 2026-08-22*. **Done, and worked last of the gate cluster deliberately: the floor is measured against whatever A5 and A9 left behind. Re-measured after both landed and the figures are unmoved — 99.56 / 97.93 / 99.36 / 99.55, 581 tests. The justifying comment was stale in the same way A5.4's was ("now that Phase 2 has a real baseline"); it now carries the measurement and its date, so the next person raising the floor knows what the last one saw.**
- [x] **A8.2** No `perFile`, so `src/index.ts` sits at 0% statements and `run-cli.ts` at 60% functions / 71% branches, hidden by the average — R2 §1.8 — **FILED, see C9**. **The filing is now written into `vitest.config.ts` beside the thresholds, naming C9.4 and both halves of it — `perFile`, and widening `include` past `src/**` so `scripts/**` is measured. Filed in the worklist alone, it was invisible to anyone reading the config and wondering why an average is the guard.**

## A9 — Config hygiene

- [x] **A9.1** `.env.example` lists only `ELEVENLABS_API_KEY`; `src/pipeline/openrouter.ts:91-93` reads `OPENROUTER_API_KEY`. Copying the example yields a pipeline that dies at Stage 3. (No real value leaks — that part is clean) — R2 §1.13. **Done: `OPENROUTER_API_KEY=` appended, with a comment naming the file that reads it and what a copy without it does. Appended blind — the global rule forbids reading any `.env` variant, so the entry was added to the end rather than placed among the existing ones.**
- [x] **A9.2** `.gitignore:3` ignores `.env` but no variants. Prefer `.env*` with `!.env.example` — R2 §1.14. **Done. Verified with `git check-ignore`: `.env` and `.env.local` are ignored, `.env.example` is not.**
- [x] **A9.3** `tsconfig.json:8` sets `outDir: "dist"` but `tsc` only ever runs `--noEmit`; `.gitignore`, `biome.json` and both jscpd configs carve out a directory nothing creates — R2 §1.16. **Done, and one step further than the finding: `outDir` is replaced by `"noEmit": true` rather than simply deleted. Deleting it alone would leave a `tsc` run without the flag emitting JavaScript next to the sources; stated in the config, no invocation can emit at all and the `--noEmit` on `check:types` is belt and braces. The four `dist` carve-outs (`.gitignore`, `biome.json`, `.jscpd.json`, `.jscpd.tests.json`) and a fifth the finding missed (`eslint.config.js`'s `ignores`) are all deleted. Nothing else in the tree mentions `dist` or a build step; `bin/lecture-notes` runs `tsx src/index.ts`.**
- [x] **A9.4** Seventeen `CLAUDE.md L<n>` citations (16 in `eslint.config.js`, 1 at `vitest.config.ts:5`) are uniformly ~7 lines short since Rule Zero was prepended. `L68` lands on ".env in .gitignore"; `L79` lands in `## Code Search` — **and that one is embedded in the lint error message developers see** (`:201`, `:205`). CLAUDE.md is gitignored, so no clone can resolve them. Cite by section heading — R2 §1.9. **Done: every citation now names a heading (`CLAUDE.md § TypeScript`, `§ TypeScript: Functions`, `§ Documentation`, `§ File Organisation`, `§ Tooling`, `§ Testing`), including the two inside lint messages. Headings survive an edit anywhere above them, which is the whole point — a line number was wrong the moment Rule Zero was prepended. One duplication went with it: the `should [behaviour] when [condition]` rule was stated both in a comment and in the message beneath it, so the comment now points at the message instead of restating it.**

## A10 — `scripts/audit-constants.mjs` is broken

- [x] **A10.1** Its "what a number looks like" regex is written three times (lines 270, 275, 290) and **line 270 omits the leading `-`**, so negative literals are recorded without their sign (`-1` → `1` → discarded as trivial) — R2 §1.18. **VERIFIED independently: the widened jscpd (A6.3) flagged the same two lines as a clone before the finding was read. Now one `NUMBER_SOURCE`, embedded in all three patterns; `-1` is recorded with its sign, and `total-1` still records `1` rather than `-1`. Both pinned by tests.**
- [x] **A10.2** No regex-literal handling: a regex containing a quote opens a phantom string and swallows the rest of the file — R2 §1.18. **Done: the scanner recognises regex literals, including character classes (`/["']/` no longer opens a string) and escaped slashes, and distinguishes them from division by what precedes the slash.**
- [x] **A10.3** Escapes mishandled — `"a\nb"` is recorded as `anb` — R2 §1.18. **Done: `readEscape` decodes the control escapes, `\uXXXX`, `\u{…}` and `\xXX`, and falls back to the character itself for `\\`, `\"` and `\'`.**
- [x] **A10.4** Template literals captured whole, hiding every constant inside `${…}` — R2 §1.18. **Done: `scanSegment` recurses into each interpolation and scans it as code, so constants inside `${…}` are reported. Literal text either side is recorded as its own value. Nested templates work to any depth.**
- [x] **A10.5** `walk` matches `.ts` only, including `.d.ts` and excluding `.tsx`/`.mjs`, though its TSDoc claims "Every TypeScript file" — R2 §1.18. **Done: walks `.ts/.tsx/.js/.mjs/.cjs` and skips `.d.ts`. Chosen to match the extensions A6 just brought into the gate rather than the doc's narrower "TypeScript"; the TSDoc now says what it does.**
- [x] **A10.6** Zero tests, for a 383-line source scanner — R2 §1.17. **Done for this file: 31 tests over `scan`, `collectFromFile`, `objectLiterals` and `walk`, in the first two suites to live outside `src/`. They exist because A6.4 widened vitest's `include`.** `block-bash-grep` is likewise a 273-line shell lexer with none — **still open, and covered by A1.3, which extracts its lexer.**

## A11 — Run the two axes nobody has run

- [ ] **A11.1** `/security-review` over the tree — path traversal, prompt injection, secret leakage. Never run — R2 "What this review did not establish"
- [ ] **A11.2** A defect pass over the four built stages and the runner: races under `--concurrency`, off-by-ones, swallowed filesystem errors. **Neither review axis hunts defects** — the Fowler baseline is a refactoring vocabulary — R1/R2 both state this

> **A11 runs last of everything, after C3–C8 and immediately before user testing** — moved there from
> straight-after-the-gate on 2026-08-22. It is the only group that *generates* findings rather than
> closing them, so running it early would label and work findings against code A15–A21 were about to
> rewrite. Findings are appended to this worklist and labelled AUTO/COLLAB before any are worked.

## A12 — Design doc contradicts itself, settled cases

Code is right, doc is stale. Fixed in the same commit as any related code change, suite version bumped last.

- [x] **A12.1** `QA checked/` vs `Output/` — TD §3.3 and `layout.ts:199` say `QA checked/`; §5 Stage 7 (line 939), §5 Stage 8 (line 976) and the §4.5 manifest example (line 430) still say `Output/notes.md`. **The only finding corroborated independently by two agents in R1 and again in R2.** Fix before Stage 7 — R1, R2 c1. **Done: nine sites, four more than the finding named — the §4.1 stage table's Stage 7 and Stage 8 rows, the §4.5 `filesWritten` example, §5 Stage 5's `outputRelativePath` sentence, §5 Stage 7's output header and its loop-termination paragraph, and §5 Stage 8's input header, prose and `spawn` argv. `layout.ts` is the owner and already said `QA checked/`; the implementation plan already said it too, so the TD was the only stale document.**
- [x] **A12.2** `slide-conversion.outputFile` — TD §3.3's prose lists it among stages "producing a set rather than a file"; its own tree and §5 both give it `Slide content/slides.md`. Code follows the tree — R2 c2. **Done: the list is now image-extraction, qa-loop and pdf-generation, and the sentence says what made slide-conversion look like one of them — it does produce a set, one file per slide, and then concatenates it into the single file Stage 6 reads.**
- [x] **A12.3** TD §4.7's `CliDeps` sketch lists six fields and omits `selectMatch`, while the same section twice mandates the picker that requires it. Code is right, sketch is stale — R2 c4. **Done: seven fields, with a line saying why both pickers are dependencies rather than one. The same block gained `commands.ts`'s three other exports (A14.1) — `PipelineRunnerFacade`, `RunnableCliCommand`, and the two exit codes — so the CLI's surface is stated in one place.**
- [x] **A12.4** `maxRetries: 5` / `timeout: 120_000ms` — TD §8 gives them as fixed SDK settings, TD §6 says they are "configuration — never literals in code". Code follows §6 — R2 c5. **Done: the §8 table names `openRouter.completionMaxRetries` and `openRouter.completionTimeoutMs` and cites §6, so the numbers appear once — in §6's config example, where an operator can change them.**
- [x] **A12.5** The base-name builder has three names across the docs (`lectureFolderName`, `lectureBaseName`, `baseNameForLecture`) and the one actually called is declared in none. TD §3.2's rationale — "takes the parsed Date … so the one place that formats a lecture date is `formatDateISO`" — is defeated at the CLI call site, which passes a `YYYY-MM-DD` string for the wrapper to re-parse — R2 c7. **Done, and all three names survive because they are three functions, not three spellings of one: `lectureFolderName` builds the canonical form, `lectureBaseName` adds the empty-title fallback, and `baseNameForLecture` is the wrapper for a caller holding the date as the manifest's string. Each is now declared where it lives — the first two in §3.2, the wrapper in §4.7's `lecture-files.ts` block, with the local-midnight trap its TSDoc names. §5 Stage 0 stopped declaring `moduleDirs` and `lectureBaseName` as its own exports, which A20.1 made false, and points at §3.2 and §3.3 instead. §3.2's rationale is left standing: the wrapper *parses* a string, it does not format one, so `formatDateISO` is still the only formatter.**
- [x] **A12.6** TD §8's typed-error list omits `TranscriptStructuringError` — R2 c8. **Done: nine classes, matching the nine `extends NamedError` in the tree. The sentence now says every stage built so far contributes one, so the list has a rule behind it and the next stage's error is expected rather than forgotten.**
- [x] **A12.7** TD §9's file listing omits `lecture-files.ts`, `layout.ts` and `fixtures.ts` — R2 c8. **Done, and four more the finding did not name: `stage-context.ts`, `stages/pipeline-stage.ts`, `stages/transcript-structuring.prompt.ts` and `utils/errors.ts`. Checked against the whole tree rather than the finding's list — the listing now names every non-test source file, and `fixtures.ts` carries the note that production code never imports it.**
- [x] **A12.8** TD §10's "child logger bound to the run timestamp" is contradicted 30 lines later — R2 c8. **Done: `createRootLogger` is a root, not a child, and the timestamp names the debug log file rather than binding a field onto the entries. The opening sentence now says both, and says the stage binding is the only one — which is what the rest of the section is about.**
- [x] **A12.9** The implementation plan cites a "TD §10" for progress bars; the design doc ends at §9 — R2 c8 — **REJECTED, checked against the doc.** The design doc has a §10 (Logging), and it had one at `origin/main` too, so this was never true of the tree either review read. Both plan citations resolve: `logger.ts` cites "TD §10, Logging and Progress Helpers" and `progress.ts` cites "TD §10", and that subsection is where the three progress helpers are declared.
- [x] **A12.10** TD §5 Stage 0 step 1 (line 663) says parse dates "using `chrono-node`", contradicting §3.2 (line 87). Code follows §3.2 — R1. **Done: step 1 now names `extractDate` and cites §3.2, and says which half each parser does — numeric forms in `src/utils/date.ts` read in British convention, chrono for the ones written in words. The three examples stay, since one of them (`Fri 10th Oct`) is a chrono case and the split is the point.**
- [x] **A12.11** TD §10's Output Streams table lists an unmatched source file as a stderr *warning*; TD §5 (line 658) makes it a stop-the-run *error*. Code follows §5 (`source-normalisation.ts:139-148`) — R1, R2 carried §8. **Done: dropped from the Warning row. It is not moved to another row because the table already covers it — an unmatched source throws out of Stage 0 and reaches "anything that ends the invocation". The two Stage 7 conditions stay: they are warnings the run survives, and Stage 7 is not built yet.**
- [ ] **A12.12** TD §4.2 describes `isComplete()` as checking the manifest marks a stage `'complete'`, contradicting the status table at lines 282-286. **That contradiction is what produced issue #1** — fix with A18 — R1

## A13 — TSDoc drifted from the code

- [x] **A13.1** `cost.ts:73` — `stageLabel`'s TSDoc says it is "the human-readable name of a stage, as every report and message shows it". Two of three report sections don't use it: `errorRecoverySection` prints the raw id, `experimentSection` prints `Stage: ${stageId}` — R2 §4. **Done: the TSDoc names the two tables that show the label and says the other two sections name stages by raw id, citing TD §7's worked examples, which print `slide-conversion` and `Stage: synthesis` exactly that way. The code is right — this is the design, not a slip.**
- [x] **A13.2** `date.ts:334-338` (and `:354-357`) — `extractDate`'s TSDoc says a span is accepted "only when chrono is certain of both the day and the month". Numeric spans and the compact-short fallback set `confident: true` unconditionally, never consulting chrono — R2 §4, R1. **Done: the TSDoc now gives all three rules, because there are three. A numeric span is confident by its form, since the British-convention patterns identify day, month and year by position. A chrono span is confident only on chrono's certainty, which is what the old text described. The bare six-digit form is confident when it names a real day, and is tried only when nothing else produced a confident span — the exception at both ends.**
- [x] **A13.3** `progress.ts:147` — "used by Stages 4 and 5", which do not exist — R2 §4. **Done: it now says the bar is what Stages 4 and 5 are specified to use (TD §5) and that neither is built, so nothing calls it in production today. The parenthetical was read as a present-tense fact about callers; stating the specification and the gap separately cannot be.**
- [x] **A13.4** `fixtures.ts:337-339` — the TSDoc explaining why files are derived rather than reassembled, contradicted at `:528-530` — R2 §4. **Done by changing the code, not the comment: Rule Zero says duplication found is extracted, and `describeLecture` had already derived the three names the tree was rebuilding. `makeLectureTree` now writes `testLecture.videoFile` / `.slideFile` / `.outputFile`. Its `folderName` parameter went with them — **no caller ever passed it**, all four defaulted, so it was an unused knob whose only effect was to force the reassembly. This closes the `makeLectureTree` half of A21.2e. 68 tests across the four suites that call it, green.**
- [x] **A13.5** `manifest.ts:6-8` — says "three separate callers"; the design doc says four, and Stage 3 does call `writeManifest` — R2 §4. **Closed by C2.1**, which removed Stage 3's `writeManifest` call and amended TD §4.5 to say three. The TSDoc the finding names was already right; what was wrong was the code and the design doc around it, so nothing in `manifest.ts` needed editing.
- [x] **A13.6** `lecture-identity.ts:172` — `@throws … When a file **or workspace** already carries that date`, but `assertDateIsFree` checks only `[dirs.video, dirs.slide]`. The code is right per spec; the comment overclaims — and it matters, because `renameLectureFiles` moves the workspace with `rename()`, which overwrites silently — R2 §4. **Done: the `@throws` says "a source video or slide", and the summary line says "a source file" rather than "anything", matching TD §4.7's wording for the same rule. A line was added saying why the two source directories are the whole check — a lecture's date lives in its source filenames, so a date another lecture holds is a date one of those two directories already carries. The silent-overwrite consequence the finding names is not written into the code comment: it is a property of `renameLectureFiles`, not of this check, and this item is the comment.**
- [x] **A13.7** `bin/lecture-notes:8-9` — the header says it "runs from wherever the caller is", but the script `cd`s to the repo root, so relative path arguments resolve against the wrong directory — R2 §4. **Done: the header separates the two things that were conflated — it can be *invoked* from any directory once `bin/` is on `PATH`, and it *runs* from the repo root, so `--module ./Biology` resolves against the repo. It says to give module paths in absolute form, as `pipeline-config.json` does. First draft claimed nothing the CLI takes could be affected; `--module` is passed through verbatim, so that was wrong and was removed. Its stale `§7` citation (Cost Tracking) is corrected to `§4.7` in the same edit.**

## A14 — Doc inventory gaps

- [x] **A14.1** Undocumented exports to record in TD §9: `files.ts`'s `readDirSafe`/`listFileNames`/`listSubdirectoryNames`; `layout.ts`'s `stageDirectoryPath` and `StageInWorkspace`; `lecture-files.ts`'s `baseNameForLecture` (4 call sites); `transcription.ts`'s `API_KEY_VARIABLE`; `commands.ts`'s four extra exports — R2 "Not asked for", R1. **Done, and recorded next to each module's existing surface rather than in §9, which is a file listing and would have become a second home for every signature. §4.3's `files.ts` block gained the four directory reads (`pathExists` too — it was undeclared as well) under a sentence saying why they answer rather than throw; §3.3's `layout.ts` block gained `StageInWorkspace`, `stageDirectoryPath` and `stageDirectoryPaths`; §4.7's `lecture-files.ts` block gained `baseNameForLecture` (with A12.5); §5 Stage 2 gained `API_KEY_VARIABLE`; §4.7's `commands.ts` block gained the other four (with A12.3).**
- [x] **A14.2** Plan-level creep: `scripts/claude-hooks.json` ships five hooks where the plan says two; `audit-constants.mjs`, `.jscpd*.json`, `.secretlintrc.json`, `.npmrc`, `pnpm-workspace.yaml` and `vitest.config.ts` appear in no phase's deliverable list; five suites (`layout.test.ts`, `progress.test.ts`, `errors.test.ts`, `files.test.ts`, `logger.integration.test.ts` — 41 tests) are documented nowhere — R2. **Done in three parts. (1) Phase 1 describes all five hooks — the two checkers and the three blockers — plus the one-shot `tool-override` escape hatch they share, and its `pre-commit-check` bullet now names the `check:*` scripts the gate actually runs rather than the three tools it ran in Phase 1. (2) The six config files are Phase 1 deliverables, except `audit-constants.mjs`, which is not a phase deliverable at all: it is a maintenance scanner run on demand, so it gets a short "Tooling that belongs to no phase" note in the Overview instead of a false home. (3) The five suites are documented as test intent under the phase that owns their module — `layout`, `progress`, `files` (unit) and `logger` under Phase 2, `errors` under Phase 5, where `errors.ts` is already a deliverable. **Found in passing: the Dev dependency list was six packages short** — every gate tool (`secretlint`, `jscpd`, the coverage provider, the three ESLint plugins) was missing. Added, grouped by what each check needs.**
- [x] **A14.3** `pipeline-config.json` is named a Phase 1 deliverable but is gitignored; the tracked `pipeline-config.example.json` is mentioned in no doc at all — R2. **Done: the deliverable is the tracked `pipeline-config.example.json`, and the bullet says what the working copy is and why it cannot be tracked — absolute paths into one user's module folders, and the model IDs and rates they are paying for.**
- [x] **A14.4** `fixtures.ts` is a deliverable of no phase — 625 lines under `src/pipeline/`, importing `vitest` and `nock`, mentioned once in passing — R2. **Done: a Phase 2 deliverable, since it is what stops each later phase's suites inventing their own lecture — with the caveat that it is the one deliverable that keeps growing, so a phase needing a shared fixture extends it rather than restating a value. The note also records that it is the only file under `src/pipeline/` allowed to import from `src/pipeline/stages/`, which is A4.2's exemption.**
- [x] **A14.5** Two documented tests have no equivalent: `should skip module directories that contain no Pipeline processing/ folder`, and `should leave aiDerivedTitle null when LLM judges the provisional meaningful`. The plan's live-key OpenRouter test does not exist either, and the plan names a `--skip-model-check` CLI flag that was never built (it is a `loadConfig` parameter only) — R2. **Done, and each of the four went a different way, because the reason each was missing differed.**
	- **The processing-folder test was written.** `resolveLecturesByDate`'s `beforeEach` already built `moduleC` — a module with no `Pipeline processing/` — and passed it to all three tests, so the behaviour was exercised and nothing named it. The new test puts the unprocessed module **first** in `moduleRoots` and asserts the lecture behind it still resolves, which is what "skip over" means; asserting an empty list from `[moduleC]` alone would not have distinguished skipping from finding nothing. The two unnamed `mkdir` lines in the arrange gained a comment saying what they are. Its first name — `should skip a module directory that contains no Pipeline processing folder` — was rejected by `vitest/valid-title`, which enforces the `should … when …` form; the name is now `should skip the module when its directory holds no Pipeline processing folder`, and the plan carries that one.
	- **The `aiDerivedTitle` test exists under a different name**, and the design moved beneath it: since C2.1 a stage settles no manifest field itself, so what Stage 3 is tested on is that it returns no `identityChanges`. The plan now names that test and says what it means for `aiDerivedTitle`.
	- **The live-key OpenRouter test is deleted from the plan, not written.** CLAUDE.md § Testing requires every external service to be mocked, which settles it: a suite that spends money when a key happens to be present cannot be run by everyone who clones this. The plan says so, and points at Stage 2's integration test as the same tension resolved the same way.
	- **`--skip-model-check` was never a flag.** Both the plan's line and the real test's name are corrected to `skipModelCheck`, the `loadConfig` parameter, with a line on why nothing on the command line turns the check off.

## A15 — Defects that cannot self-heal

- [x] **A15.1** **Stage 0 strands its own temp files.** `executeRenames` renames through `TEMP_SUFFIX = ".stage0-tmp"`; `cleanTmpFiles` filters `.endsWith(".tmp")`, which `.stage0-tmp` fails. A crash between the two rename phases leaves `<base>.mp4.stage0-tmp` in `Video files/`, which the next run reads as a second video on that date — the module is refused as a duplicate and **cannot recover**. TD §4.3 requires each stage to delete stale `.tmp` at start; Stage 1 does it correctly — R2 Spec, corroborated by three agents independently. **Done, but not by the fix the finding implies: deleting these entries would destroy the user's only copy of a source video, since a Stage 0 temporary holds a complete item mid-rename rather than a partial write. `completeInterruptedRenames` now runs first in `normaliseModule` and moves every temporary entry across the module's four directories on to its target — the second phase of the rename, resumed. A target name that is already taken aborts the run naming those entries, which keeps Stage 0's "no filesystem changes when it throws" property (reachable when a renumber swaps two names and is interrupted mid-first-phase). The suffix stays outside the `.tmp` convention, and TD §5 Stage 0 now says why.**
	- **A second defect had to be fixed for the module to actually recover:** `extractProvisionalTitle` did not round-trip a canonical name — `Lecture 1 - Cell Injury - 2025-10-10.mp4` came back as `- Cell Injury -`, so a lecture whose sources were renamed by a run that stopped before writing its manifest was renamed again to `Lecture 1 - - Cell Injury - - 2025-10-10.mp4`. Separator debris at either end is now stripped (`EDGE_SEPARATORS`, applied before the trailing-artefact strip so an artefact at the end of a canonical name is still reached). TD §3.2 records the round-trip as the reason.
- [x] **A15.2** **A manifest-less folder aborts a whole batch.** TD §4.5 says such a folder "is a fact to skip over rather than an error". `listWorkspacesByDate` deliberately keeps it, `runLecture` then calls the throwing `readManifest`, and the rejection escapes `Promise.all`, losing every other lecture's summary. `costReport` in the same file does skip them — R2 Spec. **Done. The listing now drops them, and the code comment arguing the opposite ("it will fail when it is run, which is the right way to hear about a corrupt workspace") is gone — TD §4.5 settles it, and a stray notes folder under `Pipeline processing/` costing a whole batch its summaries is what the old behaviour bought. The two listings that read every manifest in a module were merging into one another as this was fixed, so they became one: `listLecturesByDate` returns `LocatedWorkspace[]` in date order and both `findLectureByDate` and the batch use it. `costReport` takes the manifests from that listing rather than re-reading each one, which is also what retires its now-unreachable `manifest === null` branch.**

## A16 — Wrong money on screen

- [x] **A16.1** `source-normalisation.ts:368` renders `$${...totalCostUsd.toFixed(2)}` against TD §7 and NFR-2.3 ("any other user-facing total render pounds and the `£` symbol"). **This is the figure a user weighs before approving an irreversible deletion** — R2 Spec. **Done. Stage 0 takes a `MoneyFormatter` at construction, the way it takes `confirm`, and the composition root binds it to the configured rate — so the conversion stays at the edge (TD §7) and the stage knows nothing about rates. The suites' rate moved to `fixtures.ts` as `GBP_PER_USD` when the second suite needed it; `cost.test.ts`'s reasoning for fixing a rate of its own moved with it.**
- [x] **A16.2** Unresolved cost silently becomes zero: `buildRunLog` skips `totalCostUsd === null` entries and `RunSummary.totalCostUsd` is a plain `number`, so the batch table shows a confident figure for a run whose spend is unknown. TD §7: "a stage whose cost lookup failed leaves the total itself `n/a`" — R2 Spec. **Done. `RunLog.totalCostThisRun`, `RunSummary.totalCostUsd` and `BatchSummary.totalCostUsd` are now `number | null`, and `addCost` in `cost.ts` — beside `accumulateCost`, which applies the same rule to a whole `StageCost` — is the one place the propagation lives. `totalLectureCost` is its second name, because the batch's total and each module's row in `formatBatchSummary` are the same sum over different selections of the same lectures. A fourth site was fixed with them: the cost report's "Wasted on failures" summed failed runs with the same `!== null` skip, so it printed a confident £0.016 directly under a row reading `n/a`. R2's own finding text names it ("The same asymmetry appears in `errorRecoverySection`") and the line above lost it in transcription — another instance of the completeness audit's lesson that findings go missing in a paragraph's *tail*. Fixed with the rest, and the report snapshot updated (one line).**
  - **The judgement call, taken as AUTO:** `RunLog` is a persisted format and the AUTO/COLLAB rule lists a contract change as COLLAB. Taken as AUTO because TD §7 already states the end state ("a stage whose cost lookup failed leaves the total itself `n/a`"), and both `MoneyFormatter` and `costCell` already take `number | null` — the type was the only thing that disagreed. No reader outside these totals exists: `RunSummary.totalCostUsd` is read only by `formatBatchSummary` and `runBatch`'s sum, and the cost report reads stage entries, not run totals.
  - **`manifest.currentPipelineCost` was deliberately left alone — it is the same defect and it is not fixed.** `recomputeCost` skips a stage whose cost is unresolved, so the stage vanishes from `byStage` (its row disappears from cost-report section 1) *and* from the total, and that total is what the orphan-deletion prompt quotes to the user before an irreversible delete. It is COLLAB rather than AUTO: the manifest is the persisted contract, and what a row should read when its stage's own cost is unknown is a second defensible end state, not something TD §7 settles. Filed as **A16.6**.
- [x] **A16.3** "Wasted on failures" reads £0.000 in TD's own worked example — `cost.ts:337` filters `runType: "error-recovery"` but TD §7's Run Classification table types the *first* failed run as `normal`, excluding the original failure that is the section's whole point — R1, R2 carried §3. **Done. `ranStageEntries` no longer takes a classification: it flattens the logs and each section states its own rule, since a run's type says why it was started and a stage entry says what came of it. Section 2 selects any stage that failed, plus every stage of an `error-recovery` run (the retries); section 3 keeps selecting on `experiment`.**
  - **The suite was encoding the bug.** `cost.test.ts`'s first run log typed the original 09:00 failure as `error-recovery` with `triggeredBy: "from-stage"` — a run that a `--from-stage` preceded, which by TD §7's own table it is not. Retyped to `normal`/`manual`/`fromStage: null` to match the worked example, at which point the existing snapshot went red with an empty section 2 and £0.000 — the finding, reproduced. The fix restores the snapshot byte for byte, so the row is now reached through the failure rather than through a misfiled classification.
  - A failed stage of an `experiment` run is now priced in section 2 as well as compared in section 3. That spend is wasted whatever the run was started for, and TD §7's "spend from failed runs and retries" covers it.
- [x] **A16.4** Model ids overflow their column — `formatCells` pads but never truncates; section 1's Model column is 26 and TD §4.5's own example stores a 27-character id, shifting every column right — R2 Spec. **Done, and it took both halves. `MODEL_WIDTH` (28) is now the one width for every table carrying a model, so §4.5's own 27-character id fits where it used to overrun — section 1 said 26 and the run summary 28, with no reason for the difference. `fitToColumn` in `formatCells` is the backstop for anything longer: a value that would overrun ends in `…` at one less than the column width, keeping the separating space, so no value can move the columns after it. Section 3 pads by hand rather than through `formatCells` and carried a third copy of the width — it now takes both.**
  - Section 1's other widths were literals stated twice each (header and row, plus a hand-summed 57 and 67); they are now `CURRENT_PIPELINE_WIDTHS` with the rule width derived, as `RUN_SUMMARY_WIDTHS` already was. Closes the `cost.ts` half of what A21 would have swept.
- [x] **A16.5** `moduleNameOf` re-derives the nesting `moduleRootOf` owns (`cost.ts:568-570`), against TD §3.3's "the inverse of `moduleDirs().processing`, so the nesting is stated once"; `lecturesByModule` then keys by `basename`, so two module roots sharing a leaf name collapse into one row — R2 Spec, R1. **Done. `moduleNameOf` is gone: `lecturesByModule` calls `moduleRootOf` and keys the group by that path, and the row prints its `basename`. Two module directories of the same name are now two rows with their own lecture counts and their own spend — before, one row claimed both modules' lectures and both modules' money.**
- [x] **A16.6** **PARKED to COLLAB, then closed by removing the totals altogether — the user's call.** The finding was that `manifest.currentPipelineCost` drops a stage whose cost lookup failed rather than recording it as unresolved, so the stage left no row in cost-report section 1 and nothing in the total the orphan-deletion prompt quoted before an irreversible delete. Put to the user with three options (record the unknown and let the total go unknown; record it and keep the total as a floor; leave the manifest and read the stage entries), the answer was that no total is wanted anywhere: **stage costs are compared one stage at a time, so the pipeline sums them nowhere.** NFR-2.2 was rewritten, the suite went to 1.34-draft, and `currentPipelineCost`, `RunLog.totalCostThisRun`, `RunSummary.totalCostUsd`, `BatchSummary.totalCostUsd`, the run summary's `This run` line, section 1's total, "Wasted on failures" and the batch table's whole money column are gone.
  - **This supersedes the mechanism A16.2 built.** `addCost` and `totalLectureCost` existed to carry an unresolved cost through a total; with no totals left they were deleted the same day they were written. What A16.2 established still stands — an unresolved cost is `n/a` and never zero — it now applies per stage rather than per total.
  - **A row is earned by naming a model.** A stage that names none makes no model call (audio extraction, PDF generation) and has no row in any table; a stage that names one always has a row, its cost `n/a` wherever no figure resolved — a failed lookup and a stage that failed before it charged anything read the same. `stageCostRow` in `cost.ts` is the one place that rule lives, and section 1 adds the only extra condition it needs: the output has to stand on disk.
  - **Stage 0's orphan prompt now quotes no figure**, which undoes A16.1's mechanism while keeping its finding closed — there is no `$` and no money in that prompt at all. The stage no longer takes a `MoneyFormatter`.

## A17 — Startup and lookup correctness

- [ ] **A17.1** `requireUrl` accepts the typo class it exists to reject. `config.ts:85` gates on `URL.canParse`, and `URL.canParse("htp://openrouter.ai/api/v1")` is `true` with `.origin === "null"` — so `modelsPageFor` then prints `null/models` in the very error meant to help. TD §6 promises a startup `ConfigError` — R2 Spec — VERIFIED
- [ ] **A17.2** Stage-config keys are never validated. `requireStages` maps `Object.entries` unfiltered into a `Partial<Record<StageId, …>>`, so a mistyped `transcript-strucuring` validates, has its model ID checked and passes — while the real stage silently has no config. TD §6 says the check catches "placeholders left un-substituted, **typos**, and retired IDs" — R2 Spec
- [ ] **A17.3** "Model unavailable" gets no handling. TD §8: "Stage fails; model ID included in error message." `createCompletion` special-cases only `context_length_exceeded` and rethrows everything else untouched — R2 Spec
- [ ] **A17.4** `findDatedFile` compares only the first date in a filename. Canonical names put the title before the date, and titles come from user filenames or Stage 3's LLM — so a title carrying a date-shaped span shadows the real trailing date and a present file is silently treated as absent, which TD §4.7's "anything absent is skipped" then swallows — R2 Spec
- [ ] **A17.5** `readManifestSafe` under-implements "malformed": it catches throw-sites only, and `readManifest` is an unchecked cast, so a `manifest.json` holding `{}` or `[]` is returned as a `RunManifest` rather than skipped — R2 Spec
- [ ] **A17.6** `openrouter.ts:181-187` casts wire data straight to `{ data: { total_cost: number } }` with no guard, where `transcript-structuring.ts:94-133` sets the house standard with a type guard and an explanatory comment. A response missing `total_cost` yields `undefined` typed as `number` and **silently corrupts cost telemetry** — R2 §3

## A18 — Manifest status and cost (GitHub issues #1 and #3)

Design call already made: **fix the check, not the write.** TD lines 282-286 define `skipped` as a
legitimate manifest status. Two separate commits.

- [ ] **A18.1** Issue #1 — `runner.ts:448-451` records `skippedEntry` which overwrites `status: "complete"` with `"skipped"`; `isStageComplete` (`pipeline-stage.ts:56-57`) accepts only `"complete"`. Run 1 completes → run 2 skips and downgrades → **run 3 re-executes everything billable** — R1 — VERIFIED
- [ ] **A18.2** The complete-or-skipped predicate is **already written twice** (`runner.ts:106` in `classifyRunType`, `runner.ts:298` in `resolvedStageCost`). One named predicate, three consumers; home is `run-status.ts` — R1
- [ ] **A18.3** It **must be a type guard, not a boolean.** The current `if (entry?.status !== "complete") return false;` narrows `entry` to `StageEntryComplete`, which is what makes `entry.filesWritten` typecheck. A plain boolean destroys that and the call site needs a cast. Requires exporting the completed-or-skipped union from `types/pipeline.ts`, covering `StageEntryQaComplete` too
- [ ] **A18.4** `pipeline-stage.integration.test.ts:59-69` has an `it.each` table asserting **`skipped` → incomplete**. That row moves out and complete/skipped are parameterised across the three existing "complete" cases
- [ ] **A18.5** `runner.integration.test.ts:426-441` — `mirrorIsComplete` is a **test-local re-implementation** of `isStageComplete` that also tests `!== "complete"`; the `--from-stage` tests drive stub stages through it, so leaving it means those tests do not exercise the fix
- [ ] **A18.6** New test: **three consecutive runs, assert the stage executes once**, using the real `isStageComplete` rather than a stub `isComplete`
- [ ] **A18.7** Issue #3 — `resetFromStage` (`runner.ts:512-521`) spreads `...manifest`, carrying `currentPipelineCost` through while `deleteStageOutput` removes the files it accounts for; `recomputeCost` returns `current` unchanged for non-complete entries, so it never self-corrects. Clear the `byStage` entry for every reset stage and recompute in the same loop. `byStage` is `Readonly<Partial<Record<StageId, number>>>`, so removal means building a new object — R1 — VERIFIED

## A19 — Output and message correctness

- [ ] **A19.1** ANSI is emitted unconditionally — TD §5 says the non-TTY fallback has "no ANSI"; `progress.ts:23` writes `ESC[31m…` into the payload regardless of renderer, so a failed item in a captured log gets raw escape bytes — R2 Spec
- [ ] **A19.2** `--from-stage` rejection never names the flag (`args.ts:183-185` names the value and the stage list). `parseConcurrency` does name its flag, so the CLI is inconsistent with itself — R2 Spec
- [ ] **A19.3** `commands.ts:136-138` always says "in the configured modules", but `cost-report --module` narrows to one; the follow-on advice ("add its video and slides and run the pipeline again") is also wrong for `cost-report` — R2 Spec
- [ ] **A19.4** Stage 3 cleans `.tmp` files after the billable call (`transcript-structuring.ts:331` vs `:342`), not at stage start as TD §4.3 requires. Stages 1–2 do it correctly — R1, R2 Spec
- [ ] **A19.5** `classifyRunType` adds unspecified cases — TD §7's table covers `failed`/`running` → `error-recovery` and `complete` → `experiment`; `runner.ts:106` also treats `skipped` as `experiment` and `pending`/absent as `error-recovery` — R1
- [ ] **A19.6** The OpenRouter `"test-key"` env stub is set in two suites and **restored by neither** — R2, R1

## A20 — Dependency direction and one-fact-two-homes (fix before Stage 4)

- [x] **A20.1** `lecture-files.ts:22` imports `lectureBaseName` from `stages/source-normalisation.ts` — a shared pipeline module depending on a stage, against the direction the file's own header (`:11-13`) argues for. Every new stage deepens it; three consumers; home is `utils/naming.ts` or `lecture-files.ts`. **R1's worst Standards finding, flagged "fix before Stage 4"** — R1, R2 carried §1. **Done, brought forward from the A20 batch because A4.2's rule fails the build without it. `lectureBaseName` moved to `utils/naming.ts`, beside `lectureFolderName` it already delegated to; it depends on nothing but the other naming rules, so the stage was never its home. Stage 0 and `lecture-files.ts` both import it from there now, and the rule makes the old direction a lint error rather than a convention.**
- [x] **A20.2** Stage-output directory preparation is **triplicated**: `audio-extraction.ts:138-141`, `transcription.ts:264-270`, `transcript-structuring.ts:151-155` (`stageOutputPath` → `dirname` → `mkdir` → `cleanTmpFiles`). Home is `pipeline-stage.ts`, since every stage is built through `createPipelineStage`. **Sequence after C1** — same seam — R1, R2 carried §6. **Done, with C1.1.** `prepareStageDirectories` in `pipeline-stage.ts`, run before every `run`. It reads `stageDirectoryPaths` rather than `dirname(stageOutputPath(…))`, which the three copies used: same answer for these three stages, but it also covers a stage owning several directories (`qa-loop`) or one outside the workspace (`pdf-generation`), neither of which the old expression could express. TD §4.3 now says the factory does it.
- [ ] **A20.3** `providerPrefixOf` (`config.ts:324-330`) and `PROVIDER_SEPARATOR` (`transcription.ts:71,138-139`) split a model ID on `/` in two modules, taking opposite halves — R1, R2 carried §4

## A21 — Rule Zero: the duplication sweep

Worked module by module, one commit each, **last** of the auto work.

### A21.1 Cross-file — verdicts already settled, do not re-litigate

- [ ] **A21.1a** `[video, slide, finalOutput]` at `lecture-files.ts:135`, `lecture-identity.ts:131`, `fixtures.ts:525` → an accessor on `ModuleDirs` in `layout.ts` — **ONE FACT**
- [ ] **A21.1b** Manifest schema version `"1"` — `source-normalisation.ts:36`, `fixtures.ts:424` → `manifest.ts` — **ONE FACT**
- [ ] **A21.1c** `pipeline-config.json` — `CONFIG_FILENAME` plus three error literals in `openrouter.ts`/`transcription.ts` → `types/pipeline.ts` (**not** `config.ts`, which would cycle) — **ONE FACT**
- [ ] **A21.1d** JSON indent `2` — `manifest.ts:20`, `runner.ts:332`, one test → move `writeJsonAtomic` into `utils/files.ts` beside `writeFileAtomic` — **ONE FACT**
- [ ] **A21.1e** The completed manifest stage entry, 8 sites across 6 suites → a `completeEntry(overrides)` builder in `fixtures.ts`. `commands.integration.test.ts:88-94` is an eighth site the review missed — **ONE FACT**
- [x] **A21.1f** The three midnight-anchor suffixes (`args.ts` `T00:00:00Z`, `lecture-files.ts` `T00:00:00`, `fixtures.ts` `T00:00:00.000Z`) — **REJECTED, separate facts.** Each is load-bearing: `args.ts` needs the `Z` for its `toISOString().startsWith()` round-trip; `lecture-files.ts` needs its *absence* because `formatDateISO` reads local getters. **Unifying them would break two of the three**
- [x] **A21.1g** The `[video, slide]` *pair*, `PipelineConfig.version`, `scripts/setup`'s indent, run-*log* outcomes vs manifest entries — **REJECTED, separate facts**
- [ ] **A21.1h** `LectureIdentity` declared in both `types/pipeline.ts` and `naming.ts` with **different fields** — a name collision, not duplication. Different finding, still needs fixing

### A21.2 Production, in-file

- [ ] **A21.2a** `runner.ts` — `join(workspaceRoot, RUNS_DIR)` twice (575, 581); the zero-cost run-log object restated at 489 when `runLogCost` sits one line above; `overallStatus` (558) and `aggregateStatus` (564) are the same function and both Middle Men over `summariseOverallStatus`; `readJsonFile` (145-151) duplicates `manifest.ts:61-71` `readManifestSafe`
- [ ] **A21.2b** `source-normalisation.ts` — `collectAnomalies` (124-148) restates one block four times, video/slide; `planRenames` (292-309) restates "compute target, push if different" four times, character-identical bar the field read; `join(operation.dir, …TEMP_SUFFIX)` verbatim at 325 and 330
- [ ] **A21.2c** `cost.ts` — column widths as bare literals in two sections (308-311/316, 343-346/351) with rule widths hand-computed from them, while the same file demonstrates the correct shape twice (`RUN_SUMMARY_WIDTHS`, `BATCH_SUMMARY_WIDTHS`); `"—"` three times (242, 244, 369); the "append into a Map bucket" shape twice (371-374, 585)
- [ ] **A21.2d** `config.ts` — `requireOpenRouter` extracts a `requireField` closure precisely to stop repeating the label shape; `requireStageConfig` (186-204) then writes it **five** times by hand, and `requireElevenLabs`/`requireOutput`/`requireModelIdCheck` repeat it again. Also `requireRecord`/`requireString`/`requireNumber` (37-59) are three copies of one throw
- [ ] **A21.2e** `fixtures.ts` — `new URL(exampleConfig.openRouter.baseUrl)` five times (136-144); the example-config lookup-and-throw twice (173-179, 234-238); ~~`makeLectureTree` (528-530) reassembling `${folderName}.mp4` against its own TSDoc~~ — **closed by A13.4**; `:487` vs `:522-523` both rebuilding `join(moduleDirs({moduleRoot}).processing, folderName)`
- [ ] **A21.2f** `date.ts` — the fallback loop in `allDateSpans` (321-327) hand-rolls what `claimedSpans` (235-250) already does; `.replace(/\s+/g, " ").trim()` at `:373` is a third copy of `naming.ts:131,160`
- [ ] **A21.2g** `layout.ts` — each stage's directory name written twice inside one object literal (177-197), five times over, contradicting the file's own header: "Stating a path at both ends lets it change at one"
- [ ] **A21.2h** `types/pipeline.ts` — `startedAt`/`endedAt` as a pair in `RunLog`, `RunSummary` and `BatchSummary`; `cost` + `filesWritten` travelling together in `StageOutputData` and `StageResult`
- [ ] **A21.2i** `args.ts` — `USAGE` (54-81) and `COMMAND_SPECS` (263-282) each carry the invocation form of all six commands, two character-identical; the command-word set is stated a third time as an `if`-cascade in `buildCommand`. A new command needs two edits nothing cross-checks
- [ ] **A21.2j** `files.ts` — the `.tmp` suffix at 131 and 174, the two halves of one atomic-write convention; `:246-249` `@param` text duplicates `ManifestPathQuery:234-238` verbatim
- [ ] **A21.2k** `lecture-identity.ts` — the manifest-update block (spread + `updatedAt: new Date().toISOString()`) written twice (102-109, 223-231)
- [ ] **A21.2l** `prompts.ts` — the prompt sentence twice with different tails (68, 98); the index cast twice (81, 101)
- [ ] **A21.2m** `transcription.ts` / `transcript-structuring.ts` — the prior-stage-output read written twice *including a near-verbatim explanatory comment*; the stage-output write sequence named in one file and inlined in the other; the "stage missing from config" lookup+throw in both `openrouter.ts` and `transcription.ts` with two messages and two error types; `CostResolution` declared privately in `openrouter.ts` and reassembled by hand in `transcription.ts`
- [ ] **A21.2n** `naming.ts` — `/\s+/g` inlined twice (131, 161) in a file that names every other regex; five regexes inlined against four named
- [ ] **A21.2o** `commands.ts` / `prompts.ts` — `type MatchQuery` written twice with near-identical TSDoc (`commands.ts:31`, `prompts.ts:24`); `CliDeps.selectMatch` restates `selectLectureMatch`'s signature a third time; `(text: string) => void` unnamed across **eight** sites (`commands.ts:55`, `run-cli.ts:33,35,52,127,131,136,137`) — wants one `WriteText` type
- [ ] **A21.2p** `eslint.config.js` — the `ImportNamespaceSpecifier` and `.then` selectors *and their full message strings* restated verbatim at 89-101 and 155-177. It is a JS module: hoist the array and spread it
- [ ] **A21.2q** `scripts/` — the `repo_root="$(cd …)"` incantation four times (`pre-commit-check:20`, `post-edit-biome:12`, `setup:11`, `bin/lecture-notes:8`); the hook-payload JSON parse `node -e` snippet three times; the Vera guidance message twice in two wordings; **"extensions Biome handles" twice in two syntaxes — a regex in the gate, a case glob in the formatter, so drift means gate and in-session formatter silently disagree**; `export PATH=…` three times in `setup`

### A21.3 Test suites

- [ ] **A21.3a** `stageCompletedAt` exists in `fixtures.ts` and its TSDoc says the suites share one — `commands.integration.test.ts` invents four, `cost.test.ts` invents fourteen, `runner.test.ts` restates one three times, `runner.integration.test.ts` uses the non-ISO `"earlier"` four times
- [ ] **A21.3b** `stagesWith` exists and is hand-rolled twice in `runner.integration.test.ts` (261-275, 721-730) — the fixture's body, cast included
- [x] **A21.3c** `makeStubLogger` exists and `source-normalisation.integration.test.ts:82-89` builds a second logger stub with two unexplained `as never` casts. **Done, pulled forward with C1.2** — not scope creep but its precondition: the second stub spied only `info` and `error`, so C1.2's new `debug` line had nothing that could see it. The suite now uses `makeStubLogger` and both `as never` casts are gone. `makeStubLogger` itself was extended (with C1.1) to record every level rather than only `error`, and `loggedAt({ entries, level })` filters it.
- [ ] **A21.3d** The empty `StageResult` `{ output: undefined, cost: null, filesWritten: [] }` appears eight times in `runner.integration.test.ts` (`:67,195,279,320,348,681,807,847`), three of them byte-identical `vi.fn` blocks; cost literal 3× (`:158,309,631`); `"audio extraction failed"` **5×** (`:205,222,233,343,693` — R1's count, prefer it); `makeRunner(...)` restated across four tests with no `beforeEach`
- [ ] **A21.3e** The two Stage 3 suites are near-copies: the model-reply object, the stage-config block, the `runStage` body, the transcript-fixture triple, and one helper under two names (`readManifestAt`/`manifestAt`) — five separate copies
- [ ] **A21.3f** `contextWith` defined with the same body in `audio-extraction.test.ts` and `pipeline-stage.integration.test.ts`; `completeEntry`/`completedContext` likewise
- [ ] **A21.3g** `source-normalisation.integration.test.ts` — `CELL_INJURY` named at `:19` then restated verbatim six more times (`:138,165,229,307,323,355`); `writeLecture(CELL_INJURY_VIDEO, CELL_INJURY_SLIDE)` in nine tests; lines 315-317 inline the whole body of `normaliseTwoLectures()`, a helper the same file calls twice elsewhere; Vaccination pair duplicated `:112`/`:316`; Immunity pair `:318`/`:491`
- [ ] **A21.3h** `"/workspace"` five times in the 23-line `files.test.ts`
- [ ] **A21.3i** Local `writeManifest`/`readManifest` helpers **re-implementing `manifest.ts`** in `runner.integration.test.ts:71-83` and `source-normalisation.integration.test.ts:53-55`
- [ ] **A21.3j** Cross-suite: `TRANSCRIPT_TEXT` is one fact with **three different values** (`transcription.test.ts:37`, `transcription.integration.test.ts:22`, `transcript-structuring.test.ts:38`); the nock arm/disarm block 3× (`config.integration.test.ts:135`, `openrouter.integration.test.ts:102`, `transcript-structuring.integration.test.ts:54`); the ffmpeg `sine=frequency=440` + `FIXTURE_SECONDS` pair in two suites; the temp-dir `beforeEach`/`afterEach` pair identical bar its prefix (`files.integration.test.ts:16-22`, `logger.integration.test.ts:28-34`)
- [ ] **A21.3k** `config.integration.test.ts` — `makeValidConfig` → `writeConfig` → `mockModelsResponse` repeated at `:166,191,237,255,277`; `"/openrouter/v1"` hardcoded at `:57` and `:179` **while `:201` derives it**
- [ ] **A21.3l** `openrouter.integration.test.ts` — the mock pair restated **7×** (`:182,200,217,230,241,271,281`) despite the helper at `:96` (R1's count)
- [ ] **A21.3m** `transcription.test.ts` — `interceptTranscription(...)` in **12** tests, and `:41` carries a comment *rationalising* a `test.each` breach rather than fixing it
- [ ] **A21.3n** `cost.test.ts` — identical call setup 5× (`:415,429,443,465,505`, again `:561-588`); `{promptTokens:100,…}` ×4 and `{200,80,2}` ×5 restated despite `resolved():152`; `0.74` restated at `:323,327` after `GBP_PER_USD:40`
- [ ] **A21.3o** `progress.test.ts` — `createParallelWorkBar` + `start()` restated 5× (`:47,57,69,81,97`); `24` six times
- [ ] **A21.3p** `commands.integration.test.ts` — defines `invoke()` at `:134` then calls `executeCommand` inline at `:209,305,318,327,340`; the cost-report command literal restated at `:376,387,401`; `args.test.ts:41` hardcodes the six command names already in `COMMAND_SPECS`
- [ ] **A21.3q** `prompts.test.ts:43` and `commands.integration.test.ts:142` both re-derive what `baseNameForLecture` owns — **and disagree with each other**
- [ ] **A21.3r** Setup repeated without a `beforeEach`: **6** tests in `audio-extraction.test.ts` (`:201,211,220,233,248,263` — R1's count), five in `progress.test.ts`, three acts in `runner.integration.test.ts`'s relocated-workspace block, two in `lecture-identity.integration.test.ts` (`:163-175`)

### A21.4 Missing `test.each`

- [ ] **A21.4a** `cost.test.ts:82-149` (three/four unresolved-cost tests); `runner.test.ts:29-39` (`deriveRunId`); two `createProgressBar` tests; two `lectureFolderName` tests in `naming.test.ts`; `config.integration.test.ts:298-312`; **14 repetitions of `expect(error).toBeInstanceOf(CliUsageError)` in `args.test.ts`** that belong inside the `usageError` helper
- [ ] **A21.4b** Pairs run 2 missed: `runner.integration.test.ts:219-237`/`:239-257` and `:502-513`/`:515-523`; `transcription.test.ts:174-181`/`:183-189`; `transcript-structuring.test.ts:199-205`/`:207-213`; `openrouter.integration.test.ts:140`/`146`, `152`/`158`, `164`/`174`; `lecture-identity.integration.test.ts:133/141/148/155` and `:80/87/93`

### A21.5 Test naming, AAA and call shape

- [ ] **A21.5a** **Settle the one contradiction between the runs.** R1 cites `runner.integration.test.ts:368-382` (arrange and act interleaved twice) and `source-normalisation.integration.test.ts:120-125` (the Act hidden inside `expectNormalisationToAbort`, then invoked in *assert* position at `:280` and `:478`). R2's agents asserted "AAA holds throughout" citing nothing. **Read the lines and record the verdict** — R1 vs R2
- [ ] **A21.5b** Mysterious names: `runner.integration.test.ts` `outcome`, `logged`, `existence`, `output` (`:112,125,422,757`); `config.integration.test.ts:88` `stageModelIds` returns the whole stages record; `commands.integration.test.ts:111` declares a local `otherModuleRoot()` shadowing `fixtures.ts:413`'s export with a different value
- [ ] **A21.5c** Positional params against the options-object rule: `source-normalisation.integration.test.ts:97` `writeLecture(video, slide)`; `runner.integration.test.ts:112` `outcome(stageId, entry)`

### A21.6 Type-safety escapes

- [ ] **A21.6a** Casts standing in where narrowing was available: `runner.ts:188` (`as string` ×2 after a filter that cannot narrow) and `:319`; `args.ts:342` (`COMMAND_SPECS[command] as CommandSpec` — keyed on bare `string`, so a bad call throws `TypeError` instead of `CliUsageError`); `commands.ts:147`; `prompts.ts:81,101`; `config.ts:335`; `source-normalisation.ts:205,216,356` and one more
- [ ] **A21.6b** Unvalidated boundaries: `manifest.ts:48` `JSON.parse(...) as RunManifest`; `runner.ts:580` JSON-parsing every file in `runs/` and casting `as RunLog` *(interacts with **C5** — a debug log in that directory would be parsed as a run)*
- [ ] **A21.6c** `pipeline-stage.integration.test.ts:66` casts `{ status } as ManifestStageEntry` for `"failed"` and `"skipped"`, both of which structurally require further fields — so the test exercises `isStageComplete` against data a real run can never produce *(closed by A18.4)*
- [ ] **A21.6d** `run-cli.ts:147` `command satisfies RunnableCliCommand` asserts what the `=== "help"` guard already narrowed; `commands.ts:122`'s `moduleRoots = undefined` default is redundant against the `??` at `:130`

### A21.7 Misused suppressions

- [ ] **A21.7a** `transcription.ts:24` disables `prefer-readonly-parameter-types` **file-wide**, justified by `StageContext`'s shape — but `transcript-structuring.ts` has helpers with the identical signature and needs no suppression. One of the two is wrong — R1, R2. **EVIDENCE MOVED, 2026-08-22 (C1.1). Re-read the code, not this line, before working it — but the finding is now stronger, not weaker, and the direction is settled.** `transcript-structuring.ts` no longer "needs no suppression": it carries **three** targeted `disable-next-line`s (`:291`, `:341`, `:394`), each naming pino's `Logger` as its reason. That makes it the worked example rather than the counter-example — it proves a targeted disable is sufficient for these signatures, so **the file-wide disables are the wrong side of the contradiction.** There are **three** of them, not the one the review named: `transcription.ts:24`, `audio-extraction.ts:15` and `source-normalisation.ts:18`. `pipeline-stage.ts` (`:140`, `:150`) also uses targeted ones. The work is to replace the three file-wide disables with targeted ones and confirm nothing else in those files was quietly relying on the blanket
- [ ] **A21.7b** Two `eslint-disable` comments in `runner.ts` (411, 615) misquote CLAUDE.md, which permits dropping `readonly` only "when a **library** requires mutable types"

### A21.8 Small modelling fixes

- [ ] **A21.8a** `naming.ts:166` throws a bare `Error` where `errors.ts:7` `NamedError` exists
- [ ] **A21.8b** `cost.ts` — exported `stageLabel` bypassed by its own file (`:308`, `:525` index `STAGE_LABELS` directly); `experimentSection` (366-381) hand-builds padded lines instead of using `renderCostTable`; `manifestStageMeta` (253-259) only reshapes `manifestStageOutput` and has one caller; `stageId: string` from `Object.entries` loses `StageId`; accumulators mutated inside `.map`/loops (`:520-531`, `:336`, `:611`)
- [ ] **A21.8c** `files.ts:185` uses `(error as {code?: unknown}).code` rather than `in` narrowing; `:42` `readEntryNames` is the file's only undocumented private function
- [ ] **A21.8d** `progress.ts:85` inlines an upload format while `:11` names the parallel one; `:47` `formatUploadValue` is exported only for its test
- [ ] **A21.8e** `RunLogCost:472-475` is a second, weaker representation of `StageCost:56-63`, dropping `costResolutionError`

### A21.9 Untested exports

- [ ] **A21.9a** `files.ts:15,59,70,124` — `readDirSafe`, `listFileNames`, `listSubdirectoryNames` and **`produceFileAtomic`** have no unit tests, against "MUST write unit tests for all new functions and modules". R2 reports the first three as a docs gap; **R1 is right that it is a Standards violation**, and R2 omits `produceFileAtomic` entirely

---

# COLLAB

Nothing here is touched until the decision is made. Each arrives with evidence, just-in-time, except
C1 and C2 which are settled early because A20 shares their seam.

## C1 — The logger seam *(settle before A20.2)*

> **SETTLED 2026-08-22 with the user. Agreed, not yet built.**
>
> **The logger enters through `run`'s arguments, supplied by `runStage`.** Not on `StageContext` — that
> is a data value (identity, paths, config, manifest) and a live logger is a capability, and every
> `assembleContext` call site including the tests would have to produce one. Not at
> `createPipelineStage` construction either — stages are injected into the runner as `lectureStages`,
> so they are built before it.
>
> `runStage` already receives the run logger and already derives `createStageLogger({ logger, stageId })`
> in its `catch`. **`createPipelineStage` derives that child once** so no stage repeats `.child()`.
> `getInput` and `isComplete` are left alone — they log nothing.
>
> **`makeCompletionCall` takes a logger too**, rather than returning timing and token data for the
> caller to log: it already measures the latency internally, and handing that back for someone else to
> re-assemble is the more roundabout of the two.
>
> **A20.2 lands in the same commit** — stage-output directory prep is triplicated across the three
> stages and its home is `pipeline-stage.ts`, the same seam. Opening that file twice is the thing this
> sequencing exists to avoid.

> **REVISED 2026-08-22 during the build, with the user. The seam moved from `run`'s arguments to the
> stage factory's construction arguments.** What is built is:
> `createPipelineStage({ stageId, logger, getInput, run })`, which derives `createStageLogger` **once, at
> construction**, and hands the bound child to `run`. `PipelineStage.run` keeps `{ input, context }`;
> the runner is unchanged; each per-lecture stage factory takes `{ logger }` exactly as
> `createSourceNormalisationStage` already did.
>
> **Two facts overturned the original decision, both established by reading rather than argument:**
>
> 1. **The reason given for rejecting construction-time injection was wrong.** It said stages "are built
>    before" the runner — true, but the logger is not the runner. `run-cli.ts:56` creates the logger and
>    `:64` builds the stages eight lines below it, and Stage 0 on `:62` already takes its logger there.
> 2. **Putting `logger` on `PipelineStage.run` forced `pino` into `src/types/pipeline.ts`**, a contract
>    file that until then imported nothing, and derived the child on every invocation rather than once.
>
> **A third correction came from the user and matters more than either: every stage logs, not only the
> ones that log today.** An intermediate design gave a logger only to Stage 3 — reasoning from what is
> implemented (nothing logs) instead of from TD §10, whose "Stage implementations call
> `logger.child({ stage: stageId })`" means all of them. Stage 2's Scribe upload is a billable model
> call and belongs in the debug log beside Stage 3's; its ffprobe duration failure was being swallowed
> into `costResolutionError` where nothing surfaced it. **Do not re-derive a design from what the code
> currently does when the finding is that the code does too little.**

- [x] **C1.1** Stages 1–3 do no logging at all. TD §10 requires `logger.child({ stage: stageId })` per stage and a debug line per LLM call (model, prompt tokens, latency). Only Stage 0 takes a logger. **`createPipelineStage` has no logger parameter and neither does `makeCompletionCall`'s documented signature** — the required logging has *no home in the designed API*, not merely no implementation — R1, R2 carried §2. **Done, but NOT by the seam the C1 block quote records — see the revision note below.**
- [x] **C1.2** Stage 0's logging is partial: discovery counts, renames, manifest writes and deletions are logged; per-file extracted dates, assigned numbers and video↔slide matches are not — exactly the three that explain *why* a lecture got the number it did. Follows from whatever C1.1 decides — R1, R2. **Done.** One `debug` line per lecture — `"Resolved lecture"` carrying number, date, video, slide and provisional title — emitted from `normaliseModule` straight after `orderLectures` and **before any rename**, so it records what was decided rather than what the rename left behind. All three missing facts land in one line because they are one fact: the date earned the number, and the pairing is what made it a lecture at all.

## C2 — Stage↔runner contract

> **SETTLED 2026-08-22 with the user. Agreed, not yet built.** Four decisions, one deferral.
>
> **C2.1 — the runner applies the identity changes, after it receives the `StageResult`.** Stage 3 stops
> writing the manifest itself; the changes travel back on the result and the runner writes them with the
> `complete` entry. This is the user's call and it is *not* what I recommended (I proposed a re-read
> inside `recordIdentity` on the grounds that a lecture's title is not "stage bookkeeping"); **do not
> re-litigate it.** It is the reading of TD §4.2 that takes "written by the runner, never by the stage"
> literally, and it removes the write from the stage rather than making the stage's write safer.
>
> Two facts found while checking it, so they are not re-derived. **What makes this route work at all:**
> `runStage`'s `record` helper re-locates the workspace by date before *every* write, precisely because
> a stage may have moved it — so a runner write that lands after Stage 3 has renamed the folder still
> finds it. The current ordering comment in Stage 3 ("the manifest is written while the workspace still
> stands where it is, and the folder moves last") stops being the reason anything works, and must be
> rewritten rather than left. **What to watch:** Stage 3 calls `recordIdentity` from *two* paths — the
> adopt-title path, and the keep-the-provisional-title path that records `aiDerivedTitle` anyway
> because it is "a true fact about the transcript". Both must survive as returned changes, and the
> field carrying them on `StageResult` must not become an optional flag that selects behaviour.
>
> **C2.2 — amend the doc; the four functions stay private.** The user's reason, which is the general
> one and outlives this item: **the better design is a deeper module with less public API surface.**
> Exporting `runStage`, `updateManifest`, `resolveWorkspace` and `findLectureByDate` would add public
> API whose only consumer is the test suite. `runner.ts` is at 99.47% statements through the public
> surface, so nothing is untested. **Consequence worth noticing but NOT acting on here:** the same
> argument points at `deriveRunId`, `classifyRunType` and `assembleContext`, which *are* exported from
> the same file. That is a separate question and nobody has asked it.
>
> **C2.3 — `RunOptions` now, `StageParams` deferred.** `StageParams` is serialised into the manifest and
> the run log, and Stages 4–8 do not exist yet to show what the discriminant should be; a union chosen
> now would be guessed. Revisit when Stage 4 lands.
>
> **C2.4 — folded into the same work**, not run as its own pass: `runStage` is the function C1.1 and
> C2.1 both open anyway.

- [x] **C2.1** Stage 3 writes back a stale whole manifest. TD §4.2: "a stage's own bookkeeping in the manifest … is written by the runner, never by the stage." `recordIdentity` writes `{ ...context.manifest, ...changes }` and the runner deliberately hands the stage the pre-`running` context, so Stage 3's write **reverts its own entry's status** and after a hard crash the `running` marker TD §4.2 relies on is gone — R2 Spec. **Done.** `recordIdentity` is deleted; `settleTitle` now returns a `LectureIdentityChanges` on `StageResult.identityChanges`, and `updateManifest` spreads it over the manifest in the same write that patches the stage entry. The field is **optional and carries no flag**: absent and `{}` are spread identically, so it selects no behaviour, and making it required would oblige every stage to declare it has no identity to settle — the objection TD §4.7 already raises against reporting a relocated workspace. Stage 3 supplies `{}` rather than omitting it, so the stage itself has no conditional field to build. **The rename still happens inside the stage and still goes last**, but the reason changed: it is now the structured-transcript write, not a manifest write, that needs the folder to stand still.
- [x] **C2.2** Half the documented runner surface is unexported. TD §4.7 names `runStage`, `updateManifest`, `resolveWorkspace` and `findLectureByDate` as module-level functions specifically "so the pure parts are unit-testable in isolation". All four are module-private. Export them, or amend the doc — R2 Spec. **Done: the doc is amended, the functions stay private.** The promise that came out was "so the pure parts are unit-testable in isolation" — the clause that implied exports. §4.7 now names which functions are module-private and which are exported, so the next reader checks a list rather than inferring one. **Found while writing it:** of the three exported helpers only `deriveRunId` has a production consumer (`run-cli.ts`, for the log filename); `classifyRunType` and `assembleContext` are reached only from `runner.test.ts` and `fixtures.ts`. The C2.2 decision recorded that as "a separate question nobody has asked" — **the user asked it on 2026-08-22, so it is now C2.5.**
- [x] **C2.3** Optional fields that select runtime behaviour, which CLAUDE.md says should be discriminated unions: `StageParams:66-71` (`concurrency?` and `maxIterations?` each apply to exactly one stage); `RunOptions:536-553` (`continueOnError?` flips failure handling, `concurrency?` is batch-only). Both are contract types — R1, R2 carried §16. **Done for `RunOptions`; `StageParams` stays deferred to Stage 4 per the decision above.** The two fields needed different fixes, because they were wrong in different ways. `continueOnError?: boolean` was a mode selected by absence — three spellings (`true`, `false`, missing) for two behaviours, read as `!== true` — and became a required `onStageFailure: "halt" | "continue"`. A literal union of two payload-free variants would be that same type spelled longer, so the required field is the discriminated union, collapsed. `concurrency?: number` was not a mode at all: it is meaningless on a single-lecture run, and `CliCommand`'s `run` and `batch` variants both carried the type that offers it, leaving `COMMAND_SPECS`'s runtime check as the only thing holding the line. It moved to a new `BatchRunOptions` that intersects `RunOptions`, so `run` cannot express it; the check stays, because it is what produces the message. Both defaults existed twice (unset flag *and* the runner's fallback) and now exist once, as `DEFAULT_RUN_OPTIONS` and `DEFAULT_BATCH_OPTIONS`, which are also what `options` defaults to when a caller omits it. `fromStage?` was left alone: the user's call, in scope terms the reviews named only the other two.
- [x] **C2.4** `runner.ts:412-494` `runStage` mixes orchestration with manifest patching, workspace relocation, logging, error mapping and run-log construction across ~80 lines around a mutable `nextContext` closure — R1. **Done, in the same commit as C2.1.** The manifest half moved to `createStageRecorder`, which owns `nextContext` and exposes one method per transition — `skipped`, `running`, `complete`, `failed`, `context`. `runStage` keeps only the decisions (run, skip, map a throw to an entry, what to report) and constructs no manifest entry at all. The mutable variable did not go away — a stage can move the workspace, so something has to track where it is — but it is now inside the thing whose job that is rather than in the middle of the orchestration.

> **C2.5 — SETTLED 2026-08-22 with the user, and BUILT the same day.**
>
> C2.2 kept four functions private and recorded, as a consequence not to act on, that the same argument
> points at the three `runner.ts` *does* export. The user asked the question, so it is settled here.
> Do not re-litigate; build it.
>
> **The verdicts, and the evidence behind each:**
>
> - **`deriveRunId` stays exported.** `run-cli.ts` uses it for the debug-log filename — a real consumer
>   in another module, not a test.
> - **`classifyRunType` becomes module-private.** Its only caller outside `runner.ts` is
>   `runner.test.ts`. Nothing is lost: `runLecture` stamps the classification onto the run log, and
>   `runner.integration.test.ts` already asserts `runLog.runType` for the `experiment` case, so the
>   behaviour is reachable through the public surface.
> - **`assembleContext` moves to a new `src/pipeline/stage-context.ts` and is exported from there.**
>   *Not* the same verdict, and the reason matters: its consumers are `runner.test.ts` **and**
>   `fixtures.ts:makeStageContext`, a one-line wrapper every stage suite uses. Those suites are not
>   reaching into the runner — they need a valid `StageContext`, and this is the only thing that builds
>   one. Making it private forces `makeStageContext` to rebuild the body (the `moduleRootOf`
>   derivation, the field copies, the freeze), which is the duplication Rule Zero forbids and a live
>   drift risk between fixture and production. So the export is legitimate; what is wrong is its
>   *address*. It is a bulge on the runner's surface when it is really the constructor for
>   `StageContext`. Give it a module whose purpose is to be that constructor and the export is
>   justified by what it is, not by who needs it. **It cannot live in `types/pipeline.ts`** — that file
>   imports nothing (a C1 constraint) and `assembleContext` needs `moduleRootOf` from `layout.ts`.
>
> **The one trade the user accepted, with eyes open:** `classifyRunType`'s six pure-function unit tests
> (`runner.test.ts:42-93`) become integration tests asserting `runLog.runType`, which is slower and
> needs a workspace, a manifest and a run per case. The `--from-stage` suite already has that setup to
> build on. Consistency was judged worth more than the test speed. **Recommended by me and accepted —
> the alternative on the table was leaving `classifyRunType` exported and saying in the doc that it is
> exported for its own unit tests, which is what C2.2 had just decided against.**
>
> **Also in scope:** the TD §4.7 sentence listing which runner functions are private and which are
> exported was written by C2.2 to be true of the code *as it stood*. C2.5 changes that list, so the
> sentence moves with it — same commit.

- [x] **C2.5** `runner.ts` exports `deriveRunId`, `classifyRunType` and `assembleContext`; two of the three have no consumer but the test suite. Same deep-module argument as C2.2, which recorded it and did not act — raised by the user on 2026-08-22 — see the block quote above for the settled shape. **Done.** `runner.ts` now exports `deriveRunId` and `PipelineRunner` and nothing else. The six `classifyRunType` unit tests became one `it.each` of five cases plus a `normal` case in `runner.integration.test.ts`, asserting `RunLog.runType` — the classification's only route to the outside world. Building that table needed a `complete` manifest entry the `--from-stage` suite already had buried in a `beforeEach`, so it was hoisted to a module-level `finishedEntry({ status, filesWritten })` covering `complete` and `skipped` and taking its instant from the `stageCompletedAt` fixture, which is what that fixture is for.

## C3 — Issue #2: module-wide deletion

- [ ] **C3.1** `layout.ts:202` is `inModule(FINAL_OUTPUT_DIR)` and `deleteStageOutput` does a recursive `rm`; **`resetFromStage` iterates all nine `STAGE_IDS`**, so `--from-stage synthesis` and `qa-loop` sweep through `pdf-generation` too, taking every lecture's PDF. Latent only because nothing writes `Final output/` until Stage 8. Needs a design call on **how `pdf-generation` identifies one lecture's output inside a directory it owns at module level**. Filed `ready-for-human` — R1 — VERIFIED

## C4 — Spec conflicts with no settled answer

- [ ] **C4.1** `--from-stage` deletion vs NFR-4.3. `resetFromStage` calls `rm(…, { recursive: true, force: true })` with no prompt; TD §4.7 sanctions it, `requirements.md` NFR-4.3 says pipeline work "shall not [be] irreversibly delete[d] … without explicit user confirmation". **Stage 0's orphan guard and `delete` both confirm — the runner is the only deleter that does not** — R2 c3
- [ ] **C4.2** The placeholder guard is disarmed by the workaround the spec mandates. TD §6 has `loadConfig` reject un-substituted `<PLACEHOLDER>` ids; the test plan mandates a `placeholder/` prefix *and* an exemption for the four unbuilt stages, which filters them out before the `<`-check runs. TD §6 also says the exemption list is for "providers that genuinely sit outside OpenRouter", which `placeholder` is not — R2 c6

## C5 — Debug log placement and timestamp

- [ ] **C5.1** `run-cli.ts:58` passes bare `RUNS_DIR`, which pino resolves against `process.cwd()`, so the debug log lands in the repo root while the run-log JSON goes to the workspace. `commands.ts:213` compounds it by telling users the stack is "under runs/" directly beneath output pointing at the workspace's. **The trap: honouring TD §10's stated placement would feed a single-line NDJSON file into `readRunLogs`, which JSON-parses *every* file in `runs/`, surfacing it in the cost report as a bogus run** *(see A21.6b)* — R1, R2 Spec
- [ ] **C5.2** The debug log's timestamp cannot match the run log's. TD §10: "takes the run timestamp so the debug log shares it with the run log." `run-cli.ts:57` mints one at config-load time; `runner.ts:661` mints another when `runLecture` starts, with a network fetch in between. And `batch` runs N lectures against one root logger, so one debug log faces N run logs with N ids — **the documented sharing is unimplementable at this seam** — R2 Spec

## C6 — Deletions

- [ ] **C6.1** Three unused native dependencies: `canvas`, `sharp` and `pdfjs-dist` have zero imports anywhere in `src/`; they serve the deliberately-unbuilt Stages 4–5. **`canvas` alone forces the `pnpm-workspace.yaml` `allowBuilds` entry and a native toolchain on every install** — R2 §1.15
- [ ] **C6.2** ~90 of `progress.ts`'s 191 lines (`createParallelWorkBar` and its helpers) have no production consumer — only the test file imports them — against "**NEVER** add code beyond what is absolutely necessary" — R2 §4
- [ ] **C6.3** `cost.test.ts:349,506,588` use `toMatchSnapshot()` on rendered report text. CLAUDE.md forbids snapshots for behaviour — **but all three functions exist to produce a fixed text layout, so there is a real argument they are the permitted serialisation-format case.** R1 records the counter-argument; R2 stated it flatly. Owner's call — R1, R2

## C7 — User-visible behaviour

- [ ] **C7.1** Only `BOD_` is stripped as a module code. TD §3.2 asks Stage 0 to strip "module code prefixes (e.g. `BOD_`)" — a class, of which `BOD_` is an example. `MODULE_CODE_PREFIX` (`naming.ts:44`) implements exactly one, hardcoding one module's prefix inside a general utility, so any other module's code survives into the title. **Where does the list live — config or code?** — R2 Spec, R1
- [ ] **C7.2** `titleCaseWord` lowercases the tail, so `DNA` → `Dna`, working against TD §3.2's "the lecturer's provisional title is authoritative". Low confidence — the spec asks only to "title-case the result" — R2 Spec
- [ ] **C7.3** **The Stage 3 prompt hardcodes British English.** TD §5's structuring rules carry no language instruction — British English is scoped to the *synthesised notes* (FR-3.3, NFR-1.1) — and TD §6 makes `output.language` configurable. The stage has `context.config` and ignores it. *(One of the two places R2 is stricter than R1, which found "no scope creep in the four built stages")* — R2 "Not asked for"

## C8 — Blast-radius refactors

- [ ] **C8.1** Primitive Obsession on dates — `lectureDate: string` throughout (`args.ts:30`, `commands.ts:119`, `lecture-identity.ts:152`); `isCalendarDate` validates and returns a bare `string`, so nothing downstream distinguishes a validated date from any string. The `{workspaceRoot, moduleRoot, lectureDate}` trio also travels together at `runner.ts:249-256` and `:432-437` — R1, R2 carried §19
- [ ] **C8.2** `config.ts` does JSON validation *and* live OpenRouter network verification — two reasons to edit one file, with a module-level mutable cache and a test-only `clearModelIdCache` export as the visible cost — R2 §5
- [ ] **C8.3** Two seams for one problem: `config.ts:24`'s cache uses an exported `clearModelIdCache`; `openrouter.ts:87`'s uses an optional `client?: OpenAI` param (`:218`), which also brushes the rule against optional fields selecting runtime behaviour — R1, R2 carried §15
- [ ] **C8.4** `files.ts` carries directory listing, atomic writes **and** the manifest path-security boundary — R2 §5
- [ ] **C8.5** `fixtures.ts` (625 lines) carries promise assertions, a pino stub, config/URL fixtures, lecture identity, temp-tree builders, an ffmpeg renderer, manifest builders and nock arming — R2 §5
- [ ] **C8.6** `runner.ts`'s `costReport` writes to `process.stdout` from a class documented as an orchestrator, while TD §4.7 gives the CLI an injected `write` that every other output path uses and TD §8 states "user-facing output is the CLI's job" — R1, R2
- [ ] **C8.7** `prompts.ts` uses `-1`/`-2` sentinels sharing a number space with real array indices, where a discriminated union — CLAUDE.md's own stated preference — would remove the casts in A21.6a — R1, R2 §5
- [ ] **C8.8** `COMMAND_SPECS: Readonly<Record<string, CommandSpec>>` (`args.ts:263`) is keyed by `string`, so TS cannot check every `CliCommand` variant has a spec — that is the cast at `:342`. The `command` discriminant is also cascaded three times (`args.ts:346-375`, `commands.ts:437-446`, `:379-395`) where `COMMAND_SPECS` is already the map — R1
- [ ] **C8.9** `RunSummary:577` carries no lecture or module identity, which is the **root cause** of the path surgery at `cost.ts:568` that both runs flag. Feature Envy — R1, R2 carried §18
- [ ] **C8.10** `layout.ts`'s `StageWorkspace.outputFile: string | null` forces a runtime `throw` for the four stages that own no single file, in a file that otherwise models variants well — R2 §5
- [ ] **C8.11** `openrouter.ts` defines and exports `ContextLengthError` yet throws bare `new Error` for its own two failures, and keys its client cache on `JSON.stringify(openRouter)`, making cache identity depend on key ordering — R2 §5
- [ ] **C8.12** `cost.ts:269-277` — the `PresentedAt`/`ManifestReport` generics wrap a single field — R1, R2 carried §17

## C9 — Filed, not built

- [ ] **C9.1** **No stage progress messaging exists anywhere.** TD §10 assigns "stage start/end messages, skipped-stage notices" to stdout and says explicitly that this "is emitted by the CLI and runner, not by this logger". The runner emits no `info` at all; the CLI writes summaries but never per-stage notices. **This is why a clean re-run prints an empty table, the word `partial`, and no explanation** — the case the test plan calls out. FR-6.5 is met only by in-stage progress bars — R2 Spec
- [ ] **C9.2** **`cost-report` never aggregates.** TD §7: "aggregates all run logs across the configured `moduleRoots` … With no flags, aggregates across everything." The implementation loops workspaces and prints a separate three-section report per lecture; `formatCostReport` takes one `manifest`, so no cross-lecture or cross-module total exists. With no workspaces it prints nothing, where the test plan expects "reports zero spend without error" — R1, R2 Spec
- [ ] **C9.3** shellcheck for the four shell scripts (`pre-commit-check`, `post-edit-biome`, `setup`, `bin/lecture-notes`) — a new devDependency, deferred from A6
- [ ] **C9.4** `perFile` coverage thresholds, deferred from A8.2 until `run-cli.ts` has real tests and `src/index.ts` has a decision
- [ ] **C9.5** Any jscpd threshold raise an A21 extraction turns out to need. **List what the new floor would hide before proposing it** — the real duplicate usually hides behind the one you cannot extract

## C10 — The technical design's register

> **Raised by the user on 2026-08-22, mid-C2, after rejecting three separate paragraphs.** This group
> comes from neither review — **both put `docs/*.md` prose out of scope** (see "Not covered" below), so
> nothing here is a carried finding. It is COLLAB because the line it polices is one I got wrong three
> times in a single session, which is the evidence that I cannot reliably call it alone.
>
> **The rule.** The TD states what the system does and the properties that hold. Reasoning about *why
> the design is as it is* **is welcome** — the user said so in as many words when asked directly. What
> is not welcome is the adversarial register, in three forms:
>
> 1. **Arguing with a rejected alternative** — "a result field reporting it would oblige every stage,
>    present and future, to declare something only one of them ever does, against NFR-5.2."
> 2. **Narrating a defect** — "A stage writing `{ ...context.manifest, ...changes }` therefore writes a
>    manifest that is already stale in the one field the runner most needs."
> 3. **X-not-Y framing** — "The reason is staleness, not tidiness." "The manifest writes are not its
>    own work." Also the counterfactual: "Writing the manifest first would only move the window."
>
> **The test to apply:** would the paragraph still read correctly to someone who had never seen a code
> review? If a sentence only makes sense as an answer to a criticism, it belongs in *this file*, not in
> the TD. The concessive and the counterfactual are the two reliable tells.
>
> **Content is not deleted, it is re-homed.** Most of these passages carry a real reason for a real
> decision. The reason is restated plainly in the TD; the argument against the alternative moves to the
> worklist item that settled it. Deleting the reasoning outright is the failure mode to avoid — the
> first correction in this exchange was for trimming too much, not too little.

- [x] **C10.1** §4.2 (stage interface), §4.5 (manifest callers), §4.7 (relocated workspace, runner
  helper listing) and §5 Stage 3 (order of operations). **Done as part of C2** — these are the sections
  C2.1, C2.2 and C2.5 touched, and they were fixed as each landed rather than left for the sweep
- [ ] **C10.2** §4.4 (path validation) — at least one instance: "an assertion that cannot fail would
  misrepresent the input as untrusted to the next reader", and the surrounding `--from-stage` paragraph
  reads as a defence of a choice rather than a statement of it. Noticed while checking the manifest's
  trust posture during C2.1; not swept
> **Two more instances caught in the A12–A14 pass, both written that session and fixed in it** (§10's
> opening, "the timestamp names the file rather than binding anything onto the entries"; §4.7's
> `CliDeps`, "Both pickers are dependencies, not one"). Both were **X-not-Y correcting the sentence
> being replaced** — the tell is that the negated half is the text the edit removed, so the sentence
> only reads as an answer to the old one. Worth knowing for C10.3: **an edit that fixes a stale
> statement is where this register gets written**, because the old statement is still in mind. Check
> every replacement sentence for the ghost of what it replaced.

- [ ] **C10.3** The rest of the TD — no pass has been made. §§1–3, 4.1, 4.3, 4.6, 5 (Stages 0–2, 4–8),
  6–10 are all unread for register. **Do not assume the problem is confined to the sections C2
  touched**; those are simply the ones that were being read when it was noticed
- [ ] **C10.4** `docs/requirements.md` and `docs/implementation-plan.md` — same question, never asked
  of either. Scope them before working C10.3, since a sweep of all three at once is one reading pass
  rather than three

---

## Not covered by any of this

Recorded so it is not mistaken for done:

- **`pnpm-lock.yaml` and the `docs/*.md` prose** were deliberately out of scope in both reviews. The
  prose half is no longer wholly unexamined — **C10** opens it, but only on the one question of
  register. Nothing has checked the docs for anything else.
- **Nothing was executed.** No lecture processed, no stage invoked. This says nothing about whether
  ffmpeg works, the transcription contract holds, or the date parser survives real lecturer filenames —
  that is what the still-blocked user testing is for.
- **Performance** — no pass on either run, and not scheduled here.
