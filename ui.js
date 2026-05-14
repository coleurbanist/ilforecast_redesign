/**
 * ui.js — UI controller
 * Wires the sidebar race list, controls, grouping panel,
 * geographic filter, and stats table to data.js and map.js.
 * Depends on: data.js, map.js
 */

const ElectionUI = (() => {

  let _currentRace        = null;
  let _currentMode        = 'winner';
  let _currentCandidates  = [];
  let _groupA             = [];
  let _groupB             = [];
  let _groupC             = [];
  let _orderingCandidates = [];
  let _currentParty       = 'DEM';
  let _currentJurisdictions = null;
  let _currentJurLabel    = null;
  let _allJurisdictions   = [];
  let _geoPanel           = null;

  const CITY_MERGE = {
    'CITY OF GALESBURG':      'KNOX',
    'CITY OF DANVILLE':       'VERMILION',
    'CITY OF BLOOMINGTON':    'MCLEAN',
    'CITY OF EAST ST. LOUIS': 'ST. CLAIR',
  };

  // ── Init ──────────────────────────────────────────────────────────────────

  function init() {
    _buildRaceSelect();
    _bindPartyButtons();
    _bindModeButtons();
    document.addEventListener('click', e => {
      if (_geoPanel && !_geoPanel.closest('.geo-select-wrap').contains(e.target)) {
        _geoPanel.style.display = 'none';
        _geoPanel = null;
      }
    });
  }

  // ── Race select (top bar) ─────────────────────────────────────────────────

  function _formatRaceOption(raceName) {
    const s = raceName
      .replace(/_(DEM|GOP)_Primary$/, '')
      .replace(/^Illinois_/, '')
      .replace(/^State_(House|Senate)_District_/, 'District ')
      .replace(/^Cook_County_/, '')
      .replace(/_/g, ' ');
    if (s === 'Senate') return 'U.S. Senate';
    return s;
  }

  function _districtNum(raceName) {
    let m = raceName.match(/_District_(\d+)_/i);
    if (m) return parseInt(m[1], 10);
    m = raceName.match(/Illinois_(\d+)(?:st|nd|rd|th)_/i);
    if (m) return parseInt(m[1], 10);
    return null;
  }

  function _buildRaceSelect() {
    const sel = document.getElementById('race-select');
    if (!sel) return;
    sel.innerHTML = '';

    const partyLabel = (_currentParty === 'GOP') ? 'Republican' : 'Democrat';
    const races = ElectionData.getRaces().filter(r => r.party === partyLabel);

    const CAT_ORDER = ['Statewide', 'Congressional', 'State Senate', 'State House', 'Cook County'];
    const grouped = {};
    for (const r of races) {
      if (!grouped[r.category]) grouped[r.category] = [];
      grouped[r.category].push(r);
    }
    const cats = Object.keys(grouped).sort((a, b) => {
      const ia = CAT_ORDER.indexOf(a), ib = CAT_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });

    for (const cat of cats) {
      const grp = document.createElement('optgroup');
      grp.label = cat;
      const sorted = [...grouped[cat]].sort((a, b) => {
        const na = _districtNum(a.raceName), nb = _districtNum(b.raceName);
        if (na !== null && nb !== null) return na - nb;
        return _formatRaceOption(a.raceName).localeCompare(_formatRaceOption(b.raceName));
      });
      for (const r of sorted) {
        const opt = document.createElement('option');
        opt.value = r.raceName;
        opt.textContent = _formatRaceOption(r.raceName);
        if (r.raceName === _currentRace) opt.selected = true;
        grp.appendChild(opt);
      }
      sel.appendChild(grp);
    }

    sel.onchange = () => { if (sel.value) _selectRace(sel.value); };

    if (!_currentRace && sel.options.length) {
      _selectRace(sel.options[0].value);
    }
  }

  function _bindPartyButtons() {
    document.querySelectorAll('[data-party]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.party === _currentParty) return;
        _currentParty = btn.dataset.party;
        document.querySelectorAll('[data-party]').forEach(b =>
          b.classList.toggle('active', b.dataset.party === _currentParty));

        const demRace = _currentRace
          ? _currentRace.replace(/_(DEM|GOP)_Primary$/, '_DEM_Primary')
          : null;
        const demRaces = ElectionData.getRaces()
          .filter(r => r.party === 'Democrat')
          .map(r => r.raceName);

        if (_currentParty === 'COMPOSITE') {
          _currentRace = (demRace && demRaces.includes(demRace)) ? demRace : (demRaces[0] || null);
        } else {
          const suffix = `_${_currentParty}_Primary`;
          const equiv  = demRace ? demRace.replace('_DEM_Primary', suffix) : null;
          const partyRaces = ElectionData.getRaces()
            .filter(r => r.party === (_currentParty === 'DEM' ? 'Democrat' : 'Republican'))
            .map(r => r.raceName);
          _currentRace = (equiv && partyRaces.includes(equiv)) ? equiv : (partyRaces[0] || null);
        }

        _buildRaceSelect();
        if (_currentRace) _selectRace(_currentRace);
      });
    });
  }

  // ── Race selection ────────────────────────────────────────────────────────

  function _selectRace(raceName) {
    _currentRace        = raceName;
    _currentMode        = 'winner';
    _groupA             = [];
    _groupB             = [];
    _groupC             = [];
    _orderingCandidates = [];
    _currentJurisdictions = null;
    _currentJurLabel    = null;

    _currentCandidates = ElectionData.getCandidates(raceName);
    ElectionMap.assignCandidateColors(_currentCandidates, raceName);
    _allJurisdictions = ElectionData.getJurisdictions(raceName);

    const sel = document.getElementById('race-select');
    if (sel) sel.value = raceName;

    document.getElementById('map-controls').style.display = 'flex';
    document.getElementById('stats-section').style.display = 'block';

    // Reset mode-specific UI
    document.getElementById('heat-candidate-control').style.display = 'none';
    document.getElementById('grouping-panel').style.display = 'none';
    const orderingPanel = document.getElementById('ordering-panel');
    if (orderingPanel) orderingPanel.style.display = 'none';

    // Reset mode buttons
    document.querySelectorAll('[data-mode]').forEach(b => b.classList.remove('active'));
    document.querySelector('[data-mode="winner"]').classList.add('active');

    _buildHeatCandidateSelect();
    _buildGeoFilter();
    _updateModeButtons();
    _buildOrderingPanel();
    if (_currentParty === 'COMPOSITE') {
      ElectionMap.render(raceName, 'winner', { composite: true });
      _buildCompositeLegend();
    } else {
      ElectionMap.render(raceName, 'winner');
      _buildLegend();
    }
    _buildStatsTable();
    _updateGroupingPanel();
  }

  // ── Mode controls ─────────────────────────────────────────────────────────

  function _bindModeButtons() {
    document.querySelectorAll('[data-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!_currentRace) return;
        _currentMode = btn.dataset.mode;
        document.querySelectorAll('[data-mode]').forEach(b => {
          b.classList.toggle('active', b.dataset.mode === _currentMode);
        });
        _applyMode();
      });
    });
  }

  function _applyMode() {
    const heatControl   = document.getElementById('heat-candidate-control');
    const groupPanel    = document.getElementById('grouping-panel');
    const orderingPanel = document.getElementById('ordering-panel');
    const isComposite   = _currentParty === 'COMPOSITE';

    heatControl.style.display   = (!isComposite && _currentMode === 'heat')     ? 'flex'  : 'none';
    groupPanel.style.display    = (!isComposite && _currentMode === 'group')    ? 'block' : 'none';
    if (orderingPanel) orderingPanel.style.display = (!isComposite && _currentMode === 'ordering') ? 'block' : 'none';

    if (isComposite) {
      ElectionMap.render(_currentRace, 'winner', { jurisdictions: _currentJurisdictions, composite: true });
      _buildCompositeLegend();
      _buildStatsTable();
      return;
    }

    if (_currentMode === 'winner') {
      ElectionMap.render(_currentRace, 'winner', { jurisdictions: _currentJurisdictions });
      _buildLegend();
    } else if (_currentMode === 'heat') {
      const sel = document.getElementById('heat-candidate-select');
      const candidate = sel ? sel.value : _currentCandidates[0];
      ElectionMap.render(_currentRace, 'heat', { candidate, jurisdictions: _currentJurisdictions });
      _buildHeatLegend(candidate);
    } else if (_currentMode === 'group') {
      if (_groupA.length || _groupB.length || _groupC.length) {
        ElectionMap.render(_currentRace, 'group', {
          groupA: _groupA, groupB: _groupB, groupC: _groupC,
          jurisdictions: _currentJurisdictions,
        });
        _buildGroupLegend();
      }
    } else if (_currentMode === 'ordering') {
      if (_orderingCandidates.length >= 2) {
        ElectionMap.render(_currentRace, 'ordering', {
          candidates: _orderingCandidates, jurisdictions: _currentJurisdictions,
        });
        _buildOrderingLegend();
      }
    }

    _buildStatsTable();
  }

  function _updateModeButtons() {
    const isComposite = _currentParty === 'COMPOSITE';
    const n           = _currentCandidates.length;
    const heatBtn     = document.querySelector('[data-mode="heat"]');
    const groupBtn    = document.querySelector('[data-mode="group"]');
    const orderingBtn = document.getElementById('btn-ordering');
    if (heatBtn)     heatBtn.style.display     = (!isComposite && n >= 3) ? '' : 'none';
    if (groupBtn)    groupBtn.style.display    = (!isComposite && n >= 3) ? '' : 'none';
    if (orderingBtn) orderingBtn.style.display = (!isComposite && n >= 3) ? '' : 'none';
  }

  // ── Heat candidate picker ─────────────────────────────────────────────────

  function _buildHeatCandidateSelect() {
    const sel = document.getElementById('heat-candidate-select');
    if (!sel) return;
    sel.innerHTML = '';
    for (const c of _currentCandidates) {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      sel.appendChild(opt);
    }
    sel.onchange = () => { if (_currentMode === 'heat') _applyMode(); };
  }

  // ── Geographic filter ─────────────────────────────────────────────────────

  function _titleCase(str) {
    return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  }

  function _buildMergedOptions(rawJurs) {
    const hasCook    = rawJurs.includes('COOK');
    const hasChicago = rawJurs.includes('CITY OF CHICAGO');
    const citySet    = new Set(Object.keys(CITY_MERGE));
    const skipSet    = new Set([...citySet, 'COOK', 'CITY OF CHICAGO']);
    const options    = [];

    for (const jur of rawJurs) {
      if (skipSet.has(jur)) continue;
      const cityJurs = Object.entries(CITY_MERGE)
        .filter(([city, county]) => county === jur && rawJurs.includes(city))
        .map(([city]) => city);
      options.push({ label: _titleCase(jur), jurs: [jur, ...cityJurs] });
    }

    if (hasCook || hasChicago) {
      if (hasCook && hasChicago) {
        options.push({ label: 'Cook County',     jurs: ['COOK', 'CITY OF CHICAGO'] });
        options.push({ label: 'Suburban Cook',   jurs: ['COOK'] });
        options.push({ label: 'City of Chicago', jurs: ['CITY OF CHICAGO'] });
      } else if (hasCook) {
        options.push({ label: 'Cook County',     jurs: ['COOK'] });
      } else {
        options.push({ label: 'City of Chicago', jurs: ['CITY OF CHICAGO'] });
      }
    }

    options.sort((a, b) => a.label.localeCompare(b.label));
    return options;
  }

  function _buildGeoFilter() {
    const ctrl  = document.getElementById('geo-filter-control');
    const chips = document.getElementById('geo-filter-chips');
    if (!ctrl || !chips) return;

    if (_allJurisdictions.length <= 1) { ctrl.style.display = 'none'; return; }

    ctrl.style.display = 'flex';
    chips.innerHTML = '';

    const mergedOptions = _buildMergedOptions(_allJurisdictions);

    const wrap = document.createElement('div');
    wrap.className = 'geo-select-wrap';

    const btn = document.createElement('button');
    btn.className = 'geo-select-btn';
    btn.type = 'button';
    btn.textContent = _currentJurLabel || 'All';

    const panel = document.createElement('div');
    panel.className = 'geo-select-panel';
    panel.style.display = 'none';

    const searchWrap = document.createElement('div');
    searchWrap.className = 'geo-select-search';
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Search areas…';
    searchInput.autocomplete = 'off';
    searchWrap.appendChild(searchInput);

    const optList = document.createElement('div');
    optList.className = 'geo-select-options';
    panel.appendChild(searchWrap);
    panel.appendChild(optList);
    wrap.appendChild(btn);
    wrap.appendChild(panel);
    chips.appendChild(wrap);

    function _isActive(opt) {
      if (!_currentJurisdictions) return false;
      return opt.jurs.length === _currentJurisdictions.length &&
        opt.jurs.every(j => _currentJurisdictions.includes(j));
    }

    function renderOptions(filter) {
      optList.innerHTML = '';
      const q = (filter || '').toLowerCase();

      if (!q) {
        const allOpt = document.createElement('button');
        allOpt.className = 'geo-select-opt' + (!_currentJurisdictions ? ' active' : '');
        allOpt.textContent = 'All';
        allOpt.type = 'button';
        allOpt.addEventListener('click', () => {
          _currentJurisdictions = null;
          _currentJurLabel = null;
          btn.textContent = 'All';
          panel.style.display = 'none';
          _geoPanel = null;
          renderOptions('');
          _applyMode();
        });
        optList.appendChild(allOpt);
      }

      const filtered = q ? mergedOptions.filter(o => o.label.toLowerCase().includes(q)) : mergedOptions;
      for (const opt of filtered) {
        const el = document.createElement('button');
        el.className = 'geo-select-opt' + (_isActive(opt) ? ' active' : '');
        el.textContent = opt.label;
        el.type = 'button';
        el.addEventListener('click', () => {
          _currentJurisdictions = opt.jurs;
          _currentJurLabel = opt.label;
          btn.textContent = opt.label;
          panel.style.display = 'none';
          _geoPanel = null;
          renderOptions('');
          _applyMode();
        });
        optList.appendChild(el);
      }
    }

    renderOptions('');

    btn.addEventListener('click', e => {
      e.stopPropagation();
      if (_geoPanel && _geoPanel !== panel) {
        _geoPanel.style.display = 'none';
      }
      const opening = panel.style.display === 'none';
      panel.style.display = opening ? 'flex' : 'none';
      _geoPanel = opening ? panel : null;
      if (opening) {
        searchInput.value = '';
        renderOptions('');
        searchInput.focus();
      }
    });

    searchInput.addEventListener('input', () => renderOptions(searchInput.value));
  }

  // ── Grouping panel ────────────────────────────────────────────────────────

  function _updateGroupingPanel() {
    const unassigned = document.getElementById('unassigned-chips');
    const aChips     = document.getElementById('group-a-chips');
    const bChips     = document.getElementById('group-b-chips');
    const cChips     = document.getElementById('group-c-chips');
    if (!unassigned || !aChips || !bChips) return;

    unassigned.innerHTML = '';
    aChips.innerHTML     = '';
    bChips.innerHTML     = '';
    if (cChips) cChips.innerHTML = '';

    document.getElementById('group-a-empty').style.display = _groupA.length ? 'none' : 'block';
    document.getElementById('group-b-empty').style.display = _groupB.length ? 'none' : 'block';
    const cEmpty = document.getElementById('group-c-empty');
    if (cEmpty) cEmpty.style.display = _groupC.length ? 'none' : 'block';

    for (const c of _currentCandidates) {
      if (_groupA.includes(c))                aChips.appendChild(_makeCandidateChip(c, 'a'));
      else if (_groupB.includes(c))           bChips.appendChild(_makeCandidateChip(c, 'b'));
      else if (_groupC.includes(c) && cChips) cChips.appendChild(_makeCandidateChip(c, 'c'));
      else                                    unassigned.appendChild(_makeCandidateChip(c, null));
    }
  }

  function _makeCandidateChip(name, group) {
    const chip = document.createElement('span');
    chip.className = `candidate-chip${group === 'a' ? ' selected-a' : group === 'b' ? ' selected-b' : group === 'c' ? ' selected-c' : ''}`;
    chip.textContent = name;
    chip.draggable = true;

    chip.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', name);
      e.dataTransfer.effectAllowed = 'move';
    });

    chip.addEventListener('click', () => {
      if (group === null)       _groupA.push(name);
      else if (group === 'a') { _groupA = _groupA.filter(c => c !== name); _groupB.push(name); }
      else if (group === 'b') { _groupB = _groupB.filter(c => c !== name); _groupC.push(name); }
      else                    { _groupC = _groupC.filter(c => c !== name); }
      _updateGroupingPanel();
      _rerenderGroup();
    });

    return chip;
  }

  function handleDrop(event, targetGroup) {
    event.preventDefault();
    const name = event.dataTransfer.getData('text/plain');
    if (!name) return;
    _groupA = _groupA.filter(c => c !== name);
    _groupB = _groupB.filter(c => c !== name);
    _groupC = _groupC.filter(c => c !== name);
    if (targetGroup === 'a')      _groupA.push(name);
    else if (targetGroup === 'b') _groupB.push(name);
    else if (targetGroup === 'c') _groupC.push(name);
    _updateGroupingPanel();
    _rerenderGroup();
  }

  function _rerenderGroup() {
    if (_currentMode === 'group' && (_groupA.length || _groupB.length || _groupC.length)) {
      ElectionMap.render(_currentRace, 'group', {
        groupA: _groupA, groupB: _groupB, groupC: _groupC,
        jurisdictions: _currentJurisdictions,
      });
      _buildGroupLegend();
      _buildStatsTable();
    }
  }

  // ── Ordering panel ────────────────────────────────────────────────────────

  function _buildOrderingPanel() {
    const selected  = document.getElementById('ordering-selected');
    const available = document.getElementById('ordering-available');
    if (!selected || !available) return;
    selected.innerHTML  = '';
    available.innerHTML = '';

    for (const c of _orderingCandidates) {
      selected.appendChild(_makeOrderingChip(c, true));
    }
    for (const c of _currentCandidates) {
      if (!_orderingCandidates.includes(c)) {
        available.appendChild(_makeOrderingChip(c, false));
      }
    }
  }

  function _makeOrderingChip(name, isSelected) {
    const chip = document.createElement('span');
    chip.className = `candidate-chip${isSelected ? ' selected-a' : ''}`;
    if (isSelected) {
      chip.style.background  = `${ElectionMap.getCandidateColor(name)}33`;
      chip.style.borderColor = ElectionMap.getCandidateColor(name);
      chip.style.color       = ElectionMap.getCandidateColor(name);
    }
    chip.textContent = name;
    chip.draggable = isSelected;

    if (isSelected) {
      chip.addEventListener('click', () => {
        _orderingCandidates = _orderingCandidates.filter(c => c !== name);
        _buildOrderingPanel();
        if (_currentMode === 'ordering') _applyMode();
      });
      chip.addEventListener('dragstart', e => {
        e.dataTransfer.setData('text/plain', name);
        e.dataTransfer.effectAllowed = 'move';
      });
    } else {
      chip.addEventListener('click', () => {
        if (_orderingCandidates.length >= 3) return;
        _orderingCandidates.push(name);
        _buildOrderingPanel();
        if (_currentMode === 'ordering') _applyMode();
      });
    }
    return chip;
  }

