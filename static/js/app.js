/* BOG PMO v2 — JS */

const fmt = {
  num: n => new Intl.NumberFormat('en-US').format(Math.round(n || 0)),
  decimal: n => (n ?? 0).toLocaleString('en-US', { maximumFractionDigits: 1 }),
  money: n => new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n || 0),
  date: d => d || '—',
};

// ========= TABS =========
const tabs = document.querySelectorAll('.exec-tab');
const panels = document.querySelectorAll('.tab-panel');
tabs.forEach(t => {
  t.addEventListener('click', () => {
    const target = t.dataset.tab;
    tabs.forEach(x => x.classList.remove('active'));
    panels.forEach(p => p.classList.remove('active'));
    t.classList.add('active');
    document.getElementById(target).classList.add('active');

    if (target === 'services' && !state.servicesLoaded) loadServices();
    if (target === 'timesheets' && !state.timesheetsLoaded) loadTimesheets();
    if (target === 'missing' && !state.missingLoaded) loadMissing();
    if (target === 'roadmap' && !state.roadmapLoaded) loadRoadmap();
    if (target === 'budget' && !state.budgetLoaded) loadBudget();
  });
});

const state = {};
let charts = {};

document.getElementById('generatedTime').textContent =
  new Date().toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' });

// ========= OVERVIEW =========
async function loadOverview() {
  const res = await fetch('/api/overview');
  const d = await res.json();
  document.getElementById('kpiServices').textContent = d.total_services;
  document.getElementById('kpiWD').textContent = fmt.num(d.total_working_days);
  document.getElementById('kpiMD').textContent = fmt.num(6556);
  document.getElementById('kpiProfit').textContent = d.profit_pct;
  document.getElementById('progressVal').textContent = d.progress_pct;
  document.getElementById('progressBar').style.width = d.progress_pct + '%';

  // Complexity chart
  const ctx = document.getElementById('complexityChart').getContext('2d');
  if (charts.complexity) charts.complexity.destroy();
  charts.complexity = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: Object.keys(d.complexity_distribution),
      datasets: [{
        data: Object.values(d.complexity_distribution),
        backgroundColor: ['#3B82F6', '#10B981', '#F59E0B', '#EF4444'],
        borderColor: '#fff',
        borderWidth: 3,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: { color: '#4B5563', font: { family: 'Inter', size: 13 }, padding: 14 }
        }
      },
      cutout: '65%'
    }
  });

  loadRecentActivity();
}

async function loadRecentActivity() {
  const today = new Date();
  const lastWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fromStr = lastWeek.toISOString().split('T')[0];

  const cont = document.getElementById('recentActivity');
  try {
    const res = await fetch(`/api/timesheets/employees?from=${fromStr}`);
    const d = await res.json();
    if (!d.employees || !d.employees.length) {
      cont.innerHTML = '<div class="loading">No activity in the last 7 days</div>';
      return;
    }
    cont.innerHTML = '';
    d.employees.slice(0, 8).forEach(e => {
      const row = document.createElement('div');
      row.className = 'activity-row';
      row.innerHTML = `
        <span class="activity-date">last 7 days</span>
        <span class="activity-emp">${e.name}</span>
        <span class="activity-task">${e.days_logged} days · ${e.entries} entries</span>
        <span class="activity-hrs">${fmt.decimal(e.total_hours)}h</span>
      `;
      cont.appendChild(row);
    });
  } catch (e) {
    cont.innerHTML = '<div class="loading">Could not load activity</div>';
  }
}

// ========= SERVICES =========
async function loadServices() {
  state.servicesLoaded = true;
  const res = await fetch('/api/services');
  const services = await res.json();
  state.services = services;
  document.getElementById('servicesCount').textContent = services.length;
  renderServices(services);

  document.getElementById('serviceSearch').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    const filtered = services.filter(s => {
      const name = (s['اسم الخدمة المستقبلي'] || '').toString().toLowerCase();
      return name.includes(q);
    });
    renderServices(filtered);
  });
}

