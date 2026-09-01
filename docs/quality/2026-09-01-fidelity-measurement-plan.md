# Measuring and improving structuring fidelity — the plan

**Written:** 1 September 2026. **Scope:** lecture 3 first; lecture 4 is held out.

This plan supersedes the sequencing implied by issue #9 ("Rewrite Stage 3's prompt and drop
its token cap"). It does not abandon that ticket — it puts a measuring instrument in front of
it, because the evidence gathered on 31 August and 1 September shows the rewrite cannot
currently be judged.

---

## Why the order changes

Three facts from the runs so far reframe the work.

**We have been tuning the instrument, not the product.** Five models have now been trialled
as the Stage 4 checker — Terra Pro, Sol Pro, Gemini 3.1 Pro, Kimi K3, Qwen 3.6 Max — and
none has been trialled as the Stage 3 writer. Stage 4 reports and never gates, so its quality
changes nothing about the output a student reads; it changes only how well we can see that
output. Meanwhile `google/gemini-3.7-flash`, the cheapest model in the pipeline, does the one
job that *is* the product, and has never been compared against anything.

**The two hand assessments are not evidence that Opus 5 is a better checker.** They were
produced in Claude Desktop and Claude Code — agentic settings where the model read the
transcript, worked in passes, and could go back over it. Stage 4 gives one model one shot at
~13k tokens and asks for the concept inventory, the forward diff, the reverse diff, the
severity ordering and the JSON in a single completion. Model and harness are confounded, and
the harness has never been varied. That is the largest untested hypothesis available, and it
costs almost nothing to test.

**The token cap is not what is limiting Stage 3.** Lecture 3's structured transcript is 2,007
words — roughly 3,000 output tokens — against a configured ceiling of 8,192. The model stops
at about a quarter of what it is allowed. The prompt already says "do not summarise" in plain
English and is ignored. So neither raising the ceiling nor rewording the instruction addresses
the cause: **the unit of work is the constraint**, and only changing that will move it.

---

## Two instruments, not one

The 43-item second assessment measures the **checker**. It is a list of faults in one
particular structured transcript, so a rewritten Stage 3 produces a different structured
transcript with different faults and the list stops applying.

To measure the **writer** we need a concept inventory of the transcript itself — what *should*
survive — which is independent of any structured version and reusable across every variant.

That inventory is also precisely what the blinded first pass of the two-pass checker is
supposed to produce, so the same artefact serves as the writer's benchmark *and* as the ground
truth that says whether the blinded pass works. It is the keystone; everything else hangs off
it.

| | measures | built from | used by |
|---|---|---|---|
| **Artefact A** — concept inventory | Stage 3, the writer | the raw transcript alone | Phase 2 (validation), Phase 3 (scoring) |
| **Artefact B** — 43-item yardstick | Stage 4, the checker | the second hand assessment | Phase 2 (scoring) |

---

## Phase 0 — Preconditions

**0.1 Restore the config.** `pipeline-config.json` pointed `transcript-verification` at
`qwen/qwen3.6-max-preview`, left over from the model trials. Restored to
`openai/gpt-5.6-sol-pro`, which is #8's recommended default. The file is gitignored, so
nothing enforces this and it must be checked before any baseline run.

**0.2 Protect the calibration corpus.** Lecture 3's workspace transcript and structured
transcript were verified byte-identical to the committed copies in this directory on
1 September 2026, so the committed copies are the authoritative backup and no third copy is
kept — a third would only introduce drift.

> **Hard rule: never let `--from-stage` reach `transcript-structuring` on lecture 3.**
> Regenerating that file destroys the corpus both hand assessments describe, and with it the
> only ground truth in the project. Every writer variant in Phase 3 writes to an experiment
> directory, never to the workspace.

**0.3 Land the outstanding quality files.** The recast three-assessments write-up and the
Gemini 3.1 Pro and Qwen 3.6 Max reports were untracked; they are the evidence behind decisions
already taken and are now committed.

**0.4 Lecture 4 is held out.** Starting with lecture 3 makes lecture 4 the validation set —
but only if it is not looked at while iterating. This converts a scheduling decision into the
one defence available against overfitting to a single lecture. The temptation to peek arrives
around Phase 3; the rule is that lecture 4 is opened once, in Phase 4, after both winners are
chosen.

**0.5 Open decision — is Opus 5 admissible as the shipped checker?** It was excluded from the
#8 comparison as too close to the reports it was measured against. That objection is about the
*comparison* and lapses once the yardstick is a scored benchmark rather than an Opus-authored
report. Phase 2 arm 3 is wasted work if the answer is no. **This is the user's call and blocks
nothing before Phase 2.**

---

## Phase 1 — Build the instruments

The expensive phase, and the one that makes every later decision an A/B against a fixed set
rather than an essay.

### 1.1 Artefact A — the frozen concept inventory of lecture 3

A machine-readable list of every distinct claim, mechanism, example, number, caveat and piece
of exam framing in the raw transcript. One row each:

