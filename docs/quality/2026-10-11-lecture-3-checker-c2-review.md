# Lecture 3: a review of the faults that checker c2 found

**Date:** 2026-10-11
**Lecture:** Lecture 3, "The nature of cancer" (2026-03-04)
**Writer:** `anthropic/claude-sonnet-5.5`, prompt `w1`
**Checker:** `openai/gpt-5.6-sol-pro`, prompt `c2`
**Data:** `2026-10-11-lecture-3-checker-c2-review.json` holds each fault with its passages and both verdicts.

The checker found 36 faults in 15 of the 17 subtopics. The user and the agent judged each fault separately. The agent did not see the user's marks before it judged.

## The question that each verdict answers

Would a student who learns from the rewrite be misled, or lose content that the lecturer taught?

- **The user** marked each fault on a review page: *matters* or *does not matter*.
- **The agent** gave one of three verdicts. *Useful*: the fault is real and matters. *Minor*: the fault is real under the writer's rules, but the notes still teach the same thing. *Wrong*: the rewrite is right, or better than the transcript.

For the comparison, *useful* is the agent's *matters*. *Minor* and *wrong* are the agent's *does not matter*.

## Each fault

A fault is named by its subtopic and its number in the check of that subtopic.

| Fault | Kind | The checker's finding, in short | User | Agent | Agree |
|---|---|---|---|---|---|
| 1.1 | distortion | Three questions given as alternatives become one list | does not matter | minor | yes |
| 1.2 | distortion | "Hopefully you will be interested" becomes a prediction | does not matter | minor | yes |
| 1.3 | distortion | "You will be able to link this in the practicals" becomes "This is linked" | does not matter | minor | yes |
| 2.1 | unsourced-addition | "That is" makes acetylation the same as the state of transcription | matters | useful | yes |
| 2.2 | distortion | "Viruses can predispose to chronic inflammation" becomes "infection can" | matters | minor | **no** |
| 3.1 | unsourced-addition | "Everybody in the room" becomes "every person" | does not matter | minor | yes |
| 3.2 | omission | "During the time that you were born" is dropped | does not matter | minor | yes |
| 3.3 | omission | Adolescence is dropped | does not matter | minor | yes |
| 3.4 | distortion | "A signalling and basis for adherence" becomes "a signalling basis" | matters | useful | yes |
| 3.5 | distortion | "Invading stroma" becomes "invaded stroma" | does not matter | wrong | yes |
| 5.1 | unsourced-addition | "Since" joins two facts as cause and effect | does not matter | minor | yes |
| 6.1 | distortion | "I think" is dropped from a claim about ovarian cancer | does not matter | minor | yes |
| 6.2 | distortion | "Transcoelomic site" becomes "transcoelomic route" | does not matter | wrong | yes |
| 6.3 | distortion | "Very often" becomes "often" | does not matter | minor | yes |
| 6.4 | distortion | "This tumour cell has" becomes "a tumour cell may have" | does not matter | minor | yes |
| 6.5 | distortion | "Will be difficult" becomes "would be difficult" | does not matter | minor | yes |
| 7.1 | unsourced-addition | The rewrite adds where the tumour lies on the specimen | matters | useful | yes |
| 7.2 | distortion | "Circumspect" becomes "circumscribed" | does not matter | wrong | yes |
| 7.3 | omission | "Very often" is dropped from sampling the lymph node | does not matter | minor | yes |
| 8.1 | omission | The next step, looking for metastases, is dropped | does not matter | useful | no |
| 8.2 | distortion | "What you would think is" becomes a plain statement | does not matter | minor | yes |
| 9.1 | distortion | "Would put pressure" becomes "puts pressure" | does not matter | minor | yes |
| 10.1 | distortion | "Adenomas" becomes "adenoma" in a list | does not matter | wrong | yes |
| 11.1 | distortion | "Erosion of that bone function" becomes "erosion of the bone" | does not matter | wrong | yes |
| 11.2 | unsourced-addition | "The normal" becomes "normal tissue" | does not matter | minor | yes |
| 11.3 | unsourced-addition | "These will interfere" becomes interference with the stem cells | does not matter | minor | yes |
| 11.4 | omission | "Things like" is dropped before two examples | does not matter | minor | yes |
| 12.1 | unsourced-addition | "Because" makes a cause that the lecturer did not state | does not matter | minor | yes |
| 12.2 | unsourced-addition | Moles are counted among the tissue overgrowths | does not matter | minor | yes |
| 12.3 | omission | "And so" between "difficult to treat" and "progress quickly" is dropped | does not matter | minor | yes |
| 13.1 | distortion | "They very much get similar tumours" becomes "very similar tumours" | does not matter | minor | yes |
| 13.2 | distortion | "Pretty clear" becomes "clear" | does not matter | minor | yes |
| 14.1 | distortion | "Something to bear in mind" becomes "has to be borne in mind" | does not matter | minor | yes |
| 14.2 | distortion | "Have to be able to do" becomes "necessary to do" | does not matter | minor | yes |
| 15.1 | omission | The mitotic cells visible on the slide are dropped | matters | useful | yes |
| 16.1 | omission | "A bit" is dropped from "a bit trickier" | does not matter | minor | yes |

