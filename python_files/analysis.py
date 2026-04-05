"""
Top-3 Combination Analyzer
----------------------------
For races with more than 3 candidates, finds all ordered combinations
(permutations) of the top 3 candidates per precinct and counts them.

Reports:
- Overall top-3 combination counts with voter totals (ordered by voters)
- Top-3 combination counts broken down by who came in 1st place

Run:
    python top3_combinations.py
"""

import json
from collections import Counter, defaultdict
from pathlib import Path

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
BASE      = Path(__file__).resolve().parent.parent
JSON_PATH = BASE / "data" / "election_csvs" / "clean" / "2026" / "Primary" / "2026_primary.json"

# Races to analyze (add more as needed)
RACES_TO_ANALYZE = [
    "Illinois_9th_Congressional_DEM_Primary",
]


# ---------------------------------------------------------------------------
# Analysis
# ---------------------------------------------------------------------------

def safe_float(v):
    try:
        return float(v or 0)
    except (ValueError, TypeError):
        return 0.0


def get_top3(race_data: dict) -> tuple | None:
    """
    Returns (ordered top-3 tuple, total_voters) or None if fewer than 3
    candidates have votes. Ties broken alphabetically for consistency.
    """
    candidates = {k: v for k, v in race_data.items() if k != 'Total Voters'}
    ranked = sorted(candidates.items(), key=lambda x: (-safe_float(x[1]), x[0]))
    ranked = [(name, votes) for name, votes in ranked if safe_float(votes) > 0]
    if len(ranked) < 3:
        return None
    total_voters = safe_float(race_data.get('Total Voters', 0))
    return tuple(name for name, _ in ranked[:3]), total_voters


def analyze_race(data: dict, race_name: str) -> None:
    print(f"\n{'='*70}")
    print(f"Race: {race_name}")
    print(f"{'='*70}")

    overall_counter   = Counter()
    overall_voters    = defaultdict(int)
    by_leader_counter = defaultdict(Counter)
    by_leader_voters  = defaultdict(lambda: defaultdict(int))
    total_precincts   = 0
    skipped           = 0

    for jf, precinct in data.items():
        race_data = precinct.get('races', {}).get(race_name)
        if not race_data:
            continue

        result = get_top3(race_data)
        if result is None:
            skipped += 1
            continue

        top3, voters = result
        overall_counter[top3]             += 1
        overall_voters[top3]              += int(voters)
        by_leader_counter[top3[0]][top3]  += 1
        by_leader_voters[top3[0]][top3]   += int(voters)
        total_precincts += 1

    print(f"\nTotal precincts analyzed: {total_precincts}")
    if skipped:
        print(f"Skipped (fewer than 3 candidates with votes): {skipped}")
    print(f"Unique top-3 ordered combinations: {len(overall_counter)}")

    total_voters_all = sum(overall_voters.values())

    # ── Overall combinations (sorted by voters) ──
    print(f"\n{'─'*70}")
    print("TOP-3 COMBINATIONS (overall, ordered by total voters)")
    print(f"{'─'*70}")
    print(f"{'Rank':<5} {'Combination':<48} {'Count':>6} {'%':>6} {'Voters':>8} {'Voters%':>8} {'Avg':>6}")
    print(f"{'-'*5} {'-'*48} {'-'*6} {'-'*6} {'-'*8} {'-'*8} {'-'*6}")

    for rank, combo in enumerate(sorted(overall_counter.keys(), key=lambda c: -overall_voters[c]), 1):
        count     = overall_counter[combo]
        pct       = count / total_precincts * 100
        voters    = overall_voters[combo]
        vpct      = voters / total_voters_all * 100 if total_voters_all else 0
        avg       = voters / count if count else 0
        combo_str = ' → '.join(combo)
        print(f"{rank:<5} {combo_str:<48} {count:>6} {pct:>5.1f}% {voters:>8,} {vpct:>7.1f}% {avg:>6.0f}")

    # ── By leader (sorted by voters within each leader) ──
    all_leaders = sorted(
        by_leader_counter.keys(),
        key=lambda l: sum(by_leader_voters[l].values()),
        reverse=True
    )

    for leader in all_leaders:
        leader_total        = sum(by_leader_counter[leader].values())
        leader_voters_total = sum(by_leader_voters[leader].values())
        pct_of_all          = leader_total / total_precincts * 100
        unique              = len(by_leader_counter[leader])

        print(f"\n{'─'*70}")
        print(f"LEADER: {leader}")
        print(f"  {leader_total} precincts ({pct_of_all:.1f}% of total) · "
              f"{leader_voters_total:,} voters · "
              f"{unique} unique combo{'s' if unique != 1 else ''}")
        print(f"{'─'*70}")
        print(f"{'Rank':<5} {'Combination':<48} {'Count':>6} {'% leader':>9} {'Voters':>8} {'Avg':>6}")
        print(f"{'-'*5} {'-'*48} {'-'*6} {'-'*9} {'-'*8} {'-'*6}")

        for rank, combo in enumerate(sorted(by_leader_counter[leader].keys(), key=lambda c: -by_leader_voters[leader][c]), 1):
            count     = by_leader_counter[leader][combo]
            pct       = count / leader_total * 100
            voters    = by_leader_voters[leader][combo]
            avg       = voters / count if count else 0
            combo_str = ' → '.join(combo)
            print(f"{rank:<5} {combo_str:<48} {count:>6} {pct:>8.1f}% {voters:>8,} {avg:>6.0f}")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    print(f"Loading: {JSON_PATH}")
    with open(JSON_PATH, encoding='utf-8') as f:
        data = json.load(f)
    print(f"Loaded {len(data)} precincts")

    for race in RACES_TO_ANALYZE:
        analyze_race(data, race)

    print(f"\n{'='*70}")
    print("Done.")


if __name__ == "__main__":
    main()