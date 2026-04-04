/**
 * ui.js — UI controller
 * Wires the sidebar race list, controls, grouping panel,
 * geographic filter, and stats table to data.js and map.js.
 * Depends on: data.js, map.js
 */

const ElectionUI = (() => {

  let _currentRace = null;
  let _currentMode = 'winner';
  let _currentCandidates = [];
  let _groupA = [];
  let _groupB = [];
  let _groupC = [];
  let _currentJurisdictions = null;
  let _allJurisdictions = [];

  // ── Init ──────────────────────────────────────────────────────────────────

  function init() {
    _buildRaceList();
    _bindModeButtons();
    _bindSearchBox();
  }

  // ── Race sidebar ──────────────────────────────────────────────────────────

  function _buildRaceList(filter = '') {
    const races  = ElectionData.getRaces();
    const list   = document.getElementById('race-list');
    list.innerHTML = '';

    const grouped = {};
    for (const r of races) {
      if (filter && !r.raceName.toLowerCase().includes(filter.toLowerCase())) continue;
      const key = `${r.party}__${r.category}`;
      if (!grouped[key]) grouped[key] = { party: r.party, category: r.category, races: [] };
      grouped[key].races.push(r);
    }

    const partyOrder = ['Democrat', 'Republican'];
    const sortedKeys = Object.keys(grouped).sort((a, b) => {
      const [pa, ca] = a.split('__');
      const [pb, cb] = b.split('__');
      return partyOrder.indexOf(pa) - partyOrder.indexOf(pb) || ca.localeCompare(cb);
    });

    for (const key of sortedKeys) {
      const { party, category, races: raceList } = grouped[key];

      const label = document.createElement('div');
      label.className = 'sidebar-section-label';
      label.textContent = `${party} — ${category}`;
      list.appendChild(label);

      for (const r of raceList) {
        const btn = document.createElement('button');
        btn.className = 'sidebar-race-btn';
        btn.dataset.race = r.raceName;

        const dot = document.createElement('span');
        dot.className = `party-dot ${r.party === 'Democrat' ? 'dem' : 'rep'}`;
        btn.appendChild(dot);
        btn.appendChild(document.createTextNode(_formatRaceName(r.raceName)));

        if (r.raceName === _currentRace) btn.classList.add('active');
        btn.addEventListener('click', () => _selectRace(r.raceName));
        list.appendChild(btn);
      }

      const div = document.createElement('div');
      div.className = 'divider';
      list.appendChild(div);
    }
  }

  function _formatRaceName(name) {
    return name
      .replace(/_Primary$/, '')
      .replace(/^(Cook_County|State_House|State_Senate|Congressional|Statewide)_/, '')
      .replace(/_/g, ' ');
  }

  function _bindSearchBox() {
    const input = document.getElementById('race-search');
    if (!input) return;
    input.addEventListener('input', () => _buildRaceList(input.value));
  }

  // ── Race selection ────────────────────────────────────────────────────────

  function _selectRace(raceName) {
    _currentRace = raceName;
    _currentMode = 'winner';
    _groupA = [];
    _groupB = [];
    _groupC = [];
    _currentJurisdictions = null;

    _currentCandidates = ElectionData.getCandidates(raceName);
    ElectionMap.assignCandidateColors(_currentCandidates, raceName);
    _allJurisdictions = ElectionData.getJurisdictions(raceName);

    document.querySelectorAll('.sidebar-race-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.race === raceName);
    });

    document.getElementById('map-title').textContent = _formatRaceName(raceName);
    document.getElementById('map-subtitle').textContent =
      `${_currentCandidates.length} candidate${_currentCandidates.length !== 1 ? 's' : ''} · ${_allJurisdictions.length} jurisdiction${_allJurisdictions.length !== 1 ? 's' : ''}`;

    document.getElementById('map-controls').style.display = 'flex';
    document.getElementById('stats-section').style.display = 'block';

    // Reset mode-specific UI elements
    document.getElementById('heat-candidate-control').style.display = 'none';
    document.getElementById('grouping-panel').style.display = 'none';
    document.getElementById('map-controls').style.display = 'flex';

    // Reset mode buttons
    document.querySelectorAll('[data-mode]').forEach(b => b.classList.remove('active'));
    document.querySelector('[data-mode="winner"]').classList.add('active');
    _buildHeatCandidateSelect();
    _buildGeoFilter();
    ElectionMap.render(raceName, 'winner');
    _buildLegend();
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
    const heatControl = document.getElementById('heat-candidate-control');
    const groupPanel  = document.getElementById('grouping-panel');

    heatControl.style.display = _currentMode === 'heat'  ? 'flex'  : 'none';
    groupPanel.style.display  = _currentMode === 'group' ? 'block' : 'none';

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
    }

    _buildStatsTable();
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
    sel.onchange = () => {
      if (_currentMode === 'heat') _applyMode();
    };
  }

  // ── Geographic filter ─────────────────────────────────────────────────────

  function _buildGeoFilter() {
    const ctrl  = document.getElementById('geo-filter-control');
    const chips = document.getElementById('geo-filter-chips');
    if (!ctrl || !chips) return;

    if (_allJurisdictions.length <= 1) {
      ctrl.style.display = 'none';
      return;
    }

    ctrl.style.display = 'flex';
    chips.innerHTML = '';

    const allChip = _makeGeoChip('All', true, () => {
      _currentJurisdictions = null;
      chips.querySelectorAll('.geo-chip').forEach(c => c.classList.toggle('active', c.dataset.jur === 'ALL'));
      _applyMode();
    });
    allChip.dataset.jur = 'ALL';
    chips.appendChild(allChip);

    for (const jur of _allJurisdictions) {
      const chip = _makeGeoChip(jur, false, () => {
        _currentJurisdictions = [jur];
        chips.querySelectorAll('.geo-chip').forEach(c => c.classList.toggle('active', c.dataset.jur === jur));
        _applyMode();
      });
      chip.dataset.jur = jur;
      chips.appendChild(chip);
    }
  }

  function _makeGeoChip(label, active, onClick) {
    const chip = document.createElement('button');
    chip.className = `geo-chip${active ? ' active' : ''}`;
    chip.textContent = label;
    chip.addEventListener('click', onClick);
    return chip;
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

  // ── Legends ───────────────────────────────────────────────────────────────

  function _buildLegend() {
    const legend = document.getElementById('map-legend');
    if (!legend) return;
    legend.innerHTML = '';
    for (const c of _currentCandidates) {
      const item = document.createElement('div');
      item.className = 'legend-item';
      item.innerHTML = `
        <span class="legend-swatch" style="background:${ElectionMap.getCandidateColor(c)}"></span>
        ${c}
      `;
      legend.appendChild(item);
    }
  }

  function _buildHeatLegend(candidate) {
    const legend = document.getElementById('map-legend');
    if (!legend) return;
    legend.innerHTML = `
      <div class="legend-item">
        <span class="legend-swatch" style="background:#d16f4f"></span> Below district average
      </div>
      <div class="legend-item">
        <span class="legend-swatch" style="background:#1c2330"></span> At average
      </div>
      <div class="legend-item">
        <span class="legend-swatch" style="background:#4f93d1"></span> Above district average
      </div>
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
      <div class="legend-item">
        <span class="legend-swatch" style="background:#4f93d1"></span> ${aLabel}
      </div>
      <div class="legend-item">
        <span class="legend-swatch" style="background:#d16f4f"></span> ${bLabel}
      </div>
      ${cLabel ? `<div class="legend-item"><span class="legend-swatch" style="background:#2ecc71"></span> ${cLabel}</div>` : ''}
    `;
  }

  // ── Stats tables ──────────────────────────────────────────────────────────

  function _buildStatsTable() {
    const grid = document.getElementById('stats-grid');
    if (!grid || !_currentRace) return;
    grid.innerHTML = '';

    if (_currentMode === 'group' && (_groupA.length || _groupB.length || _groupC.length)) {
      _buildGroupStatsTable(grid);
    } else {
      _buildCandidateStatsTable(grid);
    }
    _buildBreakdownSections(grid);
  }

  function _buildCandidateStatsTable(grid) {
    const { candidates, totalVoters } = ElectionData.getDistrictTotals(_currentRace, _currentJurisdictions);
    const sorted = Object.entries(candidates).sort((a, b) => b[1] - a[1]);

    // Merge precincts-won across all jurisdictions
    const jurWon = ElectionData.getJurisdictionTotals(_currentRace, _currentJurisdictions);
    const districtWonMerged = { won: {}, ties: 0 };
    for (const jur of Object.values(jurWon)) {
      for (const [k, v] of Object.entries(jur.won || {}))
        districtWonMerged.won[k] = (districtWonMerged.won[k] || 0) + v;
      districtWonMerged.ties += jur.ties || 0;
    }
    const totalPrecincts = Object.values(districtWonMerged.won).reduce((s, v) => s + v, 0);

    const card = document.createElement('div');
    card.className = 'card';

    const titleEl = document.createElement('div');
    titleEl.className = 'card-title';
    titleEl.textContent = _currentJurisdictions
      ? `Results — ${_currentJurisdictions.join(', ')}`
      : 'District-Wide Vote Totals';
    card.appendChild(titleEl);

    const table = document.createElement('table');
    table.className = 'stats-table';
    table.innerHTML = `
      <thead>
        <tr>
          <th>Candidate</th>
          <th style="text-align:right">Precincts Won</th>
          <th style="text-align:right">Votes</th>
          <th style="text-align:right">Share</th>
        </tr>
      </thead>
    `;

    const tbody = document.createElement('tbody');
    for (const [name, votes] of sorted) {
      const share  = totalVoters > 0 ? ((votes / totalVoters) * 100).toFixed(1) : '—';
      const color  = ElectionMap.getCandidateColor(name);
      const pw     = districtWonMerged.won[name] || 0;
      const pwPct  = totalPrecincts > 0 ? ((pw / totalPrecincts) * 100).toFixed(1) : '—';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="white-space:nowrap">
          <span class="candidate-color-bar" style="background:${color}"></span>${name}
        </td>
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
      ...g,
      votes: g.members.reduce((sum, c) => sum + (candidates[c] || 0), 0),
    }));

    const combined = groupTotals.reduce((sum, g) => sum + g.votes, 0);

    // Precincts won per group
    const groupWonData = ElectionData.getJurisdictionTotals(
      _currentRace, _currentJurisdictions, _groupA, _groupB, _groupC
    );
    const groupWonMerged = { won: {}, ties: 0 };
    for (const jur of Object.values(groupWonData)) {
      for (const [k, v] of Object.entries(jur.won || {}))
        groupWonMerged.won[k] = (groupWonMerged.won[k] || 0) + v;
      groupWonMerged.ties += jur.ties || 0;
    }
    const totalGPrecincts = Object.values(groupWonMerged.won).reduce((s, v) => s + v, 0);

    const card = document.createElement('div');
    card.className = 'card';

    const titleEl = document.createElement('div');
    titleEl.className = 'card-title';
    titleEl.textContent = _currentJurisdictions
      ? `Head to Head — ${_currentJurisdictions.join(', ')}`
      : 'Head to Head — District-Wide';
    card.appendChild(titleEl);

    const table = document.createElement('table');
    table.className = 'stats-table';
    table.innerHTML = `
      <thead>
        <tr>
          <th>Group</th>
          <th style="text-align:right">Precincts Won</th>
          <th style="text-align:right">Votes</th>
          <th style="text-align:right">Share</th>
        </tr>
      </thead>
    `;

    const tbody = document.createElement('tbody');
    for (const g of groupTotals) {
      const share  = combined > 0 ? ((g.votes / combined) * 100).toFixed(1) : '—';
      const gpw    = groupWonMerged.won[g.key] || 0;
      const gpwPct = totalGPrecincts > 0 ? ((gpw / totalGPrecincts) * 100).toFixed(1) : '—';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="white-space:nowrap">
          <span class="candidate-color-bar" style="background:${g.color}"></span>${g.label}
        </td>
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

    // ── Jurisdiction summary table ──
    const jurCard = document.createElement('div');
    jurCard.className = 'card';
    jurCard.style.marginTop = '16px';

    const jurTitle = document.createElement('div');
    jurTitle.className = 'card-title';
    jurTitle.textContent = 'Results by Jurisdiction';
    jurCard.appendChild(jurTitle);

    const jurTable = document.createElement('table');
    jurTable.className = 'stats-table';
    jurTable.innerHTML = `
      <thead>
        <tr>
          <th>Jurisdiction</th>
          <th>${isGroup ? 'Group' : 'Candidate'}</th>
          <th style="text-align:right">Precincts Won</th>
          <th style="text-align:right">Votes</th>
          <th style="text-align:right">Share</th>
        </tr>
      </thead>
    `;

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
      jurHeader.style.cssText = `
        display:flex;align-items:center;gap:8px;padding:10px 12px;
        cursor:pointer;border-radius:6px;user-select:none;
        transition:background 0.12s;
      `;
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
      twHeader.style.cssText = `
        display:flex;align-items:center;gap:8px;padding:8px 12px;
        cursor:pointer;border-radius:6px;user-select:none;
        border-bottom:1px solid var(--border);
        transition:background 0.12s;
      `;
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
      twTable.innerHTML = `
        <thead>
          <tr>
            <th>${isGroup ? 'Group' : 'Candidate'}</th>
            <th style="text-align:right">Precincts Won</th>
            <th style="text-align:right">Votes</th>
            <th style="text-align:right">Share</th>
          </tr>
        </thead>
      `;
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