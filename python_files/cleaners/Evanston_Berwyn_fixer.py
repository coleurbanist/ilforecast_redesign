"""
Evanston/Berwyn Precinct Fixer
--------------------------------
Scans all CSVs under data/election_csvs/clean/2026/Primary subfolders.
For any row where Ward/Township is Evanston or Berwyn and Precinct is
just a number, replaces the Precinct value with "Ward X Precinct Y"
parsed from JoinField_alt.

Overwrites files in place.

Run:
    python Fix_Evanston_Berwyn.py
"""

import re
import pandas as pd
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
BASE      = Path(__file__).resolve().parent.parent.parent
SEARCH_DIR = BASE / "data" / "election_csvs" / "clean" / "2026" / "Primary"


# ---------------------------------------------------------------------------
# Parse "Ward X Precinct Y" from a JoinField_alt value
# e.g. "COOK:Evanston Ward 3 Precinct 2" -> "Ward 3 Precinct 2"
# ---------------------------------------------------------------------------

def extract_ward_precinct(jfa: str) -> str | None:
    if pd.isna(jfa):
        return None
    m = re.search(r'(Ward\s+\d+\s+Precinct\s+\d+)', str(jfa), re.IGNORECASE)
    return m.group(1) if m else None


# ---------------------------------------------------------------------------
# Fix a single CSV
# ---------------------------------------------------------------------------

def fix_file(csv_path: Path) -> int:
    df = pd.read_csv(csv_path, dtype=str)

    # Skip if required columns aren't present
    required = {"Ward/Township", "Precinct", "JoinField_alt"}
    if not required.issubset(df.columns):
        return 0

    # Find Evanston/Berwyn rows where Precinct is just a number
    mask = (
        df["Ward/Township"].str.strip().str.upper().isin(["EVANSTON", "BERWYN"]) &
        df["Precinct"].str.strip().str.match(r'^\d+$', na=False)
    )

    if mask.sum() == 0:
        return 0

    # Fix each matching row
    fixed = 0
    for idx in df[mask].index:
        correct = extract_ward_precinct(df.at[idx, "JoinField_alt"])
        if correct:
            df.at[idx, "Precinct"] = correct
            fixed += 1
        else:
            print(f"    WARNING: could not parse Ward/Precinct from: {df.at[idx, 'JoinField_alt']}")

    if fixed > 0:
        df.to_csv(csv_path, index=False)

    return fixed


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    print(f"Scanning: {SEARCH_DIR}\n")

    csv_files = sorted(SEARCH_DIR.rglob("*.csv"))
    if not csv_files:
        print("No CSV files found.")
        return

    total_files_fixed = 0
    total_rows_fixed = 0

    for csv_path in csv_files:
        fixed = fix_file(csv_path)
        if fixed > 0:
            print(f"  Fixed {fixed} row(s): {csv_path.relative_to(SEARCH_DIR)}")
            total_files_fixed += 1
            total_rows_fixed += fixed

    print(f"\nDone. {total_files_fixed} file(s) updated, {total_rows_fixed} row(s) fixed.")


if __name__ == "__main__":
    main()