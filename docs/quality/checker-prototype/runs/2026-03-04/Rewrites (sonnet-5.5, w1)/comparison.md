# Checks of Rewrites (sonnet-5.5, w1), lecture 2026-03-04

| Checker | Faults | Subtopics failed | Subtopics checked | Faults that matter found | Cost |
| --- | --- | --- | --- | --- | --- |
| gemini-3.1-pro-preview c3 | 4 | 3 | 17 | 3 of 8 | $0.68 |
| gemini-3.1-pro-preview c4 | 57 | 14 | 17 | 7 of 8 | $1.48 |
| gemini-3.8-flash c3 | 2 | 2 | 17 | 2 of 8 | $0.12 |
| gemini-3.8-flash c4 | 20 | 10 | 17 | 5 of 8 | $0.32 |
| gpt-5.6-sol-pro c3 | 13 | 10 | 17 | 3 of 8 | $1.17 |
| gemini-3.1-pro, c2 (pipeline) | 24 | 8 | 17 | 5 of 8 | $1.33 |
| gemini-3.8-flash, c2 (pipeline) | 8 | 4 | 17 | 3 of 8 | $0.34 |
| gemini-3.8-flash, c3 (pipeline) | 1 | 1 | 17 | 1 of 8 | $0.15 |
| sol-pro, c2 (pipeline) | 36 | 15 | 17 | 7 of 8 | $2.31 |
| sonnet-5.5, c2 (pipeline) | 4 | 4 | 17 | 1 of 8 | $0.53 |
| terra-pro, c2 (pipeline) | 42 | 13 | 14 | 4 of 8 | $2.72 |

## Faults that matter

| Fault | gemini-3.1-pro-preview c3 | gemini-3.1-pro-preview c4 | gemini-3.8-flash c3 | gemini-3.8-flash c4 | gpt-5.6-sol-pro c3 | gemini-3.1-pro, c2 (pipeline) | gemini-3.8-flash, c2 (pipeline) | gemini-3.8-flash, c3 (pipeline) | sol-pro, c2 (pipeline) | sonnet-5.5, c2 (pipeline) | terra-pro, c2 (pipeline) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2.1 | no | yes | no | yes | yes | no | no | no | yes | no | no |
| 2.2 | no | yes | no | yes | yes | yes | no | no | yes | no | yes |
| 3.4 | no | yes | no | no | no | yes | yes | no | yes | no | no |
| 7.1 | yes | yes | no | yes | no | yes | yes | no | yes | no | yes |
| 8.1 | yes | yes | no | no | yes | yes | no | no | yes | yes | yes |
| 12.1 | no | yes | yes | yes | no | no | yes | yes | yes | no | no |
| 15.1 | no | no | no | no | no | no | no | no | yes | no | yes |
| 11.A | yes | yes | yes | yes | no | yes | no | no | no | no | no |

## Faults outside the key

### gemini-3.1-pro-preview c3: 0 faults outside the key



### gemini-3.1-pro-preview c4: 36 faults outside the key

- **1**, distortion: The rewrite changes what ranges from molecular mechanisms to the patient experience. In the text, it is the students' differing interests that span these topics, whereas the rewrite states that the lectures themselves range across these topics.
  - Source: Because from the molecular mechanisms to the patient experience and to the evolution of personalized medicine and what that entails, you're all going to be having different things that you're interested in.
  - Rewrite: from the lectures, which range from molecular mechanisms to the patient experience and the evolution of personalized medicine and what that entails.
- **10**, distortion: The rewrite explicitly matches lipomas to fat and leiomyomas to smooth muscle, clarifying an incomplete and unclear statement of the text.
  - Source: So the fat, smooth muscle or papillomas in the skin
  - Rewrite: lipomas in fat, leiomyomas in smooth muscle, papillomas in the skin
- **11**, unsourced-addition: The rewrite adds the contrastive word 'whereas' to state a link between a meningioma causing pressure and a lung carcinoma causing blockage, which the text simply juxtaposes.
  - Source: things like a meningioma will cause pressure. Things like a lung carcinoma will cause blockage.
  - Rewrite: a meningioma will cause pressure, whereas a lung carcinoma will cause blockage.
