# Checks of Rewrites (sonnet-5.5, w1), lecture 2026-03-04

| Checker | Faults | Subtopics failed | Subtopics checked | Faults that matter found | Cost |
| --- | --- | --- | --- | --- | --- |
| gemini-3.8-flash c3 | 2 | 2 | 17 | 1 of 7 | $0.12 |
| gemini-3.1-pro, c2 (pipeline) | 24 | 8 | 17 | 4 of 7 | not recorded |
| gemini-3.8-flash, c2 (pipeline) | 8 | 4 | 17 | 3 of 7 | not recorded |
| gemini-3.8-flash, c3 (pipeline) | 1 | 1 | 17 | 1 of 7 | not recorded |
| sol-pro, c2 (pipeline) | 36 | 15 | 17 | 7 of 7 | not recorded |
| sonnet-5.5, c2 (pipeline) | 4 | 4 | 17 | 1 of 7 | not recorded |
| terra-pro, c2 (pipeline) | 42 | 13 | 14 | 4 of 7 | not recorded |

## Faults that matter

| Fault | gemini-3.8-flash c3 | gemini-3.1-pro, c2 (pipeline) | gemini-3.8-flash, c2 (pipeline) | gemini-3.8-flash, c3 (pipeline) | sol-pro, c2 (pipeline) | sonnet-5.5, c2 (pipeline) | terra-pro, c2 (pipeline) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2.1 | no | no | no | no | yes | no | no |
| 2.2 | no | yes | no | no | yes | no | yes |
| 3.4 | no | yes | yes | no | yes | no | no |
| 7.1 | no | yes | yes | no | yes | no | yes |
| 8.1 | no | yes | no | no | yes | yes | yes |
| 12.1 | yes | no | yes | yes | yes | no | no |
| 15.1 | no | no | no | no | yes | no | yes |

## Faults outside the key

### gemini-3.8-flash c3: 1 fault outside the key

- **11**, distortion: The rewrite states that a tumour occurs in a meningioma, treating a meningioma as an anatomical site or organ, whereas a meningioma is itself a type of tumour.
  - Source: Only 10% of these deaths, generally, if they're occurring in things like the meningioma that I was telling you about or in the liver.
  - Rewrite: Only 10% of deaths are generally caused in this way, for example when the tumour occurs in a meningioma or in the liver.

### gemini-3.1-pro, c2 (pipeline): 10 faults outside the key

- **11**, distortion: The rewrite states that a tumour occurs inside a meningioma, whereas the text gives the meningioma as an example of a tumour.
  - Source: occurring in things like the meningioma that I was telling you about
  - Rewrite: when the tumour occurs in a meningioma
- **13**, distortion: The rewrite replaces the general word "things" with the more precise biological term "species".
  - Source: if you compare any two things
  - Rewrite: any comparison between two species
- **15**, unsourced-addition: The rewrite adds that the cervix is seen alongside the endocervical canal, establishing a spatial relationship that the lecturer does not state.
  - Source: none
  - Rewrite: and the cervix is seen alongside it.
- **3**, omission: The rewrite leaves out the qualification that the intestines are being cited as an example.
  - Source: within, for example, the intestines
  - Rewrite: none
- **8**, omission: The rewrite leaves out the qualification that the diagnosis is limited by what the biopsy looks like.
  - Source: and what that looks like.
  - Rewrite: none
- **8**, distortion: The rewrite replaces the pronoun 'this' with 'Invasion', explicitly stating a specific conclusion that the lecturer did not explicitly state here.
  - Source: So this is probably an obligatory step
  - Rewrite: Invasion is therefore probably an obligatory step
- **8**, distortion: The rewrite replaces the general pronoun 'this' with the more precise medical term 'a lesion'.
  - Source: because this is not necessarily an adenoma
  - Rewrite: because a lesion is not necessarily an adenoma
