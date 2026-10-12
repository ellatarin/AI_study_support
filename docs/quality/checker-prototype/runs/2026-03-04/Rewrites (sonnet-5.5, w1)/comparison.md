# Checks of Rewrites (sonnet-5.5, w1), lecture 2026-03-04

| Checker | Faults | Subtopics failed | Subtopics checked | Faults that matter found | Cost |
| --- | --- | --- | --- | --- | --- |
| gemini-3.1-pro-preview c3 | 4 | 3 | 17 | 2 of 7 | $0.68 |
| gemini-3.1-pro-preview c4 | 57 | 14 | 17 | 6 of 7 | $1.48 |
| gemini-3.8-flash c3 | 2 | 2 | 17 | 1 of 7 | $0.12 |
| gemini-3.8-flash c4 | 20 | 10 | 17 | 5 of 7 | $0.32 |
| gemini-3.8-flash c4 by paragraph | 55 | 15 | 17 | 5 of 7 | $0.70 |
| gemini-3.8-flash c4 by paragraph run 2 | 51 | 14 | 17 | 5 of 7 | $0.69 |
| gemini-3.8-flash c4 by paragraph run 3 | 53 | 15 | 17 | 5 of 7 | $0.66 |
| gemini-3.8-flash c4 run 2 | 20 | 10 | 17 | 5 of 7 | $0.33 |
| gemini-3.8-flash c4 run 3 | 18 | 9 | 17 | 5 of 7 | $0.11 |
| gemini-3.8-flash c5 | 25 | 13 | 17 | 4 of 7 | $0.39 |
| gemini-3.8-flash c5 run 2 | 16 | 8 | 17 | 3 of 7 | $0.29 |
| gemini-3.8-flash c5 run 3 | 13 | 9 | 17 | 4 of 7 | $0.28 |
| gemini-3.8-flash c6 | 17 | 9 | 17 | 4 of 7 | $0.34 |
| gemini-3.8-flash c6 run 2 | 20 | 10 | 17 | 4 of 7 | $0.32 |
| gemini-3.8-flash c6 run 3 | 18 | 11 | 17 | 6 of 7 | $0.29 |
| gemini-3.8-flash c7 | 9 | 6 | 17 | 4 of 7 | $0.36 |
| gemini-3.8-flash c7 run 2 | 10 | 6 | 17 | 4 of 7 | $0.33 |
| gemini-3.8-flash c7 run 3 | 8 | 6 | 17 | 3 of 7 | $0.35 |
| gpt-5.6-sol-pro c3 | 13 | 10 | 17 | 2 of 7 | $1.17 |
| gemini-3.1-pro, c2 (pipeline) | 24 | 8 | 17 | 4 of 7 | $1.33 |
| gemini-3.8-flash, c2 (pipeline) | 8 | 4 | 17 | 2 of 7 | $0.34 |
| gemini-3.8-flash, c3 (pipeline) | 1 | 1 | 17 | 0 of 7 | $0.15 |
| sol-pro, c2 (pipeline) | 36 | 15 | 17 | 5 of 7 | $2.31 |
| sonnet-5.5, c2 (pipeline) | 4 | 4 | 17 | 0 of 7 | $0.53 |
| terra-pro, c2 (pipeline) | 42 | 13 | 14 | 3 of 7 | $2.72 |

## Faults that matter

