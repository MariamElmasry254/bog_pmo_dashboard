/* Timesheets tab — with multi-select phase filter */
const DEFAULT_PHASE = 'Development Phase';

window.loadTimesheets = async function() {
  if (!AppState.loaded.timesheets) {
    await loadPhasesDropdown();
    const def = getDefaultDates();
    document.getElementById('tsFrom').value = def.from;
    document.getElementById('tsTo').value = def.to;
    AppState.loaded.timesheets = true;

    document.getElementById('tsApply').addEventListener('click', refreshTimesheets);
    document.getElementById('tsReset').addEventListener('click', () => {
      const def = getDefaultDates();
      document.getElementById('tsFrom').value = def.from;
      document.getElementById('tsTo').value = def.to;
      AppState.selectedPhases = AppState.phases.includes(DEFAULT_PHASE) ? [DEFAULT_PHASE] : [];
      renderPhaseMenu();
      updatePhaseToggleLabel();
      document.getElementById('tsSearch').value = '';
      refreshTimesheets();
    });
    document.getElementById('tsExport').addEventListener('click', exportTimesheets);
    document.getElementById('tsSearch').addEventListener('input', filterEmployeeRows);
    document.getElementById('tsBack').addEventListener('click', () => {
      document.getElementById('tsDetailView').style.display = 'none';
      document.getElementById('tsListView').style.display = 'block';
    });
    setupPhaseDropdown();
  }
  refreshTimesheets();
};

async function loadPhasesDropdown() {
  const res = await fetch('/api/phases');
  const d = await res.json();
  AppState.phases = d.phases.map(p => p.name);
  AppState.selectedPhases = AppState.phases.includes(d.default || DEFAULT_PHASE)
    ? [d.default || DEFAULT_PHASE]
    : (AppState.phases.length ? [AppState.phases[0]] : []);
  renderPhaseMenu();
  updatePhaseToggleLabel();
}

function renderPhaseMenu() {
  const menu = document.getElementById('phaseMenu');
  if (!menu) return;
  let html = `
    <div class="phase-menu-actions">
      <a id="phaseSelectAll">Select all</a>
      <a id="phaseSelectNone">Clear</a>
    </div>
  `;
  AppState.phases.forEach(p => {
    const checked = AppState.selectedPhases.includes(p);
    html += `
      <label class="phase-option ${checked ? 'selected' : ''}" data-phase="${p}">
        <input type="checkbox" ${checked ? 'checked' : ''}>
        <span dir="auto">${p}</span>
      </label>
    `;
  });
  menu.innerHTML = html;

  menu.querySelectorAll('.phase-option').forEach(opt => {
    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      const phase = opt.dataset.phase;
      const checkbox = opt.querySelector('input');
      if (e.target !== checkbox) checkbox.checked = !checkbox.checked;
      if (checkbox.checked) {
        if (!AppState.selectedPhases.includes(phase)) AppState.selectedPhases.push(phase);
        opt.classList.add('selected');
      } else {
        AppState.selectedPhases = AppState.selectedPhases.filter(p => p !== phase);
        opt.classList.remove('selected');
      }
      updatePhaseToggleLabel();
    });
  });
  menu.querySelector('#phaseSelectAll').addEventListener('click', (e) => {
    e.stopPropagation();
    AppState.selectedPhases = [...AppState.phases];
    renderPhaseMenu();
    updatePhaseToggleLabel();
  });
  menu.querySelector('#phaseSelectNone').addEventListener('click', (e) => {
    e.stopPropagation();
    AppState.selectedPhases = [];
    renderPhaseMenu();
    updatePhaseToggleLabel();
  });
}

function updatePhaseToggleLabel() {
  const label = document.getElementById('phaseToggleLabel');
  if (!label) return;
  const sel = AppState.selectedPhases || [];
  if (sel.length === 0) {
    label.innerHTML = '<span style="color: var(--text-muted);">No phase selected</span>';
  } else if (sel.length === 1) {
    label.innerHTML = `<span dir="auto">${sel[0]}</span>`;
  } else if (sel.length === AppState.phases.length) {
    label.innerHTML = `All phases <span class="phase-count-badge">${sel.length}</span>`;
  } else {
    label.innerHTML = `${sel.length} phases <span class="phase-count-badge">${sel.length}</span>`;
  }
}

