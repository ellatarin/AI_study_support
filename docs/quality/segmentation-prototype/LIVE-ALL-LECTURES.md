# Live retitling and grouping, every lecture, against the prototype

Live: `retitle-subtopics` then `define-topics` (panel of 9, bar 5), 3 October 2026. Prototype: the `r9` titles and the grouping `choose_panel.py` chooses from `g23` Sol Pro runs 1–4 (30 September), on the same divisions.
"Apart" counts topic starts one chosen grouping has and the other does not. Rulings columns read matches / missed / against; — where the lecture has no rulings.

| Lecture | Subtopics | Titles identical | Title word overlap | Live topic starts | Prototype topic starts | Apart | Live support | Live groupings | Live vs rulings | Prototype vs rulings |
|---|---|---|---|---|---|---|---|---|---|---|
| l1 | 16 | 9 | 0.81 | 1,2,5,7,9,11,12,13,14,16 | 1,2,5,7,9,11,12,13,14,16 | 0 | 5 of 9 | 2 | no / - / 5,7,11,12,14 | no / - / 5,7,11,12,14 |
| l2 | 15 | 2 | 0.74 | 1,2,5,9,12,13,14,15 | 1,2,3,4,9,12,13,14,15 | 3 | 9 of 9 | 1 | — / — / — | — / — / — |
| l3 | 17 | 5 | 0.75 | 1,2,5,8,10,11,12,14,17 | 1,2,3,5,8,10,11,12,14,17 | 1 | 6 of 9 | 2 | no / - / 8 | no / - / 3,8 |
| l4 | 22 | 11 | 0.80 | 1,2,4,7,9,14,16,18,20,22 | 1,2,4,7,9,14,16,18,22 | 1 | 7 of 9 | 2 | no / - / 16,20 | no / - / 16 |
| l5 | 17 | 9 | 0.87 | 1,2,4,5,8,12,14,15,17 | 1,2,4,5,8,12,14,15,17 | 0 | 5 of 9 | 3 | no / - / 4,12,14,15 | no / - / 4,12,14,15 |
| l6 | 19 | 4 | 0.61 | 1,2,5,7,8,10,12,15,16,19 | 1,2,5,7,8,10,12,15,16,19 | 0 | 8 of 9 | 2 | no / - / 10 | no / - / 10 |
| l7 | 12 | 2 | 0.68 | 1,2,4,7,9,10,11,12 | 1,2,3,4,7,9,10,11,12 | 1 | 4 of 9 | 4 | — / — / — | — / — / — |
| l8 | 23 | 12 | 0.84 | 1,2,3,4,5,7,8,10,13,15,16,18,20,21,22 | 1,2,3,4,5,7,8,10,13,15,16,18,20,21,22 | 0 | 4 of 9 | 6 | — / — / — | — / — / — |

## Live run against the prototype: l1

### Subtopic titles

16 subtopics. The live run gave 9 the same title as the prototype's `r9` run.
Word overlap (shared words ÷ all words used by either title): mean 0.81. For scale, the titles before retitling overlap the prototype's by 0.37.

| # | Before retitling | Live | Prototype `r9` | Overlap |
|---|---|---|---|---|
| 1 | Lecture introduction and overview | Introduction to the initiation and resolution of inflammation | Introduction to the initiation and resolution of inflammation | 1.00 |
| 2 | Innate immune recognition via PAMPs and DAMPs | Innate immune recognition of PAMPs and DAMPs | Innate recognition of PAMPs and DAMPs by sentinel cells | 0.60 |
| 3 | Properties and examples of effective PAMPs | Properties of effective PAMPs and self–non-self discrimination | Properties of PAMPs that enable self–non-self discrimination | 0.60 |
| 4 | Genetic encoding and subcellular localization of PRRs | Germline encoding and cellular localisation of pattern recognition receptors | Germline encoding and cellular localisation of pattern recognition receptors | 1.00 |
| 5 | Toll-like receptors and their ligands | Toll-like receptors and their microbial ligands | Toll-like receptors: microbial recognition and immune activation | 0.50 |
| 6 | TLR signaling pathways and stress integration | Location-dependent TLR signalling and synergy with cellular stress | Compartment-specific TLR signalling and integration with cellular stress | 0.50 |
| 7 | Alternative PRR families: CLRs, RLRs, and NLRs | Other pattern recognition receptor families and NOD2 in Crohn's disease | Non-TLR pattern recognition receptors and inflammatory disease | 0.27 |
| 8 | The inflammasome and IL-1beta activation | Inflammasome assembly, IL-1β activation and chronic inflammation | Inflammasome assembly, IL-1β activation and chronic inflammation | 1.00 |
| 9 | Sentinel cell activation and systemic cytokine effects | Sentinel cell activation and local and systemic inflammatory effects | Sentinel cell activation and local versus systemic inflammatory effects | 0.89 |
| 10 | Leukocyte extravasation and chemokine migration | Leukocyte recruitment through adhesion, extravasation and chemotaxis | Leukocyte recruitment through adhesion, extravasation and chemotaxis | 1.00 |
| 11 | Lymphatic drainage and adaptive immune priming | Lymphatic drainage and dendritic cell migration for adaptive immune priming | Lymphatic drainage and dendritic cell migration for adaptive immune priming | 1.00 |
| 12 | Systemic inflammatory pathology: sepsis and septic shock | Excessive systemic inflammation and septic shock | Excessive systemic inflammation and septic shock | 1.00 |
| 13 | Passive and active resolution of inflammation | Passive and active mechanisms of inflammation resolution | Passive and active mechanisms of inflammation resolution | 1.00 |
| 14 | Tissue repair, scarring, and chronic inflammation | Tissue repair and causes of persistent inflammation | Tissue repair and causes of persistent inflammation | 1.00 |
| 15 | Protective role of granulomas in persistent infections | Granuloma formation as a strategy for containing persistent infection | Granuloma formation as a strategy for containing persistent infection | 1.00 |
| 16 | Lecture conclusion | Lecture close: introduction to the next lecture on complement | Lecture close: next lecture on complement | 0.62 |

### Grouping

Live choice: run 1, made by 5 of 9 runs, decided by most-runs.
Prototype choice (runs 1–4): run 1, most runs (4 of 4).

- Live chosen starts: 1,2,5,7,9,11,12,13,14,16 (10 topics)
- Prototype chosen starts: 1,2,5,7,9,11,12,13,14,16 (10 topics)
- Shared starts: 10; starts one has and the other does not: 0
- Ruled topic starts: 2,9,13,16

Every run, live and prototype. "Apart" counts topic starts the run has and the prototype's choice does not, or the reverse.

