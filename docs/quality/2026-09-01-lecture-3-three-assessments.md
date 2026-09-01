# Three assessments of the same structured transcript

**Subject:** Lecture 3 — *The Nature and Biology of Cancer* (2026-03-04). One structured transcript, assessed three times against the same raw transcript.

| | produced | findings |
|---|---|---|
| **First assessment** — `2026-08-31-lecture-3-fidelity.md` | 31 Aug 2026, by hand | 31 |
| **Second assessment** — `2026-08-31-lecture-3-fidelity-second-opinion.md` | 31 Aug 2026, by hand, independently of the first | 43 |
| **Stage 4** — `2026-09-01-lecture-3-verification-sol-pro.{json,md}` | 1 Sep 2026, by the pipeline | 22 |

The pipeline run used `openai/gpt-5.6-sol-pro` through `lecture-notes run 2026-03-04`, with the checker prompt unchanged — it is the assessment method that produced the two committed reports, with only a reply contract appended. So the three differ in who did the work, not in what was asked.

The question here is not which report is best. It is what the automated stage can and cannot see, measured against two careful passes over the same document.

### Why Terra Pro is not in this comparison

`openai/gpt-5.6-terra-pro` was run over the same lecture on the same day and is not good enough to keep as a candidate. It raised 12 findings, and — decisively — filed the polyp/adenoma conflation as *minor* and *underexplained*, where both committed assessments rank it first for reinstatement and one calls it critical. It also missed the PSA policy softening and the benign-tumour incidence block, the largest single loss in the lecture. Its reports remain in this directory (`2026-09-01-lecture-{3,4}-verification-terra-pro.{json,md}`) as the record behind that decision; the stage is configured to Sol Pro.

---

## The three side by side

Counted as items of the second assessment's 43, since it is the fullest of the three and the only one that enumerates every category separately.

| category | items | first assessment | second assessment | Stage 4 |
|---|---|---|---|---|
| distorted — asserts what the source does not support | 9 | 5 | 9 | **6** |
| lost — no counterpart at all | 14 | 14 | 14 | 11 |
| underexplained — present, mechanism stripped | 12 | 11 | 12 | **3** |
| unsourced additions | 8 | 6 | 8 | 4 |
| **total** | **43** | **36** | **43** | **24** |

Stage 4 raised 22 findings covering 24 of those items — a single finding sometimes covers two the assessment listed separately — **plus three items that appear in neither committed report.**

Two things in that table are worth more than the totals.

**Stage 4 beats the first assessment on distortions**, 6 items to 5, in the category both assessments name as the highest-risk one: the structured version stating something the lecture does not support.

**Stage 4 collapses on underexplained**, 3 items against 11 and 12. That is not a small shortfall; it is a different order of performance from everything else it does.

---

## The two committed assessments are not two independent data points

Before measuring the pipeline against them, it is worth being honest about the yardstick. **The second assessment is close to a strict superset of the first.** It contains all 31 of the first assessment's findings; the first reaches 36 of the second's 43 items and contributes nothing the second lacks.

The seven the first assessment missed are not random either. Four are cases where the structured version asserts something unsupported:

- *"millions"* of tumour cells shed into circulation — a magnitude the lecturer never gave
- biliary obstruction attached to liver failure, where the lecturer said it interferes with digestion
- the lecturer's cat promoted to feline epidemiology, and *"proposed to be due to the adjuvant"* hardened into an association — the first assessment explicitly records dropping the anecdote as *"the right call"* and does not notice what came with it
- endoscopic screening gaining a therapeutic function it was never given

Plus what a positive FIT result implies about the lesion, the inferred metastatic route attributions, and HeLa's *"first"* — which the first assessment notes in passing rather than raising.

So the first assessment is the weaker of the two specifically at **distortion and unsourced addition**, which is exactly where Stage 4 is strongest. That is the finding that makes this three-way comparison worth doing: the automated checker's profile is not a diluted version of a human pass, it is a *differently shaped* one.

---

## Where Stage 4 holds its own

