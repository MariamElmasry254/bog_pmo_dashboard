/* BOG PMO Dashboard JS */

const fmt = {
  num: (n) => new Intl.NumberFormat('en-US').format(Math.round(n || 0)),
  money: (n) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n || 0),
  decimal: (n) => (n ?? 0).toLocaleString('en-US', { maximumFractionDigits: 1 }),
};

// ========= Tabs =========
const tabs = document.querySelectorAll('.tab');
const panels = document.querySelectorAll('.tab-panel');

tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab;
    tabs.forEach(t => t.classList.remove('active'));
    panels.forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(target).classList.add('active');

    // lazy load on tab change
    if (target === 'services' && !state.servicesLoaded) loadServices();
    if (target === 'timesheets' && !state.timesheetsLoaded) loadTimesheets();
    if (target === 'analysis' && !state.analysisLoaded) loadAnalysis();
    if (target === 'budget' && !state.budgetLoaded) loadBudget();
  });
});

const state = {};
let charts = {};

// ========= Overview =========
async function loadOverview() {
  try {
    const res = await fetch('/api/overview');
    const d = await res.json();

    document.getElementById('kpiWD').textContent = fmt.num(d.total_working_days);
    document.getElementById('kpiServices').textContent = d.total_services;
    document.getElementById('kpiMD').textContent = fmt.num(6556);
    document.getElementById('kpiProfit').textContent = d.profit_pct + '%';
    document.getElementById('progressVal').textContent = d.progress_pct;
    document.getElementById('progressBar').style.width = d.progress_pct + '%';

    // complexity chart
    const ctx = document.getElementById('complexityChart').getContext('2d');
    if (charts.complexity) charts.complexity.destroy();
    charts.complexity = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: Object.keys(d.complexity_distribution),
        datasets: [{
          data: Object.values(d.complexity_distribution),
          backgroundColor: ['#7c9eb2', '#8ab87a', '#e0b15c', '#c97a6a'],
          borderColor: '#1a1d26',
          borderWidth: 2,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right',
            labels: { color: '#8b8fa0', font: { family: 'Manrope', size: 12 }, padding: 14 }
          }
        },
        cutout: '70%'
      }
    });
  } catch (e) {
    console.error('overview load error', e);
  }
}

