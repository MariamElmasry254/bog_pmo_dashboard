/* Timesheets tab */
window.loadTimesheets = async function() {
  if (!AppState.loaded.timesheets) {
    // First load: populate service dropdown
    await loadServiceDropdown();
    // Set default dates (last 30 days)
    const def = getDefaultDates();
    document.getElementById('tsFrom').value = def.from;
    document.getElementById('tsTo').value = def.to;
    AppState.loaded.timesheets = true;

    // Wire events
    document.getElementById('tsApply').addEventListener('click', refreshTimesheets);
    document.getElementById('tsReset').addEventListener('click', () => {
      const def = getDefaultDates();
      document.getElementById('tsFrom').value = def.from;
      document.getElementById('tsTo').value = def.to;
      document.getElementById('tsService').value = '';
      document.getElementById('tsSearch').value = '';
      refreshTimesheets();
    });
    document.getElementById('tsExport').addEventListener('click', exportTimesheets);
    document.getElementById('tsSearch').addEventListener('input', filterEmployeeRows);
    document.getElementById('tsBack').addEventListener('click', () => {
      document.getElementById('tsDetailView').style.display = 'none';
      document.getElementById('tsListView').style.display = 'block';
    });
  }
  refreshTimesheets();
};

async function loadServiceDropdown() {
  const res = await fetch('/api/services/projects');
  const d = await res.json();
  const sel = document.getElementById('tsService');
  d.services.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = s;
    sel.appendChild(opt);
  });
}

function getCurrentFilters() {
  return {
    from: document.getElementById('tsFrom').value,
    to: document.getElementById('tsTo').value,
    service: document.getElementById('tsService').value,
  };
}

async function refreshTimesheets() {
  const f = getCurrentFilters();
  const params = new URLSearchParams();
  if (f.from) params.set('from', f.from);
  if (f.to) params.set('to', f.to);
  if (f.service) params.set('service', f.service);

  const tbody = document.querySelector('#tsEmpTable tbody');
  tbody.innerHTML = '<tr><td colspan="5" class="loading">Loading…</td></tr>';

  try {
    const res = await fetch('/api/timesheets/employees?' + params.toString());
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
    document.getElementById('tsServiceLabel').textContent = f.service || 'All services';

    AppState.tsEmployees = d.employees;
    renderEmployeeRows(d.employees);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="loading">Error: ${err.message}</td></tr>`;
  }
}

function renderEmployeeRows(employees) {
  const tbody = document.querySelector('#tsEmpTable tbody');
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
  const filtered = !q ? AppState.tsEmployees :
    AppState.tsEmployees.filter(e => e.name.toLowerCase().includes(q));
  renderEmployeeRows(filtered);
}

async function loadEmployeeDetail(name) {
  document.getElementById('tsListView').style.display = 'none';
  document.getElementById('tsDetailView').style.display = 'block';

  const f = getCurrentFilters();
  const params = new URLSearchParams();
  if (f.from) params.set('from', f.from);
  if (f.to) params.set('to', f.to);
  if (f.service) params.set('service', f.service);

  document.getElementById('tsDetailName').textContent = name;
  const cont = document.getElementById('tsDetailDays');
  cont.innerHTML = '<div class="loading">Loading…</div>';

  const res = await fetch(`/api/timesheets/employee/${encodeURIComponent(name)}?` + params.toString());
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
            ${t.description ? `<div class="task-desc">${t.description}</div>` : ''}
          </div>
          <div>${t.service ? `<span class="task-service" dir="auto">${t.service}</span>` : ''}</div>
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
  const params = new URLSearchParams();
  if (f.from) params.set('from', f.from);
  if (f.to) params.set('to', f.to);
  if (f.service) params.set('service', f.service);
  window.location.href = '/api/timesheets/export?' + params.toString();
}
