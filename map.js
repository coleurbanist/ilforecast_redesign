/**
 * map.js — Map rendering layer
 * Uses Leaflet + the data layer to render choropleth maps.
 * Depends on: Leaflet (CDN), data.js
 */

const ElectionMap = (() => {

  let _map         = null;

  function _norm(s) {
    if (!s) return '';
    return s.trim().toUpperCase().replace(/\s+/g, ' ');
  }

  function _filterGeoJSON(geojson, raceName, jurisdictionFilter) {
    if (!geojson) return null;
    const features = geojson.features.filter(f => {
      const jf = f.properties?.JoinField;
      if (!jf) return false;
      if (jurisdictionFilter && !jurisdictionFilter.includes(jf.split(':')[0])) return false;
      return ElectionData.getRaceData(jf, raceName) !== null;
    });
    return { ...geojson, features };
  }

  let _geojsonLayer            = null;
  let _currentRace             = null;
  let _currentMode             = 'winner';
  let _currentHeatCandidate    = null;
  let _currentGroupA           = [];
  let _currentGroupB           = [];
  let _currentGroupC           = [];
  let _currentOrderingCandidates = [];
  let _currentJurisdictions    = null;
  let _onPrecinctClick         = null;

  const CANDIDATE_COLORS = [
    '#4f93d1', '#d16f4f', '#5cb85c', '#9b59b6',
    '#f39c12', '#1abc9c', '#e74c3c', '#3498db',
    '#e67e22', '#2ecc71', '#95a5a6', '#c0392b',
    '#f1c40f',
  ];

  let _candidateColorMap = {};

  // ── Init ──────────────────────────────────────────────────────────────────

  function init(containerId) {
    const renderer = L.canvas({ padding: 0.5 });
    _map = L.map(containerId, {
      center: [41.85, -87.85],
      zoom: 10,
      zoomControl: true,
      renderer: renderer,
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(_map);
    return _map;
  }

  // ── Color utilities ───────────────────────────────────────────────────────

  const RACE_COLORS = {
    'Illinois_9th_Congressional_DEM_Primary': {
      'Daniel Biss':     '#9b59b6',
      'Kat Abughazaleh': '#f39c12',
      'Mike Simmons':    '#ff69b4',
      'Hoan Huynh':      '#95a5a6',
      'Laura Fine':      '#5cb85c',
      'Bushra Amiwala':  '#1abc9c',
      'Phil Andrew':     '#e74c3c',
    },
  };

  const ORDERING_SHADES = {
    '012': 0.95, '021': 0.45,
    '102': 0.95, '120': 0.45,
    '201': 0.95, '210': 0.45,
  };

  const ORDERING_LEADER_COLORS = ['#4f93d1', '#d16f4f', '#2ecc71'];

  function _getOrderingColor(ordering, candidates) {
    if (!ordering || candidates.length < 2) return '#888';
    const leaderIdx = parseInt(ordering[0]);
    const baseColor = ORDERING_LEADER_COLORS[leaderIdx] || '#888';
    const shade = ORDERING_SHADES[ordering] ?? 0.7;
    return lerpColor('#1c2330', baseColor, shade);
  }

  function assignCandidateColors(candidates, raceName) {
    _candidateColorMap = {};
    const overrides = RACE_COLORS[raceName] || {};
    candidates.forEach((c, i) => {
      _candidateColorMap[c] = overrides[c] || CANDIDATE_COLORS[i % CANDIDATE_COLORS.length];
    });
    return _candidateColorMap;
  }

  function getCandidateColor(name) {
    return _candidateColorMap[name] || '#888';
  }

  function lerpColor(colorA, colorB, t) {
    const a = hexToRgb(colorA);
    const b = hexToRgb(colorB);
    return `rgb(${Math.round(a.r+(b.r-a.r)*t)},${Math.round(a.g+(b.g-a.g)*t)},${Math.round(a.b+(b.b-a.b)*t)})`;
  }

  function hexToRgb(hex) {
    const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return r ? { r: parseInt(r[1],16), g: parseInt(r[2],16), b: parseInt(r[3],16) } : { r:128, g:128, b:128 };
  }

  // ── Layer rendering ───────────────────────────────────────────────────────

  async function render(raceName, mode, options = {}) {
    _currentRace = raceName;
    _currentMode = mode;
    _currentJurisdictions = options.jurisdictions || null;

    if (_geojsonLayer) { _map.removeLayer(_geojsonLayer); _geojsonLayer = null; }

    const baseGeoJSON = await ElectionData.loadGeoJSONForRace(raceName, 'data/election_shapefiles/');
    const geojson = _filterGeoJSON(baseGeoJSON, raceName, _currentJurisdictions);
    if (!geojson || geojson.features.length === 0) {
      console.warn('No GeoJSON features for race:', raceName);
      return;
    }

    if      (mode === 'winner')   _renderWinner(raceName, geojson);
    else if (mode === 'heat')     _renderHeat(raceName, options.candidate, geojson);
    else if (mode === 'group')    _renderGroup(raceName, options.groupA || [], options.groupB || [], geojson, options);
    else if (mode === 'ordering') _renderOrdering(raceName, options.candidates || [], geojson);

    if (_geojsonLayer) _map.fitBounds(_geojsonLayer.getBounds(), { padding: [20, 20] });
  }

  function _renderWinner(raceName, geojson) {
    const candidates = ElectionData.getCandidates(raceName);
    assignCandidateColors(candidates, raceName);
    _geojsonLayer = L.geoJSON(geojson, {
      style: feature => {
        const jf = feature.properties.JoinField;
        const raceData = ElectionData.getRaceData(jf, raceName);
        if (!raceData) return _noDataStyle();
        const winner  = _getWinner(raceData, candidates);
        const share   = _getWinnerShare(raceData, winner);
        const color   = winner ? getCandidateColor(winner) : '#333';
        const opacity = winner ? 0.3 + (share * 0.7) : 0.15;
        return { fillColor: color, fillOpacity: opacity, color, weight: 0.5, smoothFactor: 0 };
      },
      onEachFeature: _bindTooltip,
    }).addTo(_map);
  }

  function _renderHeat(raceName, candidateName, geojson) {
    if (!candidateName) return;
    _currentHeatCandidate = candidateName;
    const deviations = ElectionData.computeHeatDeviation(raceName, candidateName, _currentJurisdictions);
    _geojsonLayer = L.geoJSON(geojson, {
      style: feature => {
        const jf = feature.properties.JoinField;
        const d  = deviations.get(_norm(jf));
        if (!d || d.deviation === null) return _noDataStyle();
        const t = Math.min(Math.abs(d.deviation) / 0.3, 1);
        const color = d.deviation >= 0
          ? lerpColor('#1c2330', '#4f93d1', t)
          : lerpColor('#1c2330', '#d16f4f', t);
        return { fillColor: color, fillOpacity: 0.85, color, weight: 0.5, smoothFactor: 0 };
      },
      onEachFeature: _bindTooltip,
    }).addTo(_map);
  }

  function _renderGroup(raceName, groupA, groupB, geojson, options = {}) {
    const groupC = options.groupC || [];
    if (!groupA.length && !groupB.length && !groupC.length) return;
    _currentGroupA = groupA;
    _currentGroupB = groupB;
    _currentGroupC = groupC;
    const totals = ElectionData.computeGroupTotals(raceName, groupA, groupB, _currentJurisdictions, groupC);
    _geojsonLayer = L.geoJSON(geojson, {
      style: feature => {
        const jf = feature.properties.JoinField;
        const d  = totals.get(_norm(jf));
        if (!d || d.total === 0) return _noDataStyle();
        const winner = d.groupC > d.groupA && d.groupC > d.groupB ? 'c'
                     : d.groupA >= d.groupB ? 'a' : 'b';
        const baseColor = winner === 'a' ? '#4f93d1' : winner === 'b' ? '#d16f4f' : '#2ecc71';
        const winShare  = winner === 'a' ? d.shareA  : winner === 'b' ? d.shareB  : d.shareC;
        const color = lerpColor('#2a3040', baseColor, 0.3 + (winShare || 0) * 0.7);
        return { fillColor: color, fillOpacity: 0.85, color, weight: 0.5, smoothFactor: 0 };
      },
      onEachFeature: _bindTooltip,
    }).addTo(_map);
  }

  function _renderOrdering(raceName, candidates, geojson) {
    if (!candidates.length) return;
    _currentOrderingCandidates = candidates;
    const totals = ElectionData.computeOrderingTotals(raceName, candidates, _currentJurisdictions);
    _geojsonLayer = L.geoJSON(geojson, {
      style: feature => {
        const jf = feature.properties.JoinField;
        const d  = totals.get(_norm(jf));
        if (!d) return _noDataStyle();
        const color = _getOrderingColor(d.ordering, candidates);
        return { fillColor: color, fillOpacity: 0.85, color, weight: 0.5, smoothFactor: 0 };
      },
      onEachFeature: _bindTooltip,
    }).addTo(_map);
  }

  // ── Tooltip ───────────────────────────────────────────────────────────────

  function _bindTooltip(feature, layer) {
    layer.on({
      mouseover: e => {
        e.target.setStyle({ weight: 2, color: 'rgba(255,255,255,0.5)' });
        e.target.bringToFront();
      },
      mouseout: e => { _geojsonLayer.resetStyle(e.target); },
      click: e => {
        const jf = feature.properties.JoinField;
        if (_onPrecinctClick) _onPrecinctClick(jf);
      },
      mousemove: e => {
        const jf = feature.properties.JoinField;
        const raceData = ElectionData.getRaceData(jf, _currentRace);
        if (!raceData) return;

        const candidates = ElectionData.getCandidates(_currentRace);
        const total = raceData['Total Voters'] || 0;
        let rows;

        if (_currentMode === 'group') {
          const groups = [
            { label: _currentGroupA.join(' + ') || 'Group A', members: _currentGroupA, color: '#4f93d1' },
            { label: _currentGroupB.join(' + ') || 'Group B', members: _currentGroupB, color: '#d16f4f' },
            { label: _currentGroupC.join(' + ') || 'Group C', members: _currentGroupC, color: '#2ecc71' },
          ].filter(g => g.members.length > 0);
          const combined = groups.reduce((sum, g) =>
            sum + g.members.reduce((s, c) => s + (parseFloat(raceData[c]) || 0), 0), 0);
          rows = groups.map(g => {
            const v   = g.members.reduce((s, c) => s + (parseFloat(raceData[c]) || 0), 0);
            const pct = combined > 0 ? ((v / combined) * 100).toFixed(1) : '—';
            const dot = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${g.color};margin-right:5px;"></span>`;
            return `<tr><td>${dot}${g.label}</td><td style="text-align:right;padding-left:16px;font-family:monospace">${v.toLocaleString()} (${pct}%)</td></tr>`;
          }).join('');

        } else if (_currentMode === 'ordering' && _currentOrderingCandidates.length) {
          const combined = _currentOrderingCandidates.reduce((s, c) => s + (parseFloat(raceData[c]) || 0), 0);
          rows = [..._currentOrderingCandidates]
            .map(c => ({ c, v: parseFloat(raceData[c]) || 0 }))
            .sort((a, b) => b.v - a.v)
            .map(({ c, v }) => {
              const pct = combined > 0 ? ((v / combined) * 100).toFixed(1) : '—';
              const dot = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${getCandidateColor(c)};margin-right:5px;"></span>`;
              return `<tr><td>${dot}${c}</td><td style="text-align:right;padding-left:16px;font-family:monospace">${v.toLocaleString()} (${pct}%)</td></tr>`;
            }).join('');

        } else {
          rows = [...candidates]
            .sort((a, b) => (parseFloat(raceData[b]) || 0) - (parseFloat(raceData[a]) || 0))
            .map(c => {
              const v   = parseFloat(raceData[c]) || 0;
              const pct = total > 0 ? ((v / total) * 100).toFixed(1) : '—';
              const dot = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${getCandidateColor(c)};margin-right:5px;"></span>`;
              return `<tr><td>${dot}${c}</td><td style="text-align:right;padding-left:16px;font-family:monospace">${v.toLocaleString()} (${pct}%)</td></tr>`;
            }).join('');
        }

        const precinct = _precinctLabel(jf);
        layer.bindTooltip(`
          <div style="font-family:'DM Sans',sans-serif;font-size:12px;min-width:220px">
            <div style="font-weight:600;margin-bottom:6px;border-bottom:1px solid rgba(255,255,255,0.2);padding-bottom:4px">${precinct}</div>
            <table style="width:100%;border-collapse:collapse">${rows}</table>
            <div style="margin-top:6px;color:#8b949e;font-size:11px">Total: ${total.toLocaleString()}</div>
          </div>
        `, { sticky: false, opacity: 0.97, className: 'cem-tooltip', offset: L.point(16, 0), direction: 'right' }).openTooltip(e.latlng);
      },
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function _noDataStyle() {
    return { fillColor: '#1c2330', fillOpacity: 0.5, color: '#1c2330', weight: 0.5, smoothFactor: 0 };
  }

  function _getWinner(raceData, candidates) {
    let winner = null, max = -1;
    for (const c of candidates) {
      if ((parseFloat(raceData[c]) || 0) > max) { max = parseFloat(raceData[c]); winner = c; }
    }
    return winner;
  }

  function _getWinnerShare(raceData, winner) {
    const total = parseFloat(raceData['Total Voters']) || 0;
    return total > 0 ? (parseFloat(raceData[winner]) || 0) / total : 0;
  }

  function _precinctLabel(jf) {
    const precinct = ElectionData.raw[jf] ||
      ElectionData.raw[Object.keys(ElectionData.raw).find(k => k.toUpperCase() === jf.toUpperCase())];
    if (!precinct) return jf;
    const jurRaw    = jf.split(':')[0].trim();
    const isChicago = jurRaw.toUpperCase() === 'CITY OF CHICAGO';
    const jur       = isChicago ? 'Chicago' : jurRaw;
    const ward      = precinct['Ward/Township'] || '';
    const prec      = precinct['Precinct'] || '';
    if (isChicago && ward && prec) return `${jur} · Ward ${ward} · Precinct ${prec}`;
    return [jur, ward, prec].filter(Boolean).join(' · ');
  }

  // ── Public API ────────────────────────────────────────────────────────────

  return {
    init,
    render,
    assignCandidateColors,
    getCandidateColor,
    _getOrderingColor,
    get map() { return _map; },
    get candidateColors() { return _candidateColorMap; },
    onPrecinctClick(fn) { _onPrecinctClick = fn; },
  };

})();