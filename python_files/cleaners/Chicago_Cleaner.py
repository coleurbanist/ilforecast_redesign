"""
Chicago City Election Data Cleaner
-----------------------------------
Batch cleans all .xls election result files from the City of Chicago into flat CSVs.

Input:  data/uncleaned election files/Chicago/*.xls
Output: data/semi-clean-election-files/Chicago/*.csv  (same filename, .xls -> .csv)

Run:
    python Chicago_Cleaner.py
"""

import csv
import glob
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
BASE = Path(__file__).resolve().parent.parent.parent  # cleaners/ -> python_files/ -> project root  # project root (ilforecast_redesign/)
INPUT_DIR    = BASE / "data" / "uncleaned election files" / "Chicago"
OUTPUT_DIR   = BASE / "data" / "semi-clean-election-files" / "Chicago"


# ---------------------------------------------------------------------------
# Step 1 - LibreOffice .xls -> CSV conversion
# ---------------------------------------------------------------------------

def find_libreoffice() -> str:
    if sys.platform == "win32":
        patterns = [
            r"C:\Program Files\LibreOffice*\program\soffice.exe",
            r"C:\Program Files (x86)\LibreOffice*\program\soffice.exe",
        ]
        for pattern in patterns:
            matches = glob.glob(pattern)
            if matches:
                return matches[0]
        raise FileNotFoundError(
            "LibreOffice not found. Install it from https://www.libreoffice.org "
            "or add its 'program' folder to your PATH."
        )
    for cmd in ("libreoffice", "soffice"):
        path = shutil.which(cmd)
        if path:
            return path
    mac_path = "/Applications/LibreOffice.app/Contents/MacOS/soffice"
    if os.path.isfile(mac_path):
        return mac_path
    raise FileNotFoundError(
        "LibreOffice not found. Install it from https://www.libreoffice.org "
        "or add its 'program' folder to your PATH."
    )


def xls_to_csv_rows(xls_path: str) -> list[list[str]]:
    soffice = find_libreoffice()
    with tempfile.TemporaryDirectory() as tmpdir:
        subprocess.run(
            [soffice, "--headless", "--convert-to", "csv", xls_path, "--outdir", tmpdir],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        base = os.path.splitext(os.path.basename(xls_path))[0]
        csv_path = os.path.join(tmpdir, base + ".csv")
        with open(csv_path, newline="", encoding="utf-8") as f:
            return list(csv.reader(f))


# ---------------------------------------------------------------------------
# Step 2 - Cleaning logic
# ---------------------------------------------------------------------------

def clean_rows(raw_rows: list[list[str]]) -> list[list[str]]:
    rows = raw_rows[3:]

    ward_re = re.compile(r"^\s*Ward\s+(\d+)\s*$", re.IGNORECASE)

    current_ward = None
    output_rows = []
    header_inserted = False
    precinct_col_idx = None
    pct_col_indices = set()

    for row in rows:
        if all(cell.strip() == "" for cell in row):
            continue

        stripped = [c.strip() for c in row]
        non_empty = [c for c in stripped if c]

        if len(non_empty) == 1 and ward_re.match(non_empty[0]):
            m = ward_re.match(non_empty[0])
            current_ward = m.group(1).zfill(2)
            continue

        if stripped[0].lower() == "total":
            continue

        if stripped[0].lower() == "precinct":
            if header_inserted:
                continue
            precinct_col_idx = 0
            pct_col_indices = {i for i, h in enumerate(stripped) if h == "%"}
            new_header = []
            for i, cell in enumerate(row):
                if i in pct_col_indices:
                    continue
                if i == precinct_col_idx:
                    new_header.append("JoinField")
                    new_header.append("Ward")
                new_header.append(cell)
            output_rows.append(new_header)
            header_inserted = True
            continue

        if precinct_col_idx is None or current_ward is None:
            continue

        precinct_raw = stripped[precinct_col_idx]
        try:
            precinct_num = str(int(float(precinct_raw))).zfill(2)
        except (ValueError, TypeError):
            precinct_num = precinct_raw.zfill(2) if precinct_raw.isdigit() else precinct_raw

        join_value = f"CITY OF CHICAGO:WARD {current_ward} PRECINCT {precinct_num}"

        new_row = []
        for i, cell in enumerate(row):
            if i in pct_col_indices:
                continue
            if i == precinct_col_idx:
                new_row.append(join_value)
                new_row.append(current_ward)
            new_row.append(cell)

        output_rows.append(new_row)

    return output_rows


# ---------------------------------------------------------------------------
# Step 3 - Write CSV
# ---------------------------------------------------------------------------

def write_csv(rows: list[list[str]], out_path: Path) -> None:
    with open(out_path, "w", newline="", encoding="utf-8") as f:
        csv.writer(f).writerows(rows)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    xls_files = sorted(INPUT_DIR.glob("*.xls"))
    if not xls_files:
        print(f"No .xls files found in {INPUT_DIR}")
        return

    print(f"Found {len(xls_files)} file(s) to process\n")

    success, failed = 0, []

    for xls_path in xls_files:
        out_path = OUTPUT_DIR / (xls_path.stem + ".csv")
        print(f"Processing: {xls_path.name}")
        try:
            raw_rows = xls_to_csv_rows(str(xls_path))
            cleaned = clean_rows(raw_rows)
            write_csv(cleaned, out_path)
            print(f"  -> saved {len(cleaned) - 1} data rows to {out_path.name}")
            success += 1
        except Exception as e:
            print(f"  ERROR: {e}")
            failed.append(xls_path.name)

    print(f"\nDone. {success} succeeded, {len(failed)} failed.")
    if failed:
        print("Failed files:")
        for f in failed:
            print(f"  {f}")


if __name__ == "__main__":
    main()