function renderServices(services) {
  const tbody = document.querySelector('#servicesTable tbody');
  tbody.innerHTML = '';
  services.forEach((s, i) => {
    const name = s['اسم الخدمة المستقبلي'] || '—';
    const priority = s['الأولوية'] !== null ? s['الأولوية'] : '';
    const complexity = s['Complexity'] || '';
    const cClass = ['Basic', 'Simple', 'Medium', 'Complex'].includes(complexity)
      ? `complexity-${complexity}` : '';
    const compHtml = complexity ? `<span class="complexity-pill ${cClass}">${complexity}</span>` : '—';
    const teamHtml = s.assignation_team ? `<span class="team-pill">${s.assignation_team}</span>` : '<span class="muted-text">—</span>';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td dir="auto" style="font-weight:500;">${name}</td>
      <td>${priority || '—'}</td>
      <td>${compHtml}</td>
      <td>${teamHtml}</td>
      <td><span class="muted-text">— TBD —</span></td>
      <td class="num">${s['WD'] != null ? fmt.decimal(s['WD']) : '—'}</td>
      <td>${s.planned_start || '—'}</td>
      <td>${s.planned_end || '—'}</td>
      <td class="num"><b>${s['ALL'] != null ? fmt.decimal(s['ALL']) : '—'}</b></td>
    `;
    tbody.appendChild(tr);
  });
}

// ========= TIMESHEETS — VIEW 1: EMPLOYEES =========
async function loadTimesheets() {
  state.timesheetsLoaded = true;
  const from = document.getElementById('dateFrom').value;
  const to = document.getElementById('dateTo').value;
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);

  const tbody = document.querySelector('#employeeTable tbody');
  tbody.innerHTML = '<tr><td colspan="6" class="loading">Loading…</td></tr>';

  try {
    const res = await fetch('/api/timesheets/employees?' + params.toString());
    const d = await res.json();

    const banner = document.getElementById('connectionBanner');
    if (!d.connected) {
      banner.style.display = 'block';
      document.getElementById('bannerMsg').textContent = 'Demo data shown. Configure ODOO_USERNAME/PASSWORD env vars for live sync.';
    } else {
      banner.style.display = 'none';
    }

    document.getElementById('tsTotalHours').textContent = fmt.decimal(d.total_hours);
    document.getElementById('tsTotalEmps').textContent = d.employees.length;
    document.getElementById('tsRange').textContent = (from && to) ? `${from} → ${to}` :
                                                      from ? `from ${from}` :
                                                      to ? `until ${to}` : 'All time';

    tbody.innerHTML = '';
    if (!d.employees.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="loading">No data</td></tr>';
      return;
    }
    d.employees.forEach(e => {
      const tr = document.createElement('tr');
      tr.className = 'clickable';
      tr.innerHTML = `
        <td><b style="color: var(--navy);">${e.name}</b></td>
        <td class="num"><b style="font-size:15px;">${fmt.decimal(e.total_hours)}</b>h</td>
        <td class="num">${e.days_logged}</td>
        <td class="num">${fmt.decimal(e.avg_per_day)}h</td>
        <td class="num">${e.entries}</td>
        <td><span style="color: var(--blue); font-weight: 600;">View details →</span></td>
      `;
      tr.addEventListener('click', () => loadEmployeeDetail(e.name));
      tbody.appendChild(tr);
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="loading">Error: ${err.message}</td></tr>`;
  }
}

// ========= TIMESHEETS — VIEW 2: DRILL-DOWN =========
async function loadEmployeeDetail(name) {
  document.getElementById('employeeListView').style.display = 'none';
  document.getElementById('employeeDetailView').style.display = 'block';

  const from = document.getElementById('dateFrom').value;
  const to = document.getElementById('dateTo').value;
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);

  document.getElementById('detailEmpName').textContent = name;
  const cont = document.getElementById('detailDays');
  cont.innerHTML = '<div class="loading">Loading…</div>';

  const res = await fetch(`/api/timesheets/employee/${encodeURIComponent(name)}?` + params.toString());
  const d = await res.json();

  document.getElementById('detailTotalH').textContent = fmt.decimal(d.total_hours);
  document.getElementById('detailTotalD').textContent = d.total_days;

  cont.innerHTML = '';
  if (!d.days.length) {
    cont.innerHTML = '<div class="loading">No entries for this employee</div>';
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
    card.innerHTML = `
      <div class="day-card-head">
        <span class="day-card-date">${day.date}</span>
        <span class="day-card-hours">${fmt.decimal(day.total_hours)}h</span>
      </div>
      ${tasksHtml}
    `;
    cont.appendChild(card);
  });
}

