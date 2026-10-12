# Checks of Rewrites (sonnet-5.5, w1), lecture 2026-03-04

| Checker | Faults | Subtopics failed | Subtopics checked | Faults that matter found | Cost |
| --- | --- | --- | --- | --- | --- |
| gemini-3.1-pro-preview c3 | 4 | 3 | 17 | 3 of 9 | $0.68 |
| gemini-3.1-pro-preview c4 | 57 | 14 | 17 | 8 of 9 | $1.48 |
| gemini-3.8-flash c3 | 2 | 2 | 17 | 1 of 9 | $0.12 |
| gemini-3.8-flash c4 | 20 | 10 | 17 | 6 of 9 | $0.32 |
| gemini-3.8-flash c4 run 2 | 20 | 10 | 17 | 6 of 9 | $0.33 |
| gemini-3.8-flash c4 run 3 | 18 | 9 | 17 | 6 of 9 | $0.11 |
| gemini-3.8-flash c5 | 25 | 13 | 17 | 5 of 9 | $0.39 |
| gemini-3.8-flash c5 run 2 | 16 | 8 | 17 | 4 of 9 | $0.29 |
| gemini-3.8-flash c5 run 3 | 13 | 9 | 17 | 4 of 9 | $0.28 |
| gpt-5.6-sol-pro c3 | 13 | 10 | 17 | 3 of 9 | $1.17 |
| gemini-3.1-pro, c2 (pipeline) | 24 | 8 | 17 | 6 of 9 | $1.33 |
| gemini-3.8-flash, c2 (pipeline) | 8 | 4 | 17 | 2 of 9 | $0.34 |
| gemini-3.8-flash, c3 (pipeline) | 1 | 1 | 17 | 0 of 9 | $0.15 |
| sol-pro, c2 (pipeline) | 36 | 15 | 17 | 6 of 9 | $2.31 |
| sonnet-5.5, c2 (pipeline) | 4 | 4 | 17 | 1 of 9 | $0.53 |
| terra-pro, c2 (pipeline) | 42 | 13 | 14 | 4 of 9 | $2.72 |

## Faults that matter

| Fault | gemini-3.1-pro-preview c3 | gemini-3.1-pro-preview c4 | gemini-3.8-flash c3 | gemini-3.8-flash c4 | gemini-3.8-flash c4 run 2 | gemini-3.8-flash c4 run 3 | gemini-3.8-flash c5 | gemini-3.8-flash c5 run 2 | gemini-3.8-flash c5 run 3 | gpt-5.6-sol-pro c3 | gemini-3.1-pro, c2 (pipeline) | gemini-3.8-flash, c2 (pipeline) | gemini-3.8-flash, c3 (pipeline) | sol-pro, c2 (pipeline) | sonnet-5.5, c2 (pipeline) | terra-pro, c2 (pipeline) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2.1 | no | yes | no | yes | yes | yes | yes | yes | yes | yes | no | no | no | yes | no | no |
| 2.2 | no | yes | no | yes | yes | yes | yes | yes | yes | yes | yes | no | no | yes | no | yes |
| 3.4 | no | yes | no | no | no | no | no | no | no | no | yes | yes | no | yes | no | no |
| 7.1 | yes | yes | no | yes | yes | yes | yes | yes | yes | no | yes | yes | no | yes | no | yes |
| 8.1 | yes | yes | no | no | no | no | yes | yes | no | yes | yes | no | no | yes | yes | yes |
| 15.1 | no | no | no | no | no | no | no | no | no | no | no | no | no | yes | no | yes |
| 11.A | yes | yes | yes | yes | yes | yes | no | no | no | no | yes | no | no | no | no | no |
| 4.A | no | yes | no | yes | yes | yes | yes | no | yes | no | no | no | no | no | no | no |
| 8.F | no | yes | no | yes | yes | yes | no | no | no | no | yes | no | no | no | no | no |

## Faults outside the key

### gemini-3.1-pro-preview c3: 0 faults outside the key



### gemini-3.1-pro-preview c4: 0 faults outside the key



### gemini-3.8-flash c3: 0 faults outside the key



### gemini-3.8-flash c4: 0 faults outside the key



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

### gpt-5.6-sol-pro c3: 0 faults outside the key



### gemini-3.1-pro, c2 (pipeline): 0 faults outside the key



### gemini-3.8-flash, c2 (pipeline): 0 faults outside the key



### gemini-3.8-flash, c3 (pipeline): 0 faults outside the key



### sol-pro, c2 (pipeline): 0 faults outside the key



### sonnet-5.5, c2 (pipeline): 0 faults outside the key



### terra-pro, c2 (pipeline): 0 faults outside the key