| Run | Topic starts | Topics | Apart from prototype choice | Matches rulings | Missed | Against ruling |
|---|---|---|---|---|---|---|
| live 1 | 1,2,5,7,9,11,12,13,14,16 | 10 | 0 | no | - | 5,7,11,12,14 |
| live 2 | 1,2,5,9,11,12,13,14,16 | 9 | 1 | no | - | 5,11,12,14 |
| live 3 | 1,2,5,7,9,11,12,13,14,16 | 10 | 0 | no | - | 5,7,11,12,14 |
| live 4 | 1,2,5,9,11,12,13,14,16 | 9 | 1 | no | - | 5,11,12,14 |
| live 5 | 1,2,5,9,11,12,13,14,16 | 9 | 1 | no | - | 5,11,12,14 |
| live 6 | 1,2,5,9,11,12,13,14,16 | 9 | 1 | no | - | 5,11,12,14 |
| live 7 | 1,2,5,7,9,11,12,13,14,16 | 10 | 0 | no | - | 5,7,11,12,14 |
| live 8 | 1,2,5,7,9,11,12,13,14,16 | 10 | 0 | no | - | 5,7,11,12,14 |
| live 9 | 1,2,5,7,9,11,12,13,14,16 | 10 | 0 | no | - | 5,7,11,12,14 |
| prototype 1 | 1,2,5,7,9,11,12,13,14,16 | 10 | 0 | no | - | 5,7,11,12,14 |
| prototype 2 | 1,2,5,7,9,11,12,13,14,16 | 10 | 0 | no | - | 5,7,11,12,14 |
| prototype 3 | 1,2,5,7,9,11,12,13,14,16 | 10 | 0 | no | - | 5,7,11,12,14 |
| prototype 4 | 1,2,5,7,9,11,12,13,14,16 | 10 | 0 | no | - | 5,7,11,12,14 |
| prototype 5 | 1,2,5,7,9,11,12,13,14,16 | 10 | 0 | no | - | 5,7,11,12,14 |

### Topic titles where both choices start a topic

| Starts at | Live | Prototype | Overlap |
|---|---|---|---|
| 1 | Introduction and lecture framing | Lecture introduction and framing | 1.00 |
| 2 | Principles of innate immune recognition | Principles of innate danger recognition | 0.67 |
| 5 | Toll-like receptor recognition and signalling | Toll-like receptor recognition and signalling | 1.00 |
| 7 | Non-TLR recognition pathways and inflammatory disease | Non-TLR pathways linking danger recognition to inflammation | 0.36 |
| 9 | Sentinel-driven inflammation and leukocyte recruitment | Sentinel-driven inflammation and leukocyte recruitment | 1.00 |
| 11 | Lymphatic transport and adaptive immune priming | Lymphatic transport and adaptive immune priming | 1.00 |
| 12 | Excessive systemic inflammation and septic shock | Excessive systemic inflammation and septic shock | 1.00 |
| 13 | Passive and active resolution of inflammation | Mechanisms of inflammation resolution | 0.43 |
| 14 | Tissue repair and persistent inflammation | Tissue repair and persistent inflammation | 1.00 |
| 16 | Lecture close and next lecture | Lecture close and next lecture | 1.00 |

## Live run against the prototype: l2

### Subtopic titles

15 subtopics. The live run gave 2 the same title as the prototype's `r9` run.
Word overlap (shared words ÷ all words used by either title): mean 0.74. For scale, the titles before retitling overlap the prototype's by 0.35.

| # | Before retitling | Live | Prototype `r9` | Overlap |
|---|---|---|---|---|
| 1 | Introduction to complement lecture | Introduction to complement and its complex nomenclature | Introduction to complement and its importance | 0.62 |
| 2 | Overview of complement and its primary roles | Overview of complement activation and effector functions | Overview of complement activation, immune defence and clearance functions | 0.60 |
| 3 | Complement nomenclature conventions | Complement numbering and cleavage fragment nomenclature | Complement nomenclature and its exceptions | 0.38 |
| 4 | Central role and activation mechanism of C3 | C3 activation, C3b surface binding and C3a inflammation | C3 activation, C3b surface attachment and C3a inflammation | 0.78 |
| 5 | The alternative pathway of complement activation | Three complement activation pathways and their timing | Three pathways of complement activation and their timing | 0.88 |
| 6 | the mechanism of the alternative pathway of complement activation | Alternative pathway initiation and surface amplification | Alternative pathway: spontaneous C3 activation and surface amplification | 0.56 |
| 7 | The lectin pathway of complement activation | Lectin pathway recognition and C3 convertase formation | Lectin pathway: microbial carbohydrate recognition and C3 convertase formation | 0.78 |
| 8 | The classical pathway and complement trigger threshold | Classical pathway activation and the local complement threshold | Classical pathway and the threshold for complement activation | 0.78 |
| 9 | Effector mechanisms: opsonization, inflammation, and membrane lysis | Complement-mediated opsonization and phagocytosis | Complement-mediated opsonization and phagocyte activation | 0.57 |
| 10 | Complement-mediated inflammation via C3a | C3a-mediated inflammation and cell recruitment | C3a-mediated inflammation and immune cell recruitment | 0.86 |
| 11 | Pathogen lysis via the membrane attack complex | Membrane attack complex assembly and pathogen lysis | Membrane attack complex assembly and pathogen lysis | 1.00 |
| 12 | Host cell regulation of complement activation | Complement regulation and protection of host cells | Complement regulation and protection of host cells | 1.00 |
| 13 | Clinical presentations of complement deficiencies | Clinical consequences of complement component deficiencies | Clinical consequences of complement component and regulator deficiencies | 0.75 |
| 14 | Pathogen evasion mechanisms and applications of protein A | Pathogen complement evasion and applications of staphylococcal protein A | Complement evasion by Staphylococcus aureus and applications of protein A | 0.58 |
| 15 | Lecture conclusion and next session preview | Lecture close: Transition to adaptive immunity | Lecture close: transition to adaptive immunity | 1.00 |

### Grouping

Live choice: run 1, made by 9 of 9 runs, decided by most-runs.
Prototype choice (runs 1–4): run 1, most runs (3 of 4).

- Live chosen starts: 1,2,5,9,12,13,14,15 (8 topics)
- Prototype chosen starts: 1,2,3,4,9,12,13,14,15 (9 topics)
- Shared starts: 7; starts one has and the other does not: 3
- Ruled topic starts: 

Every run, live and prototype. "Apart" counts topic starts the run has and the prototype's choice does not, or the reverse.

| Run | Topic starts | Topics | Apart from prototype choice | Matches rulings | Missed | Against ruling |
|---|---|---|---|---|---|---|
| live 1 | 1,2,5,9,12,13,14,15 | 8 | 3 | — | — | — |
| live 2 | 1,2,5,9,12,13,14,15 | 8 | 3 | — | — | — |
| live 3 | 1,2,5,9,12,13,14,15 | 8 | 3 | — | — | — |
| live 4 | 1,2,5,9,12,13,14,15 | 8 | 3 | — | — | — |
| live 5 | 1,2,5,9,12,13,14,15 | 8 | 3 | — | — | — |
| live 6 | 1,2,5,9,12,13,14,15 | 8 | 3 | — | — | — |
| live 7 | 1,2,5,9,12,13,14,15 | 8 | 3 | — | — | — |
| live 8 | 1,2,5,9,12,13,14,15 | 8 | 3 | — | — | — |
| live 9 | 1,2,5,9,12,13,14,15 | 8 | 3 | — | — | — |
| prototype 1 | 1,2,3,4,9,12,13,14,15 | 9 | 0 | — | — | — |
| prototype 2 | 1,2,5,9,12,13,14,15 | 8 | 3 | — | — | — |
| prototype 3 | 1,2,3,4,9,12,13,14,15 | 9 | 0 | — | — | — |
| prototype 4 | 1,2,3,4,9,12,13,14,15 | 9 | 0 | — | — | — |
| prototype 5 | 1,2,3,4,9,12,13,14,15 | 9 | 0 | — | — | — |

### Topic titles where both choices start a topic

| Starts at | Live | Prototype | Overlap |
|---|---|---|---|
| 1 | Introduction to the complement lecture | Introduction to the complement lecture | 1.00 |
| 2 | Complement cascade fundamentals and the central role of C3 | Overview of complement activation and functions | 0.25 |
| 9 | Complement effector mechanisms | Complement effector mechanisms | 1.00 |
| 12 | Complement regulation and host-cell protection | Complement regulation and host-cell protection | 1.00 |
| 13 | Clinical consequences of complement deficiencies | Clinical consequences of complement deficiencies | 1.00 |
| 14 | Pathogen complement evasion and protein A applications | Staphylococcus aureus complement evasion and protein A applications | 0.67 |
| 15 | Lecture close and transition to adaptive immunity | Lecture close and transition to adaptive immunity | 1.00 |

