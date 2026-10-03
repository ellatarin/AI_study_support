# 16 — Keep an answer that arrives with the provider's error

**What to build:** a reply that carries a complete answer and the provider's error together is handed back, not resent, and every call's finish reason is written to the debug log. Built to TD §6, "A rejection can arrive inside an accepted reply", TD §10, and plan Phase 11, "answers kept beside a provider's error".

**Blocked by:** None — can start immediately

**Status:** resolved

What happens now: the completion call looks for the provider's error before it reads the answer, so a reply carrying both is treated as a refusal — logged, resent, and its answer thrown away; three such replies fail the stage. The finish reason is never read or logged. `openai/gpt-6.1-sol-pro` reported `error` as the finish reason on 11 of the prototype's 72 grouping calls, all of them usable answers. The prototype kept only the parsed answer, so whether those replies also carried an error field is unknown; the first live `define-topics` run will show it.

- [x] A reply with an answer and the provider's error returns the answer after one send.
- [x] That error is logged as a warning with the provider's sentence, the stage, the model, the finish reason and which send it was.
- [x] A reply whose finish reason is `error` and which carries no error field returns its answer after one send.
- [x] Every call's `debug` record carries the finish reason, or `null` when none was reported.
- [x] A reply with the provider's error and no answer — no choice, or a choice with empty content — is still a refusal, resent as before.

## Comments

2026-10-03: found while agreeing ticket 08's test seams. The user ruled the answer is accepted and the debug log is enough to keep the evidence; finish reason is not added to the run files.
