# Whole-tree code review — 2026-08-22 (run 2)

Extends `code-review-2026-08-22.md` (run 1), which covered `src/**` only and could not prove its own
coverage. This run partitions the whole tree by line count, requires a per-file verdict from every
agent, and adds a verification pass over the duplication findings.

> **It does not supersede run 1 — read both.** A finding-by-finding diff (below, "Carried forward from
> run 1") shows run 2 missed ~25 findings run 1 caught, eight of them substantive, and **contradicts run 1
> once**. Run 2 is better on file coverage, on the tooling/config/scripts third of the tree, and on
> verification; run 1 is better on the cross-suite long tail. Neither is a superset.

**Target: the tree as it stands, not a diff.** There is no fixed point and no changed hunks. Standards
asks "is this code, as it exists today, conformant?"; Spec asks "is what exists faithful to the design
docs?" — not "did a change drift?"

---

## Coverage

| | Files | Lines | Agents |
|---|---|---|---|
| Standards — production source | 28 | 8,101 | 9 |
| Standards — test source | 30 | 6,627 | 7 |
| Standards — scripts, hooks, build & lint config | 22 | 1,509 | 2 |
| Spec — production source | 28 | 8,101 | 9 |
| Spec — plan fidelity (`implementation-plan.md`, `requirements.md`) | 2 | 603 | 1 |
| Duplication verification | — | — | 6 |

Every agent was capped at ~800–1,000 lines, told to `Read` each assigned file **in full**, and required
to return a coverage table naming one verifiable detail per file. **All 28 reports accounted for every
file assigned to them — 80 distinct files on the Standards axis, no gaps, no overlaps.**

**Out of scope, deliberately:** `pnpm-lock.yaml` (5,804 generated lines), the `docs/*.md` prose (2,644
lines — it is the *spec*, not a review target), three empty `.gitkeep` files.

---

## Standards

~180 findings across 18 agents. Grouped by area; every one traceable to a file and, where it matters, a
line.

### 1. The quality gate does not enforce what CLAUDE.md says it enforces

This is the most consequential section, because **every other agent in this review was told to "skip
anything tooling enforces"** — and that instruction is only safe where the tooling actually does.

**1.1 — The commit gate is bypassed by any `git <global-flag> commit`.** `scripts/hooks/pre-commit-check:38-41`
matches the literal substring `"git commit"`. **Verified by hand:** `git -C . commit -m x` and
`git -c user.name=x commit -m x` both take the `exit 0` branch — secretlint, Biome, tsc, ESLint, both
jscpd passes and the full test suite are all skipped. `.git/hooks/` holds only `.sample` files and
`core.hooksPath` is unset, so this Claude-Code-only hook is the *entire* gate; a commit from a terminal,
an IDE, or any non-Bash path has none at all.

**1.2 — Two `MUST` rules are configured `warn`, and nothing fails on warnings.** `eslint.config.js:86`
sets `id-length` to `"warn"` (CLAUDE.md: "**MUST** use meaningful, descriptive names"); `:130` sets
`jsdoc/require-throws` to `"warn"` ("document … exceptions raised"). Neither `package.json:10` nor the
gate passes `--max-warnings 0`. **Verified by hand:** `pnpm exec eslint .` reports
`src/pipeline/fixtures.ts:275 warning Identifier name 'id' is too short` and **exits 0**. Both rules are
decorative. (Biome is invoked with `--error-on-warnings`; ESLint is not.)

**1.3 — The rule CLAUDE.md names ESLint's whole purpose for does not exist.** CLAUDE.md: "**MUST** use
ESLint for architectural rules (**cross-feature imports, restricted imports**)". **Verified by hand:**
`eslint --print-config src/utils/naming.ts` returns `no-restricted-imports = undefined` and
`import/no-restricted-paths = undefined`. The feature-boundary rules in the File Organisation section are
unenforced by anything.

**1.4 — The immutability `MUST` covers half the source tree.** `eslint.config.js:138` scopes
`prefer-readonly-parameter-types` to `src/pipeline/**` and `src/types/**`. **Verified by hand:** the rule
resolves to `undefined` for `src/utils/naming.ts`. `src/cli/**` (5 modules) and `src/utils/**` (7 modules)
are exempt, against "use `readonly` … **wherever** TypeScript allows". The justifying comment at `:135`
("Scoped to **Phase 1** domain code") is five phases stale.

**1.5 — Every hook is installed twice.** **Verified by hand:** `.claude/settings.local.json` holds two
identical `Bash`, `Grep` and `WebFetch` PreToolUse groups and two `Edit|Write` PostToolUse groups. No
entry carries `__project`, which is what `scripts/setup:96-98` dedupes on — so every `pnpm setup` appends
another copy. Today that means `pre-commit-check` runs **twice per commit** (tsc, both jscpd passes and
the whole `vitest --coverage` suite, doubled) and `post-edit-biome` twice per edit. Cause: Claude Code
re-serialises that file and drops the unknown `__project` key. Dedupe on the command string instead.

**1.6 — Outside `src/`, only secretlint runs.** Biome's `files.includes` is `["src/**/*"]` and the gate
passes `--no-errors-on-unmatched`, so a miss becomes a success; every ESLint rule block is
`files: ["src/**"]`; jscpd's pattern is `src/**`; vitest's include is `src/**`. **All 1,509 lines of
scripts, hooks and config are checked by secretlint and nothing else** — no format, lint, types,
duplication or tests. `biome check vitest.config.ts eslint.config.js` reports both as "provided but
ignored" (verified). A `.ts` file outside `src/` escapes all three gates.

**1.7 — `pnpm lint` is materially weaker than the gate.** `package.json:10` runs biome + eslint + jscpd;
it omits `tsc --noEmit`, the tests, **secretlint** (a devDependency with a config and no script at all),
and the `.jscpd.tests.json` pass. The full gate exists only inside the Claude Code hook. Two competing
definitions of "the checks".

**1.8 — Coverage thresholds were never ratcheted, and are global-only.** `vitest.config.ts:28-33` sets
95/90/95/95 with a comment saying to raise them as coverage climbs. Measured now: **99.56 / 97.93 / 99.36
/ 99.55** — roughly 50 statements and 38 branches of slack. No `perFile`, so `src/index.ts` sits at 0%
statements and `run-cli.ts` at 60% functions / 71% branches, both hidden by the average.

**1.9 — Every `CLAUDE.md L<n>` citation in the config is wrong.** Seventeen references across
`eslint.config.js` (16) and `vitest.config.ts:5` are uniformly ~7 lines short — the offset introduced when
Rule Zero was prepended. `L68` claims the ESLint rule but lands on ".env in .gitignore"; `L79` claims the
test-title rule but lands in `## Code Search` — **and that one is embedded in the lint error message
developers are shown** (`:201`, `:205`). CLAUDE.md is gitignored, so these point into a file no clone can
resolve. Cite by section heading.

**1.10 — `block-bash-grep` misses the common bypasses.** Verified exit 0 for `git -C . grep foo`,
`git --no-pager grep foo`, `git ls-files | xargs grep foo`, `find . -exec grep foo {} ;`, and `ag foo`.
`shouldBlock` requires `args[0] === "grep"`; `SEARCH_TOOLS` omits `ag`/`ack`/`ugrep`; any command whose
first word is `xargs` or `find` is never inspected.

**1.11 — WebSearch is unblocked.** `scripts/claude-hooks.json:38-46` registers `block-webfetch` for
`WebFetch` only. The PostToolUse matcher `Edit|Write` also omits `MultiEdit`/`NotebookEdit`.

**1.12 — The override token has three behaviours.** `block-webfetch:2` uses a *relative*
`.claude/tool-override` (dead whenever cwd ≠ repo root); `block-bash-grep:33` resolves it against
`repoRoot`; `block-grep` has no override at all.

**1.13 — `.env.example` omits a required secret.** It lists only `ELEVENLABS_API_KEY`.
`src/pipeline/openrouter.ts:91-93` reads `OPENROUTER_API_KEY`, and the technical design documents both.
Copying the example yields a pipeline that dies at Stage 3. (No real value leaks — that part is clean.)

**1.14 — `.gitignore:3` ignores `.env` but no variants** (`.env.local`, `.env.production`, …). Prefer
`.env*` with `!.env.example`.

**1.15 — Three unused native dependencies.** `canvas`, `sharp` and `pdfjs-dist` have zero imports
anywhere in `src/`; they serve the deliberately-unbuilt Stages 4–5. `canvas` alone forces the
`pnpm-workspace.yaml` `allowBuilds` entry and a native toolchain on every install. This is present cost
for absent code — the inverse of the sanctioned "absent stages" non-finding.

**1.16 — `dist/` is dead configuration.** `tsconfig.json:8` sets `outDir: "dist"`, but `tsc` is only ever
run `--noEmit` and `src/index.ts` documents "Live TypeScript, no build step". `.gitignore`, `biome.json`
and both jscpd configs all carve out a directory nothing creates.

**1.17 — No tests anywhere in `scripts/`.** `block-bash-grep` is a 273-line shell lexer/parser;
`audit-constants.mjs` a 383-line source scanner. Zero tests — and vitest's `include: ["src/**"]` means a
test placed beside them would not run.

**1.18 — `audit-constants.mjs` under-reports silently.** Its scanner has no regex-literal handling, so a
regex containing a quote character opens a phantom string and swallows the rest of the file. Escapes are
mishandled (`"a\nb"` is recorded as `anb`). Template literals are captured whole, hiding every constant
inside `${…}`. `walk` matches `.ts` only, including `.d.ts` and excluding `.tsx`/`.mjs`, though its TSDoc
claims "Every TypeScript file". **And its own "what a number looks like" regex is written three times, at
lines 270, 275 and 290 — with line 270 omitting the leading `-`, so negative numeric literals are recorded
without their sign** (`-1` → `1` → discarded as trivial).

**What the gate does correctly enforce:** `strict`, `noUncheckedIndexedAccess`, `noDefaultExport`,
`noTsIgnore`, `ban-ts-comment`, `noExplicitAny`, `consistent-type-definitions`, generic-name convention,
explicit return types, `max-params: 1` (off in tests, intended), typed catch, no `.then()` chains, no
wildcard imports, no barrel files, `vitest/valid-title`, and both jscpd passes with **no source carve-out**
and `threshold: 0`. Working-tree scoping is correct and `git add X && git commit` is safe as documented.
No swallowed exit codes.

**Consequence:** the fleet-wide "skip anything tooling enforces" instruction was *not* safe for: exceptions
in TSDoc, terse identifiers, `readonly` in `src/cli` and `src/utils`, TSDoc on exported arrow functions
(`require-jsdoc` exempts `ArrowFunctionExpression`), and cross-feature imports. Those need human eyes.

### 2. Rule Zero — duplication

Cross-file candidates were settled by an independent verification pass; see [Cross-file duplication](#cross-file-duplication-verified)
below for verdicts. In-file duplication, by module:

**Production source**
- `runner.ts` — `join(workspaceRoot, RUNS_DIR)` twice (575, 581); the zero-cost run-log object restated at
  489 when `runLogCost` sits one line above; the "output exists" predicate written two ways
  (`status === "complete" || status === "skipped"` at 106, negated at 298); `overallStatus` (558) and
  `aggregateStatus` (564) are the same function, and both are Middle Men over `summariseOverallStatus`.
- `source-normalisation.ts` — `collectAnomalies` (124-148) restates one block four times, video/slide;
  `planRenames` (292-309) restates "compute target, push if different" four times, the video and slide
  branches character-identical bar the field read; `join(operation.dir, \`${operation.target}${TEMP_SUFFIX}\`)`
  verbatim at 325 and 330.
- `cost.ts` — column widths spelled as bare literals in two sections (308-311/316, 343-346/351) with the
  rule widths hand-computed from them (`width: 67` is `24+26+7+10`), while the *same file* demonstrates the
  correct shape twice over (`RUN_SUMMARY_WIDTHS` + a derived rule width). The `"—"` placeholder three times
  (242, 244, 369). The "append into a Map bucket" shape twice (371-374, 585).
- `config.ts` — `requireOpenRouter` extracts a `requireField` closure precisely to stop repeating
  `` label: `openRouter.${field}` ``; twenty lines later `requireStageConfig` (186-204) writes that shape
  **five** times by hand, and `requireElevenLabs`/`requireOutput`/`requireModelIdCheck` repeat it again.
- `fixtures.ts` — `new URL(exampleConfig.openRouter.baseUrl)` constructed five times (136-144); the
  example-config lookup-and-throw written twice (173-179, 234-238); `describeLecture` derives
  `videoFile`/`slideFile`/`outputFile` and its TSDoc says they exist so nothing is *"reassembled from
  `${folderName}.mp4`"* — then `makeLectureTree` (528-530) reassembles exactly that.
- `date.ts` — the fallback loop in `allDateSpans` (321-327) hand-rolls what `claimedSpans` (235-250)
  already does.
- `layout.ts` — each stage's directory name written twice inside one object literal (177-197:
  `directories: [inWorkspace("Audio")], outputFile: join("Audio", "audio.m4a")`, five times over),
  contradicting the file's own header: *"Stating a path at both ends lets it change at one."*
- `types/pipeline.ts` — `startedAt`/`endedAt` as a pair in `RunLog`, `RunSummary` and `BatchSummary`;
  `cost` + `filesWritten` travelling together in both `StageOutputData` and `StageResult`.
- `args.ts` — **`USAGE` (54-81) and `COMMAND_SPECS` (263-282) each carry the invocation form of all six
  commands**, two of them character-identical. A new command needs two edits that nothing cross-checks.
  The command-word set is stated a third time as an `if`-cascade in `buildCommand`.
- `files.ts` — the `.tmp` suffix at 131 and 174, the two halves of one atomic-write convention.
- `lecture-identity.ts` — the manifest-update block (spread + `updatedAt: new Date().toISOString()`)
  written twice (102-109, 223-231).
- `prompts.ts` — the prompt sentence twice with different tails (68, 98); the index cast twice (81, 101).
- `transcription.ts` / `transcript-structuring.ts` — the prior-stage-output read (locate → access → catch →
  throw) written twice, *including a near-verbatim explanatory comment*; the stage-output write sequence
  (`stageOutputPath` → `dirname` → `mkdir` → `cleanTmpFiles` → `writeFileAtomic`) named in one file and
  inlined in the other; the "stage missing from config" lookup+throw in both `openrouter.ts` and
  `transcription.ts` with two messages and two error types; `CostResolution` declared privately in
  `openrouter.ts` and reassembled by hand in `transcription.ts`.
- `naming.ts` — `/\s+/g` inlined twice (131, 161) in a file that names every other regex as a constant;
  five regexes inlined against four named.
- `eslint.config.js` — the `ImportNamespaceSpecifier` and `.then` selectors *and their full message
  strings* restated verbatim at 89-101 and 155-177. The comment explains flat-config forces it, but this is
  a JS module: hoist the array and spread it.
- `scripts/` — `repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/…" && pwd)"` four times
  (`pre-commit-check:20`, `post-edit-biome:12`, `setup:11`, `bin/lecture-notes:8`); the hook-payload JSON
  parse `node -e` snippet three times; the Vera guidance message twice in two wordings; "extensions Biome
  handles" twice in two syntaxes (a regex in the gate, a case glob in the formatter — **drift means gate
  and in-session formatter silently disagree**); `export PATH=…` three times in `setup`.

