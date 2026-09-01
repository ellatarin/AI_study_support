# Transcript verification

Verdict **fail**, coverage **74/100**, **9 findings**.

## Findings by category

| Category | Findings |
| --- | --- |
| Distortion | 1 |
| Omission | 8 |

## Findings

### Distortion

#### Major — The structured version asserts that biliary obstruction leads to 'liver failure'. The transcript says it 'interferes with digestion'. In the transcript, 'liver failure' is explicitly linked to 'secondary metastases colonizing organs all over the body' in the mortality section. Attributing liver failure to bile duct obstruction is a clinically distinct and unsupported mechanistic shift.

- **In the structured transcript:** Morbidity and Mortality in Cancer -> Luminal obstruction
- **In the source:** Morbidity and mortality section; approx 37:00-39:00.

> Things like obstruction of the bile ducts in the liver interferes with digestion... So when the tumor has spread all throughout the body, you can get things like liver failure.

**Suggested fix:** Correct the bullet point to state biliary obstruction leads to digestive interference/malabsorption. Move 'liver failure' to the section on metastatic disease/colonization of distant organs.

### Omission

#### Major — Lost the specific 'clear margins' concept. The transcript explicitly states this is a key diagnostic goal for histopathologists during biopsy/excision to ensure the entire tumor is removed.

- **In the structured transcript:** Benign vs Malignant Tumours: Invasion and Metastasis or Case Study: Colorectal Cancer Progression
- **In the source:** After colorectal invasion discussion; approx 28:15.

> You'll also hear about looking for clear margins around any kind of biopsy, to see that you have lifted out the entire tumor.

**Suggested fix:** Add a note under the benign vs malignant or colorectal case study section explaining that histopathologists assess 'clear margins' to confirm complete tumor excision.

#### Major — Lost the critical caveat regarding the limitations of biopsy sampling. The transcript emphasizes that because you cannot biopsy the whole body, missing metastases is common unless there are other physical signs, and finding widespread metastases at initial biopsy usually implies missed prior sampling.

- **In the structured transcript:** Benign vs Malignant Tumours: Invasion and Metastasis
- **In the source:** Invasion/Metastasis discussion and Colorectal progression; approx 23:30 and 28:00.

> ...you wouldn't be sampling all over the body, so it might be difficult to necessarily find all of the possible secondary tumors unless there is some other physical sign... by the time you get secondary metastases in other sites... that is probably you've missed something in terms of the sampling.

**Suggested fix:** Add a caveat under the Invasion and Metastasis section: clinical biopsy is spatially limited; absence of metastasis in a sample does not rule it out, and widespread metastasis at presentation often indicates prior undetected progression.

#### Major — Lost the geographical/ethnic incidence data. The transcript highlights that liver and nasopharyngeal carcinomas are prevalent in Chinese populations (with an infectious component to liver cancer), which is a key epidemiological teaching point.

- **In the structured transcript:** Comparative Oncology and Tumour Incidence
- **In the source:** Incidence/Epidemiology section; approx 34:45.

> ...liver cancer and nasopharyngeal carcinomas are very big in Chinese populations. There's also a large infectious element to liver cancer.

**Suggested fix:** Add a bullet point in the incidence section noting geographical variations, specifically high rates of liver and nasopharyngeal cancers in Chinese populations and the infectious etiology of liver cancer.

#### Major — Lost the 'four horsemen' mnemonic and the specific clinical context that patients typically make 3-5 visits before diagnosis due to vague symptoms.

- **In the structured transcript:** Clinical Detection and Screening Strategies
- **In the source:** Clinical Detection intro; approx 36:15.

> I call this the four horsemen. You show up with something that's itchy, crusty, lumpy, or bloody... patients are usually making three or four or five visits before a diagnosis is made...

**Suggested fix:** Include the 'itchy, crusty, lumpy, or bloody' signs (optionally referencing the 'four horsemen' mnemonic) and the statistic that vague symptoms often lead to 3-5 clinical visits before diagnosis.

