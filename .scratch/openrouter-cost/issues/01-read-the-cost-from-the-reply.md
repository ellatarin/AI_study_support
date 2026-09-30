# 01 — Read each call's cost from its reply

**What to build:** every OpenRouter call records what it cost, taken from the reply itself, so runs, batches and the cost report show a figure rather than `n/a`.

**Blocked by:** None — can start immediately

**Status:** needs-triage

Moved from GitHub issue #10 (opened 2026-09-01) on 2026-09-30, and investigated before filing here.

## What happens now

Every OpenRouter-billed stage records its token counts and then fails to price them. The manifest entry carries `costUsd: null` with `Cost lookup failed: Error: 404 Generation gen-… not found`, and the run summary and cost report print `n/a`. Seen on every OpenRouter call since at least 2026-09-01: the verification runs (#8), and every splitting run of tickets 05, 06 and 10 in this repo's division-stages tickets.

After a reply arrives, the pipeline asks OpenRouter's `/generation` endpoint for the call's price. That record is not there yet, so the endpoint answers 404. The SDK treats a 404 as permanent and never retries it, so the configured `costLookupMaxRetries` never engages.

## What the investigation found (2026-09-30)

Two one-word calls to `google/gemini-3.7-flash`, then `/generation` asked at rising intervals:

| Request | Cost in the reply | `/generation` 404 until | First 200 |
|---|---|---|---|
| As the pipeline sends it today | `usage.cost` present | 9.8 s | 18.1 s |
| With `usage: { include: true }` | `usage.cost` present | 9.3 s | 17.6 s |

- **The reply already carries the cost**, as `usage.cost` (with `cost_details` splitting prompt and completion), even without asking for it. The second request is unnecessary.
- **The lookup record takes between 10 and 18 seconds to appear.** Retrying the lookup would work, but it would hold every call open for that long.

## What to build

- [ ] A call's `costUsd` is the reply's `usage.cost`; the `/generation` lookup is removed.
- [ ] A reply without a numeric `usage.cost` records `costUsd: null` with a `costResolutionError` saying so; it never fails the call, the stage or the run (technical-design.md §7).
- [ ] A provider refusal (an accepted reply carrying an error) keeps costing $0 when it carries no cost, as now; when it does carry `usage.cost`, that figure is used.
- [ ] `costLookupTimeoutMs` and `costLookupMaxRetries` no longer govern anything, so they leave the config, the example config and the TD. What happens to a config that still carries them is decided at triage: refuse it with a message, or ignore them.
- [ ] When costs are summed and several parts are unpriced, each distinct reason is recorded once, not once per call: a panel stage makes 18 or more calls and would otherwise repeat the same reason 18 times. (From issue #10's comment of 2026-09-28.)
- [ ] Covered by tests that do not depend on live OpenRouter timing.
- [ ] One live call confirms a priced cost reaches the manifest and the run summary.

## Comments

2026-09-30: the costs already lost stay lost. Every stage run so far records `n/a`, and no run file saved the reply's `usage.cost`, so nothing can be re-priced after the fact. Past spend can be read from OpenRouter's activity page.
