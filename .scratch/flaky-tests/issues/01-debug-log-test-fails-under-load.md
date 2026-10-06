# 01 — The debug log test fails under the load of the full suite

**What to build:** a debug log test that passes every time, also when the full suite runs. The test is "should write the debug log under the project root when a command runs" in `src/cli/run-cli.integration.test.ts`.

**Blocked by:** None — can start immediately

**Status:** needs-triage

## The defect

On 2026-10-06, the commit gate ran the full suite and this test failed once. It expected one `-debug.log` file in the debug log folder and found none:

```
AssertionError: expected [] to have a length of 1 but got +0
 ❯ src/cli/run-cli.integration.test.ts:116:67
```

The same working tree passed the full suite two minutes before and after. The test file passed 5 times out of 5 when it ran alone. The commits under test changed only comments.

## The probable cause

This cause is not verified.

The logger writes the debug log through a pino destination with `sync: false` and `mkdir: true` (`src/utils/logger.ts`). Such a destination makes the folder and opens the file after the call returns. The test lists the folder directly after `runCli` returns. Under load, the list can come before the file is made.

## Criteria

- [ ] A test run shows the cause. For example, the test fails every time when the open of the file is delayed.
- [ ] One side changes, and the user decides which. Either the test waits for the debug log without a timing guess, or the CLI makes the file before it returns.
- [ ] The test passes in 20 full-suite runs in a row.
- [ ] The commit gate passes.

## Comments
