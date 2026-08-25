# Lecture Notes Generator — User Test Plan

**Scope:** manual acceptance testing of the stages built so far, against real lecture files.
**Not suite-versioned.** This is an operational document; it deliberately sits outside the shared version lockstep of `requirements.md`, `technical-design.md` and `implementation-plan.md`, so testing notes never force a version bump on the design docs. Automated test names live in `implementation-plan.md`; expected behaviour lives in `technical-design.md`. This document holds only what a person does and sees.

---

## 1. What exists, and what the runner will do

Four of the nine stages are built and wired in:

| Stage | Name | Writes |
|---|---|---|
| 0 | source-normalisation | renames sources, creates workspaces and `manifest.json` |
| 1 | audio-extraction | `Audio/audio.m4a` |
| 2 | transcription | `Transcript/transcript.txt` |
| 3 | transcript-structuring | `Structured transcript/structured-transcript.md` |

Stages 4–8 (slide-conversion, image-extraction, synthesis, qa-loop, pdf-generation) **do not exist yet**.

**The runner will not try to call them.** It iterates the stage list it was given (`src/cli/run-cli.ts`), not the full set of stage IDs, so unbuilt stages are absent rather than skipped. A run ends after Stage 3, writes its run log, prints a cost summary, and exits 0.

### Two behaviours that look like faults and are not

- **A run that produces no PDF is still reported as a success.** Only Stages 0–3 exist, so a run does everything there is to do and ends with a structured transcript. The status describes the run, not how far the pipeline reaches.
- **`--from-stage` accepts stages that do not exist yet.** `--from-stage synthesis` is accepted, resets manifest entries for stages that never ran, then runs the three built stages, which all skip. A no-op, not an error.

### What a run prints

Each lecture is named as its run begins, and each stage says what it did as it happens: `▶` for a stage starting, `✔` when it finishes (with its calls and cost, where it made any), `−` where its output was already present and it was skipped, `✖` where it failed. The run summary follows, then any failed stage's message and where to find its stack. A re-run of a finished lecture is all `−` lines and an empty summary table — the table lists only stages that did work.

---

## 2. Setup — must be done before any test

### 2.1 Blockers

| # | What | Where | Status |
|---|---|---|---|
| 1 | `moduleRoots` points at the real module folders | `pipeline-config.json` | ☑ done |
| 2 | `transcript-structuring.modelId` is a real model (`google/gemini-3.7-flash`) | `pipeline-config.json` | ☑ done |
| 3 | `OPENROUTER_API_KEY` present | `.env` | ☑ added |
| 4 | `ELEVENLABS_API_KEY` present | `.env` | ☑ added |
| 5 | Lecture files copied into `Source files/` (§2.2, §2.3) | module folders | ☐ |

Blockers 1 and 2 were cleared and verified: `lecture-notes run 1999-01-01` loads the config and runs Stage 0 across both modules, and the model ID is genuinely checked — pointing it at a nonexistent `google/…` model is rejected before anything runs. Both module trees exist and were verified against `moduleDirs()`.

Blockers 3 and 4 are recorded as added but **not verified**, and cannot be: `.env` is never read. The first run that reaches Stage 2 is what confirms them. A key present under a slightly wrong variable name reads identically to a missing one, so if either stage fails on authentication, check the name against §2.1 before the value.

**Keep the `placeholder/` prefix on the four unbuilt stages, and the `placeholder` exemption alongside it.** It is what stops `loadConfig` rejecting a stage that has no real model yet. Strip each one as its stage is built — leaving it past that point disarms the check that exists to catch an un-substituted placeholder, and the failure then lands at that stage *after* the stages before it have been paid for. That is what nearly happened here with `transcript-structuring`.

The two keys fail differently, which matters when reading an error: transcription checks its key first and fails with `ELEVENLABS_API_KEY is not set; cannot transcribe`. OpenRouter has no equivalent guard, so a missing key surfaces as a less obvious SDK error.

`.env` is loaded automatically (`import "dotenv/config"`, and the `bin/lecture-notes` wrapper runs from the repo root).

### 2.2 Source file layout

Stage 0 validates the **whole module** before touching anything, and refuses to proceed unless every video has a parseable date and a 1:1 slide match by date:

```
<moduleRoot>/Source files/Video files/<something with a date>.mp4
<moduleRoot>/Source files/Lecture slides/<same date>.pdf
```

### 2.3 Filename dates

Dates are read in **British convention**: a four-digit component is the year, otherwise the day leads. Month-first is never read. The date may sit anywhere in the filename, and anything may abut it — underscores, brackets, whatever the lecturer used.

