# Grouping analysis, 2026-09-29

One-off scripts from the session that settled grouping on g15, a panel of 18 and
the grouping closest to a 9/18 vote, and that prototyped retitling. Kept so the
numbers can be reproduced; not maintained. Run every script from the prototype
folder (`docs/quality/segmentation-prototype`), since each loads
`report-topic-rulings.py` and `division_support.py` from there.

| script | what it shows |
|---|---|
| `stability.py` | g12 on the voted and the closest-run d13 divisions: distinct groupings, most common, identical pairs, two panels of 9 agreeing |
| `grouping_methods.py <division>` | most common, vote and closest-to-vote groupings at bars 3–7 of 9: share right against the rulings, and two-panel stability |
| `topic_start_stability.py` | closest to the vote at bars 3–7 of 9: two-panel stability, and how often each contested topic start flips |
| `topic_start_stability_vote.py` | the same for the voted grouping |
| `panel18.py <lectures>` | from 36 g12 runs: closest to 5/9 against closest to 7–10 of 18, right, stability and flips |
| `g12_vs_g15.py` | g12 runs 1–18 against g15's 18: runs matching the ruling, the grouping at 9/18, and starts whose support moved |
| `closest_grouping_data.py <out-dir> <bar> <panel> <prompt>` | the chosen grouping per lecture with full text, for a review page |
| `build_page.py` | turns that data into the review page, optionally with a retitle version's titles |
| `write_rt3.py` | writes `closest-rt3-d13-l*`: each closest-run d13 division with r3's titles in place of the inherited ones |
| `rt3_vs_d13.py` | g15's 18 runs on those divisions against g15's 18 on the originals: runs matching the ruling, the grouping at 9/18, starts whose support moved. The result that put retitling after grouping |
| `initial_choice.py` | how often two panels of 9 initial splits choose the same split to deepen, per lecture |
| `chosen_compare.py <out-dir>` | the division chosen from the live pipeline's 18 runs against the one chosen from the prototype's 18 `d13` runs; writes `chosen.json` to `<out-dir>`. Reads the live workspaces |
| `write_live_chosen.py <out-dir>` | writes `runs/chosen-live18-l*` from that `chosen.json`, for `group-trial.mts` |
| `grouping_consistency.py <out-dir> [prefix] [lectures]` | two panels of 18 from 36 grouping runs: same grouping, starts differing, right against the rulings |
| `nolabels_compare.py` | g15 without titles (runs 1–18) against g15 with titles, per lecture |
| `bar_sweep.py` | with and without titles, bars 5–14 of 18: steadiness and right against the rulings |

The last six measured the 18-run divisions and grouping with and without titles; their results are written up in `../DIVISION-AND-GROUPING-RESULTS.md`.

`closest-groupings.template.html` is the review page those two build.