| Fault | gemini-3.1-pro-preview c3 | gemini-3.1-pro-preview c4 | gemini-3.8-flash c3 | gemini-3.8-flash c4 | gemini-3.8-flash c4 by paragraph | gemini-3.8-flash c4 by paragraph run 2 | gemini-3.8-flash c4 by paragraph run 3 | gemini-3.8-flash c4 run 2 | gemini-3.8-flash c4 run 3 | gemini-3.8-flash c5 | gemini-3.8-flash c5 run 2 | gemini-3.8-flash c5 run 3 | gemini-3.8-flash c6 | gemini-3.8-flash c6 run 2 | gemini-3.8-flash c6 run 3 | gemini-3.8-flash c7 | gemini-3.8-flash c7 run 2 | gemini-3.8-flash c7 run 3 | gpt-5.6-sol-pro c3 | gemini-3.1-pro, c2 (pipeline) | gemini-3.8-flash, c2 (pipeline) | gemini-3.8-flash, c3 (pipeline) | sol-pro, c2 (pipeline) | sonnet-5.5, c2 (pipeline) | terra-pro, c2 (pipeline) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2.1 | no | yes | no | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | no | no | no | yes | no | no |
| 2.2 | no | yes | no | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | no | yes | yes | no | no | yes | no | yes |
| 3.4 | no | yes | no | no | yes | yes | yes | no | no | no | no | no | no | no | yes | no | no | no | no | yes | yes | no | yes | no | no |
| 7.1 | yes | yes | no | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | no | yes | yes | no | yes | no | yes |
| 15.1 | no | no | no | no | no | no | no | no | no | no | no | no | no | no | no | no | no | no | no | no | no | no | yes | no | yes |
| 11.A | yes | yes | yes | yes | no | no | no | yes | yes | no | no | no | yes | yes | yes | yes | yes | yes | no | yes | no | no | no | no | no |
| 4.A | no | yes | no | yes | yes | yes | yes | yes | yes | yes | no | yes | no | no | yes | no | no | no | no | no | no | no | no | no | no |

## Faults outside the key

### gemini-3.1-pro-preview c3: 0 faults outside the key



### gemini-3.1-pro-preview c4: 0 faults outside the key



### gemini-3.8-flash c3: 0 faults outside the key



### gemini-3.8-flash c4: 0 faults outside the key



### gemini-3.8-flash c4 by paragraph: 14 faults outside the key

- **1**, unsourced-addition: The rewrite specifies that there are six lectures in total ('three of the six'), which is not stated in the text.
  - Source: she will also be teaching three of these lectures.
  - Rewrite: three of the six.
- **10**, distortion: In the source text, 'within the lymph nodes, within those structures' is an apposition or clarifying repetition referring to the lymph nodes. The rewrite inserts 'and' ('within the lymph nodes and those structures'), treating 'those structures' as an additional, separate location alongside the lymph nodes.
  - Source: within the lymph nodes, within those structures
  - Rewrite: within the lymph nodes and those structures
- **12**, unsourced-addition: The rewrite specifies that the numbers give a sense of 'incidence', which the text does not state.
  - Source: So I've just put these numbers up just so that you can have a sense.
  - Rewrite: give a sense of incidence
- **14**, unsourced-addition: The rewrite specifies 'cancer', turning the lecturer's word 'this' into a specific disease description that is not mentioned in the source text (which only refers to 'a tumor' and 'tumors').
  - Source: Okay, so what does this look like in the clinic? [chuckles] I call this the four horsemen.
  - Rewrite: the presentation of cancer can be summarised as the "four horsemen":
- **14**, unsourced-addition: The rewrite introduces a causal link ('For this reason') where the source text only indicates reflection or a conversational transition ('So in thinking about this').
  - Source: So in thinking about this
  - Rewrite: For this reason
- **15**, unsourced-addition: The rewrite replaces the pointing word 'this' with 'Screening', a description that the lecturer did not give.
  - Source: So this, as I said, is a success story.
  - Rewrite: Screening is a success story.
- **2**, unsourced-addition: The rewrite adds 'therefore', establishing a causal or consequential link between previous points and the occurrence of many changes, whereas the source text only uses 'So' as a conversational discourse marker.
  - Source: So there's a lot of changes that occur
  - Rewrite: Many changes therefore occur
- **7**, distortion: The text refers singular/generically to 'what this looks like for the patient', whereas the rewrite changes this to plural 'these tumours', introducing a reference to multiple specific tumours.
  - Source: what this looks like for the patient
  - Rewrite: what these tumours look like for the patient
- **8**, unsourced-addition: The rewrite turns the lecturer's pointing word 'here' into the description 'In the slice', which the lecturer did not give (the lecturer refers to a 'slide', not a 'slice').
  - Source: So, if you have a look here, so again, this is that cauliflower head kind of poking out here.
  - Rewrite: In the slice, the cauliflower head pokes out
- **8**, omission: The rewrite omits the causal link explaining that the muscularis mucosae is used as a proxy for the basement membrane because it lies directly underneath the epithelium.
  - Source: So for our purposes, what we're going to use is the muscularis mucosa here as our proxy for the basement membrane, because here is your normal epithelium and the muscularis mucosa, which would be the, if you like, the thin line of musculature that occurs underneath the epithelium.
  - Rewrite: For this purpose the muscularis mucosae is used as a proxy for the basement membrane. The muscularis mucosae is the thin line of musculature that occurs underneath the epithelium.
