"""
DEM and GOP Primary Election File Combiner
-------------------------------------------
For DEM: processes Comptroller, Governor, Senate folders under
         data/uncleaned election files/DEM/
For GOP: processes all race folders under
         data/uncleaned election files/GOP/

Run:
    python DEM_GOP_Combiner.py
"""

import csv
import re
import pandas as pd
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
BASE      = Path(__file__).resolve().parent.parent.parent
UNCLEANED = BASE / "data" / "uncleaned election files"
SEMICLEAN = BASE / "data" / "semi-clean-election-files"

DEM_RACES = ["Comptroller", "Governor", "Senate"]


# ---------------------------------------------------------------------------
# File-type processors
# ---------------------------------------------------------------------------

def process_chicago(df: pd.DataFrame) -> pd.DataFrame:
    """
    Chicago files have: JoinField, Ward, Precinct, <votes>
    - Insert JoinField_alt (= JoinField) right after JoinField
    - Rename Ward -> Ward/Township
    """
    jf_idx = df.columns.get_loc("JoinField")
    df.insert(jf_idx + 1, "JoinField_alt", df["JoinField"].values)
    df = df.rename(columns={"Ward": "Ward/Township"})
    return df


def parse_cook_joinfield_alt(value: str):
    """
    'COOK:Elk Grove Precinct 22'        -> ('Elk Grove', '22')
    'COOK:Evanston Ward 1 Precinct 3'   -> ('Evanston', 'Ward 1 Precinct 3')
    'COOK:Berwyn Ward 2 Precinct 5'     -> ('Berwyn', 'Ward 2 Precinct 5')
    """
    if pd.isna(value):
        return "", ""
    inner = str(value).strip()
    if inner.upper().startswith("COOK:"):
        inner = inner[5:]

    # Evanston / Berwyn special case
    m = re.match(r'^(Evanston|Berwyn)\s+(Ward\s+\d+\s+Precinct\s+\d+)$', inner, re.IGNORECASE)
    if m:
        return m.group(1), m.group(2)

    # General: everything before "Precinct" is township
    m = re.match(r'^(.+?)\s+Precinct\s+(\d+)$', inner, re.IGNORECASE)
    if m:
        return m.group(1).strip(), m.group(2).strip()

    return inner, ""


def process_cook(df: pd.DataFrame) -> pd.DataFrame:
    """
    Cook files have: JoinField, JoinField_alt, <votes>
    - Insert Ward/Township and Precinct after JoinField_alt
    """
    alt_idx = df.columns.get_loc("JoinField_alt")
    townships, precincts = [], []
    for val in df["JoinField_alt"]:
        t, p = parse_cook_joinfield_alt(val)
        townships.append(t)
        precincts.append(p)
    df.insert(alt_idx + 1, "Ward/Township", townships)
    df.insert(alt_idx + 2, "Precinct", precincts)
    return df


def parse_other_joinfield(value: str):
    """
    'LAKE:ANTIOCH 1'        -> ('ANTIOCH', '1')
    'WILL:JOLIET PCT 001'   -> ('JOLIET', '001')
    'LAKE:NEW LENOX PCT 3'  -> ('NEW LENOX', '3')
    """
    if pd.isna(value):
        return "", ""
    inner = str(value).strip()
    if ':' in inner:
        inner = inner.split(':', 1)[1]

    # Will county PCT variant
    m = re.match(r'^(.+?)\s+PCT\s+(\d+)$', inner, re.IGNORECASE)
    if m:
        return m.group(1).strip(), m.group(2).strip()

    # General: last token is the number
    m = re.match(r'^(.+?)\s+(\d+)$', inner)
    if m:
        return m.group(1).strip(), m.group(2).strip()

    return inner, ""


def process_other(df: pd.DataFrame) -> pd.DataFrame:
    """
    Other county files have: JoinField, <votes>
    - Insert JoinField_alt (= JoinField), Ward/Township, Precinct after JoinField
    - Skip inserting any column that already exists
    """
    jf_idx = df.columns.get_loc("JoinField")

    townships, precincts = [], []
    for val in df["JoinField"]:
        t, p = parse_other_joinfield(val)
        townships.append(t)
        precincts.append(p)

    # Insert in reverse order so indices stay valid
    cols_to_insert = []
    if "JoinField_alt" not in df.columns:
        cols_to_insert.append(("JoinField_alt", df["JoinField"].values))
    if "Ward/Township" not in df.columns:
        cols_to_insert.append(("Ward/Township", townships))
    if "Precinct" not in df.columns:
        cols_to_insert.append(("Precinct", precincts))

    insert_pos = jf_idx + 1
    for col_name, col_vals in cols_to_insert:
        df.insert(insert_pos, col_name, col_vals)
        insert_pos += 1

    return df


# ---------------------------------------------------------------------------
# Route a single file to the right processor
# ---------------------------------------------------------------------------

def process_file(csv_path: Path) -> pd.DataFrame:
    df = pd.read_csv(csv_path, dtype=str)
    name = csv_path.stem.upper()

    if name.endswith("_CHICAGO"):
        return process_chicago(df)
    elif name.endswith("_COOK"):
        return process_cook(df)
    else:
        return process_other(df)


# ---------------------------------------------------------------------------
# Combine all files in a race folder with repeated headers between blocks
# ---------------------------------------------------------------------------

def combine_race_folder(folder: Path, party: str) -> None:
    csv_files = sorted(folder.glob("*.csv"))
    if not csv_files:
        print(f"  No CSV files found in {folder}")
        return

    out_dir = SEMICLEAN / party
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{folder.name}_{party}_combined.csv"

    rows_out = []

    for csv_path in csv_files:
        print(f"  Processing: {csv_path.name}")
        try:
            df = process_file(csv_path)
            rows_out.append(df.columns.tolist())          # header row
            for _, row in df.iterrows():
                rows_out.append(row.tolist())             # data rows
        except Exception as e:
            print(f"    ERROR: {e}")

    with open(out_path, "w", newline="", encoding="utf-8") as f:
        csv.writer(f).writerows(rows_out)

    print(f"  -> saved {len(rows_out)} rows (incl. headers) to {out_path.name}\n")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    print(f"Project root: {BASE}\n")

    print("=" * 60)
    print("DEM RACES")
    print("=" * 60)
    dem_dir = UNCLEANED / "DEM"
    for race in DEM_RACES:
        folder = dem_dir / race
        if not folder.exists():
            print(f"  SKIP (not found): {folder}")
            continue
        print(f"\nRace: {race}")
        combine_race_folder(folder, "DEM")

    print("=" * 60)
    print("GOP RACES")
    print("=" * 60)
    gop_dir = UNCLEANED / "GOP"
    if not gop_dir.exists():
        print(f"  GOP directory not found: {gop_dir}")
    else:
        for folder in sorted(gop_dir.iterdir()):
            if folder.is_dir():
                print(f"\nRace: {folder.name}")
                combine_race_folder(folder, "GOP")

    print("Done.")


if __name__ == "__main__":
    main()