# Verification checker comparison: GPT-5.6 Terra Pro vs GPT-5.6 Sol Pro

**Ran:** 1 September 2026, through the pipeline's Stage 4 (`lecture-notes run <date>`), not a scratch script.
**Lectures:** Lecture 3 — *The Nature and Biology of Cancer* (2026-03-04), and Lecture 4 — *Causes of Cancer and Environmental Carcinogenesis* (2026-03-06).
**Checkers:** `openai/gpt-5.6-terra-pro` and `openai/gpt-5.6-sol-pro`, each over both lectures, four runs in all.
**Prompt:** unchanged — the assessment method that produced the two committed lecture 3 assessments, with only the reply contract appended.
**Reports:** `2026-09-01-lecture-{3,4}-verification-{terra-pro,sol-pro}.{json,md}` in this directory.

Lecture 3 is the calibrated lecture: two assessments of the same structured transcript are already committed here (`2026-08-31-lecture-3-fidelity.md`, and the independent second opinion). Lecture 4 has none, which makes it the control — a checker whose lecture 4 findings resemble its lecture 3 findings in character is reading rather than pattern-matching.

The two committed assessments are prior assessments, not an answer key. Where a checker finds something they did not, that is not automatically an error by anyone; it is checked here on its own merits against the transcript.

---

## What the four runs produced

| | verdict | coverage | findings | distortion | unsourced | omission | underexplained | considered |
|---|---|---|---|---|---|---|---|---|
| L3 Terra Pro | fail | 74 | 12 | 2 | 3 | 5 | 2 | 4 |
| L3 Sol Pro | fail | 80 | 22 | 5 | 4 | 10 | 3 | 7 |
| L4 Terra Pro | fail | 71 | 12 | 2 | 5 | 2 | 3 | 5 |
| L4 Sol Pro | fail | 74 | 23 | 5 | 8 | 8 | 2 | 5 |

Severity spread:

| | critical | major | minor |
|---|---|---|---|
| L3 Terra Pro | 0 | 4 | 8 |
| L3 Sol Pro | 1 | 5 | 16 |
| L4 Terra Pro | 2 | 6 | 4 |
| L4 Sol Pro | 1 | 12 | 10 |

**Neither checker used the `other` category once, over four runs.** There are no candidate categories to add to `QaDeficiencyType` from this exercise.

**Ignore `coverageScore`.** It runs *opposite* to the findings: Terra Pro scores the same transcript lower (74, 71) while raising half as much, and Sol Pro scores it higher (80, 74) while raising twice as much. Two models cannot both be calibrated on a 0–100 self-assessment that behaves this way, and nothing should be built on the number.

**Cost.** The stage recorded token counts but could not price any of the four runs — the cost lookup returned `404 Generation … not found` every time, apparently querying OpenRouter before the generation record exists. From the token counts and published rates the four runs come to roughly $1.33: Terra Pro ≈ $0.61 for both lectures, Sol Pro ≈ $0.72. Sol Pro is cheaper per completion token ($10/M against $12/M) but writes more, so it lands about 18% dearer per lecture — for roughly 85% more findings. At these prices cost does not discriminate between them.

---

## Accuracy: did either checker invent findings?

Every finding either model raised on lecture 3 that the committed assessments do not contain was checked against the transcript, and a sample of lecture 4's most specific claims was checked in both directions — that the quoted source text exists, and that the structured version really says what is alleged.

**No false positives were found in either checker, on either lecture.**

Three of Sol Pro's lecture 3 findings appear in neither committed assessment. All three hold up:

- **"Mammography" is an unsourced addition.** The structured version says *"Mammography detects early lesions…"*; the word appears nowhere in the transcript, where the lecturer says only *"Breast screening is done…"*. Correct, and missed by both prior assessments.
- **Cats' skin and connective tissue tumours are omitted.** Transcript: *"in cats, the primary type of tumor that arises is non-Hodgkin's lymphoma, but they also get skin and connective tissue tumors."* The structured version gives cats only lymphoma and injection-site sarcoma, while attributing skin and connective tissue tumours to dogs alone. Correct, and missed by both.
- **The lecturer's revision steer is dropped.** *"There's nothing to memorize here except to say that… breast, prostate, lung, and bowel are the four big cancer types."* The quote is real and the guidance is absent from the structured version. This is the weakest of Sol Pro's 22 — it is lecturer meta-commentary, which both assessments treat as a non-finding class — but it is not fabricated, and it is exam-relevant in a way that slide-navigation chatter is not.