All of these are the tenth of November 2025:

| Day first | Year first |
|---|---|
| `10112025` | `20251110` |
| `10-11-2025` | `2025-11-10` |
| `10.11.2025` | `2025.11.10` |
| `10/11/2025` | `2025/11/10` |

Also accepted: single-digit day and month (`1/2/2025` is the first of February), and a **trailing** two-digit year (`10-11-26` is the tenth of November 2026). A *leading* two-digit component is always the day, so `26-11-10` is the twenty-sixth of November 2010 — `YY-MM-DD` is not a supported form.

`DDMMYY` — six bare digits — is read only when the filename yields no date any other way, since six digits are as likely to be an identifier as a date.

Dates written in words still work (`13 Oct 2025`, `10 October 2025`). **One trap there:** a prose date with no year is anchored to the *current* year, so `Fri 10th Oct` dates itself to whenever it was processed. Numeric formats have no such behaviour — prefer them.

**What is rejected** — and rejection is loud, not silent: a filename with no extractable date, and a date naming no real day (`31022025`, `2025-13-10`). Stage 0 refuses the whole module and names each offending file rather than guessing.

If a run finds nothing, the `"Normalising module sources"` line in `<repo root>/runs/<timestamp>-debug.log` carries the video and slide counts it actually saw. `videos: 0` means the filenames were never read — check the directory names first (§2.2), then the dates.

### 2.4 Use a scratch module

**Stage 0 renames source files in place** to `Lecture N - Title - YYYY-MM-DD.ext`. Copy two or three lectures into a scratch module folder and point `moduleRoots` at that. Do not test against irreplaceable recordings.

Include at least one **short** lecture (2–5 minutes) — most tests below only need one, and transcription is billed by audio length.

### 2.5 Cost model

- **Transcription** is reported at the configured `elevenLabs.costPerAudioHourUsd` (currently `0.22`), converted at `currency.gbpPerUsd` (currently `0.74`) — roughly **£0.16 per audio hour**, so a 5-minute lecture is about **£0.01**. The figure printed is derived from that configured rate, not from a bill; check it against the real invoice once.
- **Stage 3** costs OpenRouter tokens for one call per lecture, reported from the live generation endpoint, so that figure is actual.
- Always use `run <date>` for testing. **Never `batch`** — it takes every lecture in the module.

---

## 3. How to isolate stages

- **Stage 0 alone:** `lecture-notes run 1999-01-01` — any date no lecture has. Sources are normalised across every configured module *before* the date is looked up, so Stage 0 does its full job, then the command reports that no lecture matches and exits 1. Nothing downstream runs and nothing is spent. The non-zero exit is the date lookup, not Stage 0.
- **Stages 1–2 without 3:** there is no `--to-stage` or `--only` flag. Once a real lecture is named, all three built stages run. Either run all three and inspect each stage's output directory separately (recommended), or use test **P1** below, which reaches the same place deliberately.

---

## 4. Where to look after a run

| What | Where |
|---|---|
| Stage outputs | `<moduleRoot>/Pipeline processing/<Lecture folder>/` |
| Manifest | `<workspace>/manifest.json` — per-stage status, cost, `filesWritten` |
| Run log (JSON, per invocation) | `<workspace>/runs/<runId>.json` |
| Debug log | `<repo root>/runs/<timestamp>-debug.log` |

Note the debug log lands under the **repo root**, not the workspace, unlike the run log. Confirm that is intended.

---

## 5. Test passes — free

None of these should spend money. Run them in order.

### T1 — The CLI fails clearly before spending anything

| Step | Expect |
|---|---|
| `lecture-notes --help` | Usage text, exit 0 |
| `lecture-notes run` | Usage error naming the missing date, exit 1 |
| `lecture-notes run 10-10-2025` | Rejects the date format, exit 1 |
| `lecture-notes run 2025-10-10 --from-stage nonsense` | Names the flag and lists the valid stages, exit 1 |
| `lecture-notes run 1999-01-01` | Stage 0 runs, then "No lecture is dated 1999-01-01…", exit 1 |

**Check:** no `Audio/` directory is created anywhere, and no ElevenLabs or OpenRouter request is made.

### T2 — Stage 0 on the scratch module

Run `lecture-notes run 1999-01-01`, then inspect the module.