- **8**, distortion: The rewrite replaces the transcribed phrase 'on two words' with the unsourced interpretation 'from their appearance'.
  - Source: anything on two words
  - Rewrite: from their appearance
- **8**, omission: The rewrite drops the causal link 'because' that connects the conclusion of a stepwise change to the observations of the malignant part of the tumour.
  - Source: that there is a stepwise change that is occurring because the malignant part of this tumor that has arisen here,
  - Rewrite: that a stepwise change occurs. The malignant part of this tumour is diagnosed
- **8**, distortion: The rewrite replaces the general spatial phrase 'over here' with the precise phrase 'Elsewhere in the same lesion', adding a medical term not used by the lecturer.
  - Source: over here you have the adenoma
  - Rewrite: Elsewhere in the same lesion is the adenoma

### gemini-3.8-flash, c2 (pipeline): 1 fault outside the key

- **11**, unsourced-addition: The rewrite adds the statement 'Other effects depend on the site.', which does not appear in the source text.
  - Source: none
  - Rewrite: Other effects depend on the site.

### gemini-3.8-flash, c3 (pipeline): 0 faults outside the key



### sol-pro, c2 (pipeline): 0 faults outside the key



### sonnet-5.5, c2 (pipeline): 2 faults outside the key

- **5**, omission: The lecturer says invasion under the microscope is something students will come to appreciate in their practicals. This is a course arrangement, so dropping it is acceptable. However, the first sentence of the source, "with these tools in hand", is also dropped, which is not subject matter. No real omission here.
  - Source: that's something that you'll come to appreciate in your practicals
  - Rewrite: none
- **7**, distortion: The lecturer says the benign tumour on the slide has a capsule around it. The rewrite turns this into a general possibility, 'may have a capsule', which changes the certainty of the statement.
  - Source: you can have a benign tumor like this one, which has a capsule around it.
  - Rewrite: a benign tumour may have a capsule around it.

### terra-pro, c2 (pipeline): 19 faults outside the key

- **1**, distortion: The rewrite removes the lecturer's qualification "hopefully" and therefore presents students' grasp of the learning outcomes with greater certainty.
  - Source: And we have these learning outcomes that hopefully you should be able to grasp by the end of each of the specific lectures.
  - Rewrite: Learning outcomes are set for each lecture, and students should be able to grasp them by the end of the specific lecture.
- **13**, unsourced-addition: The rewrite generalises the statement about the lecturer's cat's sarcoma into a claim that feline injection site sarcomas as a class arise from injections. The source states this only of the depicted case.
  - Source: none
  - Rewrite: Such tumours arise from injections
- **13**, distortion: The precise category name "hematopoietic" has been changed to "hematopoietic tissues".
  - Source: You'll see that digestive tissues, hematopoietic, and skin are the three main categories in terms of where cancers arise.
  - Rewrite: A comparison of the incidence of different types of tumours in other taxa, such as birds and reptiles, with that in mammals shows that digestive tissues, hematopoietic tissues and skin are the three main categories in terms of where cancers arise.
- **15**, unsourced-addition: The rewrite adds that the cervix is seen "alongside" the endocervical canal. The source identifies both structures in the diagram but does not state this spatial relationship.
  - Source: none
  - Rewrite: the cervix is seen alongside it
- **15**, distortion: The source uses "would be" when identifying the women still dying of cervical cancer, whereas the rewrite states this categorically as "are".
  - Source: the women that are still dying of cervical cancer would be the ones that either are not followed up after their screen or that have declined screening altogether
  - Rewrite: The women who are still dying of cervical cancer are those who are either not followed up after their screen or who have declined screening altogether.
- **16**, distortion: The rewrite removes the lecturer's additional uncertainty that the tumour is "probably" already malignant.
  - Source: And the blood, of course, would be arising from the fact that this is an ulcerated cauliflower structure, if you like, an ulcerated tumor, and very likely to probably already be malignant.
  - Rewrite: The blood would arise from the fact that this is an ulcerated cauliflower-like structure, an ulcerated tumour, which is very likely to be malignant already.