On lecture 4, the most falsifiable claim either model made was that the structured version converts the lecture's *"yearly rainfall of greater than 50 mils"* into `> 50 mm`. Both models raised it and both are right; the structured version writes it as LaTeX, which is why a naïve text search misses it. It is the single most checkable factual error in either lecture: the conversion asserts a specific unit the lecturer did not give, in a criterion that is otherwise reproduced verbatim.

So the volume difference between the two checkers is not a noise difference. **Sol Pro raises roughly twice as much, and the extra is real.**

---

## Coverage against the calibrated lecture

The fuller of the two committed assessments records 43 findings on lecture 3 (14 lost, 12 underexplained, 9 distorted, 8 unsourced). Against that:

- **Terra Pro raised 12.** Every one corresponds to an item in the committed assessments, covering 17 of the 43 between them. None is new.
- **Sol Pro raised 22.** Nineteen correspond to committed items and cover 24 of the 43; the other three are new, and all three check out.

What each missed matters more than what each found, so the audit below runs in both directions: which of each model's findings map onto the assessments, and which of the assessments' 43 items each model failed to reach.

### Terra Pro missed the two items both assessments rank highest

Both committed assessments put the **polyp/adenoma conflation** first in their reinstatement order, one calling it a *"conceptual error, and it's examinable"*, the other *"critical"* — the structured version resolves, in the wrong direction, a distinction the lecturer drew explicitly and self-correctingly on tape.

Sol Pro raises it as a **critical distortion**, matching both assessments in category and severity.

Terra Pro does raise the same material — but as a **minor underexplained** finding. That is the most consequential difference in this comparison. A reader triaging a 12-item report by severity reads the four majors and stops; on Terra Pro's report the highest-priority defect in the lecture sits eighth, in the lowest severity band, filed under a category that means "present but thin" rather than "asserts what the source contradicts".

Both assessments also rank the **human tumour incidence block** as the largest single loss — benign tumours being *"incredibly common"*, and the base-rate inference the lecturer draws from it, which is the population-level counterpart to the multi-hit model taught at the start of the lecture. Sol Pro raises it. Terra Pro does not.

### Terra Pro missed four of the five quantitative and policy drifts

The second assessment names these as a pattern in their own right — *"Quantities drift… None is a rounding artefact; each reads as confident."*

| Drift | Terra Pro | Sol Pro |
|---|---|---|
| "millions" of shed cells (invented magnitude) | ✅ minor | ✅ minor |
| PSA *"not recommended"* → "controversial" | ❌ | ✅ **major** |
| Breast over-treatment denominator shifted | ❌ | ❌ |
| "half" → "over half" | ❌ | ✅ minor |
| 90% complement stated as taught fact | ❌ | ❌ |

The PSA miss is the notable one: a statement of current clinical policy became a statement of debate, and it is exactly the kind of drift a student repeats in an exam.

### What Terra Pro caught that Sol Pro did not

One item on lecture 3: **HeLa cells as the first tumour cells to grow in culture**. The structured version keeps the surprise and drops the reason for it, which both committed assessments also note. Sol Pro missed it.

Terra Pro also framed the biopsy-sampling-and-margins cluster as a *major omission*, where Sol Pro filed the same material as *underexplained*. Terra Pro's reading is arguably the better one — the content is absent, not thin. And Terra Pro flagged the unsourced claim that endoscopic screening permits **removal** of polyps; Sol Pro raised the same passage only for the missing histology requirement and let the invented therapeutic function through.

### What neither checker found

Walking all 43 items of the fuller committed assessment in the other direction — asking of each whether either model raised it — **sixteen were raised by neither.**

Three of those are items the assessments themselves record as benign or as improvements on the lecturer's wording: "pleomorphic", "squamocolumnar transformation zone", and the inferred lymphatic and haematogenous route attributions. Leaving those unraised is defensible, arguably correct.

The remaining thirteen are substantive, and they are not randomly distributed.

**Two further quantity drifts.** The breast over-treatment denominator (the lecturer's third is of those who proceed to treatment; the structured version's third is of all flagged abnormalities) and the 90% complement presented as taught fact. Of the five drifts the second assessment named as a pattern in its own right, Sol Pro caught three, Terra Pro one, and **neither caught these two**.

**Three losses.** Invasion as an obligatory step for metastasis, together with the sampling caveat that defends it against apparent counter-examples; the second block of open research questions, including the metastatic-niche problem, which appears nowhere else in the lecture; and the lecturer's explicit hedge on the central diagram — *"Simplicity can help frame our thinking, but it will also end up losing a lot of details."*