#### Minor — Omitted the statistic that mesenchymal malignant tumors (sarcomas) are extremely rare, occur primarily in adolescence/young adulthood, and progress quickly.

- **In the structured transcript:** Comparative Oncology and Tumour Incidence or Tumour Nomenclature and Classification
- **In the source:** Incidence section; approx 33:45.

> But malignant tumors, for example, originating from mesenchymal lineage cell types, they're extremely rare... usually occur in young adulthood... progress very quickly, and they're lethal.

**Suggested fix:** Add a note under the incidence or nomenclature section that mesenchymal malignancies are rare, typically present in young adulthood, and are aggressive.

#### Minor — Lost the visual diagnostic details for adenocarcinoma cells invading muscle: they retain markers of muscle cells but not all, indicating partial dedifferentiation.

- **In the structured transcript:** Benign vs Malignant Tumours: Invasion and Metastasis -> Leiomyosarcoma
- **In the source:** Leiomyosarcoma vs fibroid comparison; approx 20:30.

> ...these tumor cells have some of the markers of muscle cells, but not all of them, so they're considered to have dedifferentiated slightly in terms of their phenotype.

**Suggested fix:** Clarify in the Leiomyosarcoma description that invading cells show partial dedifferentiation, retaining some but not all muscle markers.

#### Minor — Omitted the explanation of why colonic polyps take on a 'cauliflower' shape (mechanical pulling by peristalsis).

- **In the structured transcript:** Case Study: Colorectal Cancer Progression -> Polyp / Adenoma
- **In the source:** Colorectal case study; approx 25:45.

> ...the polyp is pulled out off of the surface through the action of peristalsis in the bowel as food moves through it.

**Suggested fix:** Add a brief phrase noting the polyp's stalked/cauliflower shape results from mechanical traction by bowel peristalsis.

#### Minor — Lost the specific clinical nuance that cervical cancer mortality declines have primarily benefited older women, while younger population rates haven't changed much, with deaths now concentrated in those declining screening or lost to follow-up.

- **In the structured transcript:** Clinical Detection and Screening Strategies -> Cervical Cancer Screening
- **In the source:** Cervical screening results; approx 42:15.

> ...rates of death in cervical cancer came down, particularly amongst older women... hasn't changed much for the younger populations... women that are still dying... either are not followed up... or that have declined screening...

**Suggested fix:** Refine the cervical screening outcome to specify that mortality reduction is most pronounced in older women, and current deaths largely involve patients lost to follow-up or declining screening.

## Considered and not raised

The checker examined and cleared **5 passages**.

- *"Simplicity can help frame our thinking, but it will also end up losing a lot of details... [chuckles]... Whoops. I'll just skip forward... Oops. Oh, God. It doesn't go backwards."* — Throughout transcript.. Admin chatter, slide navigation errors, and meta-commentary on diagram simplicity are non-content and correctly excluded.
- *"...tas instead of metastasis, which I do frequently."* — Metastasis definition; approx 17:45.. Lecturer aside regarding personal pronunciation habit. No conceptual loss.
- *"And this is my cat, who also ended up with a feline injection site sarcoma... You'll be happy to hear he's doing fine now after his surgery."* — Comparative oncology; approx 35:30.. Personal anecdote about the lecturer's cat. The core concept (feline injection-site sarcomas associated with adjuvants) is preserved in the structured version.
- *"Primary cells really don't grow in culture... ethical practices were different at the time..."* — Cell culture section; approx 14:30.. Compressed but intact. The structured version captures the failure of primary cells to grow, the surprise of HeLa, the 1950s timeframe, and the lack of modern consent.
- *"Breast screening... about a third of those cases are unnecessary treatment... PSA... not a very, very good test..."* — Screening limitations; approx 43:30-44:30.. Preserved. The structured version accurately captures the ~1/3 overtreatment rate for breast screening and the poor specificity/indolent disease issue for PSA.