## Live run against the prototype: l3

### Subtopic titles

17 subtopics. The live run gave 5 the same title as the prototype's `r9` run.
Word overlap (shared words ÷ all words used by either title): mean 0.75. For scale, the titles before retitling overlap the prototype's by 0.36.

| # | Before retitling | Live | Prototype `r9` | Overlap |
|---|---|---|---|---|
| 1 | Course introduction and learning outcomes | Introduction to cancer biology and lecture learning outcomes | Introduction to cancer biology and lecture learning outcomes | 1.00 |
| 2 | Stepwise genetic and epigenetic changes in cancer | Accumulation of genetic and epigenetic changes in cancer development | Accumulation of genetic and epigenetic changes in cancer development | 1.00 |
| 3 | Cancer as a failure of cellular differentiation and tissue architecture | Cancer as a failure of differentiation and tissue architecture | Cancer as a failure of differentiation and tissue architecture | 1.00 |
| 4 | Culturing tumor cells in vitro and the limitations of 2D models | Tumour cell culture and the limitations of studying isolated cells | Cell culture models of cancer and their limitations | 0.38 |
| 5 | Mechanisms and pathology of invasion and metastasis | Invasion as the distinction between benign and malignant tumours | Invasion as the distinction between benign and malignant tumors | 0.80 |
| 6 | metastasis and routes of secondary tumor spread | Routes of metastasis and features of secondary tumours | Routes of metastasis and features of secondary tumors | 0.75 |
| 7 | Benign tumor characteristics versus local tissue invasion in malignant tumors | Histological comparison of benign tumours and invasive malignancy | Histological comparison of benign tumors and malignant invasion | 0.45 |
| 8 | Stepwise progression from adenoma to adenocarcinoma in colorectal polyps | Colorectal adenoma-to-carcinoma progression and histological assessment of invasion | Histological progression from colorectal adenoma to invasive adenocarcinoma | 0.38 |
| 9 | Clinical risks and behaviors of benign tumors | Malignant potential and harmful effects of benign tumours | Malignant potential and harmful effects of benign tumors | 0.78 |
| 10 | Tumor nomenclature and classification systems | Tumour nomenclature by tissue of origin and malignant status | Tumor nomenclature by tissue of origin and malignancy | 0.55 |
| 11 | Pathophysiological causes of cancer morbidity and mortality | Mechanisms of cancer-related illness and death | Mechanisms of cancer-related illness and death | 1.00 |
| 12 | Cancer incidence and comparative oncology across taxa | Incidence and mortality of major human tumour types | Human tumor incidence and cancer mortality patterns | 0.36 |
| 13 | cancer incidence across companion animals and other multicellular taxa | Tumour incidence across animal species | Comparative tumor incidence across animal species | 0.57 |
| 14 | Clinical symptoms and cancer screening modalities | Clinical presentation of cancer and the rationale for screening | Clinical presentation and the rationale for cancer screening | 0.89 |
| 15 | Cervical cancer screening, histology, and dysplasia detection | Cervical screening for HPV-associated pre-invasive lesions | Cervical screening for HPV-associated pre-invasive lesions | 1.00 |
| 16 | Colorectal and other cancer screening modalities | Methods and limitations of colorectal, breast and prostate cancer screening | Methods and limitations of colorectal, breast and prostate screening | 0.89 |
| 17 | Lecture closing and housekeeping | Lecture close: learning outcomes, revision and upcoming practicals | Lecture close: learning outcomes, revision and practicals | 0.88 |

### Grouping

Live choice: run 2, made by 6 of 9 runs, decided by most-runs.
Prototype choice (runs 1–4): run 1, most runs (3 of 4).

- Live chosen starts: 1,2,5,8,10,11,12,14,17 (9 topics)
- Prototype chosen starts: 1,2,3,5,8,10,11,12,14,17 (10 topics)
- Shared starts: 9; starts one has and the other does not: 1
- Ruled topic starts: 2,5,10,11,12,14,17

Every run, live and prototype. "Apart" counts topic starts the run has and the prototype's choice does not, or the reverse.

| Run | Topic starts | Topics | Apart from prototype choice | Matches rulings | Missed | Against ruling |
|---|---|---|---|---|---|---|
| live 1 | 1,2,3,5,8,10,11,12,14,17 | 10 | 0 | no | - | 3,8 |
| live 2 | 1,2,5,8,10,11,12,14,17 | 9 | 1 | no | - | 8 |
| live 3 | 1,2,3,5,8,10,11,12,14,17 | 10 | 0 | no | - | 3,8 |
| live 4 | 1,2,5,8,10,11,12,14,17 | 9 | 1 | no | - | 8 |
| live 5 | 1,2,5,8,10,11,12,14,17 | 9 | 1 | no | - | 8 |
| live 6 | 1,2,3,5,8,10,11,12,14,17 | 10 | 0 | no | - | 3,8 |
| live 7 | 1,2,5,8,10,11,12,14,17 | 9 | 1 | no | - | 8 |
| live 8 | 1,2,5,8,10,11,12,14,17 | 9 | 1 | no | - | 8 |
| live 9 | 1,2,5,8,10,11,12,14,17 | 9 | 1 | no | - | 8 |
| prototype 1 | 1,2,3,5,8,10,11,12,14,17 | 10 | 0 | no | - | 3,8 |
| prototype 2 | 1,2,3,5,10,11,12,14,17 | 9 | 1 | no | - | 3 |
| prototype 3 | 1,2,3,5,8,10,11,12,14,17 | 10 | 0 | no | - | 3,8 |
| prototype 4 | 1,2,3,5,8,10,11,12,14,17 | 10 | 0 | no | - | 3,8 |
| prototype 5 | 1,2,3,5,8,10,11,12,14,17 | 10 | 0 | no | - | 3,8 |

### Topic titles where both choices start a topic

| Starts at | Live | Prototype | Overlap |
|---|---|---|---|
| 1 | Introduction and lecture learning outcomes | Introduction and lecture learning outcomes | 1.00 |
| 2 | Cancer development and the importance of tissue context | Accumulating genetic and epigenetic changes in cancer | 0.15 |
| 5 | Distinguishing benign and malignant tumours through invasion and metastasis | Distinguishing benign and malignant tumors through invasion and metastasis | 0.78 |
| 8 | Benign tumour progression and clinical risks | Benign tumor progression and malignant potential | 0.33 |
| 10 | Tumour nomenclature | Tumor nomenclature | 0.33 |
| 11 | How cancer causes illness and death | How cancer causes illness and death | 1.00 |
| 12 | Tumour incidence in humans and other animals | Tumor incidence in humans and other animals | 0.75 |
| 14 | Cancer detection and screening | Clinical detection and cancer screening | 0.80 |
| 17 | Lecture close and upcoming practicals | Lecture close and follow-up | 0.43 |

## Live run against the prototype: l4

### Subtopic titles

22 subtopics. The live run gave 11 the same title as the prototype's `r9` run.
Word overlap (shared words ÷ all words used by either title): mean 0.80. For scale, the titles before retitling overlap the prototype's by 0.33.

