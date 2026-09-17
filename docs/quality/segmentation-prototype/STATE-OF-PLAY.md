# Dividing a transcript into subtopics — state of play

Written 2026-09-17. Numbers are in `DIVISION-RESULTS.md`, which is generated from
the run files; this file is the account of what they mean and what is decided.

## The system

Two model calls per lecture, then a vote over repeated whole-system runs.

**Pass one** (`split-trial.mts`, prompt version `s6`) reads the whole transcript
and returns a flat list of subtopics, each as a label, a reason, and the first
eight to twelve words of its opening sentence quoted verbatim. The harness
locates each quote in a whitespace-free, case-folded index and slices the
**original** transcript, so losslessness is guaranteed by construction and a
quote that cannot be found is reported rather than guessed at.

**Pass 1.5** (`deepen-trial.mts`, prompt versions `d1`–`d10`) measures every
section pass one produced and sends **only those over 600 words** back to the
model on their own, asking where each divides further. It can only add cuts
inside the passage it was given, so it can never move or lose a boundary pass one
made. Sections under the gate are never sent and so can never be disturbed.

**The vote.** Both passes vary run to run, so the whole system is run N times and
a boundary is kept only if at least *k* of the runs propose it. This is not a
tidy-up: it is what turns a prompt that is usually right into a division that is
reliably right.

## What is ruled

Hand judgements live in `runs/divisions.json`, keyed by lecture, on the same
terms as pass two's `runs/criteria.json`. Nothing in the scorer guesses.

- **Lecture 3 — 15 sections.** Ruled 2026-09-08: four contested cuts rejected
  (18.7%, 54.0%, 88.5%, 92.5%) — "all these cuts split topics". Ruled again
  2026-09-17: shown the division `d9` actually produces, the user accepted the
  single 1,137-word section running 27.5%–41.4%, so **31.3% and 36.1% moved to
  `dontCare`** — not wrong, just boundaries they are content to do without.
- **Lecture 4 — 22 sections.** Ruled 2026-09-17. Twenty of its twenty-one
  boundaries were already in front of the user when lecture 4's five criteria
  were judged, sixteen of them in every one of the six divisions looked at, and
  none was objected to. The twenty-first, a 150-word recap at 81.4%, appeared
  first under `d7` and was ruled its own section.
- **Lecture 5 — 17 sections.** Ruled 2026-09-06.

## Where it stands

**`d9`, run nine times, keeping every boundary five of the nine propose.**
Measured over **18 runs per lecture**, which is what makes panels of nine nearly
independent — the same sweep over 11 runs flattered every bar and showed a clean
sweep at 6-of-9 that 18 runs does not reproduce.

| bar | lecture 3 | lecture 4 | lecture 5 |
|---|---|---|---|
| 9, keep 4 (44%) | 0.33 err, 67% right | perfect | perfect |
| **9, keep 5 (56%)** | **0.23 err, 77% right** | **perfect** | **perfect** |
| 9, keep 6 (67%) | 0.59 err, 49% right | 0.04 err, 96% | perfect |

The usable window per lecture, at 18 runs: **lecture 3 (33%, 61%]**, lecture 4
(6%, 78%], lecture 5 (11%, 83%]. Lecture 3 sets both ends — its 18.7% cut, made
by 6 of 18 runs, floors the bar, and its 64.9% boundary, made by 11 of 18, caps
it. 56% sits inside that window, and the residual 0.23 is panels of nine that
happen not to reach five votes for a boundary supported by 11 of 18.

**Measuring at 11 runs over-states the system.** Every figure improved when the
pool was small because panels of nine drawn from eleven share at least seven
members, so 55 "panels" are one observation counted 55 times. Sweep at 18.

**What each version bought, in order:**

- `d4` — the baseline this work started from. Four unwanted cuts on lecture 3,
  the worst at 7 of 11 runs.
- `d5` — every "step" in the document renamed "subtopic". **Not cosmetic:** the
  model merges more when the unit is called a subtopic. It removed all four
  unwanted cuts on lecture 3 and took three wanted ones with it. Vocabulary is a
  grain lever, not a tidy-up.
- `d6` — a rule that showing what was just described is not a new step. Removed
  three of lecture 3's four unwanted cuts and left the fourth, 54.0%, exactly
  where it found it.
- **`d7` — a rule that stages of a progression the lecturer set out to trace are
  one step. Removed all four, including 54.0%, and kept every wanted boundary.**
  The only rule in the programme that worked first time.
- `d8` — `d7`'s seven boundary rules said as one, with the six prohibitions as
  numbered items. A clear regression: the same words bind less as items under a
  heading than as rules in their own right.
- `d9` — `d7` with the progression rule scoped. Best result on lectures 4 and 5;
  lecture 3's 31.3% and 36.1% fell from 8 of 11 runs to 1, which the user has
  since accepted.
- `d10` — the freeing half of `d9`'s scoping alone. Middling everywhere.

## What is settled and should not be relitigated

- **A rule is a unit of attention.** Merging rules weakens them (`d8`). The form
  that works is a refusal stated *inside* the sentence that would otherwise grant
  permission, in that sentence's own words (`d7`). A precedence clause stated as
  a citation was tried in `s6` and never engaged.