- **8**, distortion: The lecturer's phrase 'before we get there' is unclear (it could refer to reaching that topic in the lecture or reaching the malignant stage in the disease progression) and functions adverbially ('we need to study therefore... before we get there'). The rewrite resolves this ambiguity by specifying 'before malignancy' and attaching it as an adjectival modifier to the stages ('stages before malignancy').
  - Source: So we need to study therefore what these stages look like before we get there.
  - Rewrite: The appearance of these stages before malignancy must therefore be studied.
- **8**, unsourced-addition: The rewrite uses 'so that' to state a result link between cutting the section through the tumour and the stalk and head being visible, whereas the original text merely places the two statements consecutively without stating a link.
  - Source: this is kind of, again, an H&E section now cut this way through the tumor. You can see the stalk here and the head of the cauliflower here.
  - Rewrite: The H&E section is cut through the tumour so that the stalk and the head of the cauliflower are visible.
- **8**, unsourced-addition: The rewrite states that the submucosa 'lies beneath' the muscularis mucosae, turning the lecturer's pointing word ('here') into a spatial description that the lecturer did not give.
  - Source: The submucosa is here
  - Rewrite: the submucosa lies beneath it
- **8**, unsourced-addition: The text refers only to 'the little one', but the rewrite introduces the specific noun 'polyp', which is not mentioned in the source text.
  - Source: What about the little one that was next to it?
  - Rewrite: The smaller polyp next to it

### gemini-3.8-flash c4 by paragraph run 2: 13 faults outside the key

- **1**, unsourced-addition: The rewrite states that Professor Turner teaches three of 'the six' lectures, specifying a total number of lectures that is not mentioned in the source text.
  - Source: and so she will also be teaching three of these lectures.
  - Rewrite: who teaches three of the six.
- **12**, unsourced-addition: The text only says the numbers are provided so that students 'can have a sense', without specifying what metric the numbers measure. Adding 'of incidence' introduces a specific epidemiological concept not stated in the source.
  - Source: So I've just put these numbers up just so that you can have a sense.
  - Rewrite: The numbers shown give a sense of incidence,
- **14**, unsourced-addition: The lecturer refers to 'this' ('what does this look like in the clinic? ... I call this the four horsemen'), which the rewrite interprets and expands into 'the presentation of cancer', introducing a specific description and the term 'cancer' not found in the source text (which only mentions tumours).
  - Source: Okay, so what does this look like in the clinic? [chuckles] I call this the four horsemen.
  - Rewrite: the presentation of cancer can be summarised as the "four horsemen"
- **15**, unsourced-addition: The rewrite replaces the lecturer's pointing word 'this' with the description 'Screening', which was not specified at this point in the source text.
  - Source: So this, as I said, is a success story.
  - Rewrite: Screening is a success story.
- **2**, unsourced-addition: The rewrite adds the causal adverb 'therefore', creating a causal link to an unstated prior event or cause, whereas the source text only uses 'So' as a conversational sentence opener.
  - Source: So there's a lot of changes that occur
  - Rewrite: Many changes therefore occur
