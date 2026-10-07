# Outline proposal for the technical design

Written 2026-10-07 from a full read of `docs/technical-design.md` at commit `082209a0`. The user has not ruled on it yet (ticket 01).

## The rule behind this proposal

A section number changes only when the change makes the document easier to use. Each change below gives its cost: the references that must change with it. The counts are from 2026-10-07.

References to the TD by section number:

- in `src/` and `scripts/`: 422
- in the TD itself: 199
- in `docs/implementation-plan.md`: 104.

No top-level number changes in this proposal. New sections go at the end of their parent, so no existing number moves.

## The proposed outline

| Section now | Proposal | Why | References that change |
|---|---|---|---|
| Header (suite version, date, status) | Keep | | None |
| §1 System Overview | Keep | | None |
| §2 Technology Stack | Keep | The column "Rationale" says "Already built" for many rows. That is a content fix, in ticket 05. | None |
| §3.1 Top-Level Module Structure | Keep | | None |
| §3.2 Source Files | Keep the number. Change the heading to "Reading and building lecture file names". | The section holds the date rules, the title rules and the naming helpers. The heading "Source Files" does not tell a reader this. | Only references that quote the heading. The check in ticket 02 finds them. |
| §3.3 Pipeline Processing — Per-Lecture Workspace | Keep | | None |
| §3.4 Re-numbering When New Lectures Are Added | Delete. Move any fact that is not already there into §5, `source-normalisation`, "Collision-safe renaming". | It says again what §5 says. | None. Nothing refers to §3.4. |
| §4.1 to §4.6 | Keep | | None |
| §4.7 Pipeline Runner | Keep for the runner only. That is the run options and the run status. It is also `--from-stage`, `--to-stage`, how a lecture is found, the stage context, a moved workspace, batch mode and the lecture count. | §4.7 has about 230 lines. It holds three subjects: the runner, the commands that change a lecture's identity, and the command line. | See the two rows below. |
| (new) §4.8 Lecture identity and lecture files | Move here from §4.7: "Identity-change commands", "An identity change acts on exactly one lecture", the three bullets that follow, and "Moving a lecture's files". | These parts describe the `rename`, `delete` and `change-date` commands and `lecture-files.ts`. They are not the runner. | About 26 references to §4.7 in `src/cli/` and `lecture-files.ts` must be read. Some change to §4.8 or §4.9. |
| (new) §4.9 Command line | Move here from §4.7: "CLI Structure" and the paragraphs after it (parsing, flags, `run` normalises first, exit codes, `--help`). | The command line is a layer of its own, with its own folder `src/cli/`. | Included in the row above. |
| §5 Stage Designs, opening | Keep "Where prompts live". Move "Panel runs" here from the division section. | Three stages share the panel runs: the two splitting stages and `group-into-topics`. At the moment the shared rules sit inside the section of the division stages. | 8 in the code, 7 in the TD and 2 in the plan. Each `(§5, "Dividing the transcript", Panel runs)` becomes `(§5, "Panel runs")`. |
| §5, the built stages | Keep in pipeline order. | | None. §5 references name the stage, not a number. |
| §5, `transcript-structuring` and `transcript-verification` | Keep until the stages are deleted. Add one line at the top of each that says the stage will be deleted. Do not rewrite them. | The user ruled on 2026-10-06 that both stages will be deleted. | None |
| §5, the stages not yet built (`slide-conversion`, `image-extraction`, `synthesis`, `qa-loop`, `pdf-generation`) | Put them last, under one heading "Stages not yet built". | No code exists for them. The pipeline redesign (the 20-stage design in the README) will change them. A reader must see at once which text describes code and which text describes a plan. | None |
| §6 Model Configuration | Keep the number. Make two numbered parts. The part "Calling a model" (§6.1) holds the OpenRouter client, JSON mode, refusals inside a reply and the shared JSON-reply calls. The part "The configuration file" (§6.2) holds `pipeline-config.json` and each setting. | §6 holds two subjects. How a call is made is not configuration. A reference to "§6" stays right. | None required. References can become more exact later. |
| §7 Cost Tracking | Keep | | None |
| §8 Error Handling | Keep. "API Error Handling" refers to §6.1 for the refusal rules and does not repeat them. | | None |
| §9 Source File Structure | Keep the folders and the folder rules. Delete the line for each file. | Each file says what it does in its own header comment. The list of files goes out of date. For example, it describes `workspace-paths.ts` as two resolvers. | 1 in the code, 2 in the TD and 2 in the plan. These keep the number. |
| §10 Logging | Keep | | None |

## What this proposal does not change

- Wording. The rewrite of each section is a later ticket.
- The facts. Each "Fix the design" ruling in `.scratch/comment-rewrite/rulings.md` goes into the rewrite of its section.
- The implementation plan and the requirements.