**Test source** — the same pattern, plus fixtures that exist and are bypassed:
- `stageCompletedAt` exists in `fixtures.ts` and its TSDoc says *"the suites share one rather than each
  inventing a timestamp that reads as though it mattered"* — `commands.integration.test.ts` invents four,
  `cost.test.ts` invents fourteen, `runner.test.ts` restates one three times, `runner.integration.test.ts`
  uses the non-ISO string `"earlier"` four times.
- `stagesWith` exists and is hand-rolled twice in `runner.integration.test.ts` (261-275, 721-730) — the
  fixture's body, cast included.
- `makeStubLogger` exists and `source-normalisation.integration.test.ts:82-89` builds a second logger stub
  with two unexplained `as never` casts.
- The empty `StageResult` `{ output: undefined, cost: null, filesWritten: [] }` appears eight times in
  `runner.integration.test.ts`, three of them byte-identical `vi.fn` blocks.
- The two Stage 3 suites are near-copies: the model-reply object, the stage-config block, the `runStage`
  body, the transcript-fixture triple, and one helper under two names (`readManifestAt` / `manifestAt`) —
  five separate copies.
- `contextWith` defined with the same body in `audio-extraction.test.ts` and
  `pipeline-stage.integration.test.ts`; `completeEntry`/`completedContext` likewise.
