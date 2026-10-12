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
| 8.1 | omission | The next step, looking for metastases, is dropped | matters | useful | yes |
| 8.2 | distortion | "What you would think is" becomes a plain statement | does not matter | minor | yes |
| 9.1 | distortion | "Would put pressure" becomes "puts pressure" | does not matter | minor | yes |
| 10.1 | distortion | "Adenomas" becomes "adenoma" in a list | does not matter | wrong | yes |
| 11.1 | distortion | "Erosion of that bone function" becomes "erosion of the bone" | does not matter | wrong | yes |
| 11.2 | unsourced-addition | "The normal" becomes "normal tissue" | does not matter | minor | yes |
| 11.3 | unsourced-addition | "These will interfere" becomes interference with the stem cells | does not matter | minor | yes |
| 11.4 | omission | "Things like" is dropped before two examples | does not matter | minor | yes |
| 12.1 | unsourced-addition | "Because" makes a cause that the lecturer did not state | matters | useful | yes |
| 12.2 | unsourced-addition | Moles are counted among the tissue overgrowths | does not matter | minor | yes |
| 12.3 | omission | "And so" between "difficult to treat" and "progress quickly" is dropped | does not matter | minor | yes |
| 13.1 | distortion | "They very much get similar tumours" becomes "very similar tumours" | does not matter | minor | yes |
| 13.2 | distortion | "Pretty clear" becomes "clear" | does not matter | minor | yes |
| 14.1 | distortion | "Something to bear in mind" becomes "has to be borne in mind" | does not matter | minor | yes |
| 14.2 | distortion | "Have to be able to do" becomes "necessary to do" | does not matter | minor | yes |
| 15.1 | omission | The mitotic cells visible on the slide are dropped | matters | useful | yes |
| 16.1 | omission | "A bit" is dropped from "a bit trickier" | does not matter | minor | yes |

## Where the user and the agent agree

The user and the agent agree on every fault except fault 2.2.

- The faults that matter to both are 2.1, 3.4, 7.1, 8.1, 12.1 and 15.1. Some add a fact or a causal or defining link that the lecturer did not state. The others drop an observation or a step of reasoning.
- Neither thinks that a change to an intensity word matters. The same is true of a change to a modal verb, and of a remark to the audience.
- Neither thinks that the five repairs of misheard or garbled words matter: 3.5, 6.2, 7.2, 10.1 and 11.1. The agent judged the rewrite better than the transcript in each one.

## Where they disagree

**Fault 2.2.** The lecturer said that about seven human viruses can predispose to chronic inflammation. The rewrite says that infection can. The agent judged the meaning almost the same. The user marked it *matters*. The user's verdict stands: the rewrite changes the subject of a causal claim, from one named agent to a wider class. So a change to the subject of a causal claim is a fault, also when the claim stays near to true.

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