| # | Before retitling | Live | Prototype `r9` | Overlap |
|---|---|---|---|---|
| 1 | Lecture Introduction and Learning Objectives | Introduction to cancer causes and lecture objectives | Introduction to cancer causes and lecture objectives | 1.00 |
| 2 | Cancer as a Genetic and Evolutionary Disease | Cancer as genetic evolution within a permissive microenvironment | Cancer as clonal evolution in a permissive microenvironment | 0.60 |
| 3 | Endogenous Mutational Processes and Genetic Predisposition | Endogenous mutations, environmental exposures and inherited cancer predisposition | Endogenous mutations, environmental exposures and inherited cancer predisposition | 1.00 |
| 4 | Environmental Carcinogens and Epidemiological Variation | Known and suspected environmental cancer risks | Established and suspected environmental cancer risks | 0.71 |
| 5 | The 'bad luck' vs. environmental exposure debate and public perception of cancer risk | The cancer bad luck hypothesis and public interpretation | The cancer ‘bad luck’ debate and public interpretation | 0.78 |
| 6 | Epidemiological studies and geographic variation in cancer incidence | Geographical cancer incidence as evidence for environmental and genetic influences | Geographical cancer patterns and evidence for environmental influences | 0.64 |
| 7 | Infectious Pathogens and Cancer Risk | Infectious agents and their mechanisms of carcinogenesis | Infectious agents and their mechanisms in cancer development | 0.50 |
| 8 | Burkitt Lymphoma and the Lymphoma Belt | Burkitt lymphoma: EBV, malaria and MYC translocation | Burkitt lymphoma: EBV, malaria and MYC translocation | 1.00 |
| 9 | Dietary Carcinogens and Aflatoxin Activation | Dietary aflatoxin activation and DNA adduct formation | Dietary aflatoxin activation and DNA adduct formation | 1.00 |
| 10 | UV Radiation and Thymine Dimer Formation | UV-induced thymine dimers and nucleotide excision repair | UV-induced thymine dimers and nucleotide excision repair | 1.00 |
| 11 | Polycyclic Aromatic Hydrocarbons and Xenobiotic Metabolism | Benzo[a]pyrene metabolic activation, DNA adducts and transversion mutations | Benzo[a]pyrene activation, DNA adducts and transversion mutations | 0.90 |
| 12 | TCDD toxicity and mechanism of DNA damage through oxidative stress | TCDD-induced oxidative stress and indirect DNA damage | TCDD-induced oxidative stress and indirect DNA damage | 1.00 |
| 13 | Tissue-Specific Activation of Beta-Naphthylamine | Bladder-specific activation of aromatic amine carcinogens | Bladder-specific activation of aromatic amine carcinogens | 1.00 |
| 14 | Asbestos and Chronic Inflammation as a Promoter | Asbestos-induced chronic inflammation and tumour promotion | Asbestos, chronic inflammation and tumour promotion | 0.86 |
| 15 | Two-Stage Carcinogenesis and Tumor Promoters | Two-stage carcinogenesis: DMBA initiation and TPA-mediated promotion | Experimental evidence for tumour initiation and promotion | 0.23 |
| 16 | Developmental Stage Susceptibility and Alkylating Agents | Developmental stage and tissue susceptibility to carcinogens | Developmental stages and tissue susceptibility to carcinogens | 0.75 |
| 17 | Summary of mechanisms and factors in cancer causation | Summary of DNA damage, tumour promotion and tissue-specific carcinogenesis | Summary of carcinogenic mechanisms and tissue specificity | 0.31 |
| 18 | Mutational Signatures from Whole Genome Sequencing | Mutational signatures as evidence of carcinogen exposure | Mutational signatures as evidence of carcinogen exposure | 1.00 |
| 19 | Epidemiological Biobanks and Animal Carcinogenicity Studies | Epidemiology, exposure biomarkers and biobanks in carcinogenicity research | Epidemiological assessment of carcinogenicity using biomarkers and biobanks | 0.33 |
| 20 | Animal studies and toxicological testing for carcinogenicity | Animal carcinogenicity testing: species differences and dose limitations | Animal carcinogenicity testing: species differences and dose limitations | 1.00 |
| 21 | The Ames Test for Mutagenicity | The Ames mutagenicity test and its limitations | The Ames mutagenicity test and its limitations | 1.00 |
| 22 | Lecture Summary and Risk-Benefit Analysis | Lecture summary: environmental cancer risks, carcinogenicity assessment and risk–benefit decisions | Lecture summary: environmental cancer risks, carcinogenicity assessment and risk–benefit decisions | 1.00 |

### Grouping

Live choice: run 1, made by 7 of 9 runs, decided by most-runs.
Prototype choice (runs 1–4): run 1, most runs (4 of 4).

- Live chosen starts: 1,2,4,7,9,14,16,18,20,22 (10 topics)
- Prototype chosen starts: 1,2,4,7,9,14,16,18,22 (9 topics)
- Shared starts: 9; starts one has and the other does not: 1
- Ruled topic starts: 2,7,9,14,18 (22 set aside, as in score_groupings.py)

Every run, live and prototype. "Apart" counts topic starts the run has and the prototype's choice does not, or the reverse.

| Run | Topic starts | Topics | Apart from prototype choice | Matches rulings | Missed | Against ruling |
|---|---|---|---|---|---|---|
| live 1 | 1,2,4,7,9,14,16,18,20,22 | 10 | 1 | no | - | 16,20 |
| live 2 | 1,2,4,7,9,14,16,18,20,22 | 10 | 1 | no | - | 16,20 |
| live 3 | 1,2,4,7,9,14,16,18,20,22 | 10 | 1 | no | - | 16,20 |
| live 4 | 1,2,4,7,9,14,16,18,20,22 | 10 | 1 | no | - | 16,20 |
| live 5 | 1,2,4,7,9,14,16,18,20,22 | 10 | 1 | no | - | 16,20 |
| live 6 | 1,2,4,7,9,14,16,18,20,22 | 10 | 1 | no | - | 16,20 |
| live 7 | 1,2,4,7,9,14,16,18,22 | 9 | 0 | no | - | 16 |
| live 8 | 1,2,4,7,9,14,16,18,22 | 9 | 0 | no | - | 16 |
| live 9 | 1,2,4,7,9,14,16,18,20,22 | 10 | 1 | no | - | 16,20 |
| prototype 1 | 1,2,4,7,9,14,16,18,22 | 9 | 0 | no | - | 16 |
| prototype 2 | 1,2,4,7,9,14,16,18,22 | 9 | 0 | no | - | 16 |
| prototype 3 | 1,2,4,7,9,14,16,18,22 | 9 | 0 | no | - | 16 |
| prototype 4 | 1,2,4,7,9,14,16,18,22 | 9 | 0 | no | - | 16 |
| prototype 5 | 1,2,4,7,9,14,16,18,22 | 9 | 0 | no | - | 16 |

### Topic titles where both choices start a topic

| Starts at | Live | Prototype | Overlap |
|---|---|---|---|
| 1 | Introduction and lecture objectives | Lecture introduction and learning objectives | 0.80 |
| 2 | Genetic evolution and the foundations of cancer susceptibility | Cancer evolution and the origins of genetic susceptibility | 0.78 |
| 4 | Environmental cancer risk versus chance and genetic predisposition | Environmental cancer risks and their interpretation | 0.27 |
| 7 | Infectious agents in cancer development | Infectious agents in cancer development | 1.00 |
| 9 | Environmental carcinogens and mechanisms of DNA damage | Environmental carcinogens and mechanisms of DNA damage | 1.00 |
| 14 | Tumour promotion and two-stage carcinogenesis | Tumour initiation and promotion | 0.43 |
| 16 | Tissue and developmental susceptibility, with a recap of carcinogenesis | Developmental and tissue susceptibility within carcinogenic mechanisms | 0.33 |
| 18 | Human evidence linking carcinogen exposure to cancer | Evidence and tests for carcinogenicity | 0.09 |
| 22 | Closing summary and risk–benefit decisions | Closing summary and risk–benefit decisions | 1.00 |