- **11**, unsourced-addition: The rewrite uses 'which' to state a causal link, making the build-up of secretions the cause of breathing difficulties and the breeding ground for infection. In the text, these are listed independently alongside the build-up as parallel effects.
  - Source: this builds up secretions within the lungs, makes it harder for people to breathe, is a breeding ground for infection.
  - Rewrite: this leads to a build-up of secretions within the lungs, which makes breathing harder and provides a breeding ground for infection.
- **11**, unsourced-addition: The rewrite introduces a general statement that other effects depend on the site, which the lecturer did not state.
  - Source: none
  - Rewrite: Other effects depend on the site.
- **11**, unsourced-addition: The rewrite uses a colon to state a link between ulceration and the cauliflower-like structure, implying one explains or defines the other, whereas the text just lists them sequentially without a stated link.
  - Source: Also ulceration, you saw that enormous cauliflower structure within the colon.
  - Rewrite: Ulceration is another effect: the enormous cauliflower-like structure seen within the colon
- **11**, unsourced-addition: The rewrite adds the word 'therefore' to state a causal link between the niche not being very big and the tumour interfering with the bone marrow, which the text does not state.
  - Source: This niche is not very big. This will interfere with your bone marrow
  - Rewrite: This niche is not very big. The tumour will therefore interfere with the bone marrow
- **12**, unsourced-addition: The rewrite replaces the pointing word 'this' with 'A further slide', which is a description that the lecturer did not give.
  - Source: And then this is, if you like, the percentage of tumors that result in deaths.
  - Rewrite: A further slide shows the percentage of tumours that result in deaths.
- **13**, distortion: The rewrite changes the lecturer's broad claim about comparing 'any two things' into a narrower claim about comparing 'two species'.
  - Source: if you compare any two things, you're going to find differences.
  - Rewrite: any comparison between two species will reveal differences.
- **13**, distortion: The rewrite makes an incomplete statement complete by choosing one reading, adding 'tumours of the' before 'skin and connective tissues'.
  - Source: along with skin and connective tissues,
  - Rewrite: along with tumours of the skin and connective tissues,
- **13**, distortion: The rewrite makes an incomplete statement complete by adding 'the pattern in', clarifying what dogs are being compared to.
  - Source: which is different from people.
  - Rewrite: which differs from the pattern in people.
- **13**, distortion: The rewrite makes an unclear statement clear by adding 'and are' to separate the claims that the tumours arise from injections and that they are proposed to be due to the adjuvant.
  - Source: This is from injections proposed to be due to the adjuvant
  - Rewrite: Such tumours arise from injections and are proposed to be due to the adjuvant
- **13**, omission: The rewrite omits the word 'also', which states the fact that the adjuvant is added in addition to something else.
  - Source: that is also added with the injection.
  - Rewrite: that is added with the injection.
- **13**, distortion: The rewrite makes an incomplete statement complete by adding the noun 'tissues' to the adjective 'hematopoietic'.
  - Source: digestive tissues, hematopoietic, and skin
  - Rewrite: digestive tissues, hematopoietic tissues and skin
- **13**, distortion: The rewrite changes the phrase 'thing that was quite interesting to note' into 'notable difference'.
  - Source: The only thing that was quite interesting to note here is that
  - Rewrite: The one notable difference is that
- **13**, unsourced-addition: The rewrite adds the link word 'so', stating a result/causal link between a problem in differentiation and ending up with a tumour, which the text only placed next to each other using 'and'.
  - Source: and end up with a tumor
  - Rewrite: and so with a tumour
- **15**, unsourced-addition: The rewrite turns the lecturer's pointing words into a spatial description ('alongside it') that the lecturer did not give.
  - Source: Histologically, this is the endocervical canal here, and so you're looking at the cervix here.
  - Rewrite: and the cervix is seen alongside it.
- **15**, distortion: The text makes an unclear or incomplete statement that the canal 'goes between' the singular 'neck of the womb'. The rewrite makes this statement clear by choosing the reading 'runs through', which is forbidden.
  - Source: here is the endocervical canal that it goes between the neck of the womb.
  - Rewrite: the endocervical canal runs through the neck of the womb,
- **15**, distortion: The rewrite changes the verb 'is' to 'has', and changes the verb 'has' to 'form'. This alters the stated relationships between the ectocervix, its squamous cells, and the protective layer.
  - Source: which is more squamous cells, which has more of a protective layer,
  - Rewrite: has more squamous cells, which form more of a protective layer
