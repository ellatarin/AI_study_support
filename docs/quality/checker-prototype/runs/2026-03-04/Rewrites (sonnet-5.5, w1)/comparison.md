# Checks of Rewrites (sonnet-5.5, w1), lecture 2026-03-04

| Checker | Faults | Subtopics failed | Subtopics checked | Faults that matter found | Cost |
| --- | --- | --- | --- | --- | --- |
| gemini-3.1-pro-preview c3 | 4 | 3 | 17 | 3 of 9 | $0.68 |
| gemini-3.1-pro-preview c4 | 57 | 14 | 17 | 8 of 9 | $1.48 |
| gemini-3.8-flash c3 | 2 | 2 | 17 | 1 of 9 | $0.12 |
| gemini-3.8-flash c4 | 20 | 10 | 17 | 6 of 9 | $0.32 |
| gpt-5.6-sol-pro c3 | 13 | 10 | 17 | 3 of 9 | $1.17 |
| gemini-3.1-pro, c2 (pipeline) | 24 | 8 | 17 | 6 of 9 | $1.33 |
| gemini-3.8-flash, c2 (pipeline) | 8 | 4 | 17 | 2 of 9 | $0.34 |
| gemini-3.8-flash, c3 (pipeline) | 1 | 1 | 17 | 0 of 9 | $0.15 |
| sol-pro, c2 (pipeline) | 36 | 15 | 17 | 6 of 9 | $2.31 |
| sonnet-5.5, c2 (pipeline) | 4 | 4 | 17 | 1 of 9 | $0.53 |
| terra-pro, c2 (pipeline) | 42 | 13 | 14 | 4 of 9 | $2.72 |

## Faults that matter

| Fault | gemini-3.1-pro-preview c3 | gemini-3.1-pro-preview c4 | gemini-3.8-flash c3 | gemini-3.8-flash c4 | gpt-5.6-sol-pro c3 | gemini-3.1-pro, c2 (pipeline) | gemini-3.8-flash, c2 (pipeline) | gemini-3.8-flash, c3 (pipeline) | sol-pro, c2 (pipeline) | sonnet-5.5, c2 (pipeline) | terra-pro, c2 (pipeline) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2.1 | no | yes | no | yes | yes | no | no | no | yes | no | no |
| 2.2 | no | yes | no | yes | yes | yes | no | no | yes | no | yes |
| 3.4 | no | yes | no | no | no | yes | yes | no | yes | no | no |
| 7.1 | yes | yes | no | yes | no | yes | yes | no | yes | no | yes |
| 8.1 | yes | yes | no | no | yes | yes | no | no | yes | yes | yes |
| 15.1 | no | no | no | no | no | no | no | no | yes | no | yes |
| 11.A | yes | yes | yes | yes | no | yes | no | no | no | no | no |
| 4.A | no | yes | no | yes | no | no | no | no | no | no | no |
| 8.F | no | yes | no | yes | no | yes | no | no | no | no | no |

## Faults outside the key

### gemini-3.1-pro-preview c3: 0 faults outside the key



### gemini-3.1-pro-preview c4: 0 faults outside the key



### gemini-3.8-flash c3: 0 faults outside the key



### gemini-3.8-flash c4: 0 faults outside the key



### gpt-5.6-sol-pro c3: 0 faults outside the key



### gemini-3.1-pro, c2 (pipeline): 0 faults outside the key



### gemini-3.8-flash, c2 (pipeline): 0 faults outside the key



### gemini-3.8-flash, c3 (pipeline): 0 faults outside the key



### sol-pro, c2 (pipeline): 0 faults outside the key



### sonnet-5.5, c2 (pipeline): 0 faults outside the key



### terra-pro, c2 (pipeline): 0 faults outside the key