## Live run against the prototype: l5

### Subtopic titles

17 subtopics. The live run gave 9 the same title as the prototype's `r9` run.
Word overlap (shared words ÷ all words used by either title): mean 0.87. For scale, the titles before retitling overlap the prototype's by 0.32.

| # | Before retitling | Live | Prototype `r9` | Overlap |
|---|---|---|---|---|
| 1 | Lecture introduction and learning outcomes | Introduction to cellular transformation and cancer genetics | Introduction to cellular transformation and cancer genetics | 1.00 |
| 2 | History of cell theory and discovery of tumor viruses | From cell and germ theories to tumor virology | From cell and germ theories to tumor virology | 1.00 |
| 3 | Retroviral oncogene capture and transformation assays | Retroviral capture of cellular proto-oncogenes | Retroviral capture of cellular proto-oncogenes | 1.00 |
| 4 | Assays for measuring cell transformation and oncogenic potential | Experimental assays of cellular transformation and cancer mutations | Experimental assays of cellular transformation | 0.62 |
| 5 | Classification of cancer mutations | Functional classification of cancer genes and mutations | Functional classification of cancer genes and mutations | 1.00 |
| 6 | Cell cycle regulation at the G1/S checkpoint | G1–S checkpoint regulation and its disruption in cancer | RB control of the G1–S checkpoint and its disruption in cancer | 0.62 |
| 7 | Dominant negative mutations and p53 tetramerization | Mutation dominance and dominant-negative effects in p53 | Mutation-specific effects and dominant-negative p53 | 0.67 |
| 8 | Sequence instability versus chromosomal instability | Sequence instability and chromosomal instability in cancer | Sequence instability and chromosomal instability in cancer | 1.00 |
| 9 | DNA repair pathway defects in cancer | Excision repair and single-strand break repair | Excision repair and single-strand break repair | 1.00 |
| 10 | Mismatch repair pathway and microsatellite instability in cancer | Mismatch repair defects and microsatellite instability | Mismatch repair defects and microsatellite instability | 1.00 |
| 11 | Double-strand break repair pathways and chromosomal instability | Double-strand break repair defects and chromosomal instability | Double-strand break repair and chromosomal instability | 0.88 |
| 12 | Replication and mitotic errors and their cellular consequences | DNA polymerase epsilon mutations and sequence instability | DNA polymerase epsilon mutations and sequence instability | 1.00 |
| 13 | Chromosomal instability and mitotic defects | Mitotic errors and their consequences for tumor adaptation | Mitotic errors and their consequences for tumor adaptation | 1.00 |
| 14 | The Vogelstein model of stepwise tumorigenesis | Mutation order and genetic instability in colorectal cancer progression | Mutation timing and genetic instability in colorectal cancer progression | 0.80 |
| 15 | Hereditary cancer predisposition syndromes | Hereditary cancer predisposition and tumor suppressor mutations | Hereditary cancer predisposition through caretaker and gatekeeper mutations | 0.50 |
| 16 | Genetic instability is not required for malignancy | BRCA2 restoration during treatment shows genetic instability is not required for malignancy | BRCA2 restoration during treatment shows instability is not required for malignancy | 0.92 |
| 17 | Lecture wrap-up and reading recommendations | Lecture close: further reading and questions | Lecture close: questions, further reading and next lecture | 0.86 |

### Grouping

Live choice: run 3, made by 5 of 9 runs, decided by most-runs.
Prototype choice (runs 1–4): run 2, most runs (2 of 4).

- Live chosen starts: 1,2,4,5,8,12,14,15,17 (9 topics)
- Prototype chosen starts: 1,2,4,5,8,12,14,15,17 (9 topics)
- Shared starts: 9; starts one has and the other does not: 0
- Ruled topic starts: 2,5,8,17

Every run, live and prototype. "Apart" counts topic starts the run has and the prototype's choice does not, or the reverse.

| Run | Topic starts | Topics | Apart from prototype choice | Matches rulings | Missed | Against ruling |
|---|---|---|---|---|---|---|
| live 1 | 1,2,4,5,8,14,15,17 | 8 | 1 | no | - | 4,14,15 |
| live 2 | 1,2,4,5,8,15,17 | 7 | 2 | no | - | 4,15 |
| live 3 | 1,2,4,5,8,12,14,15,17 | 9 | 0 | no | - | 4,12,14,15 |
| live 4 | 1,2,4,5,8,12,14,15,17 | 9 | 0 | no | - | 4,12,14,15 |
| live 5 | 1,2,4,5,8,14,15,17 | 8 | 1 | no | - | 4,14,15 |
| live 6 | 1,2,4,5,8,14,15,17 | 8 | 1 | no | - | 4,14,15 |
| live 7 | 1,2,4,5,8,12,14,15,17 | 9 | 0 | no | - | 4,12,14,15 |
| live 8 | 1,2,4,5,8,12,14,15,17 | 9 | 0 | no | - | 4,12,14,15 |
| live 9 | 1,2,4,5,8,12,14,15,17 | 9 | 0 | no | - | 4,12,14,15 |
| prototype 1 | 1,2,4,5,8,12,14,15,16,17 | 10 | 1 | no | - | 4,12,14,15,16 |
| prototype 2 | 1,2,4,5,8,12,14,15,17 | 9 | 0 | no | - | 4,12,14,15 |
| prototype 3 | 1,2,4,5,8,12,14,15,17 | 9 | 0 | no | - | 4,12,14,15 |
| prototype 4 | 1,2,4,5,8,12,15,17 | 8 | 1 | no | - | 4,12,15 |
| prototype 5 | 1,2,4,5,8,12,14,15,17 | 9 | 0 | no | - | 4,12,14,15 |

### Topic titles where both choices start a topic

| Starts at | Live | Prototype | Overlap |
|---|---|---|---|
| 1 | Introduction and learning outcomes | Lecture introduction and learning outcomes | 0.80 |
| 2 | Tumor virology and the discovery of cellular proto-oncogenes | Tumor virology and the discovery of cellular proto-oncogenes | 1.00 |
| 4 | Experimental tests of cellular transformation | Experimental assays of cellular transformation | 0.67 |
| 5 | Functional effects and classification of cancer mutations | Functional classification and effects of cancer mutations | 1.00 |
| 8 | Forms of genetic instability and defects in DNA repair | Genetic instability and defects in DNA repair | 0.78 |
| 12 | Genetic instability from replication and mitotic errors | Genetic instability from replication and mitotic errors | 1.00 |
| 14 | Mutation order in colorectal cancer progression | Mutation timing in colorectal cancer progression | 0.71 |
| 15 | Hereditary cancer predisposition and the role of inherited mutations | Hereditary cancer predisposition and the limits of instability dependence | 0.50 |
| 17 | Further reading, questions, and next lecture | Lecture close, further reading and next lecture | 0.71 |

## Live run against the prototype: l6

### Subtopic titles

19 subtopics. The live run gave 4 the same title as the prototype's `r9` run.
Word overlap (shared words ÷ all words used by either title): mean 0.61. For scale, the titles before retitling overlap the prototype's by 0.28.

