"""
Lake County Election Data Cleaner
-----------------------------------
Cleans all CSVs from unconsolidated/ and saves to semi-clean-election-files/Lake/.

Steps:
1. Delete row 0 (race title)
2. Delete column 1 (Registered Voters)
3. Use row 0 (candidate names) as column headers, replacing every "Total Votes" with the name above it
4. Delete the now-redundant header row (row 1 which had "Total Votes" labels)
5. Add Total Voters column (sum of all candidate columns)
6. Insert JoinField = "LAKE:" + County value (uppercased)
7. Delete County column

Run:
    python Lake_Cleaner.py
"""

import pandas as pd
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
BASE       = Path(__file__).resolve().parent.parent.parent
INPUT_DIR  = BASE / "data" / "uncleaned election files" / "Lake" / "unconsolidated"
OUTPUT_DIR = BASE / "data" / "semi-clean-election-files" / "Lake"


# ---------------------------------------------------------------------------
# Clean a single CSV
# ---------------------------------------------------------------------------

def clean_file(csv_path: Path) -> pd.DataFrame:
    df = pd.read_csv(csv_path, header=None, dtype=str)

    # Step 1: drop row 0 (race title)
    df = df.drop(index=0).reset_index(drop=True)

    # Step 2: drop column 1 (Registered Voters)
    df = df.drop(columns=1)
    df.columns = range(len(df.columns))

    # Now: row 0 = candidate names (with NaN in col 0)
    #      row 1 = "County", "Total Votes", "Total Votes", ...
    #      row 2+ = data

    # Step 3: build column names from row 0 (candidate names)
    candidate_names = df.iloc[0].tolist()  # [NaN, 'Kevin Ryan', 'Robin Kelly', ...]

    # row 1 has "County" in col 0 and "Total Votes" everywhere else — we don't need it
    # Use candidate_names as headers, col 0 will be "County"
    headers = []
    for i, name in enumerate(candidate_names):
        if i == 0:
            headers.append("County")
        else:
            # Use candidate name from row 0 (already the right name)
            headers.append(str(name).strip() if pd.notna(name) and str(name).strip() else f"col_{i}")

    # Step 4: drop rows 0 and 1 (candidate name row + Total Votes label row)
    df = df.drop(index=[0, 1]).reset_index(drop=True)
    df.columns = headers

    # Convert candidate columns to numeric
    candidate_cols = [c for c in df.columns if c != "County"]
    df[candidate_cols] = df[candidate_cols].apply(pd.to_numeric, errors="coerce").fillna(0).astype(int)

    # Step 5: add Total Voters = sum of all candidate columns
    df["Total Voters"] = df[candidate_cols].sum(axis=1)

    # Step 6: insert JoinField = "LAKE:" + County uppercased
    df.insert(0, "JoinField", "LAKE:" + df["County"].str.strip().str.upper())

    # Step 7: drop County column
    df = df.drop(columns=["County"])

    return df


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    csv_files = sorted(INPUT_DIR.glob("*.csv"))
    if not csv_files:
        print(f"No CSV files found in {INPUT_DIR}")
        return

    print(f"Found {len(csv_files)} file(s) to process\n")

    success, failed = 0, []

    for csv_path in csv_files:
        out_path = OUTPUT_DIR / csv_path.name
        print(f"Processing: {csv_path.name}")
        try:
            df = clean_file(csv_path)
            df.to_csv(out_path, index=False)
            print(f"  -> saved {len(df)} rows, {len(df.columns)} cols to {out_path.name}")
            success += 1
        except Exception as e:
            print(f"  ERROR: {e}")
            failed.append(csv_path.name)

    print(f"\nDone. {success} succeeded, {len(failed)} failed.")
    if failed:
        print("Failed files:")
        for f in failed:
            print(f"  {f}")


if __name__ == "__main__":
    main()