function setupPhaseDropdown() {
  const toggle = document.getElementById('phaseToggle');
  const menu = document.getElementById('phaseMenu');
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = menu.style.display !== 'none';
    menu.style.display = isOpen ? 'none' : 'block';
    toggle.classList.toggle('open', !isOpen);
  });
  document.addEventListener('click', (e) => {
    if (!document.getElementById('phaseDropdown').contains(e.target)) {
      menu.style.display = 'none';
      toggle.classList.remove('open');
    }
  });
}

function getCurrentFilters() {
  return {
    from: document.getElementById('tsFrom').value,
    to: document.getElementById('tsTo').value,
    phases: AppState.selectedPhases || [],
  };
}

function buildParams(f) {
  const params = new URLSearchParams();
  if (f.from) params.set('from', f.from);
  if (f.to) params.set('to', f.to);
  if (f.phases && f.phases.length) params.set('phases', f.phases.join(','));
  return params;
}

async function refreshTimesheets() {
  const f = getCurrentFilters();
  const tbody = document.querySelector('#tsEmpTable tbody');
  tbody.innerHTML = '<tr><td colspan="5" class="loading">Loading…</td></tr>';

  try {
    const res = await fetch('/api/timesheets/employees?' + buildParams(f).toString());
    const d = await res.json();

    const banner = document.getElementById('connectionBanner');
    if (!d.connected) {
      banner.style.display = 'block';
      document.getElementById('bannerMsg').textContent = 'Demo data shown. Configure ODOO credentials for live sync.';
    } else {
      banner.style.display = 'none';
    }

    document.getElementById('tsTotalHours').textContent = fmt.decimal(d.total_hours);
    document.getElementById('tsTotalEmps').textContent = d.employees.length;
    document.getElementById('tsRange').textContent = (f.from && f.to) ? `${f.from} → ${f.to}` :
                                                      f.from ? `from ${f.from}` :
                                                      f.to ? `until ${f.to}` : 'All time';
    const phaseLabel = !f.phases.length ? 'No phase' :
                       f.phases.length === 1 ? f.phases[0] :
                       `${f.phases.length} phases`;
    document.getElementById('tsServiceLabel').textContent = phaseLabel;

    // Default sort: alphabetical by name (A-Z)
    d.employees.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    AppState.currentSort = { col: 'name', dir: 'asc' };
    AppState.tsEmployees = d.employees;
    renderEmployeeRows(d.employees);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="loading">Error: ${err.message}</td></tr>`;
  }
}

function sortEmployeeTable(key, type) {
  const cur = AppState.currentSort || {};
  const dir = (cur.col === key && cur.dir === 'asc') ? 'desc' : 'asc';
  AppState.currentSort = { col: key, dir };

  const sorted = [...AppState.tsEmployees].sort((a, b) => {
    let va = a[key], vb = b[key];
    if (type === 'number') {
      va = +va || 0; vb = +vb || 0;
      return dir === 'asc' ? va - vb : vb - va;
    }
    va = (va || '').toString();
    vb = (vb || '').toString();
    return dir === 'asc' ? va.localeCompare(vb, 'ar') : vb.localeCompare(va, 'ar');
  });
  // Apply current employee search filter on top
  const q = (document.getElementById('tsSearch').value || '').toLowerCase().trim();
  const visible = q ? sorted.filter(e => e.name.toLowerCase().includes(q)) : sorted;
  renderEmployeeRows(visible);
}

function renderEmployeeRows(employees) {
  const tbody = document.querySelector('#tsEmpTable tbody');
  const thead = document.querySelector('#tsEmpTable thead tr');

  // Make headers sortable (one-time setup)
  if (!thead.dataset.sortable) {
    thead.dataset.sortable = '1';
    const sortable = [
      { idx: 0, key: 'name', type: 'string' },
      { idx: 1, key: 'total_hours', type: 'number' },
      { idx: 2, key: 'days_logged', type: 'number' },
      { idx: 3, key: 'entries', type: 'number' },
    ];
    sortable.forEach(s => {
      const th = thead.children[s.idx];
      if (!th) return;
      th.style.cursor = 'pointer';
      th.dataset.sortKey = s.key;
      th.innerHTML = th.innerHTML + ' <span class="sort-arrow">⇅</span>';
      th.addEventListener('click', () => sortEmployeeTable(s.key, s.type));
    });
  }

  // Update sort indicator arrows
  thead.querySelectorAll('th').forEach(th => {
    const arrow = th.querySelector('.sort-arrow');
    if (!arrow) return;
    if (th.dataset.sortKey === (AppState.currentSort && AppState.currentSort.col)) {
      arrow.textContent = AppState.currentSort.dir === 'asc' ? '▲' : '▼';
      arrow.style.color = 'var(--blue)';
      arrow.style.opacity = '1';
    } else {
      arrow.textContent = '⇅';
      arrow.style.color = 'var(--text-muted)';
      arrow.style.opacity = '0.4';
    }
  });

  tbody.innerHTML = '';
  if (!employees.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="loading">No data for this filter</td></tr>';
    return;
  }
  employees.forEach(e => {
    const tr = document.createElement('tr');
    tr.className = 'clickable';
    tr.innerHTML = `
      <td><b style="color: var(--navy);">${e.name}</b></td>
      <td class="num"><b style="font-size:15px;">${fmt.decimal(e.total_hours)}</b>h</td>
      <td class="num">${e.days_logged}</td>
      <td class="num">${e.entries}</td>
      <td><span style="color: var(--blue); font-weight: 600;">View details →</span></td>
    `;
    tr.addEventListener('click', () => loadEmployeeDetail(e.name));
    tbody.appendChild(tr);
  });
}

function filterEmployeeRows() {
  const q = document.getElementById('tsSearch').value.toLowerCase().trim();
  // Apply current sort first
  const cur = AppState.currentSort || { col: 'name', dir: 'asc' };
  const sorted = [...AppState.tsEmployees].sort((a, b) => {
    let va = a[cur.col], vb = b[cur.col];
    if (typeof va === 'number') {
      return cur.dir === 'asc' ? va - vb : vb - va;
    }
    va = (va || '').toString(); vb = (vb || '').toString();
    return cur.dir === 'asc' ? va.localeCompare(vb, 'ar') : vb.localeCompare(va, 'ar');
  });
  const filtered = !q ? sorted : sorted.filter(e => e.name.toLowerCase().includes(q));
  renderEmployeeRows(filtered);
}

async function loadEmployeeDetail(name) {
  document.getElementById('tsListView').style.display = 'none';
  document.getElementById('tsDetailView').style.display = 'block';

  const f = getCurrentFilters();
  document.getElementById('tsDetailName').textContent = name;
  const cont = document.getElementById('tsDetailDays');
  cont.innerHTML = '<div class="loading">Loading…</div>';

  const res = await fetch(`/api/timesheets/employee/${encodeURIComponent(name)}?` + buildParams(f).toString());
  const d = await res.json();

  document.getElementById('tsDetailH').textContent = fmt.decimal(d.total_hours);
  document.getElementById('tsDetailD').textContent = d.total_days;

  cont.innerHTML = '';
  if (!d.days.length) {
    cont.innerHTML = '<div class="loading">No entries for this employee in selected range</div>';
    return;
  }
  d.days.forEach(day => {
    const card = document.createElement('div');
    card.className = 'day-card';
    let tasksHtml = '';
    day.tasks.forEach(t => {
      tasksHtml += `
        <div class="task-row">
          <div>
            <div class="task-name">${t.task || '—'}</div>
            ${t.description && t.description !== t.task ? `<div class="task-desc">${t.description}</div>` : ''}
          </div>
          <div>
            ${t.phase ? `<span class="task-service" dir="auto" style="background: rgba(27,42,78,0.1); color: var(--navy);">${t.phase}</span>` : ''}
            ${t.service ? `<span class="task-service" dir="auto" style="margin-left:4px;">${t.service}</span>` : ''}
          </div>
          <div class="task-hours">${fmt.decimal(t.hours)}h</div>
        </div>`;
    });
    const taskCount = day.tasks.length;
    card.innerHTML = `
      <div class="day-card-head">
        <span class="day-card-date">${day.date}</span>
        <div class="day-card-right">
          <span class="day-card-summary">${taskCount} task${taskCount !== 1 ? 's' : ''}</span>
          <span class="day-card-hours">${fmt.decimal(day.total_hours)}h</span>
        </div>
      </div>
      <div class="day-card-tasks">${tasksHtml}</div>
    `;
    card.querySelector('.day-card-head').addEventListener('click', () => {
      card.classList.toggle('expanded');
    });
    cont.appendChild(card);
  });
}

function exportTimesheets() {
  const f = getCurrentFilters();
  window.location.href = '/api/timesheets/export?' + buildParams(f).toString();
}
