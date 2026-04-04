"""
District GeoJSON Clipper
--------------------------
Creates one clipped GeoJSON per race category by intersecting
IL24.geojson precinct boundaries with each district shapefile.

Outputs (all saved to data/election_shapefiles/):
  IL24_congressional.geojson  — clipped to congressional districts, tagged cd_district
  IL24_house.geojson          — clipped to state house districts,    tagged house_district
  IL24_senate.geojson         — clipped to state senate districts,   tagged senate_district
  IL24_cook_county.geojson    — clipped to BOR + CCC districts,      tagged bor_district / ccc_district
  IL24_slim.geojson           — unchanged (used for statewide races)

Vote data is NOT modified. Split precincts carry the full precinct
vote total on each fragment — the precinct is the atomic reporting unit.

Run:
    python clip_districts.py
"""

import geopandas as gpd
import pandas as pd
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
BASE     = Path(__file__).resolve().parent
SHP_DIR  = BASE / "data" / "election_shapefiles"
OTHER    = BASE / "data" / "other_shapefiles"
IN_PATH  = SHP_DIR / "IL24.geojson"

# District shapefiles
CONGRESSIONAL_SHP = OTHER / "22_congressional_districts.shp"
HOUSE_SHP         = OTHER / "State_house.shp"
SENATE_SHP        = OTHER / "State_senate.shp"
BOR_SHP           = OTHER / "BOR.shp"
CCC_SHP           = OTHER / "CCC_districts.shp"

# Jurisdictions to keep (same as slim_geojson.py)
KEEP_PREFIXES = {
    "city of chicago", "cook", "dupage", "lake", "mchenry", "will",
    "kane", "champaign", "peoria", "mclean", "st. clair", "madison",
    "rock island", "winnebago", "sangamon",
    "city of bloomington", "city of rockford", "city of east st. louis"
}