- **4**, distortion: In the source text, 'So' links the surprise to the preceding fact that primary cells do not grow in culture ('Primary cells really don't grow in culture. So when HeLa cells... did that, this was very much a surprise'). In the rewrite, 'and so' connects the surprise directly to HeLa cells being the first tumour cells to grow in culture, changing the stated cause of the surprise.
  - Source: Primary cells really don't grow in culture. So when HeLa cells, which were the first tumor cells to grow in culture, did that, this was very much a surprise.
  - Rewrite: Primary cells do not grow in culture. HeLa cells were the first tumour cells to grow in culture, and so this was very much a surprise.
- **5**, distortion: The text uses the pronoun 'it' without an antecedent in the excerpt, leaving the referent unclear. The rewrite resolves this by specifying 'a tumour', choosing one specific reading of an unclear statement.
  - Source: So when it becomes immovable, these malignant cells
  - Rewrite: When a tumour becomes immovable, its malignant cells
- **8**, unsourced-addition: The rewrite adds 'In the slice', turning the lecturer's pointing gesture ('here') into a descriptive term ('slice') not mentioned in the source text.
  - Source: So, if you have a look here, so again, this is that cauliflower head kind of poking out here.
  - Rewrite: In the slice, the cauliflower head pokes out
- **8**, omission: The rewrite omits the causal link ('because'), which explains that the muscularis mucosae serves as a proxy for the basement membrane because it is situated directly underneath the normal epithelium.
  - Source: So for our purposes, what we're going to use is the muscularis mucosa here as our proxy for the basement membrane, because here is your normal epithelium and the muscularis mucosa, which would be the, if you like, the thin line of musculature that occurs underneath the epithelium.
  - Rewrite: For this purpose the muscularis mucosae is used as a proxy for the basement membrane. The muscularis mucosae is the thin line of musculature that occurs underneath the epithelium.
- **8**, distortion: The rewrite resolves the ambiguous phrase 'before we get there' (which could refer to before reaching that topic in the lecture) to mean 'before malignancy', turning an informal pointing word into a specific description.
  - Source: before we get there
  - Rewrite: before malignancy
- **8**, unsourced-addition: The rewrite introduces a result or purpose link ('so that') between the section being cut through the tumour and the stalk and head being visible, but the text merely juxtaposes the two observations without stating a link.
  - Source: this is kind of, again, an H&E section now cut this way through the tumor. You can see the stalk here and the head of the cauliflower here.
  - Rewrite: The H&E section is cut through the tumour so that the stalk and the head of the cauliflower are visible.
- **8**, unsourced-addition: The rewrite adds that the submucosa 'lies beneath' the muscularis mucosae, turning the lecturer's deictic pointing word ('here') into a spatial description that was not stated.
  - Source: The submucosa is here
  - Rewrite: the submucosa lies beneath it
- **8**, unsourced-addition: The rewrite specifies that the entity is a 'polyp', which is not mentioned in the source text.
  - Source: What about the little one that was next to it?
  - Rewrite: The smaller polyp next to it looks the same.

### gemini-3.8-flash c4 by paragraph run 3: 17 faults outside the key

- **1**, unsourced-addition: The text states that Professor Turner will be teaching three of the lectures, but does not state the total number of lectures. The rewrite specifies that there are six lectures in total ('three of the six').
  - Source: she will also be teaching three of these lectures
  - Rewrite: three of the six
- **10**, distortion: In the source text, 'within those structures' is an appositive repetition of 'within the lymph nodes'. The rewrite joins them with 'and' ('within the lymph nodes and those structures'), distorting the appositive restatement into a conjunction that suggests lymphomas occur in lymph nodes plus other structures.
  - Source: within the lymph nodes, within those structures.
  - Rewrite: within the lymph nodes and those structures.
- **12**, unsourced-addition: The rewrite states that the numbers give a sense 'of incidence', but the text only says they give 'a sense' without specifying incidence.
  - Source: So I've just put these numbers up just so that you can have a sense.
  - Rewrite: The numbers shown give a sense of incidence
- **14**, unsourced-addition: The rewrite introduces 'cancer', which is not mentioned in the source passage; the lecturer only speaks generally of 'this' and later refers to 'tumours'.
  - Source: what does this look like in the clinic? [chuckles] I call this the four horsemen.
  - Rewrite: the presentation of cancer can be summarised as the "four horsemen"
- **14**, unsourced-addition: The phrase 'For this reason' introduces a causal link that is not present in the original text, which merely framed the upcoming thought ('in thinking about this') rather than stating that 'this' is the reason for the action.
  - Source: So in thinking about this
  - Rewrite: For this reason
- **15**, unsourced-addition: The rewrite replaces the pointing word 'this' with 'Screening', a description that the lecturer did not provide here.
  - Source: So this, as I said, is a success story.
  - Rewrite: Screening is a success story.
- **2**, unsourced-addition: The rewrite adds 'therefore', stating a causal link for why many changes occur, whereas the source text only used 'So' as an introductory discourse marker.
  - Source: So there's a lot of changes that occur
  - Rewrite: Many changes therefore occur
- **3**, unsourced-addition: The rewrite specifies that histology is one of these 'tools', adding a noun and classification not present in the source text, which only states 'one of them'.
  - Source: So histology being one of them, of course.
  - Rewrite: Histology is one of these tools.
- **5**, distortion: The text uses the pronoun 'it' without specifying what becomes immovable, whereas the rewrite makes this complete by specifying 'a tumour'.
  - Source: So when it becomes immovable
  - Rewrite: When a tumour becomes immovable
- **7**, distortion: The lecturer refers generally to 'what this looks like for the patient', whereas the rewrite specifies 'what these tumours look like for the patient', resolving an unclear singular reference into a plural description of tumours.
  - Source: to contrast what this looks like for the patient
  - Rewrite: To contrast what these tumours look like for the patient
- **7**, omission: The rewrite omits the detail that sampling the adjacent lymph node occurs 'very often'.
  - Source: very often
  - Rewrite: the adjacent lymph node might be sampled
- **8**, unsourced-addition: The lecturer uses pointing words ('here'), but the rewrite turns this into the unstated description 'In the slice'.
  - Source: So, if you have a look here, so again, this is that cauliflower head kind of poking out here.
  - Rewrite: In the slice, the cauliflower head pokes out
- **8**, omission: The rewrite omits the causal link explaining why the muscularis mucosae is used as a proxy for the basement membrane (the lecturer states this is because it is the thin layer of musculature situated directly underneath the epithelium).
  - Source: because here is your normal epithelium and the muscularis mucosa, which would be the, if you like, the thin line of musculature that occurs underneath the epithelium.
  - Rewrite: For this purpose the muscularis mucosae is used as a proxy for the basement membrane. The muscularis mucosae is the thin line of musculature that occurs underneath the epithelium.
- **8**, distortion: The hedge 'for us' is removed, converting a qualified scientific claim about what the muscularis mucosae represents into an unqualified factual statement.
  - Source: which represents for us the basement membrane
  - Rewrite: which represents the basement membrane
- **8**, unsourced-addition: The conjunction 'so that' introduces a purposive or causal link between the section cut and the visibility of the stalk and head, whereas the source text merely places the two observations next to each other.
  - Source: this is kind of, again, an H&E section now cut this way through the tumor. You can see the stalk here and the head of the cauliflower here
  - Rewrite: The H&E section is cut through the tumour so that the stalk and the head of the cauliflower are visible.
- **8**, unsourced-addition: The rewrite turns the lecturer's pointing word ('here') into a spatial description ('lies beneath it') that was not stated in the spoken text.
  - Source: The submucosa is here
  - Rewrite: the submucosa lies beneath it
- **8**, unsourced-addition: The rewrite identifies 'the little one' as a 'polyp', which is not stated in the source text.
  - Source: What about the little one that was next to it?
  - Rewrite: The smaller polyp next to it

### gemini-3.8-flash c4 run 2: 1 fault outside the key

- **12**, distortion: The text leaves 'just so that you can have a sense' incomplete without specifying what the sense is of; the rewrite completes the statement by specifying 'of incidence'.
  - Source: So I've just put these numbers up just so that you can have a sense.
  - Rewrite: The numbers shown give a sense of incidence

### gemini-3.8-flash c4 run 3: 0 faults outside the key



### gemini-3.8-flash c5: 0 faults outside the key



### gemini-3.8-flash c5 run 2: 0 faults outside the key



### gemini-3.8-flash c5 run 3: 1 fault outside the key

- **2**, unsourced-addition: The rewrite adds 'therefore', introducing a causal/consequential link between the preceding statements and the occurrence of many changes, whereas the source text uses 'So' as a conversational transition.
  - Source: So there's a lot of changes that occur
  - Rewrite: Many changes therefore occur

### gemini-3.8-flash c6: 0 faults outside the key



### gemini-3.8-flash c6 run 2: 0 faults outside the key



### gemini-3.8-flash c6 run 3: 0 faults outside the key



### gemini-3.8-flash c7: 0 faults outside the key



### gemini-3.8-flash c7 run 2: 0 faults outside the key



### gemini-3.8-flash c7 run 3: 0 faults outside the key



### gpt-5.6-sol-pro c3: 0 faults outside the key



### gemini-3.1-pro, c2 (pipeline): 0 faults outside the key



### gemini-3.8-flash, c2 (pipeline): 0 faults outside the key



### gemini-3.8-flash, c3 (pipeline): 0 faults outside the key



### sol-pro, c2 (pipeline): 0 faults outside the key



### sonnet-5.5, c2 (pipeline): 0 faults outside the key



### terra-pro, c2 (pipeline): 0 faults outside the key


