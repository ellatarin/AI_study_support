# 15 — Review the lint directives in `src`

**What to build:** every lint directive in `src` reviewed: each `eslint-disable`, `biome-ignore`, `jscpd:ignore` and `@ts-expect-error`. A directive stays only when the code cannot be fixed to satisfy the rule. Otherwise the code is fixed and the directive is deleted.

There are about 105 directives (counted 2026-10-05):

- 56 `prefer-readonly-parameter-types`. Most are for the pino `Logger`, the OpenAI client and `ReadonlyMap`. The rule's `allow` option can clear most of them with one config change. That change is made once, across the codebase, so it is not part of an area ticket.
- 28 jscpd markers. Each is checked against the rule that dead code is deleted and not excluded.
- 18 `max-params`. These were accepted earlier.
- 2 `@ts-expect-error`. These are expected to stay.
- 1 `id-length`.

**Blocked by:** None — can start immediately

**Status:** needs-triage

- [ ] Every directive in `src` is listed with its rule and its reason.
- [ ] Each directive whose rule the code can satisfy is deleted, and the code is fixed. No new `prefer-readonly-parameter-types` disable is added.
- [ ] A config change such as the readonly rule's `allow` option is agreed with the user before it is made.
- [ ] Each directive that stays has a reason that follows the comment rules in `CLAUDE.md`.
- [ ] The commit gate passes.

## Comments

2026-10-06, the user ruled that the directives get a ticket of their own. They are not reviewed inside the area rewording tickets (04–13). Those tickets reword a directive's reason only.
