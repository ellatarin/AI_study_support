"""How often two panels of 9 initial splits would hand deepening a different division."""
import collections, itertools, sys
sys.path.insert(0, ".")
from division_support import closest_to_vote_run, cut_sites_with_runs, load_splitting_runs, site_sets, survives
FULL = (1 << 18) - 1
print("| lecture | distinct divisions in 18 runs | most common made by | two panels hand on the same division | cut sites the two differ on, average | most often chosen division |")
print("|---|---|---|---|---|---|")
for n in range(1, 9):
    runs = load_splitting_runs(f"split-s6-l{n}-*.blocks.json")
    assert len(runs) == 18
    sites = cut_sites_with_runs(runs)
    sets = site_sets(sites, 18)
    chosen = {}
    for panel in itertools.combinations(range(18), 9):
        mask = sum(1 << r for r in panel)
        voted = frozenset(i for i, (_, m) in enumerate(sites) if survives(m, mask, 5))
        chosen[mask] = sets[closest_to_vote_run(sets, panel, voted)]
    same = diff = pairs = 0
    for mask, division in chosen.items():
        other = chosen[FULL ^ mask]
        pairs += 1; same += division == other; diff += len(division ^ other)
    made = collections.Counter(sets)
    top = collections.Counter(chosen.values()).most_common(1)[0][1] / len(chosen)
    print(f"| l{n} | {len(made)} | {made.most_common(1)[0][1]} of 18 | {same / pairs:.0%} | {diff / pairs:.1f} | {top:.0%} of panels |")
