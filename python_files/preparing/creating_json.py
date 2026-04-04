"""
2026 Primary Election CSV -> JSON
----------------------------------
Combines all CSVs under data/election_csvs/clean/2026/Primary subfolders
into a single JSON keyed by JoinField.

Race name convention:
  Congressional, Statewide -> {filename}_Primary
  Cook_County, State_House, State_Senate -> {folder}_{filename}_Primary

Output: data/election_csvs/clean/2026/Primary/2026_primary.json

Run:
    python build_2026_json.py
"""

import json
import pandas as pd
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
BASE      = Path(__file__).resolve().parent.parent.parent
PRIMARY   = BASE / "data" / "election_csvs" / "clean" / "2026" / "Primary"
OUT_PATH  = PRIMARY / "2026_primary.json"

SKIP_COLS    = {"JoinField", "JoinField_alt", "Ward/Township", "Precinct"}
FOLDER_PREFIX = {"Cook_County", "State_House", "State_Senate"}


# ---------------------------------------------------------------------------
# Build race name from file path
# ---------------------------------------------------------------------------

def race_name(csv_path: Path) -> str:
    folder = csv_path.parent.name
    stem   = csv_path.stem
    if folder in FOLDER_PREFIX:
        return f"{folder}_{stem}_Primary"
    else:
        return f"{stem}_Primary"


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    csv_files = sorted(PRIMARY.rglob("*.csv"))
    if not csv_files:
        print(f"No CSV files found under {PRIMARY}")
        return

    print(f"Found {len(csv_files)} CSV file(s)\n")

    data = {}
    total_rows = 0

    for csv_path in csv_files:
        name = race_name(csv_path)
        print(f"Processing: {csv_path.relative_to(PRIMARY)}  ->  {name}")

        try:
            df = pd.read_csv(csv_path, dtype=str)

            if "JoinField" not in df.columns:
                print(f"  SKIP (no JoinField column)")
                continue

            vote_cols = [c for c in df.columns if c not in SKIP_COLS]

            for _, row in df.iterrows():
                jf = str(row["JoinField"]).strip() if pd.notna(row["JoinField"]) else None
                if not jf:
                    continue

                if jf not in data:
                    data[jf] = {
                        "Ward/Township": str(row.get("Ward/Township", "")).strip(),
                        "Precinct":      str(row.get("Precinct", "")).strip(),
                        "races":         {}
                    }

                race_entry = {}
                for col in vote_cols:
                    val = row.get(col)
                    try:
                        race_entry[col] = int(float(val)) if pd.notna(val) else None
                    except (ValueError, TypeError):
                        race_entry[col] = val

                data[jf]["races"][name] = race_entry
                total_rows += 1

        except Exception as e:
            print(f"  ERROR: {e}")

    print(f"\nBuilt {len(data)} unique precincts from {total_rows} total rows")
    print(f"Saving to {OUT_PATH.name} ...")

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    size_mb = OUT_PATH.stat().st_size / 1_000_000
    print(f"Done. File size: {size_mb:.2f} MB")


if __name__ == "__main__":
    main()