- **16**, unsourced-addition: The rewrite changes a remark about what the audience saw into a factual statement that the pre-cancerous states are present.
  - Source: You saw those different pre-cancerous states.
  - Rewrite: The different pre-cancerous states are present,
- **16**, distortion: The text describes cells as being 'for invading', indicating a potential or purpose, but the rewrite definitively states that they 'invade'.
  - Source: shedding cells for invading into other parts of the body.
  - Rewrite: shedding cells that invade other parts of the body.
- **16**, distortion: The rewrite narrows the claim that cervical screening is the best by restricting it only to the screening methods discussed.
  - Source: So screening, as I said, the cervix is best.
  - Rewrite: Of the screening methods discussed, cervical screening is the best.
- **16**, unsourced-addition: The rewrite adds a link ('such as') to indicate that showing symptoms is an example of a reason, which the text does not state.
  - Source: or there's some reason if you're showing symptoms.
  - Rewrite: or some other reason, such as the patient showing symptoms.
- **16**, distortion: The text contains a grammatically disconnected statement linking people who go for screening with a false positive rate. The rewrite makes this clear by choosing an interpretation that the people are 'affected by' the false positive rate.
  - Source: because many of the people that do go for screening and then for further treatment, it has a very, very high false positive rate.
  - Rewrite: because many of the people who go for screening and then for further treatment are affected by a very high false positive rate.
- **3**, unsourced-addition: The rewrite adds a link ('so that') stating that the cells are arranged with the result or purpose of looking uniform, whereas the text just puts the two statements next to each other.
  - Source: You'll see that the epithelial cells here are arranged. They look fairly uniform in shape and size.
  - Rewrite: in which the epithelial cells are arranged so that they look fairly uniform in shape and size
- **3**, unsourced-addition: The rewrite turns the lecturer's pointing words into a description ('image of the invasive tissue') that the lecturer did not give.
  - Source: And you can see here now the cells are all of different shapes and sizes.
  - Rewrite: In the image of the invasive tissue, the cells are of different shapes and sizes.
- **4**, unsourced-addition: The rewrite asserts that the slice through the tumour illustrates the practice of explanting it, which the text does not state. The text merely introduces the image of the slice next to the statement about explanting, and the rewrite turns pointing words into a description that the lecturer did not give.
  - Source: Here you're looking at a slice through a tumor and a stain to look at the morphology.
  - Rewrite: A slice through a tumour, with a stain to show the morphology, illustrates this [FIGURE].
- **6**, omission: The rewrite omits the lecturer's observation of the main tumour cells on the slide before noting their presence in the lymphatic duct.
  - Source: You see your tumor cells are here, and then
  - Rewrite: none
- **7**, distortion: The rewrite changes the term 'circumspect' to 'circumscribed'. Although it is likely what the lecturer meant, substituting a different term that changes the literal wording to make the statement complete/clear is a forbidden distortion.
  - Source: circumspect
  - Rewrite: circumscribed
- **8**, distortion: The text uses the ambiguous pronoun 'it's', which could refer to invasion or malignancy. The rewrite makes this unclear statement clear by specifying 'malignancy'.
  - Source: So it's defined as the ability to invade the surrounding tissue.
  - Rewrite: and malignancy is defined as the ability to invade the surrounding tissue.
- **8**, omission: The rewrite omits the limitation regarding 'what that looks like' when discussing the biopsy.
  - Source: and what that looks like.
  - Rewrite: The diagnosis is limited by where the biopsy is taken.
- **8**, unsourced-addition: The text places two statements next to each other. The rewrite links them with 'because', stating a causal link not explicitly given in the text.
  - Source: but many of them never metastasize. They never survive in the secondary site.
  - Rewrite: Many never metastasise, because they never survive at the secondary site.
- **8**, unsourced-addition: The rewrite turns the pointing word 'this' into the description 'Invasion', which the lecturer did not give.
  - Source: So this is probably an obligatory step
  - Rewrite: Invasion is therefore probably an obligatory step
- **8**, unsourced-addition: The rewrite turns the pointing word 'this' into the description 'a lesion', which the lecturer did not give.
  - Source: because this is not necessarily an adenoma
  - Rewrite: because a lesion is not necessarily an adenoma