- stable id
- topic block
- a verbatim quote fragment from the transcript
- a one-line statement of the concept
- kind: `claim` | `mechanism` | `example` | `number` | `caveat` | `framing`

Built per topic block by a model that sees **the transcript only** — never the structured
version — then verified by hand. Verification is far cheaper than authorship. Expect 150–250
items for 8,073 words.

**An imperfect inventory is still a valid benchmark.** What is being measured is the delta
between variants, not absolute truth, so a missing item costs nothing as long as it is missing
from every variant's score equally. Freeze it at "good" rather than stalling on completeness.
Amend it only when a variant surfaces a concept it genuinely lacks, and record each amendment
— an amendment invalidates comparisons across it.

**Deliverable:** `docs/quality/lecture-3-concept-inventory.json` and a readable `.md`.

### 1.2 Artefact B — the 43-item yardstick as data

`2026-08-31-lecture-3-fidelity-second-opinion.md` converted from prose into rows: id, category
(`distorted` | `lost` | `underexplained` | `unsourced`), one-line description, source quote
fragment, location in the structured version. Flag the three items the assessments themselves
call improvements, since they distort recall counts.

**Deliverable:** `docs/quality/lecture-3-checker-yardstick.json`.

### 1.3 Link B to A

Each yardstick finding points at the inventory item or items it concerns. This link is what
lets a single scoring run report both "the checker found 24 of 43" and "the writer lost 60 of
200 concepts" from the same data. Findings that point at inventory items which turn out to be
missing are folded back into A before it is frozen.

### 1.4 Build the scorer

A script, not a pipeline stage. Takes a Stage 4 report plus Artefact B and emits:

- **recall per category**, never only in aggregate — the aggregate is what hid the
  underexplained collapse until the inverse audit was run
- **precision**: findings outside the 43, each adjudicated against the transcript and then
  cached by a stable key, so a finding recurring across runs is adjudicated once
- **the three-way miss breakdown**, using the report's own `considered` array: items the
  checker never mentioned, versus items it examined and cleared. These are different failures
  — the first is attention, the second is threshold — and they call for different fixes.
  Gemini 3.1 Pro's low count was partly the second, which is what made it look worse than it
  was.

Mapping a finding onto a yardstick item is semantic, so it needs a model judge rather than
string matching. **The judge lives in the scorer, never in the checker**, so a checker variant
cannot influence how it is marked.

### 1.5 Validate the scorer before trusting it — GATE

A hand-built mapping of Sol Pro's 22 findings onto the 43 items already exists, in
`2026-09-01-lecture-3-three-assessments.md`. Run the scorer against that same report and check
it reproduces it:

| | expected |
|---|---|
| items covered | 24 of 43 |
| distorted | 6 of 9 |
| lost | 11 of 14 |
| underexplained | 3 of 12 |
| unsourced | 4 of 8 |
| findings outside the yardstick | 3 |

**Do not start Phase 2 until it does.** An unvalidated scorer produces numbers that feel
objective and are not, and every decision downstream would inherit the error invisibly. This
is the one step with free ground truth available — spend it.

---

## Phase 2 — Checker experiments

### 2.1 An experiment runner that shares the real code path

The harness variants do not exist as stages, so they cannot run through the pipeline — which
resolves rather than breaks the "all runs go through the pipeline, not a scratch script"
discipline that made the earlier comparisons trustworthy. The runner imports the **real**
`buildVerificationMessages`, `requestJsonReply` and `makeCompletionCall`, takes a variant name
and a model id, and writes into an experiment directory. Sharing the real modules is what keeps
results transferable: when a variant wins, promoting it into the stage is a small change rather
than a reimplementation.

Two things the runner must do that the stage does not:

- **write every raw reply to disk before validating it** — Kimi K3's 13-minute paid failure
  could not be diagnosed because `requestJsonReply` discards a malformed reply
- **show elapsed time on the progress line** — the absence of it is what made the Kimi run
  indistinguishable from a hang

### 2.2 Arm 1 — baseline

Re-score the existing Sol Pro report. No new spend. Establishes the number every arm is
compared against.

### 2.3 Arm 2 — blinded two-pass *(the hypothesis that matters)*

- **Call 1** sees the transcript only, and emits a concept inventory in Artefact A's shape.
- **Call 2** receives that inventory plus the structured version, and classifies each item:
  preserved / compressed but intact / underexplained / lost. Plus the reverse-direction check
  for unsourced additions.

**Reasoning:** a model that sees the structured version while inventorying builds an inventory
of what is *there*. To see "present but stripped of its mechanism" it must first have recorded
the mechanism as its own item, independently. Blinding call 1 forces exactly that, and it is
exactly the category where every checker so far has collapsed.

**Bonus diagnostic:** call 1's inventory can be scored against Artefact A directly. If it
recovers most of the inventory but call 2 still misses underexplained items, the failure is in
the judgement rather than the attention — two causes that are currently fused.

### 2.4 Arm 3 — Opus 5, single call