- **16**, distortion: The source describes the tumour as potentially shedding cells for invading other parts of the body. The rewrite instead describes it as shedding cells that themselves invade other parts of the body, changing the stated mechanism.
  - Source: So already potentially shedding cells for invading into other parts of the body.
  - Rewrite: It is therefore potentially already shedding cells that invade other parts of the body.
- **2**, unsourced-addition: The rewrite states that epigenetic changes are involved, whereas the source says only that epigenetic changes are also being discussed and describes examples of them. It does not explicitly state that they are involved in the progression.
  - Source: none
  - Rewrite: Epigenetic changes are also involved.
- **2**, distortion: The source presents starting at the beginning as a hoped-for future attempt to address some questions. The rewrite states definitively that the discussion starts at the beginning in order to address some questions, removing both the qualification "hopefully" and the tentative "try".
  - Source: So hopefully, in order to try and address some of these questions, we will start at the beginning.
  - Rewrite: Putting a model like this together invites many questions, and in order to address some of them, the discussion starts at the beginning.
- **3**, unsourced-addition: The rewrite adds that the arrangement of the epithelial cells causes or is intended to make them look uniform. The source separately states that the cells are arranged and that they look fairly uniform, without stating this link.
  - Source: none
  - Rewrite: It contains a normal milk duct, in which the epithelial cells are arranged so that they look fairly uniform in shape and size [FIGURE].
- **3**, omission: The rewrite omits the stated detail that the cells "have come in" before losing their architecture, moving over the basement membrane, invading, and growing within the stroma.
  - Source: They have come in, they have lost this architecture, moved over the basement membrane and invaded and are growing within the stroma.
  - Rewrite: none
- **4**, distortion: The general expression “other things” is replaced with the more specific term “other components”. The source does not identify those other contributors as components.
  - Source: the contributions of things like the stroma and other things.
  - Rewrite: the contributions of things such as the stroma and other components.
- **5**, distortion: The rewrite states categorically that tumours came in two types, whereas the lecturer qualified this classification with “kind of”.
  - Source: that tumors kind of came in two types.
  - Rewrite: that tumours came in two types.
- **6**, omission: The qualification that tumour cells are present only “sometimes” is omitted.
  - Source: you can often see sometimes the tumor cells are actually present within a lymphatic duct.
  - Rewrite: none
- **6**, omission: The approximate qualification “kind of” is omitted from the statement about identifying where the tumour may be coming from.
  - Source: So you can know kind of where it might be coming from.
  - Rewrite: none
- **7**, distortion: The rewrite weakens the stated fact that this benign tumour has a capsule by saying that a benign tumour “may have” one.
  - Source: you can have a benign tumor like this one, which has a capsule around it.
  - Rewrite: a benign tumour may have a capsule around it.
- **8**, distortion: The source defines invasion as the ability to invade surrounding tissue. The rewrite instead defines malignancy this way, changing the precise concept being defined.
  - Source: So invasion and malignancy are really, really important diagnostically. So it's defined as the ability to invade the surrounding tissue.
  - Rewrite: Invasion and malignancy are very important diagnostically, and malignancy is defined as the ability to invade the surrounding tissue.
- **8**, unsourced-addition: The rewrite adds an explicit causal link that the cells fail to metastasise because they fail to survive at the secondary site. The source states both points but does not explicitly give this causal link.
  - Source: none
  - Rewrite: Many never metastasise, because they never survive at the secondary site.
- **8**, distortion: The source refers specifically to the particular polyp whose histology must be understood. The rewrite substitutes the more general term “lesion” in that statement.
  - Source: But actually, it's a little bit premature of me to have done that because this is not necessarily an adenoma until I understand the histology of this particular polyp.
  - Rewrite: These were labelled as a precursor stage known as an adenoma, but that is premature, because a lesion is not necessarily an adenoma until the histology of that particular polyp is understood.
