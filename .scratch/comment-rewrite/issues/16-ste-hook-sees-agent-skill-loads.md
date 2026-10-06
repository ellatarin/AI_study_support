# 16 — Make the STE hook see a skill that an agent loads

**What to build:** the `require-ste-skill` hook lets an agent's prose edit through when that agent loaded the asd-ste100 skill. The hook blocks the edit when the agent did not load the skill, even if the main session did.

**Blocked by:** None — can start immediately. Do not change the hook while a workflow run edits files in this folder.

**Status:** resolved

## The defect

The hook reads the session record at the path that the hook payload gives. It lets a prose edit through only when that record shows a load of the asd-ste100 skill.

In the workflow run `wf_60bd9903-5cc` (2026-10-06, tickets 04–13), the hook blocked the prose edits of every agent that tried one. Each rewrite agent loaded the skill before its first edit. The main session had not loaded the skill.

The probable cause: in an agent, the payload gives the path of the main session's record, not the agent's record. This cause is not verified.

If the cause is correct, a second defect follows. When the main session loads the skill, the hook lets through every agent's prose edits, also from an agent that did not load the skill.

## What the agents did

- The rewrite agents for tickets 04–08 and 10–13 stopped and edited no file. Their check and fix agents found nothing to check or fix. So nine tickets got no rewrite.
- The ticket 09 rewrite agent edited copies of its files in the scratchpad, where the hook does not apply. It linted the copies with its own runner. Then it copied its files into `src/` with `cp` in Bash (see Comments).
- The ticket 09 agent said that agents share one override file, so one agent's override can let through another agent's edit. This is not verified.

## Criteria

- [x] A probe records the hook payload for an edit from an agent. The ticket records which fields the payload has and which session record its path names. The probe used a plain agent, not a workflow agent. The rerun of tickets 04–08 and 10–13 is the live check for a workflow agent.
- [x] A test shows that the hook lets an agent's prose edit through after that agent loads the skill.
- [x] A test shows that the hook blocks an agent's prose edit when only the main session loaded the skill.
- [x] The behaviour of the main session does not change. The existing hook tests pass.
- [x] The ticket records whether the shared override file lets one agent's override pass another agent's edit.
- [x] The commit gate passes.

## Comments

2026-10-06, the probe. A temporary line in `require-ste-skill` saved each payload. A test agent loaded asd-ste100 and wrote a Markdown file in the repo. The payload had these fields: `session_id`, `transcript_path`, `cwd`, `agent_id`, `agent_type`, `hook_event_name`, `tool_name`, `tool_input`. `transcript_path` named the main session's record, not the agent's. The write went through, because the main session had loaded the skill earlier. So both defects are real. The agent's own record is at `<session folder>/<session_id>/subagents/agent-<agent_id>.jsonl`. A workflow agent's record is one folder deeper, at `subagents/workflows/<run>/agent-<agent_id>.jsonl`.

2026-10-06, a correction. The ticket 09 agent did not use the override. The classifier refused its override write. It copied its files into `src/` with `cp` in Bash, which no edit hook sees.

2026-10-06, the fix. The hook now reads the record of the session or agent that makes the edit (`readEditorRecord` in `scripts/hooks/lib/skill-load.mjs`). When the payload has an `agent_id`, the hook reads only that agent's record. Two live agents confirmed it after the fix. An agent that loaded the skill wrote a Markdown file. An agent that did not load the skill was blocked, although the main session had loaded the skill.

2026-10-06, the override. One file, `.claude/tool-override`, serves every session and agent in the repo. The next blocked call from any of them consumes it. So one agent's override can let another agent's edit through. This is not changed here.