# Congressional district number -> race name fragment mapping
# CD118FP value -> number used in race name
CONGRESSIONAL_MAP = {
    '02': '2nd',
    '05': '5th',
    '07': '7th',
    '08': '8th',
    '09': '9th',
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def matches_prefix(join_field: str) -> bool:
    if not join_field:
        return False
    prefix = str(join_field).strip().lower().split(':')[0].strip()
    return prefix in KEEP_PREFIXES


def load_precincts() -> gpd.GeoDataFrame:
    print(f"Loading precincts: {IN_PATH.name}")
    gdf = gpd.read_file(IN_PATH)
    mask = gdf["JoinField"].apply(matches_prefix)
    gdf = gdf[mask][["JoinField", "geometry"]].copy()
    print(f"  {len(gdf)} precincts after jurisdiction filter")
    # Ensure valid geometries
    gdf["geometry"] = gdf["geometry"].buffer(0)
    return gdf


def clip_and_tag(precincts: gpd.GeoDataFrame,
                 districts: gpd.GeoDataFrame,
                 district_col: str,
                 tag_col: str,
                 district_filter=None) -> gpd.GeoDataFrame:
    """
    Intersect precincts with districts.
    Each precinct fragment inherits the district tag.
    Vote data (JoinField) is preserved unchanged on every fragment.
    """
    # Match CRS
    if districts.crs != precincts.crs:
        districts = districts.to_crs(precincts.crs)

    # Optionally filter to specific districts
    if district_filter is not None:
        districts = districts[districts[district_col].astype(str).isin(
            [str(d) for d in district_filter]
        )].copy()

    print(f"  Clipping against {len(districts)} district(s)...")

    # Keep only needed columns from districts
    districts = districts[[district_col, "geometry"]].copy()
    districts = districts.rename(columns={district_col: tag_col})

    # Overlay: intersection gives precinct fragments tagged with district
    clipped = gpd.overlay(precincts, districts, how="intersection", keep_geom_type=True)

    # Drop empty geometries
    clipped = clipped[~clipped.geometry.is_empty].copy()
    clipped = clipped[clipped.geometry.notna()].copy()

    print(f"  {len(precincts)} precincts → {len(clipped)} features after clipping")
    return clipped


def save(gdf: gpd.GeoDataFrame, out_path: Path) -> None:
    gdf.to_file(out_path, driver="GeoJSON")
    size_mb = out_path.stat().st_size / 1e6
    print(f"  Saved: {out_path.name} ({size_mb:.1f} MB)")


# ---------------------------------------------------------------------------
# Per-category clipping
# ---------------------------------------------------------------------------

def make_congressional(precincts):
    print("\n=== Congressional ===")
    districts = gpd.read_file(CONGRESSIONAL_SHP)
    print(f"  Columns: {districts.columns.tolist()}")

    # Only keep districts we have races for
    districts = districts[districts["CD118FP"].isin(CONGRESSIONAL_MAP.keys())].copy()

    # Map CD118FP to the race-friendly number string
    districts["cd_district"] = districts["CD118FP"].map(CONGRESSIONAL_MAP)

    clipped = clip_and_tag(precincts, districts, "cd_district", "cd_district")
    save(clipped, SHP_DIR / "IL24_congressional.geojson")


def make_house(precincts):
    print("\n=== State House ===")
    districts = gpd.read_file(HOUSE_SHP)
    print(f"  Columns: {districts.columns.tolist()}")
    print(f"  Districts available: {sorted(districts['DISTRICT'].unique())[:10]}...")

    # Only clip to districts we have races for
    race_districts = [13, 40]
    clipped = clip_and_tag(precincts, districts, "DISTRICT", "house_district",
                           district_filter=race_districts)
    # Ensure house_district is stored as integer string
    clipped["house_district"] = clipped["house_district"].astype(str)
    save(clipped, SHP_DIR / "IL24_house.geojson")


def make_senate(precincts):
    print("\n=== State Senate ===")
    districts = gpd.read_file(SENATE_SHP)
    print(f"  Columns: {districts.columns.tolist()}")

    race_districts = [6, 9]
    clipped = clip_and_tag(precincts, districts, "DISTRICT", "senate_district",
                           district_filter=race_districts)
    clipped["senate_district"] = clipped["senate_district"].astype(str)
    save(clipped, SHP_DIR / "IL24_senate.geojson")


def make_cook_county(precincts):
    print("\n=== Cook County (BOR + CCC) ===")

    # BOR districts 1 and 2
    bor = gpd.read_file(BOR_SHP)
    print(f"  BOR columns: {bor.columns.tolist()}")
    bor_clipped = clip_and_tag(precincts, bor, "DISTRICT_I", "bor_district",
                               district_filter=[1, 2])
    bor_clipped["bor_district"] = bor_clipped["bor_district"].astype(str)

    # CCC district 10 only
    ccc = gpd.read_file(CCC_SHP)
    print(f"  CCC columns: {ccc.columns.tolist()}")
    ccc_clipped = clip_and_tag(precincts, ccc, "DISTRICT_I", "ccc_district",
                               district_filter=[10])
    ccc_clipped["ccc_district"] = ccc_clipped["ccc_district"].astype(str)

    # Merge BOR and CCC into one file — both keep their own tag columns
    # Features will have NaN for the tag that doesn't apply to them
    combined = pd.concat([bor_clipped, ccc_clipped], ignore_index=True)
    combined = gpd.GeoDataFrame(combined, geometry="geometry", crs=precincts.crs)

    save(combined, SHP_DIR / "IL24_cook_county.geojson")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    precincts = load_precincts()

    make_congressional(precincts)
    make_house(precincts)
    make_senate(precincts)
    make_cook_county(precincts)

    print("\n✓ All clipped GeoJSON files created.")
    print("\nUpdate data.js RACE_GEOJSON map to point to these files.")


if __name__ == "__main__":
    main()