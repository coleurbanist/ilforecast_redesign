/**
 * data.js — Election data layer
 *
 * JSON structure (flat races, all JoinField keys uppercase):
 * {
 *   "COOK:7000001": {
 *     "Ward/Township": "Barrington",
 *     "Precinct": "1",
 *     "races": {
 *       "Cook_County_Assessor_DEM_Primary": { "Fritz Kaegi": 75, "Total Voters": 170 },
 *       ...
 *     }
 *   }
 * }
 */

const ElectionData = (() => {

  let _precincts    = null;
  let _geojson      = null;
  let _normalizeMap = null;
  const _categoryGeoJSON = {};

  // ── Normalization ─────────────────────────────────────────────────────────

  function _norm(s) {
    if (!s) return '';
    return s.trim().toUpperCase().replace(/\s+/g, ' ');
  }

  function _buildNormalizeMap() {
    _normalizeMap = new Map();
    for (const key of Object.keys(_precincts)) {
      _normalizeMap.set(_norm(key), key);
    }
  }

  function _getPrecinct(joinField) {
    if (!joinField) return null;
    if (_precincts[joinField]) return _precincts[joinField];
    const canonical = _normalizeMap.get(_norm(joinField));
    return canonical ? _precincts[canonical] : null;
  }

  function _canonicalKey(joinField) {
    if (!joinField) return null;
    if (_precincts[joinField]) return joinField;
    return _normalizeMap.get(_norm(joinField)) ?? null;
  }

  // ── Loaders ───────────────────────────────────────────────────────────────

  async function load(jsonPath, geojsonPath) {
    const [precinctRes, geoRes] = await Promise.all([
      fetch(jsonPath),
      fetch(geojsonPath),
    ]);
    _precincts = await precinctRes.json();
    _geojson   = await geoRes.json();

    for (const key of Object.keys(_precincts)) {
      if (!key.includes(':')) delete _precincts[key];
    }

    _buildNormalizeMap();
    console.log(`Loaded ${Object.keys(_precincts).length} precincts`);
    return { precincts: _precincts, geojson: _geojson };
  }

  // ── Race metadata helpers ─────────────────────────────────────────────────

  function _parseRaceMeta(raceName) {
    const upper = raceName.toUpperCase();
    const party = upper.includes('_DEM_') ? 'Democrat' : 'Republican';
    let category;
    if (upper.startsWith('COOK_COUNTY_')) {
      category = 'Cook County';
    } else if (upper.startsWith('STATE_HOUSE_')) {
      category = 'State House';
    } else if (upper.startsWith('STATE_SENATE_')) {
      category = 'State Senate';
    } else if (upper.includes('CONGRESSIONAL')) {
      category = 'Congressional';
    } else {
      category = 'Statewide';
    }
    return { party, category };
  }

  function _raceLabel(raceName) {
    return raceName
      .replace(/_Primary$/i, '')
      .replace(/_(DEM|GOP)$/i, '')
      .replace(/^Cook_County_/i, '')
      .replace(/^Illinois_/i, '')
      .replace(/^State_House_District_/i, 'House District ')
      .replace(/^State_Senate_District_/i, 'Senate District ')
      .replace(/_/g, ' ')
      .trim();
  }

  // ── Race discovery ────────────────────────────────────────────────────────

  function getRaces() {
    const seen = new Set();
    for (const precinct of Object.values(_precincts)) {
      for (const raceName of Object.keys(precinct.races || {})) {
        seen.add(raceName);
      }
    }
    return Array.from(seen)
      .map(raceName => ({
        raceName,
        label: _raceLabel(raceName),
        ..._parseRaceMeta(raceName),
      }))
      .sort((a, b) =>
        a.party.localeCompare(b.party) ||
        a.category.localeCompare(b.category) ||
        a.label.localeCompare(b.label)
      );
  }

  function getCandidates(raceName) {
    for (const precinct of Object.values(_precincts)) {
      const raceData = precinct.races?.[raceName];
      if (raceData) {
        return Object.keys(raceData).filter(k => k !== 'Total Voters');
      }
    }
    return [];
  }

  function getJurisdictions(raceName) {
    const jurs = new Set();
    for (const [jf, precinct] of Object.entries(_precincts)) {
      if (precinct.races?.[raceName] !== undefined) {
        jurs.add(jf.split(':')[0]);
      }
    }
    return Array.from(jurs).sort();
  }

  // ── Precinct data access ──────────────────────────────────────────────────

  function getRaceData(joinField, raceName) {
    return _getPrecinct(joinField)?.races?.[raceName] ?? null;
  }

  function computeGroupTotals(raceName, groupA, groupB, jurisdictionFilter = null, groupC = []) {
    const result = new Map();
    for (const [jf, precinct] of Object.entries(_precincts)) {
      if (jurisdictionFilter && !jurisdictionFilter.includes(jf.split(':')[0])) continue;
      const raceData = precinct.races?.[raceName];
      if (!raceData) continue;
      const aTotal = groupA.reduce((sum, c) => sum + (parseFloat(raceData[c]) || 0), 0);
      const bTotal = groupB.reduce((sum, c) => sum + (parseFloat(raceData[c]) || 0), 0);
      const cTotal = groupC.reduce((sum, c) => sum + (parseFloat(raceData[c]) || 0), 0);
      const combined = aTotal + bTotal + cTotal;
      result.set(_norm(jf), {
        groupA: aTotal, groupB: bTotal, groupC: cTotal, total: combined,
        shareA: combined > 0 ? aTotal / combined : null,
        shareB: combined > 0 ? bTotal / combined : null,
        shareC: combined > 0 ? cTotal / combined : null,
      });
    }
    return result;
  }

  function computeHeatDeviation(raceName, candidateName, jurisdictionFilter = null) {
    let districtVotes = 0, districtTotal = 0;
    const raw = new Map();
    for (const [jf, precinct] of Object.entries(_precincts)) {
      if (jurisdictionFilter && !jurisdictionFilter.includes(jf.split(':')[0])) continue;
      const raceData = precinct.races?.[raceName];
      if (!raceData) continue;
      const votes = parseFloat(raceData[candidateName]) || 0;
      const total = parseFloat(raceData['Total Voters']) || 0;
      districtVotes += votes;
      districtTotal += total;
      raw.set(_norm(jf), { votes, total });
    }
    const districtShare = districtTotal > 0 ? districtVotes / districtTotal : 0;
    const result = new Map();
    for (const [jf, { votes, total }] of raw) {
      const share = total > 0 ? votes / total : null;
      result.set(jf, {
        votes, total, share,
        deviation: share !== null ? share - districtShare : null,
        districtShare,
      });
    }
    return result;
  }

  function getDistrictTotals(raceName, jurisdictionFilter = null) {
    const totals = {};
    let totalVoters = 0;
    for (const [jf, precinct] of Object.entries(_precincts)) {
      if (jurisdictionFilter && !jurisdictionFilter.includes(jf.split(':')[0])) continue;
      const raceData = precinct.races?.[raceName];
      if (!raceData) continue;
      for (const [key, val] of Object.entries(raceData)) {
        const num = parseFloat(val) || 0;
        if (key === 'Total Voters') totalVoters += num;
        else totals[key] = (totals[key] || 0) + num;
      }
    }
    return { candidates: totals, totalVoters };
  }

  function getFilteredGeoJSON(raceName, jurisdictionFilter = null) {
    if (!_geojson) return null;
    const features = _geojson.features.filter(f => {
      const jf = f.properties?.JoinField;
      if (!jf) return false;
      if (jurisdictionFilter && !jurisdictionFilter.includes(jf.split(':')[0])) return false;
      return getRaceData(jf, raceName) !== null;
    });
    return { ..._geojson, features };
  }

  // ── Precincts won helpers ─────────────────────────────────────────────────

  function _getPrecinctsWon(raceName, jurisdictionFilter, groupA, groupB, groupC) {
    const won = {};
    let ties = 0;
    const isGroup = groupA.length || groupB.length || groupC.length;
    const gA = groupA || [];
    const gB = groupB || [];
    const gC = groupC || [];

    for (const [jf, precinct] of Object.entries(_precincts)) {
      if (jurisdictionFilter && !jurisdictionFilter.includes(jf.split(':')[0])) continue;
      const raceData = precinct.races?.[raceName];
      if (!raceData) continue;

      if (isGroup) {
        const aVotes = gA.reduce((s, c) => s + (parseFloat(raceData[c]) || 0), 0);
        const bVotes = gB.reduce((s, c) => s + (parseFloat(raceData[c]) || 0), 0);
        const cVotes = gC.reduce((s, c) => s + (parseFloat(raceData[c]) || 0), 0);
        const max = Math.max(aVotes, bVotes, cVotes);
        if (max === 0) continue;
        const winners = [];
        if (gA.length && aVotes === max) winners.push('__groupA');
        if (gB.length && bVotes === max) winners.push('__groupB');
        if (gC.length && cVotes === max) winners.push('__groupC');
        if (winners.length > 1) { ties++; winners.forEach(w => { won[w] = (won[w] || 0) + 1; }); }
        else if (winners.length === 1) won[winners[0]] = (won[winners[0]] || 0) + 1;
      } else {
        const candidates = Object.keys(raceData).filter(k => k !== 'Total Voters');
        const max = Math.max(...candidates.map(c => parseFloat(raceData[c]) || 0));
        if (max === 0 || isNaN(max)) continue;
        const winners = candidates.filter(c => (parseFloat(raceData[c]) || 0) === max);
        if (winners.length > 1) { ties++; winners.forEach(w => { won[w] = (won[w] || 0) + 1; }); }
        else won[winners[0]] = (won[winners[0]] || 0) + 1;
      }
    }
    return { won, ties };
  }

  function getJurisdictionTotals(raceName, jurisdictionFilter = null, groupA = [], groupB = [], groupC = []) {
    const byJur = {};

    for (const [jf, precinct] of Object.entries(_precincts)) {
      const jur = jf.split(':')[0];
      if (jurisdictionFilter && !jurisdictionFilter.includes(jur)) continue;
      const raceData = precinct.races?.[raceName];
      if (!raceData) continue;

      if (!byJur[jur]) byJur[jur] = { candidates: {}, totalVoters: 0, precinctCount: 0 };
      const entry = byJur[jur];
      entry.precinctCount++;

      for (const [key, val] of Object.entries(raceData)) {
        const num = parseFloat(val) || 0;
        if (key === 'Total Voters') entry.totalVoters += num;
        else entry.candidates[key] = (entry.candidates[key] || 0) + num;
      }
    }

    for (const jur of Object.keys(byJur)) {
      const { won, ties } = _getPrecinctsWon(raceName, [jur], groupA, groupB, groupC);
      byJur[jur].won = won;
      byJur[jur].ties = ties;
    }

    return byJur;
  }

  function getTownshipTotals(raceName, jurisdiction, groupA = [], groupB = [], groupC = []) {
    const byTownship = {};

    for (const [jf, precinct] of Object.entries(_precincts)) {
      const jur = jf.split(':')[0];
      if (jur !== jurisdiction) continue;
      const raceData = precinct.races?.[raceName];
      if (!raceData) continue;

      const township = precinct['Ward/Township'] || 'Unknown';
      if (!byTownship[township]) byTownship[township] = { candidates: {}, totalVoters: 0, precinctCount: 0 };
      const entry = byTownship[township];
      entry.precinctCount++;

      for (const [key, val] of Object.entries(raceData)) {
        const num = parseFloat(val) || 0;
        if (key === 'Total Voters') entry.totalVoters += num;
        else entry.candidates[key] = (entry.candidates[key] || 0) + num;
      }
    }

    for (const township of Object.keys(byTownship)) {
      const jfSet = new Set(
        Object.entries(_precincts)
          .filter(([jf, p]) => jf.split(':')[0] === jurisdiction && p['Ward/Township'] === township)
          .map(([jf]) => _norm(jf))
      );
      const { won, ties } = _getPrecinctsWonBySet(raceName, jfSet, groupA, groupB, groupC);
      byTownship[township].won = won;
      byTownship[township].ties = ties;
    }

    return byTownship;
  }

  function _getPrecinctsWonBySet(raceName, jfSet, groupA, groupB, groupC) {
    const won = {};
    let ties = 0;
    const isGroup = groupA.length || groupB.length || groupC.length;

    for (const [jf, precinct] of Object.entries(_precincts)) {
      if (!jfSet.has(_norm(jf))) continue;
      const raceData = precinct.races?.[raceName];
      if (!raceData) continue;

      if (isGroup) {
        const aVotes = groupA.reduce((s, c) => s + (parseFloat(raceData[c]) || 0), 0);
        const bVotes = groupB.reduce((s, c) => s + (parseFloat(raceData[c]) || 0), 0);
        const cVotes = groupC.reduce((s, c) => s + (parseFloat(raceData[c]) || 0), 0);
        const max = Math.max(aVotes, bVotes, cVotes);
        if (max === 0) continue;
        const winners = [];
        if (groupA.length && aVotes === max) winners.push('__groupA');
        if (groupB.length && bVotes === max) winners.push('__groupB');
        if (groupC.length && cVotes === max) winners.push('__groupC');
        if (winners.length > 1) { ties++; winners.forEach(w => { won[w] = (won[w] || 0) + 1; }); }
        else if (winners.length === 1) won[winners[0]] = (won[winners[0]] || 0) + 1;
      } else {
        const candidates = Object.keys(raceData).filter(k => k !== 'Total Voters');
        const max = Math.max(...candidates.map(c => parseFloat(raceData[c]) || 0));
        if (max === 0 || isNaN(max)) continue;
        const winners = candidates.filter(c => (parseFloat(raceData[c]) || 0) === max);
        if (winners.length > 1) { ties++; winners.forEach(w => { won[w] = (won[w] || 0) + 1; }); }
        else won[winners[0]] = (won[winners[0]] || 0) + 1;
      }
    }
    return { won, ties };
  }
  // ── GeoJSON management ────────────────────────────────────────────────────

  const GEOJSON_BASE = 'data/election_shapefiles/';

  const CATEGORY_GEOJSON = {
    'Congressional':  { file: 'IL24_congressional.geojson', field: 'cd_district' },
    'State House':    { file: 'IL24_house.geojson',         field: 'house_district' },
    'State Senate':   { file: 'IL24_senate.geojson',        field: 'senate_district' },
    'Cook County':    { file: 'IL24_cook_county.geojson',   field: null },
    'Statewide':      { file: 'IL24_slim.geojson',          field: null },
  };

  // Extract district number from race name e.g. "State_House_District_13_DEM_Primary" -> "13"
  function _extractDistrict(raceName) {
    const m = raceName.match(/District_(\w+)(?:_|$)/i);
    return m ? m[1] : null;
  }

  // Extract congressional district label e.g. "Illinois_9th_Congressional" -> "9th"
  function _extractCongressional(raceName) {
    const m = raceName.match(/Illinois_(\w+)_Congressional/i);
    return m ? m[1].toLowerCase() : null;
  }

  // Extract BOR/CCC district number
  function _extractCookDistrict(raceName) {
    const m = raceName.match(/District_(\d+)/i);
    return m ? m[1] : null;
  }

  async function loadGeoJSONForRace(raceName, geojsonBasePath) {
    const { category } = _parseRaceMeta(raceName);
    const config = CATEGORY_GEOJSON[category] || CATEGORY_GEOJSON['Statewide'];

    if (!_categoryGeoJSON[config.file]) {
      const res = await fetch(geojsonBasePath + config.file);
      _categoryGeoJSON[config.file] = await res.json();
    }

    const raw = _categoryGeoJSON[config.file];

    if (category === 'Congressional') {
      const districtValue = _extractCongressional(raceName);
      if (!districtValue) return raw;
      const features = raw.features.filter(f =>
        String(f.properties?.cd_district).toLowerCase() === districtValue
      );
      return { ...raw, features };

    } else if (category === 'Cook County') {
      const upper = raceName.toUpperCase();
      const isBOR = upper.includes('BOARD_OF_REVIEW');
      const isCCC = upper.includes('COMMISSIONER');

      // Board President and Assessor cover all of Cook — use slim GeoJSON
      if (!isBOR && !isCCC) {
        if (!_categoryGeoJSON['IL24_slim.geojson']) {
          const res = await fetch(geojsonBasePath + 'IL24_slim.geojson');
          _categoryGeoJSON['IL24_slim.geojson'] = await res.json();
        }
        return _categoryGeoJSON['IL24_slim.geojson'];
      }

      const num = _extractCookDistrict(raceName);
      if (!num) return raw;

      const field = isBOR ? 'bor_district' : 'ccc_district';
      const features = raw.features.filter(f =>
        String(f.properties?.[field]) === String(num)
      );
      return { ...raw, features };

    } else if (category === 'State House') {
      const m = raceName.match(/State_House_District_(\d+)/i);
      const districtValue = m ? m[1] : null;
      if (!districtValue) return raw;
      const features = raw.features.filter(f =>
        String(f.properties?.house_district) === String(districtValue)
      );
      return { ...raw, features };

    } else if (category === 'State Senate') {
      const m = raceName.match(/State_Senate_District_(\d+)/i);
      const districtValue = m ? m[1] : null;
      if (!districtValue) return raw;
      const features = raw.features.filter(f =>
        String(f.properties?.senate_district) === String(districtValue)
      );
      return { ...raw, features };
    }

    return raw;
  }
  function computeOrderingTotals(raceName, candidates, jurisdictionFilter = null) {
    // candidates is an array of up to 3 candidate names
    // Returns a Map: norm(jf) -> { ordering: 'ABC'|'ACB'|'BAC'|'BCA'|'CAB'|'CBA', votes: [a,b,c] }
    const result = new Map();

    for (const [jf, precinct] of Object.entries(_precincts)) {
      if (jurisdictionFilter && !jurisdictionFilter.includes(jf.split(':')[0])) continue;
      const raceData = precinct.races?.[raceName];
      if (!raceData) continue;

      const votes = candidates.map(c => parseFloat(raceData[c]) || 0);
      if (votes.every(v => v === 0)) continue;

      // Rank the selected candidates by votes descending
      const indexed = candidates.map((c, i) => ({ c, v: votes[i], i }))
        .sort((a, b) => b.v - a.v || a.c.localeCompare(b.c));

      const ordering = indexed.map(x => x.i).join('');  // e.g. "021" means c[0] 3rd, c[2] 1st, c[1] 2nd
      result.set(_norm(jf), { ordering, votes });
    }

    return result;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  return {
    load,
    getRaces,
    getCandidates,
    getJurisdictions,
    getRaceData,
    computeGroupTotals,
    computeHeatDeviation,
    getDistrictTotals,
    getJurisdictionTotals,
    getTownshipTotals,
    getFilteredGeoJSON,
    computeOrderingTotals,
    get raw() { return _precincts; },
    get geojson() { return _geojson; },
    loadGeoJSONForRace,
  };

})();