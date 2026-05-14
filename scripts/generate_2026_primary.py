"""
Generate 2026 primary JSON data files from illinois_elections.db.

Outputs:
  data/election_csvs/clean/2026/Primary/2026_primary.json         (precinct-level)
  data/election_csvs/clean/2026/Primary/2026_primary_counties.json (county-level)

Run from the project root:
  python3 scripts/generate_2026_primary.py
"""

import sqlite3, json, os

DB_PATH  = '/home/cole/databases/illinois_elections.db'
OUT_DIR  = os.path.join(os.path.dirname(__file__), '..', 'data', 'election_csvs', 'clean', '2026', 'Primary')
OUT_PREC = os.path.join(OUT_DIR, '2026_primary.json')
OUT_CTY  = os.path.join(OUT_DIR, '2026_primary_counties.json')


# ── Helpers ──────────────────────────────────────────────────────────────────

def ordinal(n, upper=False):
    n = int(n)
    if 11 <= (n % 100) <= 13:
        suf = 'th'
    else:
        suf = {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')
    s = f"{n}{suf}"
    return s.upper() if upper else s


def normalize_party(party):
    """Collapse all Democrat/Democratic/DEMOCRATIC/Democratic Party variants."""
    p = party.strip().upper()
    if p.startswith('DEM'):
        return 'DEMOCRATIC'
    if p.startswith('REP'):
        return 'REPUBLICAN'
    return party.upper()


def party_abbrev(party):
    return 'DEM' if normalize_party(party) == 'DEMOCRATIC' else 'GOP'


def precinct_race_key(race_type, district, party):
    """Race key format consumed by data.js _parseRaceMeta / _raceLabel."""
    pa = party_abbrev(party)
    d  = int(district) if district is not None else None

    simple = {
        'us_senate':          f'Senate_{pa}_Primary',
        'governor':           f'Governor_{pa}_Primary',
        'comptroller':        f'Comptroller_{pa}_Primary',
        'secretary_of_state': f'Secretary_of_State_{pa}_Primary',
        'treasurer':          f'Treasurer_{pa}_Primary',
        'attorney_general':   f'Attorney_General_{pa}_Primary',
        'cook_assessor':      f'Cook_County_Assessor_{pa}_Primary',
        'cook_board_president': f'Cook_County_Board_President_{pa}_Primary',
    }
    if race_type in simple:
        return simple[race_type]
    if race_type == 'us_house':
        return f'Illinois_{ordinal(d)}_Congressional_{pa}_Primary'
    if race_type == 'state_senate':
        return f'State_Senate_District_{d}_{pa}_Primary'
    if race_type == 'state_house':
        return f'State_House_District_{d}_{pa}_Primary'
    if race_type == 'cook_bor':
        return f'Cook_County_Board_of_Review_District_{d}_{pa}_Primary'
    if race_type == 'cook_commissioner':
        return f'Cook_County_Commissioner_District_{d}_{pa}_Primary'
    return f'{race_type}_{pa}_Primary'


def county_race_name(race_type, district):
    """Human-readable race name used in county JSON and county_maps.html."""
    d = int(district) if district is not None else None

    simple = {
        'us_senate':            'UNITED STATES SENATOR',
        'governor':             'GOVERNOR AND LIEUTENANT GOVERNOR',
        'attorney_general':     'ATTORNEY GENERAL',
        'comptroller':          'COMPTROLLER',
        'secretary_of_state':   'SECRETARY OF STATE',
        'treasurer':            'TREASURER',
        'cook_assessor':        'COOK COUNTY ASSESSOR',
        'cook_board_president': 'COOK COUNTY BOARD PRESIDENT',
    }
    if race_type in simple:
        return simple[race_type]
    if race_type == 'us_house':
        return f'{ordinal(d, upper=True)} CONGRESS'
    if race_type == 'state_senate':
        return f'{ordinal(d, upper=True)} SENATE'
    if race_type == 'state_house':
        return f'{ordinal(d, upper=True)} REPRESENTATIVE'
    if race_type == 'cook_bor':
        return f'COOK COUNTY BOARD OF REVIEW DISTRICT {d}'
    if race_type == 'cook_commissioner':
        return f'COOK COUNTY COMMISSIONER DISTRICT {d}'
    return race_type.upper().replace('_', ' ')


# ── Query ─────────────────────────────────────────────────────────────────────

conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row
cur  = conn.cursor()

print("Querying precinct-level data…")
cur.execute("""
    SELECT er.JoinField,
           er.race_type,
           er.district,
           er.candidate_name,
           er.party,
           ROUND(SUM(er.votes)) AS votes
    FROM   election_results er
    WHERE  er.year = 2026
      AND  er.election_type = 'primary'
    GROUP  BY er.JoinField, er.race_type, er.district, er.candidate_name, er.party
""")
precinct_rows = cur.fetchall()
print(f"  {len(precinct_rows):,} rows")

print("Querying county-level data…")
cur.execute("""
    SELECT er.race_type,
           er.district,
           er.candidate_name,
           er.party,
           jc.county,
           ROUND(SUM(er.votes)) AS votes
    FROM   election_results er
    JOIN   (SELECT DISTINCT JoinField, county
            FROM   blocks
            WHERE  JoinField IS NOT NULL AND county IS NOT NULL) jc
             ON er.JoinField = jc.JoinField
    WHERE  er.year = 2026
      AND  er.election_type = 'primary'
    GROUP  BY er.race_type, er.district, er.candidate_name, er.party, jc.county
""")
county_rows = cur.fetchall()
print(f"  {len(county_rows):,} rows")
conn.close()


# ── Build precinct JSON ───────────────────────────────────────────────────────

precincts = {}
for row in precinct_rows:
    jf = row['JoinField'].upper()            # data.js normalizes to uppercase
    rk = precinct_race_key(row['race_type'], row['district'], row['party'])

    if jf not in precincts:
        precincts[jf] = {'races': {}}
    if rk not in precincts[jf]['races']:
        precincts[jf]['races'][rk] = {}

    precincts[jf]['races'][rk][row['candidate_name']] = int(row['votes'])

# Add Total Voters per race per precinct
for pdata in precincts.values():
    for rdata in pdata['races'].values():
        rdata['Total Voters'] = sum(v for k, v in rdata.items() if k != 'Total Voters')

print(f"\nPrecincts: {len(precincts):,}")


# ── Build county JSON ─────────────────────────────────────────────────────────

counties = {}
for row in county_rows:
    county = row['county']
    rname  = county_race_name(row['race_type'], row['district'])
    party  = normalize_party(row['party'])
    votes  = int(row['votes'])

    if county not in counties:
        counties[county] = {'races': {}}
    if rname not in counties[county]['races']:
        counties[county]['races'][rname] = []

    race_list = counties[county]['races'][rname]
    existing  = next((c for c in race_list
                      if c['name'] == row['candidate_name'] and c['party'] == party), None)
    if existing:
        existing['votes'] += votes
    else:
        race_list.append({'name': row['candidate_name'], 'party': party, 'votes': votes})

print(f"Counties: {len(counties):,}")


# ── Write ─────────────────────────────────────────────────────────────────────

os.makedirs(OUT_DIR, exist_ok=True)

with open(OUT_PREC, 'w') as f:
    json.dump(precincts, f)
print(f"\nWrote {OUT_PREC}  ({os.path.getsize(OUT_PREC)/1024:.0f} KB)")

with open(OUT_CTY, 'w') as f:
    json.dump(counties, f, indent=2)
print(f"Wrote {OUT_CTY}  ({os.path.getsize(OUT_CTY)/1024:.0f} KB)")