**Distortions (6 of 9).** It raised the polyp/adenoma conflation as a **critical distortion** — matching the second assessment's category and severity exactly, on the item both assessments rank first for reinstatement. It also caught the PSA softening as major, the biliary/liver-failure error, the cat-anecdote hardening, *"over half"* for *"half"*, and the invented *"millions"*. Four of those six are among the seven the first assessment missed.

It missed three: the breast over-treatment denominator, the 90% complement presented as taught fact, and the endoscopy-removal claim.

**Losses (11 of 14).** It found the benign-tumour incidence block that both assessments call the largest single loss, the sarcoma epidemiology, the geographical variation, the screening cost-benefit framework, the diagnostic delay, the cervical outcomes by age and non-attendance, the lymphovascular sign, the sampling limits, the margins and depth of invasion, the biopsy workflow, and the two-polyp lesson.

It missed three: invasion as an obligatory step with the sampling caveat that defends it; the second block of open research questions, including the metastatic-niche problem that appears nowhere else in the lecture; and the lecturer's hedge on the central diagram — *"Simplicity can help frame our thinking, but it will also end up losing a lot of details."*

**Unsourced additions (4 of 8).** Germ-layer attributions, the invented worked examples, *"millions"*, and *"pancytopenia"*. It let through the 90% complement and the route attributions, and did not raise *"pleomorphic"* or *"squamocolumnar transformation zone"* — which both assessments record as correct terminology and arguable improvements, so leaving those is defensible.

---

## Where Stage 4 fails: the underexplained category

Three items of twelve. The nine it did not reach:

- why the muscularis mucosae is used as a proxy at all — the basement membrane is hard to see in histology, so without that the proxy reads as arbitrary
- why 3D culture matters — a response to a known blind spot in our understanding of tissue architecture, not a trend
- the normal squamous baseline that dysplasia is abnormal *against*: mitoses confined to the basal layer, nuclei shrinking as squames flatten
- what the Pap smear actually reads — small versus large nuclei, abundant mitotic cells — replaced by "morphological abnormalities"
- that invasion is palpable, and a surgeon can tell by touch, rather than histology being the sole route
- endoscopy's real costs and indications: general anaesthetic, a skilled operator, family history or symptoms
- what a positive FIT implies — a bleeding lesion is likely already malignant and shedding, which is the whole argument for why FIT is second-best
- incidence and mortality being different rankings, with lung disproportionately lethal
- HeLa as the *first* tumour cells to grow in culture, which is why their growth was a surprise

The pattern is clean, and it explains itself. Omissions and unsourced additions can be found by comparing two texts for the presence or absence of a thing. Distortions can be found by comparing two statements for agreement. **Underexplaining is a judgement about whether what survived still carries the reasoning that makes it usable** — which requires a model of what a student needs the passage *for*, and cannot be settled by matching text against text.

Both committed assessments found eleven and twelve of these. The pipeline found three. This is the one place where the automated stage is not a partial substitute but a different and much blunter instrument.

---

## What Stage 4 found that neither assessment did

Three items, each checked against the transcript rather than taken on the model's word:

- **"Mammography" is an unsourced addition.** The structured version reads *"Mammography detects early lesions…"*. The word appears nowhere in the transcript, where the lecturer says only *"Breast screening is done…"*. Neither assessment noticed.
- **Cats' skin and connective tissue tumours are omitted.** The transcript: *"in cats, the primary type of tumor that arises is non-Hodgkin's lymphoma, but they also get skin and connective tissue tumors."* The structured version gives cats only lymphoma and injection-site sarcoma, and attributes skin and connective tissue tumours to dogs alone. Neither assessment noticed.
- **The lecturer's revision steer is dropped** — *"There's nothing to memorize here except to say that… breast, prostate, lung, and bowel are the four big cancer types."* This is the weakest of the three, since it is lecturer meta-commentary of a kind both assessments treat as a non-finding class, but the quote is real and the guidance is genuinely absent.

Every other finding in the Stage 4 report corresponds to an item in a committed assessment. **No fabricated or unsupported finding was found in the report at all.** Its shortfall is entirely one of recall, not of precision — which matters, because it means the output can be read as it stands without filtering.

---

## Does its ordering help a reader?