- **Under-cutting, not over-cutting, is what remains.** `d7` makes no unwanted
  cut at all on lectures 3 and 4. Any new rule that makes the model more cautious
  now costs more than it can buy — `d5` and `d6` both proved it.
- **Any wording added inside the progression rule loosens its grip on lecture 3.**
  Both attempts to scope it brought back 18.7%, and one brought back 54.0%. If
  the recap exception is tried again, it has to live in a different rule.
- **Two measured dead ends, not to be revisited:** label paraphrase either side
  of a bad cut does not discriminate (0.16 against 0.12, and lecture 5's *wanted*
  cuts score higher); nor do discourse-marker openers ("So", "Right. So").
- **A pure reviewer pass between the passes cannot work** — every rung of the
  grain ladder satisfies every rule, so a rule-based reviewer ratifies whatever
  depth it is handed. The 600-word gate is the external standard that fixed this.

## The two boundaries that set the vote window — both diagnosed 2026-09-17

Everything that still goes wrong is these two, both in lecture 3, and they have
nothing in common.

**18.7% — the deepening pass splitting a claim from its demonstration.** Made by
6 of 18 `d9` runs, which is what **floors** the usable bar at 33%. Pass one
proposes it once in eighteen, so this is pass 1.5. The 1,188-word "what is
cancer" section is always over the gate and always sent; in 5 of the 17 runs
where it arrives whole, the model cuts at *"So over years and centuries, we've
been using a lot of different tools… histology being one of them."* The labels
it writes say why — *"using histology to examine tissue architecture and basement
membrane invasion"* — it has made the method the subject.

**64.9% — pass one's own variability, out of pass 1.5's reach.** Made by 11 of 18
runs, which is what **caps** the bar at 61%. `d9` tracks pass one exactly here:
11 of 18 for both, the deepener never involved. When pass one misses it, it emits
one 484-word section whose own reason gives the fault away — *"outlines the
systematic naming rules and exceptions for benign and malignant neoplasms
**while** explaining how benign tumors can still cause severe harm"* — two things
joined by "while", where a correct run gives two sections of 197 and 287 words.
**484 words is under the 600-word gate, so that section is never sent.** No
change to the pass-1.5 prompt can ever reach this boundary.

## The two fixes, to be tried ONE AT A TIME

1. **`d11` = `d9` + d6's showing rule. BUILT, NOT YET RUN. Agreed with the user.**
   Aimed at 18.7%. d6 took that boundary from 6 of 11 runs to 1. d6 was set aside
   because it also cost lecture 3's 31.3% and 36.1% — both now `dontCare`, so its
   only measured cost is in a currency the score no longer counts. Run 18
   instances on each of the three lectures and regenerate the ledger.
2. **Lowering the gate below 484 words** (say 450) so the merged nomenclature
   section is sent. Aimed at 64.9%. **The user's concern, recorded: a lower gate
   may create more splits than wanted** — it sends many more sections across every
   lecture, and each send is a chance for a spurious cut. Measure how many extra
   sections a 450 gate sends before running it, and treat lectures 4 and 5 as the
   regression test. **Not yet attempted.**
   A third possibility, untried and worth weighing against the gate change: send a
   section whose own `groupedBecause` joins two things with "while", "as well as",
   "and also" — the model's reason as the trigger rather than the word count.
   Cruder than the coverage tell that was measured and rejected, and unmeasured.

## Open items

1. **The two boundaries above** — `d11` is built and waiting to be run; the gate
   change is unattempted and carries a recorded concern.
2. **Pass two has never been run against this output.** Every grouping number in
   `GROUPING-RESULTS.md` came from `s1` subtopics. The grouping prompts `g1`–`g7`
   have never seen `s6` + `d7`/`d9` output on any lecture. **This is the largest
   untested link in the chain.**
3. **Only three of eight lectures have transcripts.** Lectures 1, 2, 6, 7 and 8
   have source video and slides under `Source files/`, and their manifests show
   every pipeline stage `pending`. Running the divider across the whole module
   needs them transcribed first.
4. **Nothing in this folder is linted or typechecked.** It sits outside `src/**`,
   where biome, eslint and jscpd are scoped. `cut-blocks.test.ts` is the folder's
   only test file; vitest picks it up because `include` is not scoped to `src/**`,
   and coverage thresholds are unaffected because coverage `include` is.

## Running it

From the **project root** — `trial-model.mts` resolves `.env` against the cwd, so
running from this folder fails every call and still writes outcome files.

```
# pass one
TRIAL_MODEL=google/gemini-3.7-flash pnpm exec tsx \
  docs/quality/segmentation-prototype/split-trial.mts s6 "<transcript>" <instance>

# pass 1.5, over one pass-one run, gate in words
TRIAL_MODEL=google/gemini-3.7-flash pnpm exec tsx \
  docs/quality/segmentation-prototype/deepen-trial.mts d9 split-s6-l3-1 600

# score, and regenerate the ledger (from this folder — it is python)
python3 report-division.py l3 'deepen-d9-600-split-s6-l3-*.blocks.json'
python3 report-division.py --ledger
```

Eleven runs of each pass, six at a time, is what every figure here was measured
at. Runs are fully parallelisable: `seq 1 11 | xargs -P 6 -I{} sh -c '…'`.
