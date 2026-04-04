"""
Cook County Election Data Cleaner
-----------------------------------
Batch cleans all .xlsx election result files from Cook County into flat CSVs.

Input:  data/uncleaned election files/Cook/*.xlsx
Output: data/semi-clean-election-files/Cook/*.csv  (same filename, .xlsx -> .csv)

Run:
    python Cook_Cleaner.py
"""

import os
import pandas as pd
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
BASE          = Path(__file__).resolve().parent.parent.parent  # cleaners/ -> python_files/ -> project root
INPUT_DIR     = BASE / "data" / "uncleaned election files" / "Cook"
OUTPUT_DIR    = BASE / "data" / "semi-clean-election-files" / "Cook"
CONVERTER_PATH = BASE / "data" / "helper_data" /"cook_converter.csv"


# ---------------------------------------------------------------------------
# Load converter once at startup
# ---------------------------------------------------------------------------

def load_converter(path: Path) -> dict:
    """Return a dict mapping lowercased JoinField_alt -> JoinField."""
    df = pd.read_csv(path, dtype=str)
    return {row["JoinField_alt"].strip().lower(): row["JoinField"].strip()
            for _, row in df.iterrows()}


# ---------------------------------------------------------------------------
# Clean a single xlsx file
# ---------------------------------------------------------------------------

def clean_file(xlsx_path: Path, converter: dict) -> pd.DataFrame:
    df = pd.read_excel(xlsx_path, sheet_name="Precinct", dtype=str)

    # Rename Total Votes -> Total Voters
    df = df.rename(columns={"Total Votes": "Total Voters"})

    # Drop Registered Voters and Ballots Cast
    df = df.drop(columns=["Registered Voters", "Ballots Cast"], errors="ignore")

    # Build JoinField_alt: "COOK:" + Precinct value (preserve original casing for output)
    df["JoinField_alt"] = "COOK:" + df["Precinct"].str.strip()

    # Look up JoinField from converter (case-insensitive)
    df["JoinField"] = df["JoinField_alt"].str.lower().map(converter)

    # Report any unmatched precincts
    unmatched = df[df["JoinField"].isna()]["JoinField_alt"].tolist()
    if unmatched:
        print(f"  WARNING: {len(unmatched)} unmatched precinct(s):")
        for u in unmatched:
            print(f"    {u}")

    # Drop Precinct column
    df = df.drop(columns=["Precinct"])

    # Reorder: JoinField, JoinField_alt, then everything else
    other_cols = [c for c in df.columns if c not in ("JoinField", "JoinField_alt")]
    df = df[["JoinField", "JoinField_alt"] + other_cols]

    return df


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    if not CONVERTER_PATH.exists():
        print(f"ERROR: converter not found at {CONVERTER_PATH}")
        return

    converter = load_converter(CONVERTER_PATH)
    print(f"Loaded converter with {len(converter)} entries")
    print(f"Looking in: {INPUT_DIR}\n")

    xlsx_files = sorted([
        f for f in INPUT_DIR.glob("*.xlsx")
        if f.name != CONVERTER_PATH.name  # skip converter if it were xlsx
    ])

    if not xlsx_files:
        print(f"No .xlsx files found in {INPUT_DIR}")
        return

    print(f"Found {len(xlsx_files)} file(s) to process\n")

    success, failed = 0, []

    for xlsx_path in xlsx_files:
        out_path = OUTPUT_DIR / (xlsx_path.stem + ".csv")
        print(f"Processing: {xlsx_path.name}")
        try:
            df = clean_file(xlsx_path, converter)
            df.to_csv(out_path, index=False)
            print(f"  -> saved {len(df)} rows to {out_path.name}")
            success += 1
        except Exception as e:
            print(f"  ERROR: {e}")
            failed.append(xlsx_path.name)

    print(f"\nDone. {success} succeeded, {len(failed)} failed.")
    if failed:
        print("Failed files:")
        for f in failed:
            print(f"  {f}")


if __name__ == "__main__":
    main()