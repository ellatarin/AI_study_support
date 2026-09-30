# 12 — Resend refused calls in every stage

**What to build:** when a provider refuses a call inside an accepted reply — OpenRouter's HTTP 200 carrying an error where the reply should be — the call is sent again instead of failing the stage at once. This holds for every call in every stage, from the one place every OpenRouter call passes through. Built to TD §6, "A rejection can arrive inside an accepted reply", and plan Phase 11, "refusals resent".

**Blocked by:** None — can start immediately

**Status:** resolved

- [x] A refused call is sent again, up to three sends, pausing two seconds and then four between them.
- [x] When a later send is accepted, its reply is returned as if nothing had been refused.
- [x] Each refusal is logged as a warning naming the stage, the model and which send it was, and quoting the provider's own sentence.
- [x] The third refusal fails with the existing named error, quoting the last refusal.
- [x] Every refused send is costed, as any send is.
- [x] A reply that carries neither a reply nor a refusal is still the existing named error, and is not resent.
- [x] Stages that resend bad replies of their own (empty, not JSON, wrong shape) keep doing so unchanged; a refusal is resent before the stage ever sees it.

## Comments

2026-09-30, from the grill: the user chose resending for every stage over the grouping panel alone. No saved prototype run shows a 429 or any rate-limit message; the rate limit on `openai/gpt-6.1-sol-pro` that motivates this is unverified, and the logged warnings are how it will be seen if real.

2026-09-30, resolved. The resend loop moved out of the panel into one shared place, used by both the completion call and the panel stages. A refused send counts as a call: its cost is looked up by its generation id, or counted as nothing when it carries none (the user's choice; OpenRouter does not bill a request that produced no output). The refusal's former debug log entry is now a warning per refused send.