Prices the model axis honestly against arm 1. Conditional on decision 0.5.

### 2.5 Arm 4 — per-block diffing *(only if arms 2 and 3 both disappoint)*

Run call 2 once per topic block rather than over the whole document. One call asked to produce
43 findings satisfices; twelve calls asked for the findings in their own block cannot.

### Gate

An arm that lifts underexplained recall from 3/12 to **≥8/12** without losing distortion recall
and without introducing false positives.

- arm 2 clears it → the answer is harness: cheap, vendor-neutral, permanent
- only arm 3 clears it → buy the model
- none clears it → the category needs its own dedicated pass, which is also a result

---

## Phase 3 — Writer experiments

Only now, with an instrument that can see the failure mode the programme exists to fix.

**3.1 Build the writer scorer** against Artefact A: for any structured transcript, what
fraction of the inventory survives intact, thinned, lost or distorted, plus unsourced
additions. Same judge, different yardstick.

**3.2 Baseline the current structured transcript.** 2,007 words from 8,073. The loss ratio is
known; what is not known is *which* concepts go, by kind. Numbers and caveats are predicted to
fare worst — that prediction is itself worth testing, since it is the argument for the wording
changes in 3.5.

**3.3 Variant: chunked structuring** — *test before any wording change.* Structure per topic
block, one call per block, stitched. The reasoning is arithmetic: the output stops at a quarter
of the configured ceiling, so no rewording defeats the model's own sense of a reasonable reply
length. Only changing the unit of work does.

**3.4 Variant: model.** `google/gemini-3.7-flash` against a mid-tier and a frontier model, at
whichever chunking wins 3.3. Spending on the writer converts into output quality; spending on
the checker converts only into knowledge about it.

**3.5 Variant: wording** — last, and aimed at all three known failure modes, one change per
run:

- **loss** (lecture 3's signature)
- **fabrication** (lecture 4's — *Plasmodium falciparum*, t(8;14), *Salmonella typhimurium*,
  S9, aflatoxin B1, "50 mils" silently converted to `> 50 mm`)
- **hedge-stripping** (both lectures, and the most consistent single defect in the corpus:
  "we think", "proposed to be", "it's a little bit premature of me")

A rewrite aimed only at "retain more" would not touch fabrication and might worsen it. Note
that fabrication is currently invisible from lecture 3 alone — this is the cost of the held-out
decision, and it is accepted knowingly.

### Gate

The progress trigger already settled, now measurable: **findings at least halve, with no new
category.** Two iterations without it means the writer's model is the constraint rather than
the prompt.

---

## Phase 4 — Promote, then expand

**4.1** Promote the winning checker harness into `transcript-verification.ts` and the winning
structuring approach into Stage 3, tests first per the repo's TDD loop.

**4.2 Unseal lecture 4.** Build its concept inventory and a hand assessment, and re-score both
winners against it. **A drop here is the real result** — it says how much of Phase 3 was fitted
to one lecture, and that number is worth having before any of this ships.

**4.3 Revisit Stage 7 revision.** Its value is bounded by the checker: a reviser fixes only
what the checker can see, so it inherits whatever blindness survives Phase 2. It is not a
substitute for Phase 3, and the report-only rule stands until the checker is trusted.

---

## Release bar, unchanged

Zero lost, underexplained or distorted findings, and no unsourced additions — a human
judgement over the reports, not a check.

## Known defects that will bite during this

Four were exposed by the model trials and none is filed. The first two matter most here:

1. **`completionTimeoutMs` does not bound a completion call.** A 795-second call happened with
   the client built at `timeout: 120000`. **Do not "fix" this by raising the number** — it is
   not binding.
2. **A malformed reply loses the accounting and is itself discarded.** Kimi K3's failed call
   consumed 13,585 prompt tokens and was billed, but the run recorded 0 calls, 0 tokens and no
   cost. Phase 2's runner works around this; the stage still has it.
3. **No progress feedback during a long call.** A slow model is indistinguishable from a hang.
4. **Cost lookups 404** (`Generation … not found`) — filed as issue #10.

## Facts the plan depends on

- **Token counts are not comparable across vendors.** Gemini reported 13,337 prompt tokens and
  Kimi 13,585 for the same material where the OpenAI models reported 67k–82k. ~13.5k is right
  for ~10,000 words, so the $1.33 estimate for the four #8 runs rests on inflated counts. Draw
  no cross-vendor cost comparison from recorded token numbers.
- **`coverageScore` is unusable.** It runs opposite to the findings in every model measured.
  Build nothing on it.
- **Neither checker has ever used the `other` category** across six runs, so no additions to
  `QaDeficiencyType` are indicated.
- **Stage 6 expects a near-transcript-sized structured transcript** — 25,000–45,000 tokens of
  combined input for a 90-minute lecture. Lecture 3's is ~3,000. That is why compression at
  Stage 3 is a defect rather than a style: it is lossy at the wrong point, and nothing
  downstream reads the raw transcript.