// ========= Services =========
async function loadServices() {
  state.servicesLoaded = true;
  const res = await fetch('/api/services');
  const services = await res.json();
  state.services = services;
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
    const compHtml = complexity
      ? `<span class="complexity-pill ${cClass}">${complexity}</span>` : '—';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td dir="auto">${name}</td>
      <td>${priority || '—'}</td>
      <td>${compHtml}</td>
      <td class="num">${s['Dev MDs'] != null ? fmt.decimal(s['Dev MDs']) : '—'}</td>
      <td class="num">${s['Analysis MD'] != null ? fmt.decimal(s['Analysis MD']) : '—'}</td>
      <td class="num">${s['UI/UX'] != null ? fmt.decimal(s['UI/UX']) : '—'}</td>
      <td class="num">${s['QC'] != null ? fmt.decimal(s['QC']) : '—'}</td>
      <td class="num">${s['UAT'] != null ? fmt.decimal(s['UAT']) : '—'}</td>
      <td class="num">${s['PM'] != null ? fmt.decimal(s['PM']) : '—'}</td>
      <td class="num"><b>${s['ALL'] != null ? fmt.decimal(s['ALL']) : '—'}</b></td>
      <td class="num">${s['WD'] != null ? fmt.decimal(s['WD']) : '—'}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ========= Timesheets =========
async function loadTimesheets() {
  state.timesheetsLoaded = true;
  const days = document.getElementById('rangeSelect').value;
  const tbody = document.querySelector('#timesheetsTable tbody');
  tbody.innerHTML = '<tr><td colspan="5" class="loading">Loading from Odoo…</td></tr>';

  try {
    const res = await fetch(`/api/timesheets?days=${days}`);
    const d = await res.json();

    const banner = document.getElementById('connectionBanner');
    const indicator = document.getElementById('liveIndicator');
    const status = document.getElementById('liveStatus');

    if (d.connected) {
      banner.style.display = 'none';
      indicator.classList.add('connected');
      status.textContent = 'Live · Odoo';
    } else {
      banner.style.display = 'block';
      document.getElementById('bannerMsg').textContent = d.message || '';
      status.textContent = 'Demo mode';
    }

    tbody.innerHTML = '';
    if (!d.data || d.data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="loading">No entries found</td></tr>';
      return;
    }

    d.data.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    d.data.forEach(row => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span style="font-family: var(--mono); font-size: 12px;">${row.date || '—'}</span></td>
        <td><b>${row.employee || '—'}</b></td>
        <td>${row.task || row.description || '—'}</td>
        <td style="color: var(--text-dim);">${row.description || ''}</td>
        <td class="num"><b>${fmt.decimal(row.hours)}</b></td>
      `;
      tbody.appendChild(tr);
    });

    renderRecentActivity(d.data.slice(0, 8));
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="5" class="loading">Error: ${e.message}</td></tr>`;
  }
}

function renderRecentActivity(entries) {
  const cont = document.getElementById('recentActivity');
  cont.innerHTML = '';
  if (!entries || entries.length === 0) {
    cont.innerHTML = '<div class="loading">No recent activity</div>';
    return;
  }
  entries.forEach(e => {
    const row = document.createElement('div');
    row.className = 'activity-row';
    row.innerHTML = `
      <span class="activity-date">${e.date || '—'}</span>
      <span class="activity-emp">${e.employee || '—'}</span>
      <span class="activity-task">${e.task || e.description || '—'}</span>
      <span class="activity-hrs">${fmt.decimal(e.hours)}h</span>
    `;
    cont.appendChild(row);
  });
}

// ========= Analysis =========
async function loadAnalysis() {
  state.analysisLoaded = true;
  const days = document.getElementById('rangeSelect').value || 30;
  const res = await fetch(`/api/timesheets/analysis?days=${days}`);
  const d = await res.json();

  document.getElementById('anaTotalH').textContent = fmt.decimal(d.total_hours);
  document.getElementById('anaMembers').textContent = d.unique_employees || 0;
  document.getElementById('anaEntries').textContent = d.total_entries || 0;
  const avg = d.by_date && d.by_date.length ? d.total_hours / d.by_date.length : 0;
  document.getElementById('anaAvgDay').textContent = fmt.decimal(avg);

  // Employee chart
  const ec = document.getElementById('employeeChart').getContext('2d');
  if (charts.employee) charts.employee.destroy();
  charts.employee = new Chart(ec, {
    type: 'bar',
    data: {
      labels: d.by_employee.map(e => e.employee),
      datasets: [{
        label: 'Hours',
        data: d.by_employee.map(e => e.hours),
        backgroundColor: '#d4a574',
        borderRadius: 0,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#8b8fa0' } },
        y: { grid: { display: false }, ticks: { color: '#e8eaee', font: { family: 'Manrope', size: 12 } } }
      }
    }
  });

  // Trend chart
  const tc = document.getElementById('trendChart').getContext('2d');
  if (charts.trend) charts.trend.destroy();
  charts.trend = new Chart(tc, {
    type: 'line',
    data: {
      labels: d.by_date.map(x => x.date),
      datasets: [{
        label: 'Hours / day',
        data: d.by_date.map(x => x.hours),
        borderColor: '#7c9eb2',
        backgroundColor: 'rgba(124,158,178,0.1)',
        fill: true,
        tension: 0.3,
        pointBackgroundColor: '#d4a574',
        pointRadius: 4,
        pointHoverRadius: 6,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#8b8fa0', font: { family: 'JetBrains Mono', size: 10 } } },
        y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#8b8fa0' }, beginAtZero: true }
      }
    }
  });
}

// ========= Budget =========
async function loadBudget() {
  state.budgetLoaded = true;
  const res = await fetch('/api/budget');
  const b = await res.json();

  const approved = document.getElementById('approvedBudget');
  approved.innerHTML = `
    <div class="budget-row"><span class="label">Total Cost (USD)</span><span class="value">$ ${fmt.money(b.approved.cost_usd)}</span></div>
    <div class="budget-row"><span class="label">Total Cost (SAR)</span><span class="value">${fmt.money(b.approved.cost_sar)}</span></div>
    <div class="budget-row"><span class="label">Total Revenue (SAR)</span><span class="value">${fmt.money(b.approved.revenue_sar)}</span></div>
    <div class="budget-row highlight"><span class="label">Profit</span><span class="value">${fmt.money(b.approved.profit_sar)} · ${b.approved.profit_pct}%</span></div>
  `;

  const final = document.getElementById('finalBudget');
  final.innerHTML = `
    <div class="budget-row"><span class="label">Total Cost (SAR)</span><span class="value">${fmt.money(b.final.cost_sar)}</span></div>
    <div class="budget-row"><span class="label">Total Revenue (SAR)</span><span class="value">${fmt.money(b.final.revenue_sar)}</span></div>
    <div class="budget-row"><span class="label">Δ Cost</span><span class="value">${fmt.money(b.total_change_cost)}</span></div>
    <div class="budget-row"><span class="label">Δ Revenue</span><span class="value" style="color: var(--danger);">(${fmt.money(Math.abs(b.total_change_revenue))})</span></div>
    <div class="budget-row highlight"><span class="label">Profit</span><span class="value">${fmt.money(b.final.profit_sar)} · ${b.final.profit_pct}%</span></div>
  `;

  const tbody = document.querySelector('#changesTable tbody');
  tbody.innerHTML = '';
  b.changes.forEach(c => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${c.reason}</td>
      <td>${c.plan_id || '—'}</td>
      <td class="num">${c.changes_cost ? fmt.money(c.changes_cost) : '—'}</td>
      <td class="num" style="color: ${c.changes_revenue < 0 ? 'var(--danger)' : 'var(--success)'}">
        ${c.changes_revenue ? '(' + fmt.money(Math.abs(c.changes_revenue)) + ')' : '—'}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// ========= Refresh & filters =========
document.getElementById('refreshBtn').addEventListener('click', () => {
  state.timesheetsLoaded = false;
  state.analysisLoaded = false;
  loadTimesheets();
});
document.getElementById('rangeSelect').addEventListener('change', () => {
  state.timesheetsLoaded = false;
  state.analysisLoaded = false;
  loadTimesheets();
});

// ========= Init =========
loadOverview();
loadTimesheets(); // load timesheets on init for the recent activity widget