- `CELL_INJURY` is named at `source-normalisation.integration.test.ts:19` then restated verbatim six more
  times; lines 315-317 inline the whole body of `normaliseTwoLectures()`, a helper the same file calls
  twice elsewhere.
- `"/workspace"` five times in the 23-line `files.test.ts`.
- Setup repeated across tests without a `beforeEach`: four tests in `audio-extraction.test.ts` (200-233),
  five in `progress.test.ts`, three acts in `runner.integration.test.ts`'s relocated-workspace block, two
  in `lecture-identity.integration.test.ts` (163-175).
- Structure duplicated where `test.each` is mandated: three unresolved-cost tests in `cost.test.ts`
  (82-149), two `deriveRunId` tests in `runner.test.ts` (29-39), two `createProgressBar` tests, two
  `lectureFolderName` tests in `naming.test.ts`, two file-handling tests in `config.integration.test.ts`
  (298-312), and 14 repetitions of `expect(error).toBeInstanceOf(CliUsageError)` in `args.test.ts` that
  belong inside the `usageError` helper.

### 3. Type-safety escapes

Casts standing in where narrowing was available, mostly working around `noUncheckedIndexedAccess`:
`runner.ts:188` (`left.lectureDate as string` after a filter that cannot narrow) and `:319`;
`args.ts:342` (`COMMAND_SPECS[command] as CommandSpec` — the record is keyed on bare `string`, so
`buildCommand`'s precondition is invisible to the compiler and a bad call throws `TypeError` instead of
`CliUsageError`); `commands.ts:147`; `prompts.ts:81, 101`; `openrouter.ts:181-187` (wire data cast straight
to `{ data: { total_cost: number } }` with no guard, where `transcript-structuring.ts:94-133` sets the
house standard with a type guard and an explanatory comment — a response missing `total_cost` yields
`undefined` typed as `number` and silently corrupts cost telemetry); `config.ts:335`;
`source-normalisation.ts` (four unchecked assertions); `manifest.ts:48` (`JSON.parse(...) as RunManifest`,
unvalidated); `runner.ts:580` (every file in `runs/` JSON-parsed and cast `as RunLog`).

In tests: `pipeline-stage.integration.test.ts:66` casts `{ status } as ManifestStageEntry` for `"failed"`
and `"skipped"`, both of which structurally *require* further fields — so the test exercises
`isStageComplete` against data a real run can never produce.

`transcription.ts:24` disables `prefer-readonly-parameter-types` **file-wide**, justified by
`StageContext`'s shape — but `transcript-structuring.ts` has helpers with the identical signature and needs
no suppression at all. One of the two is wrong. Two `eslint-disable` comments in `runner.ts` (411, 615)
misquote CLAUDE.md, which permits dropping `readonly` only "when a **library** requires mutable types".

### 4. Documentation that has drifted from the code

- `cost.ts:73` — `stageLabel`'s TSDoc says it is *"the human-readable name of a stage, as every report and
  message shows it."* Two of the three report sections don't use it: `errorRecoverySection` prints the raw
  id and `experimentSection` prints `Stage: ${stageId}`. The report therefore shows "Transcript structuring"
  in section 1 and `transcript-structuring` in sections 2-3.
- `date.ts:334-338` — `extractDate`'s TSDoc says a span is accepted *"only when chrono is certain of both
  the day and the month."* Numeric spans and the compact-short fallback set `confident: true`
  unconditionally, never consulting chrono.
