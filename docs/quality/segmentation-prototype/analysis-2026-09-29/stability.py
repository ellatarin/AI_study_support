import collections, importlib.util, itertools, sys
sys.path.insert(0, ".")
spec = importlib.util.spec_from_file_location("rtr", "report-topic-rulings.py")
rtr = importlib.util.module_from_spec(spec); spec.loader.exec_module(rtr)

def leader(panel):
    counts = collections.Counter(panel); top = max(counts.values())
    leaders = [g for g, n in counts.items() if n == top]
    return leaders[0] if len(leaders) == 1 else None

print("| lecture | division | runs OK | distinct | most common | identical pairs | starts differing per pair | two panels of 9 agree (tied) |")
print("|---|---|---|---|---|---|---|---|")
for lec in rtr.LECTURES:
    for version in ("d13", "closest-d13"):
        runs = rtr.groupings(rtr.voted_division(version, lec))
        counts = collections.Counter(runs)
        pairs = list(itertools.combinations(runs, 2))
        same = sum(a == b for a, b in pairs) / len(pairs)
        diff = sum(len(a ^ b) for a, b in pairs) / len(pairs)
        agree = tied = total = 0
        idx = range(len(runs))
        for half in itertools.combinations(idx, 9):
            if 0 not in half: continue
            other = [i for i in idx if i not in half]
            a, b = leader([runs[i] for i in half]), leader([runs[i] for i in other])
            total += 1
            if a is None or b is None: tied += 1
            elif a == b: agree += 1
        name = "voted" if version == "d13" else "closest run"
        print(f"| {lec} | {name} | {len(runs)} | {len(counts)} | {counts.most_common(1)[0][1]}/{len(runs)} | {same:.0%} | {diff:.2f} | {agree/total:.0%} ({tied/total:.0%}) |")