Partly. The report puts the polyp/adenoma conflation first and rates it critical, agreeing with both assessments' reinstatement priority. Below that, severity tracks the assessments' priorities only loosely: it rates the biliary/liver-failure error *major* where the second assessment ranks it eighth, and rates the benign-tumour incidence block *minor* where both assessments rank it second and call it the largest single loss.

Sixteen of its twenty-two findings sit at `minor`, which flattens the triage the ordering is supposed to provide. The severity definitions in the reply contract are the place to fix that, and this lecture supplies two worked cases to build them from — one conflation that inverts a distinction the lecturer drew explicitly, and one absent block carrying the only age-distribution and geographical material in the lecture.

---

## The control lecture, and a second failure mode

Lecture 4 (*Causes of Cancer and Environmental Carcinogenesis*, 2026-03-06) has no committed assessment, which makes it the control: a checker whose findings there resemble its findings on lecture 3 in character is reading rather than matching a pattern inferred from the corpus.

Stage 4 raised 23 findings on lecture 4 against 22 on lecture 3, with the same five distortions — stable in volume, and completely different in content. It passes the control.

What it found there is a Stage 3 failure mode lecture 3 barely shows. **Lecture 3's structured transcript loses material; lecture 4's invents it.**

- The two-stage initiation/promotion model is stated as a universal requirement of carcinogenesis, where the lecturer presents it as a model demonstrated by one mouse-skin experiment
- Asbestos is headed *"Pure Promoter"*, where the lecturer says *"we think"* and *"we consider this to be promoter activity"*
- The Burkitt mechanism gains *Plasmodium falciparum*, class-switch recombination and the canonical t(8;14) — none in the transcript
- The pathogen list gains species, histological subtypes and named oncoprotein targets the lecture never mentioned
- The Ames test gains *Salmonella typhimurium*, minimal-histidine medium and S9 terminology
- The lymphoma belt's *"yearly rainfall of greater than 50 mils"* is silently converted to `> 50 mm`, asserting a unit the lecturer did not give

The invented content is plausible, specific, and precisely the kind a student would repeat in an exam.

---

## What this means

**Stage 4 supplements the assessment method; it does not replace it.** It reaches 24 of 43 items, and its misses are systematic rather than random, so they will not close by running it twice or reading it more carefully.

**It is strongest where the first hand assessment was weakest.** On distortions and unsourced additions — the categories where the structured version asserts something the lecture does not support — it caught four items that the first assessment missed. Run alongside a hand assessment rather than instead of one, it is a genuine second pair of eyes, not a redundant one.

**It is close to blind to underexplaining**, which is the failure mode the fidelity programme exists to fix. That has a direct consequence for the Stage 3 prompt rewrite: a rewritten prompt that restored mechanism would show up in this stage's output only faintly, and one that failed to would not obviously look worse. Either the checker's grip on that category improves first, or the rewrite is judged against a hand assessment as well.

**Two further inputs to the rewrite**, both corroborated across two lectures:

- A rewrite aimed only at "retain more" would not touch the fabrication seen on lecture 4, and might make it worse by encouraging elaboration.
- Where the lecturer hedges, the hedge is what gets dropped. *"We think"*, *"proposed to be"*, *"this suggests something environmental"*, *"it's a little bit premature of me"* — the structuring keeps the claim, discards the qualification, and states the result with confidence. It is the most consistent single defect in the corpus.

---

## Method notes

- All runs went through the pipeline (`lecture-notes run <date>`), not a scratch script.
- The checker prompt is unchanged from the one that produced the two committed assessments, with only the reply contract appended, so a difference in findings is not a difference in method.
- **`coverageScore` is not usable.** The stage scored this transcript 80 while raising 22 findings, and Terra Pro scored it 74 while raising 12 — the number runs opposite to the findings. Nothing should be built on it.
- **Neither model used the `other` category** across four runs, so this exercise yields no candidate additions to `QaDeficiencyType`.
- **The pipeline could not price any run.** The cost lookup returned `404 Generation … not found` every time; the four runs cost roughly $1.33 by estimate from token counts and published rates. Filed as issue #10.
