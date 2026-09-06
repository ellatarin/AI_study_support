# Transcript segmentation prototype — working archive

Throwaway prototype work from 2026-09-02, archived here because the scratchpad it
ran in is session-scoped. **Nothing here is production code and nothing enters
`STAGE_IDS` yet.**

## What this is answering

Stage 3 loses 75% of the transcript. The direction agreed is to change the unit
of work: split the transcript into topic blocks first, then structure from those
blocks. This prototype settles how the splitting should work and how good it is.

## What was settled

**Cut positions, not content.** The model returns `{label, startsWith}` where
`startsWith` is the first 8–12 words of a block; the code finds it in a
whitespace-free case-folded index and slices the ORIGINAL transcript. Losslessness
is guaranteed by construction. Asking the model to emit the transcript instead
truncated on 40% of runs of a 9,226-word lecture and mangled JSON escaping on
quoted speech.

**The fidelity rule.** Accept when the output is a case-folded **subsequence** of
the source and at most 6 characters are deleted; reject any insertion or
substitution however small. "Every change is a deletion" ≡ "the result is a
subsequence". Case folding is required. This accepts the model's habit of tidying
a seam ("So some" → "Some") and still rejects `50 mils` → `50 mm`, which is the
same size.

**Model.** `google/gemini-3.7-flash` is the working choice — cheap (~2p/run),
fast, and good enough. Sol/Sol Pro find ~2× more structure and are more
self-consistent but divide far finer than wanted; Sonnet 5 is dominated on every
axis. See the memory file for the full four-model table.

## Pass one: splitting the transcript into subtopics

**Splitting prompts are versioned in `split-prompts.mts`**, on the same terms as
the grouping prompts: a version is never edited once it has runs against it, and
every rule body is a shared constant so a version that restates a rule in a
different form cannot restate it in different words.

| version | what it is |
|---|---|
| `s1` | the prose prompt — kind rule scoped to subtopics, topics exempt, opening its own division, `groupedBecause`, re-read pass. This is `HIER_PROMPT_V3` moved into the registry character for character, so every archived `hierv3-*` run is a run of `s1` |
| `s2` | `s1`'s rules as a structured document: markdown headings, a numbered method, named rules `R1`–`R9`, and a checklist. Presentation only — no rule added, removed or reworded in substance |

```
cd <repo root>
TRIAL_MODEL=google/gemini-3.7-flash \
  pnpm exec tsx docs/quality/segmentation-prototype/split-trial.mts \
  <version> "<transcript path>" <instance>
```
Run files are `split-<version>-<lecture>-<instance>`. The lecture key comes from
the workspace folder the transcript sits in, so two lectures' runs can never
overwrite one another at the same instance number.

### The earlier modes — in `failure-trial.mts`

Kept so the archived runs stay reproducible; new pass-one work goes through
`split-trial.mts`.

| constant | mode arg | what it is |
|---|---|---|
| `HIER_PROMPT_V1` | `hier` | two-level, the original. **Do not edit** — produced run h4, the reference output |
| `HIER_PROMPT_V2` | `hierv2` | v1 + kind rule (both levels), grouped-because, re-read pass, preamble rule |
| `HIER_PROMPT_V3` | `hierv3` | now `s1` in `split-prompts.mts`; this mode sends exactly that text |
| `HIER3_PROMPT` | `hier3` | three-level variant, parked |
| `CUTS_PROMPT` | `cuts` | flat, no hierarchy |
| `LONG_PROMPT` | `content` / `prototype` | content emission, superseded |

```
cd <repo root>
TRIAL_MODEL=google/gemini-3.7-flash \
  pnpm exec tsx docs/quality/segmentation-prototype/failure-trial.mts \
  hierv3 <instance> "<transcript path>"
```

Then render: `python3 render-hier-text.py "hierv3-w*.blocks.json" text-v3`
(the renderers read `failure-trial/`, so adjust `SRC_DIR` or copy `runs/` there).

Lecture 4's transcript is at
`~/Lecture Notes/Biology of Disease/Pipeline processing/Lecture 4 - Causes of
Cancer and Environmental Carcinogenesis - 2026-03-06/Transcript/transcript.txt`.

## Contents

- `*.mts` — the trial harness and two diagnostic probes
- `*.py` — renderers producing the HTML review pages
- `runs/` — every run's parsed blocks and outcome (129 files)
- `review/` — the HTML pages built from them (43 files)
- `l3-sentences.txt`, `l3-blocks.tsv` — lecture 3 sentence index and a hand
  segmentation, kept as a diagnostic reference and **not** an answer key

## Pass two: grouping subtopics into topics

Pass one cuts the transcript into subtopics; a second call groups those subtopics
into topics. The two decisions were separated because the subtopic layer is stable
across runs and models while the grouping is not — see the memory file.

**Grouping prompts are versioned in `group-prompts.mts`.** A version is never
edited once it has runs against it; add the next one instead. `dump-versions.mts`
projects the registry to `group-versions.json` for the report generator.

```
cd <repo root>
TRIAL_MODEL=google/gemini-3.7-flash \
  pnpm exec tsx docs/quality/segmentation-prototype/group-trial.mts \
  <source-run> <version> <instance> [nolabels]
```
`<source-run>` is a pass-one blocks.json stem in `runs/`, e.g. `hierv3-w4` or
`split-s2-l5-1`. `nolabels` withholds pass one's subtopic labels from the
grouping model; they are restored on the way back either way.

Score each new run by hand into `runs/criteria.json`, then regenerate the ledger:

```
python3 report-grouping.py     # writes GROUPING-RESULTS.md
```

`GROUPING-RESULTS.md` is generated — every number in it is computed from the run
files, so it cannot drift from the runs it describes.

## One lecture per table

**Numbers are never pooled across lectures.** A topic count, a singleton rate and
the five criteria all describe one transcript's material, so every run carries a
`lecture` key and the ledger gives each lecture its own table. The key is derived
from the workspace folder the transcript sits in (`lecture-key.mts`), it is part
of every new run's filename, and `backfill-lecture-key.mts` recovered it for the
archived runs from the transcript path they had always recorded.

The five criteria in `runs/criteria.json` are **lecture 4's rubric**, taken from
the user's critique of run h4. Another lecture's runs score `—`, meaning unjudged
rather than failed, until a rubric is written for it.