| # | Before retitling | Live | Prototype `r9` | Overlap |
|---|---|---|---|---|
| 1 | Introduction to cancer hallmarks and mutation progression | Introduction to cancer hallmarks and their genetic basis | Introduction to cancer hallmarks and loss of growth control | 0.42 |
| 2 | Growth signaling pathways and deregulation | Mutations in extracellular signaling pathways controlling growth and survival | Extracellular signaling pathways and mutations affecting growth control | 0.55 |
| 3 | Wnt/APC/beta-catenin signaling pathway and mutations | APC and β-catenin mutations in Wnt-driven proliferation | Wnt signaling and mutations that increase β-catenin activity | 0.33 |
| 4 | Receptor tyrosine kinase signaling pathways and mutations | Deregulation of MAPK, PI3K–AKT and TGF-β signaling | Deregulated growth and survival signaling through Ras–MAPK and PI3K–AKT | 0.38 |
| 5 | Block in terminal differentiation | Differentiation blocks and cell origins in hematological cancers | Differentiation blocks and cell maturity in hematological cancers | 0.78 |
| 6 | Differentiation block in colorectal carcinoma and intestinal epithelial renewal | APC loss disrupts intestinal epithelial differentiation and renewal | APC loss disrupts intestinal epithelial proliferation and differentiation | 0.78 |
| 7 | Evasion of apoptosis and p53 regulation | Resistance to apoptosis through p53 loss and BCL2 activity | Resistance to apoptosis through p53 loss and altered BAX–BCL2 balance | 0.67 |
| 8 | Replicative immortalization, telomeres, and senescence | Telomere shortening, replicative limits and cellular senescence | Telomere shortening, replicative limits and cellular senescence | 1.00 |
| 9 | Genetic mechanisms of TERT reactivation in cancer | TERT promoter mutations and rearrangements enabling immortalization | TERT promoter mutations and rearrangements enable tumor cell immortalization | 0.60 |
| 10 | p53-mediated stress signaling and cell fate control | p53-mediated stress responses preserve genome integrity | Summary of p53-mediated stress responses and genome protection | 0.45 |
| 11 | Summary of growth-control hallmarks and introduction to complex cancer hallmarks | Summary of growth control hallmarks and introduction to broader cancer behaviors | Summary of mutation-driven growth-control hallmarks and their limits | 0.40 |
| 12 | Altered cellular metabolism and the Warburg effect | The Warburg effect and glucose uptake in cancer diagnosis | The Warburg effect and glucose uptake in cancer diagnosis | 1.00 |
| 13 | Metabolic rewiring and tissue-specific metabolic profiles across cancer types | Cancer metabolic rewiring retains tissue-specific features | Increased glycolysis and tissue-specific metabolic rewiring in cancer | 0.45 |
| 14 | Metabolic gene mutations and oncometabolites as drivers of cancer | Oncometabolites and feedback between metabolism and the epigenome | Oncometabolites and feedback between metabolism and the epigenome | 1.00 |
| 15 | Induction of angiogenesis | The angiogenic switch in tumor development and growth | The angiogenic switch and vascular support for tumor growth | 0.55 |
| 16 | Metastasis and systemic dissemination | Metastatic dissemination, circulatory routes and clinical monitoring | Metastatic dissemination and monitoring through lymph nodes and circulating tumor cells | 0.31 |
| 17 | Metastatic inefficiency and the seed and soil hypothesis | Metastatic inefficiency and seed–soil compatibility | Metastatic inefficiency and compatibility between cancer cells and secondary sites | 0.36 |
| 18 | Genomic sequencing of metastases and whole genome duplication | Shared driver mutations and whole-genome duplication in metastases | Shared driver mutations and whole-genome duplication in metastases | 1.00 |
| 19 | Lecture summary and recommended reading | Lecture summary: diverse genetic routes converge on cancer hallmarks | Lecture summary: diverse routes to shared cancer hallmarks | 0.55 |

### Grouping

Live choice: run 1, made by 8 of 9 runs, decided by most-runs.
Prototype choice (runs 1–4): run 1, most runs (4 of 4).

- Live chosen starts: 1,2,5,7,8,10,12,15,16,19 (10 topics)
- Prototype chosen starts: 1,2,5,7,8,10,12,15,16,19 (10 topics)
- Shared starts: 10; starts one has and the other does not: 0
- Ruled topic starts: 2,5,7,8,12,15,16,19

Every run, live and prototype. "Apart" counts topic starts the run has and the prototype's choice does not, or the reverse.

| Run | Topic starts | Topics | Apart from prototype choice | Matches rulings | Missed | Against ruling |
|---|---|---|---|---|---|---|
| live 1 | 1,2,5,7,8,10,12,15,16,19 | 10 | 0 | no | - | 10 |
| live 2 | 1,2,5,7,8,10,12,15,16,19 | 10 | 0 | no | - | 10 |
| live 3 | 1,2,5,7,8,10,12,15,16,19 | 10 | 0 | no | - | 10 |
| live 4 | 1,2,5,7,8,10,12,15,16,19 | 10 | 0 | no | - | 10 |
| live 5 | 1,2,5,7,8,10,12,15,16,19 | 10 | 0 | no | - | 10 |
| live 6 | 1,2,5,7,8,10,12,15,16,19 | 10 | 0 | no | - | 10 |
| live 7 | 1,2,5,7,8,10,12,15,16,19 | 10 | 0 | no | - | 10 |
| live 8 | 1,2,5,7,8,12,15,16,19 | 9 | 1 | yes | - | - |
| live 9 | 1,2,5,7,8,10,12,15,16,19 | 10 | 0 | no | - | 10 |
| prototype 1 | 1,2,5,7,8,10,12,15,16,19 | 10 | 0 | no | - | 10 |
| prototype 2 | 1,2,5,7,8,10,12,15,16,19 | 10 | 0 | no | - | 10 |
| prototype 3 | 1,2,5,7,8,10,12,15,16,19 | 10 | 0 | no | - | 10 |
| prototype 4 | 1,2,5,7,8,10,12,15,16,19 | 10 | 0 | no | - | 10 |
| prototype 5 | 1,2,5,7,8,10,12,15,16,19 | 10 | 0 | no | - | 10 |

### Topic titles where both choices start a topic

| Starts at | Live | Prototype | Overlap |
|---|---|---|---|
| 1 | Lecture framing and the cancer hallmarks framework | Lecture framing and the cancer hallmarks framework | 1.00 |
| 2 | Signaling mutations that promote growth and survival | Deregulated extracellular signaling and growth control | 0.30 |
| 5 | Disrupted differentiation in blood and intestinal cancers | Differentiation blocks in cancer | 0.22 |
| 7 | Resistance to apoptosis | Resistance to apoptosis | 1.00 |
| 8 | Telomere maintenance and cancer cell immortalization | Telomere maintenance and tumor cell immortalization | 0.71 |
| 10 | p53-mediated genome protection and growth-control safeguards | p53-mediated genome protection and growth-control recap | 0.78 |
| 12 | Metabolic rewiring in cancer | Metabolic rewiring in cancer | 1.00 |
| 15 | Angiogenesis in tumor development | Angiogenesis and vascular support for tumor growth | 0.22 |
| 16 | Metastatic spread and successful colonization | Metastatic dissemination and successful secondary growth | 0.38 |
| 19 | Lecture conclusions and further reading | Closing synthesis and further reading | 0.43 |

## Live run against the prototype: l7

### Subtopic titles

12 subtopics. The live run gave 2 the same title as the prototype's `r9` run.
Word overlap (shared words ÷ all words used by either title): mean 0.68. For scale, the titles before retitling overlap the prototype's by 0.27.