**Eight of the twelve underexplained items.** Why the muscularis mucosae is used as a proxy at all (the basement membrane is hard to see in histology); why 3D culture matters (a response to a known blind spot, not a trend); the normal squamous baseline that dysplasia is abnormal *against*; what the Pap smear actually reads; that invasion is palpable and not only microscopic; endoscopy's real costs and indications; what a positive FIT implies about the lesion; and that incidence and mortality are different rankings, with lung disproportionately lethal.

That cluster is the most important result of this exercise, and it is a finding about both checkers rather than about either.

Counted as *assessment items covered*, since one model finding sometimes covers two items the assessment listed separately — which is why these totals exceed the 12 and 22 findings each model actually raised.

| category of assessment item | items | Terra Pro covers | Sol Pro covers | neither |
|---|---|---|---|---|
| distorted | 9 | 5 | 6 | 2 |
| lost | 14 | 7 | 11 | 3 |
| underexplained | 12 | 2 | 3 | 8 |
| unsourced | 8 | 3 | 4 | 4 |
| **total** | **43** | **17** | **24** | **16** |

**Both models are much better at *absent* and *added* than at *present but hollowed out*.** Omissions and unsourced additions are visible by comparing two texts for the presence of a thing. "Underexplained" requires judging whether what survived still carries the reasoning that makes it usable, which means holding a model of what the student needs the passage *for* — and that is where both checkers thin out, Terra Pro to 2 of 12 and Sol Pro to 4 of 12.

This bears directly on what Stage 4 is for. Underexplaining is the failure mode the fidelity programme began from — the observation that Stage 3 summarises rather than structures, keeping conclusions and dropping the mechanism. It is the category the automated checker is currently weakest at, on both candidates.

---

## The control: does lecture 4 look like lecture 3?

Both checkers pass this test, which is the main thing the control was for.

| | L3 findings | L4 findings | L3 distortions | L4 distortions |
|---|---|---|---|---|
| Terra Pro | 12 | 12 | 2 | 2 |
| Sol Pro | 22 | 23 | 5 | 5 |

Volumes are near-identical across a lecture with a committed assessment and one without, so neither model is tuned to a target it inferred from the corpus. More tellingly, the *content* of the lecture 4 reports is completely different from the lecture 3 reports and tracks lecture 4's own failure mode.

That failure mode is worth recording, because it is not the one lecture 3 showed. On lecture 3, Stage 3 mostly **lost** material. On lecture 4 it **invented** it, and the two checkers converge on this independently:

- The two-stage initiation/promotion model is stated as a universal requirement of carcinogenesis (**both checkers: critical distortion**) where the lecturer presents it as a model demonstrated by one mouse-skin experiment.
- Asbestos is headed *"Pure Promoter"* where the lecturer says *"we think"* and *"we consider this to be promoter activity"*.
- The Burkitt lymphoma mechanism gains *Plasmodium falciparum*, class-switch recombination and the canonical t(8;14) — none in the transcript.
- The pathogen list gains species, histological subtypes and named oncoprotein targets (p53, pRb, viral transactivators) the lecture never gave.
- The Ames test gains *Salmonella typhimurium*, minimal-histidine medium and S9 terminology; the chemistry sections gain aflatoxin B1, benzo[a]pyrene diol epoxide, and named bladder histologies.
- Exploratory epidemiology becomes causal: geographic patterns the lecturer raised as open questions become established drivers, and the Japanese migrant study is strengthened to rates rising *"to match the host nation"*.

Terra Pro rates the epidemiology overstatement **critical**; Sol Pro rates the same material **minor**, split across two findings. Terra Pro's severity judgement is better here, and for a defensible reason: the lecture's own stated objective is critical appraisal of epidemiological evidence, so overstating causality in that section defeats the section's purpose. This is the clearest case in the four reports where Terra Pro's ranking beats Sol Pro's.

---

## Recommendation: default the stage to Sol Pro

**`openai/gpt-5.6-sol-pro`**, on four grounds, in order of weight.

**1. It does not miss the findings that matter most, and Terra Pro does.** This is the decisive one. On the only lecture where an independent yardstick exists, Terra Pro either missed or demoted to minor both items that the two committed assessments independently rank first and second for reinstatement. Sol Pro raised both, and rated the top one critical. A checker is being asked to tell a person what went wrong; one that files the worst defect in the lowest severity band has failed at the thing it is for.

