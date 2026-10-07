# 01 — Stub the OpenRouter client in the model-stage suites

**What to build:** Each suite below replaces the module of the model call with `vi.mock`, so that a test can reach the model call. The mock lines are the same in each suite, so each suite hides them from the duplication check with a `jscpd:ignore` block. The stages already get the OpenRouter client as a dependency. Change each suite to build its stage with `stubbedOpenRouterClient` from `fixtures.ts`, as `read-slides.test.ts` does. Then remove the module mock and the `jscpd:ignore` block of each suite.

**Blocked by:** none

**Status:** resolved

The suites:

- `src/pipeline/stages/deepen-subtopic-splitting/deepen-subtopic-splitting.test.ts`
- `src/pipeline/stages/group-into-topics/group-into-topics.test.ts`
- `src/pipeline/stages/initial-subtopic-splitting/initial-subtopic-splitting.test.ts`
- `src/pipeline/stages/judge-lecture-title/judge-lecture-title.test.ts`
- `src/pipeline/stages/model-stage.test.ts`
- `src/pipeline/stages/retitle-subtopics/retitle-subtopics.test.ts`

`transcript-structuring.test.ts` and `transcript-verification.test.ts` also mock the module. They are not in this ticket, because the two transcript stages will be removed.

- [x] No suite in the list calls `vi.mock` on `openrouter.js`.
- [x] No suite in the list has a `jscpd:ignore` block for its preamble.
- [x] A stubbed reply goes through the real model-call code. So each stubbed reply is an OpenRouter reply body, with its usage and its cost.
- [x] The fixtures that read a stubbed call, such as `sentUserMessage`, read the requests of the stub client.
- [x] Each suite keeps its tests and their titles.

**Findings and decisions:**

- `useStubbedOpenRouter` in `fixtures.ts` gives a suite a new stub client before each test. `useStageReadingDivision`, `read-slides.test.ts` and the two splitting suites use it.
- `driveModelStage` now takes the client. The two suites that stub the network pass `openRouterClientFor`.
- `useStageReadingDivision` takes `reply`, the content of the reply to every call, in place of a function. It is `null` in the grouping suite that stubs the network.
- The real model-call code waits for the gap between sends. The example config spaces the sends of `group-into-topics` 0.5 s apart, so each grouping test took about 4 s. The grouping unit suite sets no gap through the new `tuning` field. The integration suite still tests the gap with a fake clock.
- The judge and retitle suites then held the same resend-failure check. `useStageReadingDivision` gives `expectResendsExhausted({ calls })`, which also checks that each call was sent three times. The grouping suite now checks its sends too.
- All 64 test files pass: 1068 tests.