| # | Before retitling | Live | Prototype `r9` | Overlap |
|---|---|---|---|---|
| 1 | Welcome and Lecture Framing | Introduction to cancer evolution, cell of origin and the microenvironment | Introduction to cancer evolution, cell of origin and the microenvironment | 1.00 |
| 2 | Clonal Evolution and Selection of Driver Mutations | Evidence for mutation-driven clonal evolution and selection | Mutation accumulation and clonal selection in cancer evolution | 0.45 |
| 3 | Epigenetic Regulation in Cancer Hallmarks | Epigenetic disruption as a driver of tumor development | Epigenetic disruption as a driver of tumor development | 1.00 |
| 4 | Cell of Origin and Cancer Stem Cells | Stem cell properties and stochastic versus hierarchical models of cancer | Stemness, cell of origin and models of tumor growth | 0.29 |
| 5 | evidence for cancer stem cells in leukemia | Evidence for cancer stem cells and tumor hierarchy in leukemia | Evidence for cancer stem cells in leukemia | 0.70 |
| 6 | cell of origin and bottom-up transformation in colorectal cancer | Cell of origin and APC loss in intestinal tumor initiation | Cell of origin and mutational pathways in intestinal tumor development | 0.54 |
| 7 | Microenvironmental and Inflammatory Promotion | Pollution-induced inflammation and stemness in lung cancer promotion | Pollution-induced inflammation and stemness in lung cancer initiation | 0.80 |
| 8 | Colon cancer and inflammation in the APC knockout model | Inflammation-induced stemness and tumor formation in APC-deficient intestinal progenitors | Inflammation-induced stemness in APC-deficient intestinal progenitors | 0.73 |
| 9 | Established Tumor Microenvironment and Spatial Profiling | Stromal support of established tumors and microenvironment-targeted therapy | Microenvironmental support of established tumors and therapeutic targeting | 0.42 |
| 10 | methods for studying tumor heterogeneity and the microenvironment | Investigating cancer evolution and cell interactions with single-cell and spatial omics | Single-cell and spatial approaches to studying cancer evolution and cell interactions | 0.54 |
| 11 | Summary of Coevolution and Routes to Malignancy | Lecture summary: mutations, cell identity and microenvironment in cancer evolution | Lecture summary: mutations, cell properties and microenvironment in cancer evolution | 0.82 |
| 12 | Closing Remarks and Next Lecture | Lecture close: next lecture on cancer therapy | Lecture close: cancer therapy next | 0.83 |

### Grouping

Live choice: run 2, made by 4 of 9 runs, decided by most-runs.
Prototype choice (runs 1–4): run 2, tie on 2 runs; most topics (9).

- Live chosen starts: 1,2,4,7,9,10,11,12 (8 topics)
- Prototype chosen starts: 1,2,3,4,7,9,10,11,12 (9 topics)
- Shared starts: 8; starts one has and the other does not: 1
- Ruled topic starts: 

Every run, live and prototype. "Apart" counts topic starts the run has and the prototype's choice does not, or the reverse.

| Run | Topic starts | Topics | Apart from prototype choice | Matches rulings | Missed | Against ruling |
|---|---|---|---|---|---|---|
| live 1 | 1,2,4,7,9,10,12 | 7 | 2 | — | — | — |
| live 2 | 1,2,4,7,9,10,11,12 | 8 | 1 | — | — | — |
| live 3 | 1,2,3,4,7,9,10,11,12 | 9 | 0 | — | — | — |
| live 4 | 1,2,4,7,10,11,12 | 7 | 2 | — | — | — |
| live 5 | 1,2,3,4,7,9,10,11,12 | 9 | 0 | — | — | — |
| live 6 | 1,2,3,4,7,9,10,11,12 | 9 | 0 | — | — | — |
| live 7 | 1,2,4,7,9,10,11,12 | 8 | 1 | — | — | — |
| live 8 | 1,2,4,7,9,10,11,12 | 8 | 1 | — | — | — |
| live 9 | 1,2,4,7,9,10,11,12 | 8 | 1 | — | — | — |
| prototype 1 | 1,2,4,7,9,10,11,12 | 8 | 1 | — | — | — |
| prototype 2 | 1,2,3,4,7,9,10,11,12 | 9 | 0 | — | — | — |
| prototype 3 | 1,2,4,7,9,10,11,12 | 8 | 1 | — | — | — |
| prototype 4 | 1,2,3,4,7,9,10,11,12 | 9 | 0 | — | — | — |
| prototype 5 | 1,2,4,7,9,10,11,12 | 8 | 1 | — | — | — |

### Topic titles where both choices start a topic

| Starts at | Live | Prototype | Overlap |
|---|---|---|---|
| 1 | Lecture introduction and learning aims | Lecture introduction and learning objectives | 0.67 |
| 2 | Molecular changes driving clonal evolution and tumor development | Mutation accumulation and clonal selection | 0.18 |
| 4 | Stemness, tumor hierarchy and the cell of origin | Cell of origin and cancer stem cell models | 0.36 |
| 7 | Inflammation-induced stemness and cancer promotion | Inflammation-induced stemness in cancer initiation | 0.50 |
| 9 | Stromal dependence of established tumors and therapeutic targeting | Microenvironmental support of established tumors | 0.30 |
| 10 | Investigating cancer evolution with single-cell and spatial omics | Single-cell and spatial methods for studying cancer | 0.42 |
| 11 | Converging conditions for malignant outgrowth | Converging conditions for malignant evolution | 0.67 |
| 12 | Lecture close and next lecture | Lecture close and next session | 0.80 |

## Live run against the prototype: l8

### Subtopic titles

23 subtopics. The live run gave 12 the same title as the prototype's `r9` run.
Word overlap (shared words ÷ all words used by either title): mean 0.84. For scale, the titles before retitling overlap the prototype's by 0.33.