function _buildOrderingLegend() {
    const legend = document.getElementById('map-legend');
    if (!legend || !_orderingCandidates.length) return;
    legend.innerHTML = '';

    const n = _orderingCandidates.length;
    const perms = n === 2
      ? [[0,1],[1,0]]
      : [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];

    // Group perms by leader index so each leader's pair sits on the same row
    const byLeader = {};
    for (const perm of perms) {
      const leader = perm[0];
      if (!byLeader[leader]) byLeader[leader] = [];
      byLeader[leader].push(perm);
    }

    const leaderOrder = [...new Set(perms.map(p => p[0]))];
    for (const leader of leaderOrder) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:4px;';
      for (const perm of byLeader[leader]) {
        const ordering = perm.join('');
        const color    = ElectionMap._getOrderingColor(ordering, _orderingCandidates);
        const label    = perm.map(i => _orderingCandidates[i]).join(' → ');
        const item     = document.createElement('div');
        item.className = 'legend-item';
        item.innerHTML = `<span class="legend-swatch" style="background:${color}"></span>${label}`;
        row.appendChild(item);
      }
      legend.appendChild(row);
    }
  }

  // ── Legends ───────────────────────────────────────────────────────────────

  function _buildLegend() {
    const legend = document.getElementById('map-legend');
    if (!legend) return;
    legend.innerHTML = '';
    for (const c of _currentCandidates) {
      const item = document.createElement('div');
      item.className = 'legend-item';
      item.innerHTML = `<span class="legend-swatch" style="background:${ElectionMap.getCandidateColor(c)}"></span>${c}`;
      legend.appendChild(item);
    }
  }

  function _buildCompositeLegend() {
    const legend = document.getElementById('map-legend');
    if (!legend) return;
    legend.innerHTML = `
      <div class="legend-item"><span class="legend-swatch" style="background:#4f93d1"></span> Dem majority</div>
      <div class="legend-item"><span class="legend-swatch" style="background:#1c2330"></span> Even</div>
      <div class="legend-item"><span class="legend-swatch" style="background:#d16f4f"></span> Rep majority</div>
    `;
  }

  function _buildHeatLegend(candidate) {
    const legend = document.getElementById('map-legend');
    if (!legend) return;
    legend.innerHTML = `
      <div class="legend-item"><span class="legend-swatch" style="background:#d16f4f"></span> Below district average</div>
      <div class="legend-item"><span class="legend-swatch" style="background:#1c2330"></span> At average</div>
      <div class="legend-item"><span class="legend-swatch" style="background:#4f93d1"></span> Above district average</div>
      <span class="text-muted" style="margin-left:4px">— ${candidate}</span>
    `;
  }

  function _buildGroupLegend() {
    const legend = document.getElementById('map-legend');
    if (!legend) return;
    const aLabel = _groupA.join(' + ') || 'Group A';
    const bLabel = _groupB.join(' + ') || 'Group B';
    const cLabel = _groupC.join(' + ');
    legend.innerHTML = `
      <div class="legend-item"><span class="legend-swatch" style="background:#4f93d1"></span> ${aLabel}</div>
      <div class="legend-item"><span class="legend-swatch" style="background:#d16f4f"></span> ${bLabel}</div>
      ${cLabel ? `<div class="legend-item"><span class="legend-swatch" style="background:#2ecc71"></span> ${cLabel}</div>` : ''}
    `;
  }

  // ── Stats tables ──────────────────────────────────────────────────────────

  function _buildStatsTable() {
    const grid = document.getElementById('stats-grid');
    if (!grid || !_currentRace) return;
    grid.innerHTML = '';
    if (_currentParty === 'COMPOSITE') {
      _buildCompositeStatsTable(grid);
      return;
    }
    if (_currentMode === 'group' && (_groupA.length || _groupB.length || _groupC.length)) {
      _buildGroupStatsTable(grid);
    } else {
      _buildCandidateStatsTable(grid);
    }
    _buildBreakdownSections(grid);
  }

  function _buildCompositeStatsTable(grid) {
    const repRaceName = _currentRace.replace('_DEM_Primary', '_GOP_Primary');
    const { totalVoters: demTotal } = ElectionData.getDistrictTotals(_currentRace, _currentJurisdictions);
    const { totalVoters: repTotal } = ElectionData.getDistrictTotals(repRaceName, _currentJurisdictions);
    const grandTotal = demTotal + repTotal;

    let demPrecincts = 0, repPrecincts = 0, evenPrecincts = 0;
    for (const [jf, precinct] of Object.entries(ElectionData.raw)) {
      if (_currentJurisdictions && !_currentJurisdictions.includes(jf.split(':')[0])) continue;
      const demData = precinct.races?.[_currentRace];
      const repData = precinct.races?.[repRaceName];
      if (!demData && !repData) continue;
      const dem = demData ? (parseFloat(demData['Total Voters']) || 0) : 0;
      const rep = repData ? (parseFloat(repData['Total Voters']) || 0) : 0;
      if (dem + rep === 0) continue;
      if (dem > rep) demPrecincts++;
      else if (rep > dem) repPrecincts++;
      else evenPrecincts++;
    }
    const totalPrecincts = demPrecincts + repPrecincts + evenPrecincts;

    const card = document.createElement('div');
    card.className = 'card';
    const titleEl = document.createElement('div');
    titleEl.className = 'card-title';
    const isStatewide = ElectionData.getRaces().find(r => r.raceName === _currentRace)?.category === 'Statewide';
    titleEl.textContent = _currentJurisdictions
      ? `Party Composition — ${_currentJurLabel || _currentJurisdictions.join(', ')}`
      : isStatewide ? 'Statewide Party Composition' : 'District-Wide Party Composition';
    card.appendChild(titleEl);

    const table = document.createElement('table');
    table.className = 'stats-table';
    table.innerHTML = `<thead><tr>
      <th>Party</th>
      <th style="text-align:right">Precincts</th>
      <th style="text-align:right">Votes</th>
      <th style="text-align:right">Share</th>
    </tr></thead>`;

    const tbody = document.createElement('tbody');
    for (const { label, votes, precincts, color } of [
      { label: 'Democrat',   votes: demTotal, precincts: demPrecincts, color: '#4f93d1' },
      { label: 'Republican', votes: repTotal, precincts: repPrecincts, color: '#d16f4f' },
    ]) {
      const share = grandTotal > 0 ? ((votes / grandTotal) * 100).toFixed(1) : '—';
      const pPct  = totalPrecincts > 0 ? ((precincts / totalPrecincts) * 100).toFixed(1) : '—';
      const tr    = document.createElement('tr');
      tr.innerHTML = `
        <td style="white-space:nowrap"><span class="candidate-color-bar" style="background:${color}"></span>${label}</td>
        <td class="num">${precincts} (${pPct}%)</td>
        <td class="num">${votes.toLocaleString()}</td>
        <td class="num">${share}%</td>
      `;
      tbody.appendChild(tr);
    }
    if (evenPrecincts > 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="white-space:nowrap"><span class="candidate-color-bar" style="background:#484f58"></span>Even</td>
        <td class="num">${evenPrecincts}</td>
        <td class="num">—</td>
        <td class="num">—</td>
      `;
      tbody.appendChild(tr);
    }
    const totalTr = document.createElement('tr');
    totalTr.innerHTML = `
      <td style="font-weight:600">Total</td>
      <td class="num" style="font-weight:600">${totalPrecincts.toLocaleString()}</td>
      <td class="num" style="font-weight:600">${grandTotal.toLocaleString()}</td>
      <td class="num">100%</td>
    `;
    tbody.appendChild(totalTr);
    table.appendChild(tbody);
    card.appendChild(table);
    grid.appendChild(card);
  }

  function _buildCandidateStatsTable(grid) {
    const { candidates, totalVoters } = ElectionData.getDistrictTotals(_currentRace, _currentJurisdictions);
    const sorted = Object.entries(candidates).sort((a, b) => b[1] - a[1]);

    const jurWon = ElectionData.getJurisdictionTotals(_currentRace, _currentJurisdictions);
    const districtWonMerged = { won: {}, ties: 0 };
    for (const jur of Object.values(jurWon)) {
      for (const [k, v] of Object.entries(jur.won || {}))
        districtWonMerged.won[k] = (districtWonMerged.won[k] || 0) + v;
      districtWonMerged.ties += jur.ties || 0;
    }
    const totalPrecincts = Object.values(districtWonMerged.won).reduce((s, v) => s + v, 0);

    const card    = document.createElement('div');
    card.className = 'card';
    const titleEl  = document.createElement('div');
    titleEl.className = 'card-title';
    const isStatewide = ElectionData.getRaces().find(r => r.raceName === _currentRace)?.category === 'Statewide';
    titleEl.textContent = _currentJurisdictions
      ? `Results — ${_currentJurLabel || _currentJurisdictions.join(', ')}`
      : isStatewide ? 'Statewide Vote Totals' : 'District-Wide Vote Totals';
    card.appendChild(titleEl);

    const table = document.createElement('table');
    table.className = 'stats-table';
    table.innerHTML = `<thead><tr>
      <th>Candidate</th>
      <th style="text-align:right">Precincts Won</th>
      <th style="text-align:right">Votes</th>
      <th style="text-align:right">Share</th>
    </tr></thead>`;

    const tbody = document.createElement('tbody');
    for (const [name, votes] of sorted) {
      const share  = totalVoters > 0 ? ((votes / totalVoters) * 100).toFixed(1) : '—';
      const color  = ElectionMap.getCandidateColor(name);
      const pw     = districtWonMerged.won[name] || 0;
      const pwPct  = totalPrecincts > 0 ? ((pw / totalPrecincts) * 100).toFixed(1) : '—';
      const tr     = document.createElement('tr');
      tr.innerHTML = `
        <td style="white-space:nowrap"><span class="candidate-color-bar" style="background:${color}"></span>${name}</td>
        <td class="num">${pw} (${pwPct}%)</td>
        <td class="num">${votes.toLocaleString()}</td>
        <td class="num">${share}%</td>
      `;
      tbody.appendChild(tr);
    }
    const totalTr = document.createElement('tr');
    totalTr.innerHTML = `
      <td style="font-weight:600">Total</td>
      <td class="num" style="font-weight:600">${totalPrecincts.toLocaleString()}</td>
      <td class="num" style="font-weight:600">${totalVoters.toLocaleString()}</td>
      <td class="num">100%</td>
    `;
    tbody.appendChild(totalTr);
    table.appendChild(tbody);
    card.appendChild(table);
    if (districtWonMerged.ties > 0) {
      const tieNote = document.createElement('div');
      tieNote.className = 'text-muted';
      tieNote.style.marginTop = '6px';
      tieNote.textContent = `* ${districtWonMerged.ties} precinct(s) tied — counted for all tied candidates`;
      card.appendChild(tieNote);
    }
    grid.appendChild(card);
  }

  function _buildGroupStatsTable(grid) {
    const { candidates } = ElectionData.getDistrictTotals(_currentRace, _currentJurisdictions);
    const groups = [
      { label: _groupA.join(' + ') || 'Group A', members: _groupA, color: '#4f93d1', key: '__groupA' },
      { label: _groupB.join(' + ') || 'Group B', members: _groupB, color: '#d16f4f', key: '__groupB' },
      { label: _groupC.join(' + ') || 'Group C', members: _groupC, color: '#2ecc71', key: '__groupC' },
    ].filter(g => g.members.length > 0);
    const groupTotals = groups.map(g => ({
      ...g, votes: g.members.reduce((sum, c) => sum + (candidates[c] || 0), 0),
    }));
    const combined = groupTotals.reduce((sum, g) => sum + g.votes, 0);

    const groupWonData = ElectionData.getJurisdictionTotals(_currentRace, _currentJurisdictions, _groupA, _groupB, _groupC);
    const groupWonMerged = { won: {}, ties: 0 };
    for (const jur of Object.values(groupWonData)) {
      for (const [k, v] of Object.entries(jur.won || {}))
        groupWonMerged.won[k] = (groupWonMerged.won[k] || 0) + v;
      groupWonMerged.ties += jur.ties || 0;
    }
    const totalGPrecincts = Object.values(groupWonMerged.won).reduce((s, v) => s + v, 0);

    const card    = document.createElement('div');
    card.className = 'card';
    const titleEl  = document.createElement('div');
    titleEl.className = 'card-title';
    const isStatewide = ElectionData.getRaces().find(r => r.raceName === _currentRace)?.category === 'Statewide';
    titleEl.textContent = _currentJurisdictions
      ? `Head to Head — ${_currentJurisdictions.join(', ')}`
      : isStatewide ? 'Head to Head — Chicagoland' : 'Head to Head — District-Wide';
    card.appendChild(titleEl);

    const table = document.createElement('table');
    table.className = 'stats-table';
    table.innerHTML = `<thead><tr>
      <th>Group</th>
      <th style="text-align:right">Precincts Won</th>
      <th style="text-align:right">Votes</th>
      <th style="text-align:right">Share</th>
    </tr></thead>`;

    const tbody = document.createElement('tbody');
    for (const g of groupTotals) {
      const share  = combined > 0 ? ((g.votes / combined) * 100).toFixed(1) : '—';
      const gpw    = groupWonMerged.won[g.key] || 0;
      const gpwPct = totalGPrecincts > 0 ? ((gpw / totalGPrecincts) * 100).toFixed(1) : '—';
      const tr     = document.createElement('tr');
      tr.innerHTML = `
        <td style="white-space:nowrap"><span class="candidate-color-bar" style="background:${g.color}"></span>${g.label}</td>
        <td class="num">${gpw} (${gpwPct}%)</td>
        <td class="num">${g.votes.toLocaleString()}</td>
        <td class="num">${share}%</td>
      `;
      tbody.appendChild(tr);
    }
    const totalTr = document.createElement('tr');
    totalTr.innerHTML = `
      <td style="font-weight:600">Combined</td>
      <td class="num" style="font-weight:600">${totalGPrecincts.toLocaleString()}</td>
      <td class="num" style="font-weight:600">${combined.toLocaleString()}</td>
      <td class="num">100%</td>
    `;
    tbody.appendChild(totalTr);
    table.appendChild(tbody);
    card.appendChild(table);
    if (groupWonMerged.ties > 0) {
      const tieNote = document.createElement('div');
      tieNote.className = 'text-muted';
      tieNote.style.marginTop = '6px';
      tieNote.textContent = `* ${groupWonMerged.ties} precinct(s) tied — counted for all tied groups`;
      card.appendChild(tieNote);
    }
    grid.appendChild(card);
  }

  // ── Breakdown sections ────────────────────────────────────────────────────

  function _buildBreakdownSections(grid) {
    const isGroup = _currentMode === 'group' && (_groupA.length || _groupB.length || _groupC.length);
    const jurData = ElectionData.getJurisdictionTotals(
      _currentRace, _currentJurisdictions,
      isGroup ? _groupA : [], isGroup ? _groupB : [], isGroup ? _groupC : []
    );

    const JURISDICTION_ORDER = ['CITY OF CHICAGO', 'COOK', 'DUPAGE', 'LAKE', 'MCHENRY', 'WILL', 'KANE'];
    const sortedJurs = Object.keys(jurData).sort((a, b) => {
      const ai = JURISDICTION_ORDER.indexOf(a.toUpperCase());
      const bi = JURISDICTION_ORDER.indexOf(b.toUpperCase());
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
    if (sortedJurs.length === 0) return;

    // ── Jurisdiction table ──
    const jurCard = document.createElement('div');
    jurCard.className = 'card';
    jurCard.style.marginTop = '16px';
    const jurTitle = document.createElement('div');
    jurTitle.className = 'card-title';
    jurTitle.textContent = 'Results by Jurisdiction';
    jurCard.appendChild(jurTitle);

    const jurTable = document.createElement('table');
    jurTable.className = 'stats-table';
    jurTable.innerHTML = `<thead><tr>
      <th>Jurisdiction</th>
      <th>${isGroup ? 'Group' : 'Candidate'}</th>
      <th style="text-align:right">Precincts Won</th>
      <th style="text-align:right">Votes</th>
      <th style="text-align:right">Share</th>
    </tr></thead>`;
    const jurTbody = document.createElement('tbody');

    for (const jur of sortedJurs) {
      const d = jurData[jur];
      const totalPrecincts = Object.values(d.won || {}).reduce((s, v) => s + v, 0);

      if (isGroup) {
        const groups = [
          { label: _groupA.join(' + ') || 'Group A', key: '__groupA', color: '#4f93d1', members: _groupA },
          { label: _groupB.join(' + ') || 'Group B', key: '__groupB', color: '#d16f4f', members: _groupB },
          { label: _groupC.join(' + ') || 'Group C', key: '__groupC', color: '#2ecc71', members: _groupC },
        ].filter(g => g.members.length > 0);
        const combined = groups.reduce((s, g) =>
          s + g.members.reduce((ss, c) => ss + (d.candidates[c] || 0), 0), 0);
        groups.forEach((g, gi) => {
          const votes  = g.members.reduce((s, c) => s + (d.candidates[c] || 0), 0);
          const share  = combined > 0 ? ((votes / combined) * 100).toFixed(1) : '—';
          const pw     = d.won[g.key] || 0;
          const pwPct  = totalPrecincts > 0 ? ((pw / totalPrecincts) * 100).toFixed(1) : '—';
          const tr = document.createElement('tr');
          tr.innerHTML = `
            ${gi === 0 ? `<td rowspan="${groups.length}" style="font-weight:500;vertical-align:top;padding-top:10px">${jur}</td>` : ''}
            <td style="white-space:nowrap"><span class="candidate-color-bar" style="background:${g.color}"></span>${g.label}</td>
            <td class="num">${pw} (${pwPct}%)</td>
            <td class="num">${votes.toLocaleString()}</td>
            <td class="num">${share}%</td>
          `;
          jurTbody.appendChild(tr);
        });
      } else {
        const sorted = Object.entries(d.candidates).sort((a, b) => b[1] - a[1]);
        sorted.forEach(([name, votes], ci) => {
          const share  = d.totalVoters > 0 ? ((votes / d.totalVoters) * 100).toFixed(1) : '—';
          const color  = ElectionMap.getCandidateColor(name);
          const pw     = d.won[name] || 0;
          const pwPct  = totalPrecincts > 0 ? ((pw / totalPrecincts) * 100).toFixed(1) : '—';
          const tr = document.createElement('tr');
          tr.innerHTML = `
            ${ci === 0 ? `<td rowspan="${sorted.length}" style="font-weight:500;vertical-align:top;padding-top:10px">${jur}</td>` : ''}
            <td style="white-space:nowrap"><span class="candidate-color-bar" style="background:${color}"></span>${name}</td>
            <td class="num">${pw} (${pwPct}%)</td>
            <td class="num">${votes.toLocaleString()}</td>
            <td class="num">${share}%</td>
          `;
          jurTbody.appendChild(tr);
        });
        if (d.ties > 0) {
          const tieRow = document.createElement('tr');
          tieRow.innerHTML = `<td colspan="5" class="text-muted" style="font-size:0.75rem;padding:4px 12px">* ${d.ties} tied precinct(s) in ${jur}</td>`;
          jurTbody.appendChild(tieRow);
        }
      }
      const divRow = document.createElement('tr');
      divRow.innerHTML = `<td colspan="5" style="padding:0;border-bottom:1px solid var(--border-strong)"></td>`;
      jurTbody.appendChild(divRow);
    }

    jurTable.appendChild(jurTbody);
    jurCard.appendChild(jurTable);
    grid.appendChild(jurCard);

    // ── Ward/Township expandable section ──
    const wtCard = document.createElement('div');
    wtCard.className = 'card';
    wtCard.style.marginTop = '16px';
    const wtTitle = document.createElement('div');
    wtTitle.className = 'card-title';
    wtTitle.textContent = 'Results by Ward / Township';
    wtCard.appendChild(wtTitle);

    for (const jur of sortedJurs) {
      const jurHeader = document.createElement('div');
      jurHeader.style.cssText = `display:flex;align-items:center;gap:8px;padding:10px 12px;cursor:pointer;border-radius:6px;user-select:none;transition:background 0.12s;`;
      jurHeader.innerHTML = `
        <span class="jur-chevron" style="font-size:0.7rem;color:var(--text-muted);transition:transform 0.2s">▶</span>
        <span style="font-weight:500;font-size:0.875rem">${jur}</span>
        <span class="text-muted" style="font-size:0.775rem">${jurData[jur].precinctCount} precincts</span>
      `;
      jurHeader.addEventListener('mouseenter', () => jurHeader.style.background = 'var(--bg-highlight)');
      jurHeader.addEventListener('mouseleave', () => jurHeader.style.background = '');

      const wtContent = document.createElement('div');
      wtContent.style.display = 'none';
      wtContent.style.paddingLeft = '16px';

      let loaded = false;
      jurHeader.addEventListener('click', () => {
        const isOpen = wtContent.style.display !== 'none';
        wtContent.style.display = isOpen ? 'none' : 'block';
        jurHeader.querySelector('.jur-chevron').style.transform = isOpen ? '' : 'rotate(90deg)';
        if (!loaded) { loaded = true; _buildTownshipSection(wtContent, jur, isGroup); }
      });

      wtCard.appendChild(jurHeader);
      wtCard.appendChild(wtContent);
    }
    grid.appendChild(wtCard);
  }

  function _buildTownshipSection(container, jurisdiction, isGroup) {
    const twData = ElectionData.getTownshipTotals(
      _currentRace, jurisdiction,
      isGroup ? _groupA : [], isGroup ? _groupB : [], isGroup ? _groupC : []
    );
    const sortedTownships = Object.keys(twData).sort((a, b) => {
      const na = parseInt(a), nb = parseInt(b);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return a.localeCompare(b);
    });

    for (const township of sortedTownships) {
      const d = twData[township];
      const totalPrecincts = Object.values(d.won || {}).reduce((s, v) => s + v, 0);

      const twHeader = document.createElement('div');
      twHeader.style.cssText = `display:flex;align-items:center;gap:8px;padding:8px 12px;cursor:pointer;border-radius:6px;user-select:none;border-bottom:1px solid var(--border);transition:background 0.12s;`;
      twHeader.innerHTML = `
        <span class="tw-chevron" style="font-size:0.65rem;color:var(--text-muted);transition:transform 0.2s">▶</span>
        <span style="font-size:0.825rem;color:var(--text-secondary)">${township}</span>
        <span class="text-muted" style="font-size:0.75rem">${d.precinctCount} precinct${d.precinctCount !== 1 ? 's' : ''}</span>
      `;
      twHeader.addEventListener('mouseenter', () => twHeader.style.background = 'var(--bg-highlight)');
      twHeader.addEventListener('mouseleave', () => twHeader.style.background = '');

      const twContent = document.createElement('div');
      twContent.style.display = 'none';
      twContent.style.padding = '4px 0 8px 16px';

      twHeader.addEventListener('click', () => {
        const isOpen = twContent.style.display !== 'none';
        twContent.style.display = isOpen ? 'none' : 'block';
        twHeader.querySelector('.tw-chevron').style.transform = isOpen ? '' : 'rotate(90deg)';
      });

      const twTable = document.createElement('table');
      twTable.className = 'stats-table';
      twTable.style.marginTop = '4px';
      twTable.innerHTML = `<thead><tr>
        <th>${isGroup ? 'Group' : 'Candidate'}</th>
        <th style="text-align:right">Precincts Won</th>
        <th style="text-align:right">Votes</th>
        <th style="text-align:right">Share</th>
      </tr></thead>`;
      const twTbody = document.createElement('tbody');

      if (isGroup) {
        const groups = [
          { label: _groupA.join(' + ') || 'Group A', key: '__groupA', color: '#4f93d1', members: _groupA },
          { label: _groupB.join(' + ') || 'Group B', key: '__groupB', color: '#d16f4f', members: _groupB },
          { label: _groupC.join(' + ') || 'Group C', key: '__groupC', color: '#2ecc71', members: _groupC },
        ].filter(g => g.members.length > 0);
        const combined = groups.reduce((s, g) =>
          s + g.members.reduce((ss, c) => ss + (d.candidates[c] || 0), 0), 0);
        for (const g of groups) {
          const votes  = g.members.reduce((s, c) => s + (d.candidates[c] || 0), 0);
          const share  = combined > 0 ? ((votes / combined) * 100).toFixed(1) : '—';
          const pw     = d.won[g.key] || 0;
          const pwPct  = totalPrecincts > 0 ? ((pw / totalPrecincts) * 100).toFixed(1) : '—';
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td style="white-space:nowrap"><span class="candidate-color-bar" style="background:${g.color}"></span>${g.label}</td>
            <td class="num">${pw} (${pwPct}%)</td>
            <td class="num">${votes.toLocaleString()}</td>
            <td class="num">${share}%</td>
          `;
          twTbody.appendChild(tr);
        }
      } else {
        const sorted = Object.entries(d.candidates).sort((a, b) => b[1] - a[1]);
        for (const [name, votes] of sorted) {
          const share  = d.totalVoters > 0 ? ((votes / d.totalVoters) * 100).toFixed(1) : '—';
          const color  = ElectionMap.getCandidateColor(name);
          const pw     = d.won[name] || 0;
          const pwPct  = totalPrecincts > 0 ? ((pw / totalPrecincts) * 100).toFixed(1) : '—';
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td style="white-space:nowrap"><span class="candidate-color-bar" style="background:${color}"></span>${name}</td>
            <td class="num">${pw} (${pwPct}%)</td>
            <td class="num">${votes.toLocaleString()}</td>
            <td class="num">${share}%</td>
          `;
          twTbody.appendChild(tr);
        }
      }

      if (d.ties > 0) {
        const tieRow = document.createElement('tr');
        tieRow.innerHTML = `<td colspan="4" class="text-muted" style="font-size:0.75rem;padding:4px 12px">* ${d.ties} tied precinct(s)</td>`;
        twTbody.appendChild(tieRow);
      }

      twTable.appendChild(twTbody);
      twContent.appendChild(twTable);
      container.appendChild(twHeader);
      container.appendChild(twContent);
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  return { init, handleDrop };

})();