- **8**, unsourced-addition: The rewrite turns the pointing phrase 'over here' into the description 'Elsewhere in the same lesion', which the lecturer did not give.
  - Source: You'll see that over here you have the adenoma
  - Rewrite: Elsewhere in the same lesion is the adenoma
- **9**, distortion: The rewrite changes the specific subject 'this meningioma' to a general subject 'A meningioma', which widens the scope of the claim from a specific instance to meningiomas in general.
  - Source: So this meningioma obviously is occurring within the skull.
  - Rewrite: A meningioma occurs within the skull,

### gemini-3.8-flash c3: 0 faults outside the key



### gemini-3.8-flash c4: 9 faults outside the key

- **11**, unsourced-addition: The rewrite inserts the causal word 'therefore' to link the small size of the niche to the tumour interfering with the bone marrow, whereas the text merely places the two statements next to each other without explicitly stating that one causes the other.
  - Source: This niche is not very big. This will interfere with your bone marrow
  - Rewrite: This niche is not very big. The tumour will therefore interfere with the bone marrow
- **12**, unsourced-addition: The rewrite turns the lecturer's pointing word 'this' into the specific description 'A further slide', which the lecturer did not state.
  - Source: And then this is, if you like, the percentage of tumors that result in deaths.
  - Rewrite: A further slide shows the percentage of tumours that result in deaths.
- **15**, unsourced-addition: The rewrite states that the cervix is seen 'alongside' the endocervical canal, turning the lecturer's deictic gesture ('here') into a specific spatial description not given in the spoken text.
  - Source: Histologically, this is the endocervical canal here, and so you're looking at the cervix here.
  - Rewrite: and the cervix is seen alongside it.
- **3**, unsourced-addition: The rewrite turns the lecturer's pointing words ('here now') into a description of the slide ('In the image of the invasive tissue') that the lecturer did not provide.
  - Source: And you can see here now the cells are all of different shapes and sizes.
  - Rewrite: In the image of the invasive tissue, the cells are of different shapes and sizes.
- **4**, unsourced-addition: The rewrite links the slice through a tumour to the previous statement by claiming it 'illustrates this' (i.e. explanting the tumour), whereas the text merely mentions explanting tumours and then describes what is shown on the slide without linking the two as an illustration.
  - Source: So the other thing to appreciate is that when, if you like, biologists are studying tumors, often they will explant the tumor. Here you're looking at a slice through a tumor and a stain to look at the morphology.
  - Rewrite: Biologists studying tumours often explant the tumour. A slice through a tumour, with a stain to show the morphology, illustrates this [FIGURE].
- **8**, distortion: The lecturer says 'So it's defined as...', leaving the referent of 'it' ambiguous between 'invasion' and 'malignancy'. The rewrite resolves this unclear statement by specifying that 'malignancy' is defined as the ability to invade surrounding tissue.
  - Source: So invasion and malignancy are really, really important diagnostically. So it's defined as the ability to invade the surrounding tissue.
  - Rewrite: Invasion and malignancy are very important diagnostically, and malignancy is defined as the ability to invade the surrounding tissue.
- **8**, unsourced-addition: The text merely places two statements next to each other ('many of them never metastasize. They never survive in the secondary site.'). The rewrite adds the causal conjunction 'because', creating an explicit causal link that the text did not state.
  - Source: many of them never metastasize. They never survive in the secondary site.
  - Rewrite: Many never metastasise, because they never survive at the secondary site.
- **8**, unsourced-addition: The rewrite replaces the lecturer's pointing word 'this' with 'Invasion', adding a specific description that the lecturer did not state.
  - Source: So this is probably an obligatory step in getting to having a malignant metastasizing tumor.
  - Rewrite: Invasion is therefore probably an obligatory step in arriving at a malignant, metastasising tumour.
- **8**, unsourced-addition: The rewrite turns the lecturer's pointing phrase 'over here' into the descriptive phrase 'Elsewhere in the same lesion', asserting that it is part of the same lesion, which the lecturer did not specify.
  - Source: You'll see that over here you have the adenoma which has progressed into an adenocarcinoma.
  - Rewrite: Elsewhere in the same lesion is the adenoma, which has progressed into an adenocarcinoma

### gpt-5.6-sol-pro c3: 0 faults outside the key



### gemini-3.1-pro, c2 (pipeline): 9 faults outside the key

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

### terra-pro, c2 (pipeline): 18 faults outside the key

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