- Source video and slides renamed to `Lecture N - Title - YYYY-MM-DD.ext`, numbering in date order
- A workspace per lecture under `Pipeline processing/`, each with `manifest.json`
- **Each workspace contains `manifest.json` and nothing else.** Stage 0 creates the workspace as a side effect of writing the manifest, and creates nothing inside it. `Audio/`, `Transcript/` and `Structured transcript/` appear only when their own stage runs; `runs/` appears when the runner writes its first run log. An otherwise-empty workspace here is correct, not a failure.
- `Pipeline processing/` itself is created on demand, so it does not need to exist beforehand. **The only directories you must create by hand are the two under `Source files/`** (§2.2)
- The manifest records lecture number, date, and provisional title
- Re-run the same command: **no further changes** — Stage 0 is idempotent
- Add a video with no matching slide deck, re-run: the whole module is refused with a message naming the mismatch, and **nothing is renamed**
- Remove a source pair whose workspace still exists, re-run: the orphan guard asks before deleting anything; decline it and confirm nothing changed

### T3 — Identity commands

Against a lecture that has a workspace but has not yet been run:

- `lecture-notes rename <date> "A Better Title"` — source files, workspace folder and manifest all follow
- `lecture-notes change-date <date> <new date>` — files and workspace move, lectures renumber
- `lecture-notes delete <date>` — lecture removed, remaining lectures renumber
- A date that matches lectures in two modules prompts for which to act on

### T4 — Cost report on an empty history

`lecture-notes cost-report` — reports zero spend without error. Repeat with `--date` and `--module`.

---

## 6. Test passes — spending

From here each run bills real transcription. Use the short lecture.

### T5 — First full run

`lecture-notes run <date>` on the short lecture.

- Progress is visible for extraction and transcription
- The workspace gains a directory per stage as each one runs — `Audio/`, then `Transcript/`, then `Structured transcript/`, plus `runs/`. Each stage creates its own on the way past, so watching them appear is a reasonable progress check
- `Audio/audio.m4a` exists and plays
- `Transcript/transcript.txt` holds recognisable text from the recording
- `Structured transcript/structured-transcript.md` is markdown with headings, filler removed, and no invented content
- Title judgement: if the provisional title was already meaningful it is kept; if not, the lecture is renamed and files, workspace and manifest all follow
- Cost summary printed, exit 0
- `manifest.json` shows the four built stages complete with costs; `runs/<runId>.json` exists
- **The manifest also lists `slide-conversion`, `image-extraction`, `synthesis`, `qa-loop` and `pdf-generation` as `pending`, and always will.** It is written with every stage in `STAGE_IDS` set to pending, so it describes the whole pipeline rather than the built part of it. Those five are never attempted — see §1

**Judge the output quality here, not just its presence** — this is the first sight of what the pipeline actually produces.

### T6 — Idempotency

Re-run the identical command.

- Every stage reports its output already present and is skipped, cost is zero, exit 0
- Overall status reads **`success`** — the lecture is finished, and repeating nothing is the pipeline working
- The run summary table is **empty**, since it lists only the stages that did work; the skip lines above it are what say why
- No file is rewritten (check modification times)

### T7 — `--from-stage`

- `--from-stage transcription` — `Transcript/` and `Structured transcript/` are discarded and rebuilt; `Audio/` untouched; **bills transcription again**
- `--from-stage audio-extraction` — everything from Stage 1 down is rebuilt
- `--from-stage synthesis` — accepted, no-op, exit 0 (see §1)

### T8 — Failure and recovery

- Delete `Transcript/transcript.txt` by hand and re-run: Stage 2 re-runs because a recorded file is missing, Stage 3 follows
- Unset `ELEVENLABS_API_KEY` and run a fresh lecture: fails at Stage 2 with the named-variable message, exit 1, nothing downstream runs
- Point `transcript-structuring.modelId` at a nonexistent model and run a fresh lecture: Stages 1–2 complete and are recorded complete, Stage 3 fails, exit 1. Restore the model and re-run — 1–2 skip, only Stage 3 runs. **This is the cheapest way to see resumability**, and doubles as the "Stages 1–2 only" case from §3.
- Repeat that failure with `--continue-on-error` and confirm the run continues rather than halting
- `lecture-notes cost-report` after these: spend attributed by run and by stage, failed runs included

### T9 — A second, longer lecture

One full-length lecture end to end, to confirm nothing depends on the short file: transcription of a realistic recording, structuring of a long transcript, and a cost figure to compare against the real invoice.

---

## 7. What to record

For each test: the command, the exit code, what was printed, and pass/fail. For failures, keep `runs/<runId>.json` and the debug log.

Worth noting separately as they come up:
- Wording that misleads, and any stage notice that says something other than what the stage did
- Any cost figure that disagrees with the provider's own
- Anything Stage 0 renames that you did not expect