**2. Its extra volume is signal, not noise.** Every additional finding checked held up against the transcript, and three of them are real defects that two prior careful passes over the same document did not catch. The usual objection to the higher-recall model — that you pay for its recall in false positives you then have to filter — does not apply on this evidence, because there were none to filter.

**3. The stage reports and never gates, so recall is worth more than precision here.** This is a property of how Stage 4 is built, not a preference about models. No verdict fails a stage, ends a run, or changes an exit code. A false positive therefore costs a reader thirty seconds; a false negative is content silently lost from the notes with nothing left to indicate it was ever there. When the two error types cost that differently, the checker that finds more is the right default — and that argument would hold whichever model happened to be the higher-recall one.

**4. Cost does not discriminate.** About 18% more per lecture, on runs costing pennies.

### What the recommendation does not claim

**Neither checker replaces the assessment method.** Sol Pro's 22 findings cover 24 of the 43 items the committed assessment records; Terra Pro's 12 cover 17. Choosing the better of the two is not the same as concluding that Stage 4 is now sufficient on its own, and nothing here supports retiring the hand-directed assessment for a lecture that matters.

The misses are systematic rather than random — eight of the twelve underexplained items, and two of the five quantity drifts, went unraised by both — so the gap will not close by running the stage twice or by reading its output more carefully. It closes, if it closes, through the prompt.

That is the practical consequence for the fidelity programme: **the automated checker is currently weakest at the exact failure mode the programme exists to fix.** A rewritten Stage 3 prompt that improved mechanism retention would be only partly visible to Stage 4 as it stands, so improvements to the checker's grip on "underexplained" are worth as much as the choice of model — and probably more.

### What the recommendation is not based on

Both candidates are OpenAI models, so no house preference is available to intrude. The verdicts are identical (both models fail both lectures), so the recommendation is not reading a verdict. The coverage scores contradict the findings in both models and were ignored. Volume alone did not decide it either — volume only counted once the additional findings had been checked one by one and held.

### Where Terra Pro is genuinely better, and what to do about it

Terra Pro's severity ranking is the sharper instrument at the top of the scale. It reserves `critical` for claims that defeat a section's purpose — two on lecture 4, where Sol Pro found one — and it correctly classed the biopsy-sampling material as an omission where Sol Pro softened it to underexplained. Sol Pro puts 16 of its 22 lecture 3 findings at `minor`, which flattens the triage the ordering is supposed to give a reader.

That is an argument for improving the prompt's severity guidance, not for accepting half the findings. The severity definitions are the part of the reply contract that could carry a worked example of what separates critical from major, and this comparison gives two concrete cases to build it from — the polyp/adenoma conflation, and the epidemiology overstatement.

### What this is not evidence of

Two lectures, one structured-transcript generator, one prompt, one run per pair. Both lectures come from the same module and the same lecturer. Nothing here establishes how either checker behaves on a *good* structured transcript — both lectures failed, and a checker's false-positive rate is best measured against material with little wrong with it. That test is worth running once the Stage 3 prompt is rewritten and the transcripts improve.

---

## What this says about Stage 3, for the prompt rewrite

Ticket #9 rewrites the structuring prompt. Two findings here bear on it directly, and both are corroborated by two independent checkers rather than asserted by one.

**The failure mode is not only compression.** Lecture 3 loses material; lecture 4 fabricates it. The invented content in lecture 4 is plausible, specific, and exactly the kind a student would repeat — named organisms, named lesions, canonical translocations, unit conversions. A prompt rewrite aimed only at "retain more" would not touch it, and might make it worse by encouraging elaboration.

**The checker cannot yet measure the thing the rewrite is aimed at.** Both models raise "underexplained" rarely — 2 and 4 findings against the committed assessment's 12 — so a rewritten prompt that restored mechanism would show up in Stage 4's output only faintly, and a rewrite that failed to would not obviously look worse. Before the rewrite is judged by this stage, the checker's grip on that category needs improving, or the rewrite needs judging against a hand-directed assessment as well.

**Where the lecturer hedges, the hedge is what gets dropped.** *"We think"*, *"proposed to be"*, *"this suggests something environmental"*, *"it's a little bit premature of me"* — across both lectures, the structuring reliably keeps the claim and discards the qualification, then states the result with confidence. Both checkers found this pattern independently, on different lectures, in different subject matter. It is the most consistent single defect in the corpus and deserves to be addressed explicitly in the rewritten prompt.