## Where the user and the agent agree

The user and the agent agree on every fault except faults 2.2 and 8.1.

- The faults that matter to both are 2.1, 3.4, 7.1 and 15.1. Some add a fact or a defining link that the lecturer did not state. The others drop a function or an observation.
- On 2026-10-11, faults 8.1 and 12.1 also mattered to both. On 2026-10-12, the user and the agent changed fault 12.1 to *does not matter*. The lecturer's next sentence, "So they're extremely common", draws the same link that the rewrite states.
- Neither thinks that a change to an intensity word matters. The same is true of a change to a modal verb, and of a remark to the audience.
- Neither thinks that the five repairs of misheard or garbled words matter: 3.5, 6.2, 7.2, 10.1 and 11.1. The agent judged the rewrite better than the transcript in each one.

## Where they disagree

**Fault 2.2.** The lecturer said that about seven human viruses can predispose to chronic inflammation. The rewrite says that infection can. The agent judged the meaning almost the same. The user marked it *matters*. The user's verdict stands: the rewrite changes the subject of a causal claim, from one named agent to a wider class. So a change to the subject of a causal claim is a fault, also when the claim stays near to true.

**Fault 8.1.** The rewrite drops the lecturer's next step: after a biopsy shows invasion, ask whether the tumour has spread. The agent judged it *useful*. On 2026-10-12, the user changed it to *does not matter*. The user's verdict stands: the lecturer only asks the question and gives no fact, so it adds little to the understanding.

## Faults that later checkers found

Other checkers ran on the same rewrites on 2026-10-12. The user marked two of their faults that checker c2 did not report. The `addedFaults` list of the data file holds them, with the checkers that found each one. The letter in the name shows that the fault is not one of the c2 checker's own.

| Fault | Kind | The finding, in short | User | Agent |
|---|---|---|---|---|
| 11.A | distortion | A meningioma, which is a tumour, becomes a place where a tumour occurs | matters | useful |
| 15.A | distortion | "Would be the ones" becomes "are those", which removes the hedge | does not matter | minor |

Checker prompt c4 then found 36 more faults outside the key. The user marked each one on a review page on 2026-10-12. One of them matters:

| Fault | Kind | The finding, in short | User | Agent |
|---|---|---|---|---|
| 4.A | unsourced-addition | The slice of a tumour "illustrates" explanting, a link that the lecturer did not state | matters | minor |

The user first marked 8.F ("over here" becomes "elsewhere in the same lesion") as *matters*. Later on 2026-10-12, the user changed it to *does not matter*: slide 32 shows one section of one polyp, so "the same lesion" is correct.

The other 35 do not matter. The data file holds each one with both verdicts. They include these kinds of change:
- a link that the lecturer only suggested, when the link is true, such as 8.C and 11.F
- pointing words that become a description, when the description is right, such as 3.B and 15.B
- an unclear statement that the rewrite makes clear by the only likely reading, such as 13.B and 15.C.

The marks follow one rule: an added spatial relation matters unless it is correct. Fault 7.1 matters because the fibroid does not lie next to the outer surface of the uterus. Fault 15.B does not matter because the canal and the cervix are side by side in the section. The added links 8.C and 11.F do not matter because they are true.

When the lecturer says what to look for on a slide, the notes must say it too. So fault 15.1 matters: the lecturer points out two mitotic cells on the slide, and the rewrite keeps only the general rule.

The checkers of the pipeline with prompt c2 had found 14 more faults outside the key. The user marked each one on a review page on 2026-10-12. None of them matters. Most remove a filler word or a hedge, or drop a remark about the course.

The key now has seven faults that matter: 2.1, 2.2, 3.4, 7.1, 15.1, 11.A and 4.A.

## What the review means for checker prompt c3

The checker should report:

- an added fact, or an added causal, defining or equating link
- a changed subject or object of a causal claim, such as a named agent that becomes a wider class
- a dropped observation, a dropped step of reasoning, or a dropped function or property
- a removed hedge on a scientific claim.

The checker should not report:

- a change to an intensity word, such as "very", "pretty" or "a bit"
- a change to a modal verb that leaves the certainty of a scientific claim as it was
- a statement about the course, the students or the lecture
- a figure of speech that helps the audience picture a slide
- a repair of a clear slip of speech or of transcription. This item depends on the user's decision about repairs. The writer's rule R4 forbids a changed term today.

For an omission, the reply format of c3 should ask for the words of the rewrite where the fact should be. When the rewrite has no such words, the passage is null. Sonnet 5.5 gave this quote under c2 on 2026-10-12, and the user chose to ask for it.

For an unsourced addition, c3 should ask for the source sentences that the addition is built on, or null. Gemini 3.8 Flash and Gemini 3.1 Pro gave this quote under c2 on 2026-10-12, and the user chose to ask for it.
