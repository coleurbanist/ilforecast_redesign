"""
CSV to Shapefile Precinct Matcher
-----------------------------------
Checks that all JoinField values in the 2026 Primary CSVs
match JoinField values in the IL24 shapefile (case-insensitive,
whitespace-normalized).

Saves unmatched rows (with source file column) to:
    data/helper_data/unmatched/unmatched_2026_primary.csv

Run:
    python csv_to_shapefile-26.py
"""

import re
import geopandas as gpd
import pandas as pd
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
BASE          = Path(__file__).resolve().parent.parent.parent
CSV_DIR       = BASE / "data" / "election_csvs" / "clean" / "2026" / "Primary"
SHP_PATH      = BASE / "data" / "election_shapefiles" / "IL24.shp"
UNMATCHED_DIR = BASE / "data" / "helper_data" / "unmatched"


# ---------------------------------------------------------------------------
# Normalization
# ---------------------------------------------------------------------------

def normalize(s: pd.Series) -> pd.Series:
    """Lowercase, strip edges, collapse internal whitespace."""
    return s.str.strip().str.lower().str.replace(r'\s+', ' ', regex=True)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print(f"Loading shapefile: {SHP_PATH.name}")
    gdf = gpd.read_file(SHP_PATH)

    if "JoinField" not in gdf.columns:
        print(f"ERROR: 'JoinField' column not found in shapefile.")
        print(f"Available columns: {gdf.columns.tolist()}")
        return

    shp_joinfields = set(normalize(gdf["JoinField"].dropna()).unique())
    print(f"Shapefile has {len(shp_joinfields)} unique JoinField values\n")

    csv_files = sorted(CSV_DIR.rglob("*.csv"))
    if not csv_files:
        print(f"No CSV files found under {CSV_DIR}")
        return

    print(f"Found {len(csv_files)} CSV file(s) to check\n")

    all_unmatched = []
    total_rows = 0
    total_unmatched = 0

    for csv_path in csv_files:
        try:
            df = pd.read_csv(csv_path, dtype=str)

            if "JoinField" not in df.columns:
                print(f"  SKIP (no JoinField column): {csv_path.relative_to(CSV_DIR)}")
                continue

            df["_source_file"] = str(csv_path.relative_to(CSV_DIR))
            matched = normalize(df["JoinField"]).isin(shp_joinfields)
            unmatched = df[~matched].copy()

            n_rows = len(df)
            n_unmatched = len(unmatched)
            total_rows += n_rows
            total_unmatched += n_unmatched

            status = f"  {n_unmatched} unmatched / {n_rows} rows" if n_unmatched > 0 else f"  OK: all {n_rows} rows matched"
            print(f"{csv_path.relative_to(CSV_DIR)}")
            print(status)

            if n_unmatched > 0:
                all_unmatched.append(unmatched)

        except Exception as e:
            print(f"  ERROR reading {csv_path.relative_to(CSV_DIR)}: {e}")

    print(f"\n{'='*60}")
    print(f"Total rows checked:   {total_rows}")
    print(f"Total unmatched:      {total_unmatched}")

    if all_unmatched:
        UNMATCHED_DIR.mkdir(parents=True, exist_ok=True)
        out_path = UNMATCHED_DIR / "unmatched_2026_primary.csv"
        combined = pd.concat(all_unmatched, ignore_index=True)
        cols = ["_source_file", "JoinField"] + [
            c for c in combined.columns if c not in ("_source_file", "JoinField")
        ]
        combined = combined[cols]
        combined.to_csv(out_path, index=False)
        print(f"Unmatched rows saved to: {out_path}")
    else:
        print("All rows matched — no unmatched file written.")


if __name__ == "__main__":
    main()