document.getElementById('backToList').addEventListener('click', () => {
  document.getElementById('employeeDetailView').style.display = 'none';
  document.getElementById('employeeListView').style.display = 'block';
});

document.getElementById('applyDateFilter').addEventListener('click', () => {
  state.timesheetsLoaded = false;
  state.missingLoaded = false;
  loadTimesheets();
});
document.getElementById('resetFilter').addEventListener('click', () => {
  document.getElementById('dateFrom').value = '';
  document.getElementById('dateTo').value = '';
  state.timesheetsLoaded = false;
  loadTimesheets();
});

// ========= MISSING HOURS =========
async function loadMissing() {
  state.missingLoaded = true;
  const tbody = document.querySelector('#missingTable tbody');
  tbody.innerHTML = '<tr><td colspan="9" class="loading">Calculating compliance…</td></tr>';

  const res = await fetch('/api/missing-hours');
  const d = await res.json();

  tbody.innerHTML = '';
  if (!d.employees.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="loading">No data</td></tr>';
    return;
  }
  d.employees.forEach(e => {
    const cls = e.completion_pct >= 90 ? 'high' : e.completion_pct >= 70 ? 'med' : 'low';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><b style="color: var(--navy);">${e.name}</b></td>
      <td><span style="font-family: var(--mono); font-size: 12px;">${e.first_entry || '—'}</span></td>
      <td class="num">${e.expected_days}</td>
      <td class="num">${e.logged_days}</td>
      <td class="num"><b style="color: ${e.missing_days_count > 0 ? 'var(--red)' : 'var(--text)'}">${e.missing_days_count}</b></td>
      <td class="num">${fmt.decimal(e.logged_hours)}h</td>
      <td class="num">${fmt.decimal(e.expected_hours)}h</td>
      <td class="num"><b style="color: ${e.missing_hours > 0 ? 'var(--red)' : 'var(--green)'}">${fmt.decimal(e.missing_hours)}h</b></td>
      <td class="compliance-cell">
        <div class="compliance-bar"><div class="compliance-fill ${cls}" style="width:${Math.min(e.completion_pct, 100)}%"></div></div>
        <div class="compliance-pct">${fmt.decimal(e.completion_pct)}%</div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// ========= ROADMAP =========
async function loadRoadmap() {
  state.roadmapLoaded = true;
  const res = await fetch('/api/roadmap');
  const d = await res.json();

  // Milestones
  const mt = document.getElementById('milestonesTimeline');
  mt.innerHTML = '';
  d.milestones.forEach(m => {
    const div = document.createElement('div');
    div.className = `milestone ${m.type}`;
    div.innerHTML = `
      <div class="milestone-date">${m.date}</div>
      <div class="milestone-title" dir="auto">${m.title}</div>
      <div class="milestone-desc" dir="auto">${m.desc}</div>
    `;
    mt.appendChild(div);
  });

  // Team breakdown
  const tb = document.getElementById('teamBreakdown');
  tb.innerHTML = '';
  Object.values(d.team_breakdown).forEach(team => {
    const card = document.createElement('div');
    card.className = 'team-card';
    card.innerHTML = `
      <h4 dir="auto">${team.name}</h4>
      <div class="big-num">${team.count}</div>
      <div class="small-text">services${team.total_wd ? ` · ${fmt.decimal(team.total_wd)} working days` : ''}</div>
    `;
    tb.appendChild(card);
  });

  // Services schedule
  const today = new Date().toISOString().split('T')[0];
  const tbody = document.querySelector('#roadmapTable tbody');
  tbody.innerHTML = '';
  d.services.forEach(s => {
    let status = 'not-started';
    let statusLabel = 'Not Started';
    if (s.start <= today && s.end >= today) {
      status = 'in-progress';
      statusLabel = 'In Progress';
    } else if (s.end < today) {
      status = 'done';
      statusLabel = 'Done';
    } else if (s.start > today) {
      status = 'not-started';
      statusLabel = 'Upcoming';
    }
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${s.id}</td>
      <td dir="auto" style="font-weight:500;">${s.name}</td>
      <td><span class="team-pill" dir="auto">${s.team}</span></td>
      <td><span style="font-family: var(--mono); font-size: 12px;">${s.start}</span></td>
      <td><span style="font-family: var(--mono); font-size: 12px;">${s.end}</span></td>
      <td class="num">${s.wd != null ? fmt.decimal(s.wd) : '—'}</td>
      <td><span class="status-pill status-${status}">${statusLabel}</span></td>
    `;
    tbody.appendChild(tr);
  });
}

// ========= BUDGET =========
async function loadBudget() {
  state.budgetLoaded = true;
  const res = await fetch('/api/budget');
  const b = await res.json();

  document.getElementById('approvedBudget').innerHTML = `
    <div class="budget-row"><span class="label">Total Cost (USD)</span><span class="value">$${fmt.money(b.approved.cost_usd)}</span></div>
    <div class="budget-row"><span class="label">Total Cost (SAR)</span><span class="value">${fmt.money(b.approved.cost_sar)}</span></div>
    <div class="budget-row"><span class="label">Total Revenue (SAR)</span><span class="value">${fmt.money(b.approved.revenue_sar)}</span></div>
    <div class="budget-row highlight"><span class="label">Profit</span><span class="value">${fmt.money(b.approved.profit_sar)} · ${b.approved.profit_pct}%</span></div>
  `;

  document.getElementById('finalBudget').innerHTML = `
    <div class="budget-row"><span class="label">Total Cost (SAR)</span><span class="value">${fmt.money(b.final.cost_sar)}</span></div>
    <div class="budget-row"><span class="label">Total Revenue (SAR)</span><span class="value">${fmt.money(b.final.revenue_sar)}</span></div>
    <div class="budget-row"><span class="label">Δ Cost</span><span class="value">${fmt.money(b.total_change_cost)}</span></div>
    <div class="budget-row"><span class="label">Δ Revenue</span><span class="value" style="color: var(--red);">(${fmt.money(Math.abs(b.total_change_revenue))})</span></div>
    <div class="budget-row highlight"><span class="label">Profit</span><span class="value">${fmt.money(b.final.profit_sar)} · ${b.final.profit_pct}%</span></div>
  `;

  const tb = document.querySelector('#changesTable tbody');
  tb.innerHTML = '';
  b.changes.forEach(c => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${c.reason}</td>
      <td>${c.plan_id || '—'}</td>
      <td class="num">${c.changes_cost ? fmt.money(c.changes_cost) : '—'}</td>
      <td class="num" style="color: ${c.changes_revenue < 0 ? 'var(--red)' : 'var(--green)'}">
        ${c.changes_revenue ? '(' + fmt.money(Math.abs(c.changes_revenue)) + ')' : '—'}
      </td>
    `;
    tb.appendChild(tr);
  });
}

// ========= INIT =========
loadOverview();