| # | Before retitling | Live | Prototype `r9` | Overlap |
|---|---|---|---|---|
| 1 | Introduction to cancer therapy | Cancer therapy approaches and learning objectives | Cancer therapy approaches and learning objectives | 1.00 |
| 2 | Surgery and radiotherapy as primary cancer treatments | Surgery and radiotherapy with adjunctive chemotherapy | Surgery and radiotherapy in cancer treatment | 0.33 |
| 3 | Cytotoxic chemotherapy mechanisms and limitations | Cytotoxic chemotherapy: mechanisms, efficacy, toxicity and resistance | Cytotoxic chemotherapy: mechanisms, efficacy, toxicity and resistance | 1.00 |
| 4 | Targeting outside-in signaling in hormone-dependent cancers | Targeting hormone dependence in breast and prostate cancers | Targeting hormone dependence in breast and prostate cancers | 1.00 |
| 5 | Exploiting cell cycle checkpoint defects and oncolytic viruses | Exploiting cell cycle checkpoint defects to increase radiosensitivity | Exploiting cell cycle checkpoint defects to enhance radiosensitivity | 0.78 |
| 6 | Exploiting p53 deficiency using engineered oncolytic adenoviruses | Oncolytic adenoviruses targeting p53-deficient cancer cells | Oncolytic adenoviruses targeting p53-deficient cancer cells | 1.00 |
| 7 | Exploiting DNA repair deficiencies with PARP inhibitors | PARP inhibition in BRCA-deficient cancers | PARP inhibition in BRCA-deficient cancers | 1.00 |
| 8 | Targeting oncogene addiction with kinase inhibitors | Oncogene addiction and genome-guided targeted therapy | Oncogene addiction and genome-guided targeted therapy | 1.00 |
| 9 | Targeting hyperactivated kinases with small-molecule inhibitors | Targeting activated oncogenic kinases with ATP-competitive inhibitors | Targeting activated oncogenic kinases with ATP-binding inhibitors | 0.78 |
| 10 | Kinase inhibitor resistance, bypass pathways, and drug addiction | Kinase inhibitor selectivity and resistance through binding-site mutations | Kinase inhibitor selectivity and resistance through binding-site mutations | 1.00 |
| 11 | Bypass resistance mechanisms and drug addiction in RAF inhibitors | BRAF inhibitor resistance, drug addiction and intermittent dosing | BRAF inhibitor resistance, bypass signalling and drug addiction | 0.60 |
| 12 | Summary of kinase inhibitors as chronic therapies and their associated side effects | Summary of long-term kinase inhibitor treatment and its limitations | Summary of chronic disease management and kinase inhibitor limitations | 0.46 |
| 13 | Monoclonal antibodies and antibody-drug conjugates | Monoclonal antibodies for receptor blockade and immune-mediated cancer cell killing | Monoclonal antibodies for receptor blockade and immune-mediated cancer cell killing | 1.00 |
| 14 | Antibody-drug conjugates and brentuximab | Antibody–drug conjugates for targeted cytotoxic delivery | Antibody–drug conjugates for targeted cytotoxic delivery | 1.00 |
| 15 | Historical and clinical evidence for cancer immune surveillance | Evidence for and against immune surveillance of cancer | Evidence for immune surveillance against cancer | 0.75 |
| 16 | Immune checkpoint inhibitors and neoantigen response | Immune checkpoint blockade: T cell reactivation, efficacy and toxicity | Immune checkpoint inhibition: T cell reactivation, efficacy and toxicity | 0.80 |
| 17 | tumor neoantigens and mutational burden driving T-cell responses | Tumor neoantigens and response to immune checkpoint blockade | Tumour neoantigens and response to immune checkpoint inhibition | 0.60 |
| 18 | Bispecific T-cell engagers and CAR T-cell therapies | Bispecific T cell engagers in B-cell lymphoma | Bispecific T cell engagers in B-cell lymphoma treatment | 0.88 |
| 19 | CAR T cell therapy mechanism, production, and limitations | CAR T cell therapy: manufacture, limitations and emerging improvements | CAR T cell therapy: manufacture, limitations and emerging improvements | 1.00 |
| 20 | Modern challenges, genomic stratification, and cancer trends | Summary of cancer therapy challenges and biomarker-guided treatment | Summary of cancer therapy challenges and personalised treatment strategies | 0.64 |
| 21 | historical trends: cancer therapy improvements versus prevention and early detection | Cancer outcome trends and the contributions of prevention and early detection | Cancer outcome trends and the contributions of prevention and early detection | 1.00 |
| 22 | future directions and ethical dilemmas in cancer management | Future cancer treatment priorities and ethical dilemmas | Future cancer treatment priorities and ethical dilemmas | 1.00 |
| 23 | Combination chemotherapy success in pediatric leukemia and ethical dilemmas | Lecture close: childhood leukemia survival and the challenge of trialling targeted therapies | Lecture close: childhood leukaemia survival and the dilemma of trialling targeted therapies | 0.71 |

### Grouping

Live choice: run 1, made by 4 of 9 runs, decided by most-runs.
Prototype choice (runs 1–4): run 1, most runs (2 of 4).

- Live chosen starts: 1,2,3,4,5,7,8,10,13,15,16,18,20,21,22 (15 topics)
- Prototype chosen starts: 1,2,3,4,5,7,8,10,13,15,16,18,20,21,22 (15 topics)
- Shared starts: 15; starts one has and the other does not: 0
- Ruled topic starts: 

Every run, live and prototype. "Apart" counts topic starts the run has and the prototype's choice does not, or the reverse.

| Run | Topic starts | Topics | Apart from prototype choice | Matches rulings | Missed | Against ruling |
|---|---|---|---|---|---|---|
| live 1 | 1,2,3,4,5,7,8,10,13,15,16,18,20,21,22 | 15 | 0 | — | — | — |
| live 2 | 1,2,3,4,5,7,8,10,13,15,16,18,20,21,22 | 15 | 0 | — | — | — |
| live 3 | 1,2,4,5,7,8,13,15,16,18,20,21,22 | 13 | 2 | — | — | — |
| live 4 | 1,2,4,5,7,8,10,13,15,18,20,21,22 | 13 | 2 | — | — | — |
| live 5 | 1,2,3,4,5,7,8,10,13,15,16,18,20,21,22 | 15 | 0 | — | — | — |
| live 6 | 1,2,3,4,5,7,8,10,13,15,16,18,20,21,22,23 | 16 | 1 | — | — | — |
| live 7 | 1,2,3,4,5,7,8,10,13,15,18,20,21,22 | 14 | 1 | — | — | — |
| live 8 | 1,2,3,4,5,7,8,10,13,15,16,18,20,21,22 | 15 | 0 | — | — | — |
| live 9 | 1,2,3,4,5,7,8,13,15,18,20,21,22 | 13 | 2 | — | — | — |
| prototype 1 | 1,2,3,4,5,7,8,10,13,15,16,18,20,21,22 | 15 | 0 | — | — | — |
| prototype 2 | 1,2,3,4,5,7,8,10,13,15,18,20,21,22,23 | 15 | 2 | — | — | — |
| prototype 3 | 1,2,3,4,5,7,8,10,13,15,16,18,20,21,22 | 15 | 0 | — | — | — |
| prototype 4 | 1,2,3,4,5,7,8,10,13,15,18,20,21,22 | 14 | 1 | — | — | — |
| prototype 5 | 1,2,3,4,5,7,8,10,13,15,16,18,20,21,22 | 15 | 0 | — | — | — |

### Topic titles where both choices start a topic

| Starts at | Live | Prototype | Overlap |
|---|---|---|---|
| 1 | Introduction and learning objectives | Lecture introduction and learning objectives | 0.80 |
| 2 | Surgery and radiotherapy | Surgery and radiotherapy | 1.00 |
| 3 | Cytotoxic chemotherapy | Cytotoxic chemotherapy | 1.00 |
| 4 | Targeting hormone-dependent cancers | Targeting hormone-dependent cancers | 1.00 |
| 5 | Exploiting cancer cell checkpoint defects | Exploiting cancer cell checkpoint defects | 1.00 |
| 7 | PARP inhibition in BRCA-deficient cancers | PARP inhibition in BRCA-deficient cancers | 1.00 |
| 8 | Oncogene addiction and targeted kinase inhibition | Oncogene addiction and targeted kinase inhibition | 1.00 |
| 10 | Kinase inhibitor resistance and long-term treatment limitations | Limitations and resistance in kinase inhibitor treatment | 0.67 |
| 13 | Antibody-directed cancer treatment | Antibody-directed cancer treatment | 1.00 |
| 15 | Evidence for immune surveillance of cancer | Evidence for immune surveillance against cancer | 0.71 |
| 16 | Immune checkpoint blockade and tumour recognition | Immune checkpoint inhibition and tumour recognition | 0.71 |
| 18 | Redirecting T cells towards cancer cells | Redirecting T cells towards cancer cells | 1.00 |
| 20 | Treatment challenges and biomarker-guided therapy | Treatment challenges and personalised strategies | 0.38 |
| 21 | Cancer outcome trends, prevention and early detection | Cancer outcome trends, prevention and early detection | 1.00 |
| 22 | Future treatment priorities and ethical dilemmas | Future treatment priorities and ethical dilemmas | 1.00 |