- `progress.ts:147` — "used by Stages 4 and 5", which do not exist. ~90 of the file's 191 lines
  (`createParallelWorkBar` and its helpers) have no production consumer at all — only the test file imports
  them. Against "**NEVER** add code beyond what is absolutely necessary".
- `fixtures.ts:337-339` — the TSDoc explaining why files are derived rather than reassembled, immediately
  contradicted at 528-530.
- `manifest.ts:6-8` — says "three separate callers"; the design doc says four, and Stage 3 does call
  `writeManifest`.
- `lecture-identity.ts:172` — `@throws … When a file **or workspace** already carries that date`, but
  `assertDateIsFree` checks only `[dirs.video, dirs.slide]`. The code is right per spec; the comment
  overclaims — and it matters, because `renameLectureFiles` moves the workspace with `rename()`, which
  overwrites silently.
- `setup:56-58` — claims the template "carries a `__project` marker inside each hook entry". It does not;
  there is one top-level marker. This is the cause of finding 1.5.
- `bin/lecture-notes:8-9` — header says it "runs from wherever the caller is", but the script `cd`s to the
  repo root, so relative path arguments resolve against the wrong directory.

### 5. Design-level smells (judgement calls)

`config.ts` does JSON validation *and* live OpenRouter network verification — two reasons to edit one
file, with a module-level mutable cache and a test-only `clearModelIdCache` export as the visible cost.
`files.ts` carries directory listing, atomic writes and the manifest path-security boundary.
`fixtures.ts` (625 lines) carries promise assertions, a pino stub, config/URL fixtures, lecture identity,
temp-tree builders, an ffmpeg renderer, manifest builders and nock arming. `runner.ts`'s `costReport`
writes to `process.stdout` from a class documented as an orchestrator. `prompts.ts` uses `-1`/`-2`
sentinels sharing a number space with real array indices, where a discriminated union would remove the
casts in finding 3. `openrouter.ts` defines and exports `ContextLengthError` yet throws bare `new Error`
for its own two failures, and keys its client cache on `JSON.stringify(openRouter)`, making cache identity
depend on key ordering. `layout.ts`'s `StageWorkspace.outputFile: string | null` forces a runtime `throw`
for the four stages that own no single file, in a file that otherwise models variants well.

---

## Spec

~68 findings across 10 agents. The spec is the project's own design docs — there is no external issue
backlog behind this code, so this axis measures internal consistency, not whether the design is what was
wanted.

### Missing or partial

- **No stage progress messaging exists anywhere.** TD §10 assigns "stage start/end messages,
  skipped-stage notices" to stdout, and says explicitly that this messaging "is emitted by the CLI and
  runner, not by this logger". The runner emits no `info` at all; the CLI writes summaries but never
  per-stage notices. Nobody emits them. This bites hardest on the case the test plan calls out: a clean
  re-run prints an **empty table**, the word `partial`, and no explanation. FR-6.5 ("clear progress
  feedback at each stage") is met only by in-stage progress bars.
- **`cost-report` never aggregates.** TD §7: *"aggregates all run logs across the configured `moduleRoots`
  … With no flags, aggregates across everything."* The implementation loops workspaces and prints a
  separate three-section report per lecture; `formatCostReport` takes one `manifest`, so there is no
  cross-lecture or cross-module total. With no workspaces it prints nothing, where the test plan expects
  "reports zero spend without error".
- **Half the documented runner surface is unexported.** TD §4.7 names `runStage`, `updateManifest`,
  `resolveWorkspace` and `findLectureByDate` as module-level functions specifically *"so the pure parts are
  unit-testable in isolation"*. All four are module-private.
- **Stage 0's logging requirement is partly met.** Discovery counts, renames, manifest writes and deletions
  are logged; per-file extracted dates, assigned numbers, and video↔slide matches are not — exactly the
  three that explain *why* a lecture got the number it did.
- **"Model unavailable" gets no handling.** TD §8: *"Stage fails; model ID included in error message."*
  `createCompletion` special-cases only `context_length_exceeded` and rethrows everything else untouched.
- **Stage-config keys are never validated.** TD §6 says the model-ID check catches "placeholders left
  un-substituted, **typos**, and retired IDs". `requireStages` maps `Object.entries` unfiltered into a
  `Partial<Record<StageId, …>>`, so a mistyped key (`transcript-strucuring`) validates, has its model ID
  checked, and passes — while the real stage silently has no config at all.
- **Only `BOD` is stripped as a module code.** TD §3.2 asks Stage 0 to strip "module code prefixes (e.g.
  `BOD_`)" — a class, of which `BOD_` is an example. `MODULE_CODE_PREFIX` implements exactly one, so any
  other module's code survives into the title.
