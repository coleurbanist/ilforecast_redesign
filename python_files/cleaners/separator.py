"""
County Consolidated File Extractor
------------------------------------
Reads the consolidated .xls/.xlsx file in each county's consolidated/ folder,
extracts specific numbered sheets, and saves them as CSVs in unconsolidated/.

Counties and sheets:
  Lake:    11, 12, 15, 19, 56, 57, 60, 63, 17, 62
  McHenry: 4, 6, 9, 11, 115, 116, 119, 121
  DuPage:  2, 3, 4, 5, 10, 11, 24, 25
  Will:    2, 3, 6, 9, 365, 366, 369, 372

Run:
    python Extract_County_Sheets.py
"""

from pathlib import Path
import pandas as pd

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
BASE      = Path(__file__).resolve().parent.parent.parent  # project root
UNCLEANED = BASE / "data" / "uncleaned election files"

# ---------------------------------------------------------------------------
# Config: county -> list of sheet names to extract (as strings)
# ---------------------------------------------------------------------------
COUNTY_SHEETS = {
    "Lake":    ["11", "12", "15", "19", "56", "57", "60", "63", "17", "62"],
    #"McHenry": ["4", "6", "9", "11", "115", "116", "119", "121"],
    #"DuPage":  ["2", "3", "4", "5", "10", "11", "24", "25"],
    #"Will":    ["2", "3", "6", "9", "365", "366", "369", "372"],
}


# ---------------------------------------------------------------------------
# Find the single spreadsheet in a consolidated/ folder
# ---------------------------------------------------------------------------

def find_consolidated_file(county: str) -> Path | None:
    folder = UNCLEANED / county / "consolidated"
    if not folder.exists():
        print(f"  ERROR: folder not found: {folder}")
        return None
    matches = list(folder.glob("*.xlsx")) + list(folder.glob("*.xls"))
    if not matches:
        print(f"  ERROR: no .xls/.xlsx found in {folder}")
        return None
    if len(matches) > 1:
        print(f"  WARNING: multiple files found in {folder}, using first: {matches[0].name}")
    return matches[0]


# ---------------------------------------------------------------------------
# Extract sheets for one county
# ---------------------------------------------------------------------------

def extract_county(county: str, sheet_names: list[str]) -> None:
    print(f"\n{'='*50}")
    print(f"County: {county}")

    src_file = find_consolidated_file(county)
    if src_file is None:
        return

    print(f"Source: {src_file.name}")

    # Load workbook and get available sheet names

    try:
        engine = "xlrd" if src_file.suffix.lower() == ".xls" else "openpyxl"
        xl = pd.ExcelFile(src_file, engine=engine)
    except Exception as e:
        print(f"  ERROR opening file: {e}")
        return

    available = xl.sheet_names
    print(f"Available sheets: {available}")

    out_dir = UNCLEANED / county / "unconsolidated"
    out_dir.mkdir(parents=True, exist_ok=True)

    for sheet in sheet_names:
        # Match sheet name as string or integer
        matched = None
        for s in available:
            if str(s).strip() == str(sheet).strip():
                matched = s
                break

        if matched is None:
            print(f"  WARNING: sheet '{sheet}' not found — skipping")
            continue

        try:
            df = pd.read_excel(src_file, sheet_name=matched, header=None, dtype=str, engine=engine)
            out_path = out_dir / f"sheet_{sheet}.csv"
            df.to_csv(out_path, index=False, header=False)
            print(f"  OK: sheet '{sheet}' -> {out_path.name}  ({len(df)} rows x {len(df.columns)} cols)")
        except Exception as e:
            print(f"  ERROR on sheet '{sheet}': {e}")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    print(f"Project root: {BASE}")
    for county, sheets in COUNTY_SHEETS.items():
        extract_county(county, sheets)
    print(f"\nDone.")


if __name__ == "__main__":
    main()