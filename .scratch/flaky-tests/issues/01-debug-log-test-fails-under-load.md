# 01 — The debug log test fails under the load of the full suite

**What to build:** a debug log test that passes every time, also when the full suite runs. The test is "should write the debug log under the project root when a command runs" in `src/cli/run-cli.integration.test.ts`.

**Blocked by:** None — can start immediately

**Status:** resolved

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

- [x] A test run shows the cause. For example, the test fails every time when the open of the file is delayed.
- [x] One side changes, and the user decides which. Either the test waits for the debug log without a timing guess, or the CLI makes the file before it returns.
- [x] The test passes in 20 full-suite runs in a row.
- [x] The commit gate passes.

## Comments

### 2026-10-07 — The cause is shown

pino 10.3.1 writes through sonic-boom 4.2.1. With `sync: false` and `mkdir: true`, sonic-boom makes the folder with an async `fs.mkdir`, and then opens the file with an async `fs.open`. Both finish after `createDebugLogger` returns. `runCli` does not wait for them, and it does not close the logger before it returns.

A preload script delayed each `fs.open` of a `-debug.log` file by 300 ms. The script was given through `NODE_OPTIONS="--require …"`, so no repository file changed. With the delay, the test failed 3 times out of 3, with the message of the original failure: `expected [] to have a length of 1 but got +0`. Without the delay, it passed.

### 2026-10-07 — Fixed on the CLI side

The user chose the CLI side. Commit `36a8d1c7`: `createDebugLogger` also gives a `close`, and `runCli` closes the debug log before it returns. The CLI test also reads the entries of the debug log. With the 300 ms delay on the file open, the CLI test and the logger test passed 3 times out of 3. The commit gate and 19 more full-suite runs passed: 20 runs in a row, each with 1185 of 1185 tests.