- **Two documented tests have no equivalent:** `should skip module directories that contain no Pipeline
  processing/ folder` and `should leave aiDerivedTitle null when LLM judges the provisional meaningful`.
  Also the plan's live-key OpenRouter test (`should complete a minimal prompt and return a fully-resolved
  non-zero cost when called with valid API key`) does not exist, and the plan names a `--skip-model-check`
  CLI flag that was never built (it is a `loadConfig` parameter only).

### Implemented but wrong

- **`requireUrl` does not catch the typo class it is named for.** TD §6: *"it must parse as an absolute
  URL, so a typo is a `ConfigError` at startup rather than an obscure failure at the first billable call."*
  `config.ts:85` gates on `URL.canParse`, which accepts any syntactically valid scheme. **Verified by
  hand:** `URL.canParse("htp://openrouter.ai/api/v1")` is `true`, and its `.origin` is `"null"` — so the
  exact typo the sentence describes passes startup, and `modelsPageFor` then prints `null/models` in the
  very error meant to help.
- **Stage 0 never clears its own temp files, and could not if it tried.** TD §4.3 requires each stage to
  delete stale `.tmp` files at start. `executeRenames` renames through `TEMP_SUFFIX = ".stage0-tmp"`, and
  `cleanTmpFiles` filters on `.endsWith(".tmp")` — which `.stage0-tmp` fails. A crash between the two
  rename phases strands `<base>.mp4.stage0-tmp` in `Video files/`, which the next run reads as a second
  video on that date, so the module is refused as a duplicate and **cannot self-heal**. Stage 1 does call
  `cleanTmpFiles`, so the discipline exists and Stage 0 is the gap. *(Corroborated independently by two
  Standards agents' inventories.)*
- **The orphan-deletion prompt shows dollars, not pounds.** `source-normalisation.ts:368` renders
  `$${...totalCostUsd.toFixed(2)}`. TD §7 and NFR-2.3: *"any other user-facing total render pounds and the
  `£` symbol."* This is the one user-facing cost figure outside the reporting layer — and it is the figure
  a user weighs before approving an irreversible deletion.
- **A manifest-less folder aborts a whole batch.** TD §4.5 says such a folder "is a fact to skip over
  rather than an error". `listWorkspacesByDate` deliberately keeps it, `runLecture` then calls the throwing
  `readManifest`, and the rejection escapes `Promise.all` — losing every other lecture's summary.
  `costReport` in the same file does skip them.
- **Stage 3 writes back a stale whole manifest.** TD §4.2: *"A stage's own bookkeeping in the manifest …
  is written by the runner, never by the stage."* `recordIdentity` writes `{ ...context.manifest,
  ...changes }` — the whole manifest — and the runner deliberately hands the stage the pre-`running`
  context, so Stage 3's write reverts its own entry's status. After a hard crash the `running` marker that
  TD §4.2 relies on is gone.
- **Unresolved cost silently becomes zero.** `buildRunLog` skips `totalCostUsd === null` entries and
  `RunSummary.totalCostUsd` is a plain `number`, so the batch table shows a confident figure for a run
  whose spend is unknown. TD §7 states the opposite principle: *"a stage whose cost lookup failed leaves
  the total itself `n/a`."* The same asymmetry appears in `errorRecoverySection`, which adds only non-null
  costs to "Wasted on failures".
- **Model ids overflow their column.** `formatCells` pads but never truncates; section 1's Model column is
  26, and TD §4.5's own example stores `"anthropic/claude-sonnet-4.6"` — 27 characters — shifting every
  column to its right.
- **`moduleNameOf` restates the nesting `moduleRootOf` owns.** TD §3.3 declares `moduleRootOf` *"the
  inverse of `moduleDirs().processing`, so the nesting is stated once"*; `cost.ts:568-570` re-derives
  `resolve(workspaceRoot, "..", "..")`. `lecturesByModule` then keys by `basename`, so two module roots
  sharing a leaf name collapse into one row.
- **`findDatedFile` compares only the first date in a filename.** Canonical names put the title before the
  date, and titles come from user filenames or Stage 3's LLM. A title carrying a date-shaped span shadows
  the real trailing date, so a present file is silently treated as absent — and TD §4.7's *"Anything absent
  is skipped"* then swallows it.
- **`readManifestSafe` under-implements "malformed".** It catches throw-sites only, and `readManifest` is
  an unchecked cast, so a `manifest.json` holding `{}` or `[]` is returned as a `RunManifest` rather than
  skipped.
- **The debug log's timestamp cannot match the run log's.** TD §10: *"Takes the run timestamp so the debug
  log shares it with the run log."* `run-cli.ts:57` mints one at config-load time; `runner.ts:661` mints
  another when `runLecture` starts, with a network fetch in between. And `batch` runs N lectures against
  one root logger, so one debug log faces N run logs with N ids — the documented sharing is not merely
  unimplemented but unimplementable at this seam.
- **The debug log lands outside the workspace.** `run-cli.ts:58` passes bare `RUNS_DIR`, which pino
  resolves against `process.cwd()`. `commands.ts:213` compounds it by telling users the stack is "in this
  run's debug log under runs/" directly beneath output pointing at the *workspace's* `runs/`. The test plan
  records this and asks for confirmation — so this one is a known-open question, not a surprise. Latent
  risk: `readRunLogs` JSON-parses *every* file in a workspace's `runs/`, so honouring TD §10's stated
  placement would feed a single-line NDJSON debug log into the cost report as a bogus run.
- **`--from-stage` rejection never names the flag.** The test plan requires it to; `args.ts:183-185` names
  the value and the stage list but not `--from-stage`. `parseConcurrency` does name its flag, so the CLI
  is inconsistent with itself.
- **The no-match message asserts a scope the search did not use.** `commands.ts:136-138` always says "in
  the configured modules", but `cost-report --module` narrows to one. The follow-on advice ("add its video
  and slides and run the pipeline again") is also wrong for `cost-report`.
- **ANSI is emitted unconditionally.** TD §5 says the non-TTY fallback has "no ANSI"; `progress.ts:23`
  writes `ESC[31m…` into the payload regardless of renderer, so a failed item in a captured log gets raw
  escape bytes.
- **Stage 3 cleans `.tmp` files after the billable call**, not at stage start as TD §4.3 requires.
  Transcription does it correctly.
- **Acronyms are mangled** — `titleCaseWord` lowercases the tail, so `DNA` → `Dna`, working against TD
  §3.2's "the lecturer's provisional title is authoritative". Low confidence; the spec asks only to
  "title-case the result".

### Not asked for

- **The runner writes to the terminal.** `costReport` calls `process.stdout.write` directly, while TD §4.7
  gives the CLI an injected `write` that every other output path uses, and TD §8 states the principle:
  "user-facing output is the CLI's job".
- **The Stage 3 prompt hardcodes British English.** TD §5's structuring rules have no language
  instruction — British English is scoped to the *synthesised notes* (FR-3.3, NFR-1.1) — and TD §6 makes
  `output.language` configurable. The stage has `context.config` and ignores it.
- **`fixtures.ts` is a deliverable of no phase** — 625 lines under `src/pipeline/`, importing `vitest` and
  `nock`, mentioned once in passing and never listed.
- Undocumented exports: `files.ts`'s `readDirSafe`/`listFileNames`/`listSubdirectoryNames` (no tests of
  their own); `layout.ts`'s `stageDirectoryPath` (no caller outside its own module) and `StageInWorkspace`;
  `lecture-files.ts`'s `baseNameForLecture` (4 call sites); `transcription.ts`'s `API_KEY_VARIABLE`;
  `commands.ts`'s four extra exports.
- Plan-level creep: `scripts/claude-hooks.json` ships five hooks where the plan says two;
  `audit-constants.mjs`, `.jscpd*.json`, `.secretlintrc.json`, `.npmrc`, `pnpm-workspace.yaml` and
  `vitest.config.ts` appear in no phase's deliverable list; five suites (`layout.test.ts`,
  `progress.test.ts`, `errors.test.ts`, `files.test.ts`, `logger.integration.test.ts` — 41 tests) are
  documented nowhere.
- `pipeline-config.json` is named as a Phase 1 deliverable but is gitignored; the tracked
  `pipeline-config.example.json` is mentioned in no doc at all.

### The design doc contradicts itself

Named rather than silently resolved, because "fidelity" is ill-defined where the spec argues both ways:

1. **`QA checked/` vs `Output/`** — TD §3.3 argues for `QA checked/notes.md` and the implementation plan
   echoes it three times; TD §§5, 4.5 and 9 say `Output/notes.md` in five places. Code follows §3.3.
   *(The only finding corroborated independently by two agents in run 1, and again here.)*
2. **`slide-conversion.outputFile`** — TD §3.3's prose lists slide-conversion among stages "producing a set
   rather than a file", but its own tree and §5 both give it `Slide content/slides.md`. Code follows the
   tree.
3. **`--from-stage` deletion vs NFR-4.3** — `resetFromStage` calls `rm(..., { recursive: true, force: true })`
   with no prompt. TD §4.7 sanctions this; `requirements.md` NFR-4.3 says *"shall not irreversibly delete
   pipeline work without explicit user confirmation"*. Stage 0's orphan guard and `delete` both confirm, so
   the runner is the only deleter that does not. Issue #2 covers the blast radius; the **absence of
   confirmation** is the broader unfiled point.
4. **`CliDeps`** — TD §4.7's type sketch lists six fields and omits `selectMatch`, while the same section
   twice mandates the single-choice picker that requires it. Code is right, sketch is stale.
5. **`maxRetries: 5` / `timeout: 120_000ms`** — TD §8 gives these as fixed SDK settings; TD §6 says they
   are "configuration — never literals in code". Code follows §6.
6. **The placeholder guard is disarmed by the workaround the spec mandates.** TD §6 has `loadConfig` reject
   un-substituted `<PLACEHOLDER>` ids; the test plan mandates keeping a `placeholder/` prefix *and* a
   `placeholder` exemption for the four unbuilt stages, which filters them out before the `<`-check runs.
   TD §6 also says to "keep the list to providers that genuinely sit outside OpenRouter" — `placeholder` is
   not a provider. The test plan's own warning about disarming the check is now structural.
7. **The base-name builder has three names** across the docs (`lectureFolderName`, `lectureBaseName`,
   `baseNameForLecture`) and the one actually called is declared in none of them. TD §3.2's stated
   rationale — *"Takes the parsed Date rather than a formatted string so the one place that formats a
   lecture date is `formatDateISO`"* — is defeated at the CLI call site, which passes a `YYYY-MM-DD` string
   for the wrapper to re-parse.
8. Smaller: TD §8's typed-error list omits `TranscriptStructuringError`; TD §9's file listing omits
   `lecture-files.ts`, `layout.ts` and `fixtures.ts`; TD §10's "child logger bound to the run timestamp" is
   contradicted 30 lines later; the implementation plan cites a "TD §10" for progress bars when the design
   doc ends at §9.

---

## Cross-file duplication (verified)

Partitioning buys provable coverage at the cost of cross-file sight, so the agents' inventories were
diffed as data and each candidate was settled by an independent agent given **the question, not a side**:
*is this one fact with two homes, or two facts sharing a value?*

| Candidate | Verdict | Where the name belongs |
|---|---|---|
| Directories a lecture's files live in — `[video, slide, finalOutput]` at `lecture-files.ts:135`, `lecture-identity.ts:131`, `fixtures.ts:525` | **ONE FACT** | An accessor on `ModuleDirs` in `layout.ts`. Add a fourth dated-file directory and updating one site is a bug: delete leaves an orphan, rename desynchronises the manifest. |
| …but the *pair* `[video, slide]` at `lecture-identity.ts:155-156, 181` | **SEPARATE FACT** | "A lecture's source pair" — `finalOutput` is deliberately absent because a PDF is optional until Stage 8. Wants its own local name; it is duplicated within its file. |
| Manifest schema version `"1"` — `source-normalisation.ts:36` (`MANIFEST_VERSION`) and `fixtures.ts:424` | **ONE FACT** | `manifest.ts`, which already owns the on-disk format. Nothing validates `version`, so bumping to `"2"` would leave every suite silently seeding v1 manifests with no test failing. |
| …but `PipelineConfig.version` also `"1"` | **SEPARATE FACT** | Different schema, independent bump. Do not merge. |
| `pipeline-config.json` — `CONFIG_FILENAME` plus three error-message literals in `openrouter.ts` and `transcription.ts` | **ONE FACT** | Not `config.ts` (it imports from `openrouter.ts`, so importing back cycles) — `types/pipeline.ts`, which is import-free and already exports `STAGE_IDS`. Rename the file and those messages tell the user to edit something that doesn't exist. |
| …but `pipeline-config.example.json` | **SEPARATE FACT**, self-duplicated | Different file, different lifecycle — but stated three times inside `fixtures.ts`. |
| JSON indent `2` — `manifest.ts:20` (`JSON_INDENT`), `runner.ts:332`, one test | **ONE FACT** | Move `writeJsonAtomic` into `utils/files.ts` beside `writeFileAtomic`, owning the indent; `writeManifest` and `writeRunLog` both call it. Not a correctness bug, but `manifest.ts`'s own docstring says its purpose is that callers share "the JSON formatting" — and `runner.ts` rebuilds it. *(This correction came from the verifier: the runner writes manifests through `writeManifest`, not `writeJsonAtomic`, so the "byte-identical" argument I put to it was wrong. The finding survives on the weaker ground.)* |
| …but `scripts/setup:105` | **SEPARATE FACT** | Writes Claude Code's `settings.json`; follows that tool's convention. Coincidental `2`. |
| A completed manifest stage entry — 8 sites across 6 suites | **ONE FACT** | A `completeEntry(overrides)` builder in `fixtures.ts`. `StageEntryComplete` is a fully-required five-field shape; add a sixth and all eight break together. Varying `filesWritten`/`cost` is what an overrides object absorbs. `commands.integration.test.ts:88-94` is an eighth site the review missed. |
| …but `run-status.test.ts` and `runner.integration.test.ts:171-186` | **SEPARATE FACT** | Run-*log* outcomes (`action: "ran"`), not manifest entries. |
| Anchoring a `YYYY-MM-DD` date to a time — `args.ts:114` (`T00:00:00Z`), `lecture-files.ts:52` (`T00:00:00`), `fixtures.ts:432` (`T00:00:00.000Z`) | **REJECTED — SEPARATE FACTS** | Each suffix is load-bearing and pinned by a different consumer. `args.ts` needs the `Z` for its `toISOString().startsWith(value)` round-trip — drop it and every valid date is rejected east of Greenwich. `lecture-files.ts` needs the *absence* of `Z` because `formatDateISO` reads local getters — add it and the base name lands a day early west of Greenwich. The fixture's is a string never parsed. Unifying them would break two of the three. |

**Name collision, not duplication:** `LectureIdentity` is declared twice — `types/pipeline.ts`
(`lectureNumber`, `lectureDate`, `provisionalTitle`, `lectureTitle`) and `naming.ts` (`lectureNumber`,
`title`, `date`). Same name, different fields, both non-exported. That is a naming problem, and a
different finding from duplication.

**Coincidences, correctly left alone:** `"utf8"`, `{ recursive: true }`, `2` as a `JSON.stringify` indent
outside `src/`, and `"1"` as both a manifest and a config version.

---

## Carried forward from run 1 (not re-found by run 2)

Every finding in `code-review-2026-08-22.md` was checked against this run. These were **not** re-found and
are still live. They are listed here so this document can be worked through on its own — but the framing
and line numbers are run 1's, and run 1's caveats apply: they are unverified agent output.

### Substantive

1. **`lecture-files.ts:22` imports `lectureBaseName` from `stages/source-normalisation.ts`** — a shared
   pipeline module depending on a stage, against the direction the file's own header (`:11-13`) argues for.
   Every new stage deepens it. `lectureBaseName` has three consumers and belongs in `lecture-files.ts` or
   `utils/naming.ts`. **This was run 1's worst Standards finding and is flagged "fix before Stage 4".**
   Run 2 saw the *symptom* — SP9 reports the base-name builder has three names across the docs — but never
   flagged the dependency direction.
2. **Stages 1–3 do no logging at all, and the API has no seam for it.** TD §10 requires
   `logger.child({ stage: stageId })` per stage and a debug line per LLM call (model, prompt tokens,
   latency). Only Stage 0 takes a logger (`source-normalisation.ts:582-588`). **`createPipelineStage` has
   no logger parameter and neither does `makeCompletionCall`'s documented signature** — so the required
   logging has no home in the designed API, not merely no implementation. Settle before Stage 4 adds a
   fourth stage with the same gap. *(Distinct from run 2's "no stage progress messaging", which is about
   stdout; this is about the debug log.)*
3. **"Wasted on failures" reads £0.000 in the design doc's own worked example.** `cost.ts:337` filters
   `runType: "error-recovery"`, but TD §7's Run Classification table types the *first* failed run as
   `normal` — so the original failure, which is the whole point of the section, is excluded. *(Run 2 found
   a different defect in the same function — unresolved costs also dropped. Both are real.)*
4. **`providerPrefixOf` (`config.ts:324-330`) and `PROVIDER_SEPARATOR` (`transcription.ts:71,138-139`)
   split a model ID on `/` in two modules, taking opposite halves.** One fact, two homes — a cross-file
   duplication run 2's inventory diff should have caught and did not.
5. **`runner.ts:145-151` `readJsonFile` duplicates `manifest.ts:61-71` `readManifestSafe`** — both are
   "parse JSON, `null` on failure" behind a bare catch.
6. **Stage-output directory preparation is triplicated, not doubled.** Run 2 reports
   `transcription.ts:264-270` and `transcript-structuring.ts:151-155`; run 1 adds
   **`audio-extraction.ts:138-141`** as the third. Run 1's placement argument is the better one: this shape
   belongs in `pipeline-stage.ts`, since every stage is built through `createPipelineStage`.
7. **AAA breaches — and run 2 contradicts run 1 here.** Run 1: `runner.integration.test.ts:368-382`
   interleaves arrange and act twice, and `source-normalisation.integration.test.ts:120-125` hides the Act
   inside `expectNormalisationToAbort`, which is then invoked in *assert* position at `:280` and `:478`.
   Run 2's agents positively asserted "AAA holds throughout" for both files. **Unresolved — run 1 cites
   specific lines and run 2 cites none, so prefer run 1 until someone looks.**
8. **A ninth design-doc self-contradiction:** TD §10's Output Streams table lists an unmatched source file
   as a stderr *warning*; TD §5 (line 658) makes an unmatched video or slide a stop-the-run *error*. Code
   follows §5 (`source-normalisation.ts:139-148`).

### Duplication and naming the inventory diff missed

9. `type MatchQuery` written twice with near-identical TSDoc (`commands.ts:31`, `prompts.ts:24`), and
   `CliDeps.selectMatch` (`commands.ts:51`) restates `selectLectureMatch`'s signature (`prompts.ts:96`) a
   third time.
10. `(text: string) => void` unnamed across **eight** sites (`commands.ts:55`,
    `run-cli.ts:33,35,52,127,131,136,137`) — wants one `WriteText` type.
11. `.replace(/\s+/g, " ").trim()` at `date.ts:373` as well as `naming.ts:131,160`. Run 2 caught the two
    in `naming.ts` and missed the cross-file third.
12. `fixtures.ts:487` vs `:522-523` both rebuild `join(moduleDirs({moduleRoot}).processing, folderName)`.
13. `files.ts:246-249` — `@param` text duplicates `ManifestPathQuery:234-238` verbatim.
14. `naming.ts:166` throws a bare `Error` where `errors.ts:7` `NamedError` exists.
15. **Two seams for one problem:** `config.ts:24`'s module cache uses an exported `clearModelIdCache`;
    `openrouter.ts:87`'s uses an optional `client?: OpenAI` param (`:218`) — which also brushes the rule
    against optional fields that select runtime behaviour. Run 2 reported each cache separately and never
    compared them.
16. `StageParams:66-71` — `concurrency?` and `maxIterations?` each apply to exactly one stage, so they are
    optional fields implying different runtime behaviour. Run 2 caught `RunOptions` and missed this.
17. `cost.ts:269-277` — the `PresentedAt` / `ManifestReport` generics wrap a single field.
18. `RunSummary:577` carries no lecture or module identity, which is the *root cause* of the path surgery
    at `cost.ts:568` that both runs flag. Feature Envy.
19. Primitive Obsession on dates: `lectureDate: string` throughout (`args.ts:30`, `commands.ts:119`,
    `lecture-identity.ts:152`); `isCalendarDate` validates and returns a bare `string`, so nothing
    downstream can tell a validated date from any string.
20. `run-cli.ts:147` `command satisfies RunnableCliCommand` asserts what the `=== "help"` guard already
    narrowed.

### Cross-suite duplication run 2's partitioning hid

21. **`TRANSCRIPT_TEXT` is one fact with three different values** — `transcription.test.ts:37`,
    `transcription.integration.test.ts:22`, `transcript-structuring.test.ts:38`.
22. The **nock arm/disarm block** appears 3× — `config.integration.test.ts:135`,
    `openrouter.integration.test.ts:102`, `transcript-structuring.integration.test.ts:54`.
23. The **ffmpeg fixture pair** (`sine=frequency=440` + `FIXTURE_SECONDS`) in
    `audio-extraction.integration.test.ts` and `transcription.integration.test.ts`.
24. The **temp-dir `beforeEach`/`afterEach` pair** is identical bar its prefix in
    `files.integration.test.ts:16-22` and `logger.integration.test.ts:28-34`.
25. The OpenRouter `"test-key"` env stub in two suites. *(Run 2 separately found that neither suite
    restores it — the leak and the duplication are both real.)*
26. Local `writeManifest`/`readManifest` helpers **re-implementing `manifest.ts`** in
    `runner.integration.test.ts:71-83` and again in `source-normalisation.integration.test.ts:53-55`.
27. `transcription.test.ts` — `interceptTranscription(...)` in **12** tests, and `:41` carries a comment
    *rationalising* a `test.each` breach rather than fixing it.
28. `config.integration.test.ts` — the `makeValidConfig` → `writeConfig` → `mockModelsResponse` arrange
    repeated at `:166,191,237,255,277`.
29. Missing `test.each` pairs run 2 did not list: `runner.integration.test.ts:219-237`/`:239-257` and
    `:502-513`/`:515-523`; `transcription.test.ts:174-181`/`:183-189`;
    `transcript-structuring.test.ts:199-205`/`:207-213`; `openrouter.integration.test.ts:140`/`146`,
    `152`/`158`, `164`/`174`; `lecture-identity.integration.test.ts:133/141/148/155` and `:80/87/93`.
30. Mysterious test names: `runner.integration.test.ts` `outcome`, `logged`, `existence`, `output`
    (`:112,125,422,757`); `config.integration.test.ts:88` `stageModelIds` returns the whole stages record.
31. `source-normalisation.integration.test.ts:97` `writeLecture(video, slide)` — positional params against
    the options-object rule. *(Run 2 caught the equivalent in `runner.integration.test.ts:112`.)*
32. `prompts.test.ts:43` and `commands.integration.test.ts:142` **both** re-derive what
    `baseNameForLecture` owns — **and disagree with each other**. Run 2 caught only the `prompts.test.ts`
    side.

### Where the two runs disagree on counts or severity

- **Run 2 undercounts three repetitions.** `audio-extraction.test.ts`: run 1 says 6 tests
  (`:201,211,220,233,248,263`), run 2 says 4. `openrouter.integration.test.ts` mock pair: run 1 says 7
  (`:182,200,217,230,241,271,281`), run 2 says 4. `"audio extraction failed"`: run 1 says 5, run 2 says 4.
  Prefer run 1's counts; they cite every line.
- **The snapshot finding is contested and run 2 stated it flatly.** Run 1 records a real counter-argument:
  all three snapshotted functions exist to produce a fixed text layout, so there is a genuine case that
  these *are* serialisation-format regression tests, which CLAUDE.md permits. Owner's call — do not treat
  it as a settled violation.
- **Untested exported functions is a Standards violation, not just a docs gap.** Run 2 reports
  `readDirSafe`/`listFileNames`/`listSubdirectoryNames` as undocumented exports on the Spec axis. Run 1
  reports them — plus **`produceFileAtomic` (`files.ts:124`)**, which run 2 omits entirely — as breaching
  "MUST write unit tests for all new functions and modules".
- **Run 2 is stricter in two places, and that is not an omission.** Run 1 called `layout.ts`,
  `manifest.ts`, `pipeline-stage.ts` and `transcript-structuring.prompt.ts` "clean"; run 2 found findings
  in all four. Run 1 found "no scope creep in the four built stages"; run 2 found the Stage 3 prompt
  hardcoding British English against a configurable `output.language`.

### Why run 2 lost these

Two causes, both worth fixing before a run 3. **Partitioning trades cross-file sight for provable
coverage** — run 1 had a dedicated exhaustive cross-suite pass and run 2 replaced it with an inventory
diff performed by me, which caught five candidates and missed at least a dozen. And **aggregation loses the
long tail**: 28 agents produced ~250 findings, and condensing them into a readable document dropped
specifics that run 1, with five agents and less to compress, kept. The fix is to diff the inventories
mechanically rather than by reading, and to keep a full appendix separate from the readable summary.

---

## Summary

| Axis | Findings | Worst issue within that axis |
|---|---|---|
| **Standards** | ~180 | **The commit gate is bypassed by any `git <global-flag> commit`, and outside `src/` only secretlint runs at all.** Two `MUST` rules are configured `warn` with no `--max-warnings 0`; the cross-feature import rule CLAUDE.md names ESLint's purpose for does not exist; the immutability rule covers half the tree; every hook is installed twice. All verified by hand. |
| **Spec** | ~68 | **No stage progress messaging exists anywhere** — TD §10 assigns it to the CLI and runner, and neither emits it, so a clean re-run prints an empty table and the word `partial` with no explanation. Runner-up: `requireUrl` accepts the exact typo it was written to reject (`URL.canParse("htp://…")` is `true`), verified by hand. |

The axes are reported separately and deliberately not merged or reranked against each other.

---

## What this review did and did not establish

**Verified by hand, not taken on an agent's word:**
- Ten of the agents' "verifiable detail" spot-checks, against the real files — all ten exact.
- `eslint .` exits 0 with a live warning; `id-length` and `jsdoc/require-throws` both resolve to severity 1.
- `no-restricted-imports`, `import/no-restricted-paths` and `prefer-readonly-parameter-types` all resolve
  to `undefined` for `src/utils/naming.ts`.
- Biome reports `vitest.config.ts` and `eslint.config.js` as "provided but ignored".
- The gate's command matcher skips `git -C . commit` and `git -c user.name=x commit`.
- Every hook group in `.claude/settings.local.json` appears exactly twice.
- `URL.canParse("htp://openrouter.ai/api/v1")` is `true`, with `.origin === "null"`.
- Six cross-file duplication candidates, each settled by an independent agent — **one was rejected**, two
  came back MIXED, and two verifiers corrected a premise or found a site the review had missed.

**Not verified:** the remaining ~240 findings are unverified agent output. Coverage is provable; individual
findings are not. Verify any one of them yourself before filing it as an issue — in run 1, one finding out
of three that got that scrutiny needed its framing corrected before it could be filed.

**Not covered:**
- **Run 1's long tail.** This run did not re-find ~25 of run 1's findings, eight of them substantive, and
  contradicts run 1 once (AAA breaches). They are carried forward above, but that section is a transcription
  of run 1's claims, not an independent re-derivation — nobody re-read those lines in this run.
- `pnpm-lock.yaml` and the `docs/*.md` prose, both deliberately out of scope.
- The Spec axis compared code against the project's own design docs. There is no independent statement of
  what was wanted, so where the docs contradict themselves — eight places, listed above — "fidelity" is
  ill-defined and the review named both sides rather than picking one.
- Nothing was executed. No lecture was processed, no stage invoked. This says nothing about whether ffmpeg
  works, the transcription contract holds, or the date parser handles real lecturer filenames — that is
  what the still-blocked user testing is for. The one exception: the test suite's own coverage figures were
  measured, and the four tooling claims above were executed directly.

**What neither axis looks for.** Standards is conformance and Spec is fidelity. **Neither hunts defects.**
The Fowler smell baseline is a refactoring vocabulary, not a correctness checklist, and a bug the spec does
not describe is invisible to both — a race under `--concurrency`, an off-by-one, a swallowed filesystem
error. **Security and performance are likewise out of scope**; `/security-review` remains untouched. A
clean report on these two axes is not evidence of sound code.

Issues #1, #2 and #3 were excluded as already filed. All three remain visible in the code.
