# 01 — Log each retry of a model call

**Status:** needs-triage

**Blocked by:** none

**The problem:** the OpenAI client of OpenRouter sends a model call again by itself. It does this when a try is longer than `openRouter.completionTimeoutMs`, and on some errors. It can send the call up to `openRouter.completionMaxRetries` more times. The client writes no line for a retry, and the pipeline does not know that a retry happened. The debug log writes one "Model call" line for each call, after the last try. Its `latencyMs` is the time of all the tries together. So a user cannot tell a slow call from a repeated call.

**What the user saw (2026-10-14):** the run of Genomics of Disease lecture 1 (debug log `2026-10-14T21-49-25Z-debug.log`). In `relocate-slides`, the call of subtopic 8 stayed in flight long after the other calls returned. The log showed no line for it until the call returned. Then its "Model call" line gave `latencyMs` 173889, with a prompt of 2,737 tokens. The time limit of that run was 120 seconds. One try cannot be longer than the limit, so the first try timed out and the client sent the call again. The log does not show this.

**The code today:** `createOpenRouterClient` in `src/pipeline/openrouter.ts` gives the client its `maxRetries` and `timeout`. `sendOnce` in the same file measures `latencyMs` around the whole call, retries included.

**What to find out first:**

- How the pipeline can see each retry. The OpenAI SDK may have a hook or a log option for retries. If it has none, the pipeline may need its own retry loop in place of the SDK's. This needs a check of the SDK version that the project uses.
- Whether OpenRouter charges for a try that the client stopped. The cost tally adds the cost of the last reply only. If a stopped try costs money, the recorded cost of the stage is too low.

**Acceptance:**

- [ ] The debug log has one line for each retry of a model call. The line gives the stage, the model, the number of the try and the reason, such as a timeout or an HTTP status.
- [ ] The "Model call" line tells the number of tries.
- [ ] A test with a stubbed OpenRouter that times out once shows the retry line.
- [ ] The ticket records the answer on the cost of a stopped try. If a stopped try costs money, a new ticket covers the cost.

## Comments
