/* Variance tab — mirrors variance.xlsx with sub-tabs */

window.loadVariance = async function() {
  if (!AppState.loaded.variance) {
    AppState.loaded.variance = true;
    document.getElementById('varianceExport').addEventListener('click', () => {
      window.location.href = '/api/variance/export';
    });
    document.querySelectorAll('.sub-tab').forEach(b => {
      b.addEventListener('click', () => switchSubTab(b.dataset.subtab));
    });
  }
  const cont = document.getElementById('varianceContent');
  cont.innerHTML = '<div class="loading">Loading variance data…</div>';
  const res = await fetch('/api/variance');
  const d = await res.json();
  if (!d.available) {
    cont.innerHTML = '<div class="banner banner-warn"><strong>Not configured:</strong> variance.xlsx not found in /data folder.</div>';
    return;
  }
  AppState.varianceData = d;
  switchSubTab('development');
};

function switchSubTab(key) {
  document.querySelectorAll('.sub-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.subtab === key);
  });
  if (key === 'travel') {
    renderTravelSubTab();
  } else {
    renderVarianceSubTab(key);
  }
}

function renderVarianceSubTab(key) {
  const cont = document.getElementById('varianceContent');
  const tab = AppState.varianceData?.tabs?.[key];
  if (!tab) {
    cont.innerHTML = '<div class="loading">No data for this tab</div>';
    return;
  }

  let html = '';
  // Section nav within sub-tab
  html += '<div class="section-nav-pills">';
  tab.sections.forEach((s, i) => {
    html += `<a href="#section-${key}-${s.key}" class="section-pill">${s.label}</a>`;
  });
  html += '</div>';

  tab.sections.forEach(sect => {
    html += `<div class="variance-section" id="section-${key}-${sect.key}">`;
    html += `<div class="section-bar"><span class="section-num">${sect.label.charAt(0)}</span><h2>${sect.label}</h2><span class="section-source">${sect.sheet || ''}</span></div>`;

    if (sect.error) {
      html += `<div class="banner banner-warn"><strong>Parse error:</strong> ${sect.error}</div>`;
    } else if (sect.data) {
      if (sect.key === 'budget') html += renderBudget(sect.data);
      else if (sect.key === 'profitability') html += renderProfitability(sect.data);
      else if (sect.key === 'effort') html += renderEffort(sect.data);
      else if (sect.key === 'estimated') html += renderEstimated(sect.data);
    }
    html += '</div>';
  });

  cont.innerHTML = html;
}

function renderBudget(data) {
  let html = '';
  // KPI cards from approved/final
  const a = data.approved || {};
  const f = data.final || {};
  html += `
    <div class="kpi-strip kpi-strip-small">
      <div class="kpi-card kpi-blue compact">
        <div class="kpi-label">TOTAL MANDAYS</div>
        <div class="kpi-value">${fmt.num(a.total_mandays)}</div>
      </div>
      <div class="kpi-card kpi-navy compact">
        <div class="kpi-label">APPROVED COST (SAR)</div>
        <div class="kpi-value">${fmt.money(a.cost_sar)}</div>
      </div>
      <div class="kpi-card kpi-green compact">
        <div class="kpi-label">APPROVED PROFIT</div>
        <div class="kpi-value">${fmt.decimal((a.profit_pct || 0) * 100)}<span class="kpi-unit">%</span></div>
        <div class="kpi-foot">${fmt.money(a.profit_sar)} SAR</div>
      </div>
      <div class="kpi-card kpi-amber compact">
        <div class="kpi-label">FINAL PROFIT</div>
        <div class="kpi-value">${fmt.decimal((f.profit_pct || 0) * 100)}<span class="kpi-unit">%</span></div>
        <div class="kpi-foot">${fmt.money(f.profit_sar)} SAR</div>
      </div>
    </div>
  `;

  // Approved vs Final side-by-side
  html += `
    <div class="grid-2">
      <div class="card budget-card">
        <h3 class="card-title">Approved Project Budget</h3>
        <div class="budget-row"><span class="label">Total Cost (USD)</span><span class="value">$${fmt.money(a.cost_usd)}</span></div>
        <div class="budget-row"><span class="label">Total Cost (SAR)</span><span class="value">${fmt.money(a.cost_sar)}</span></div>
        <div class="budget-row"><span class="label">Total Revenue (SAR)</span><span class="value">${fmt.money(a.revenue_sar)}</span></div>
        <div class="budget-row highlight"><span class="label">Profit</span><span class="value">${fmt.money(a.profit_sar)} · ${fmt.decimal((a.profit_pct || 0) * 100)}%</span></div>
      </div>
      <div class="card budget-card budget-final">
        <h3 class="card-title">Final Budget <span class="badge badge-amber">After Changes</span></h3>
        <div class="budget-row"><span class="label">Total Cost (SAR)</span><span class="value">${fmt.money(f.cost_sar)}</span></div>
        <div class="budget-row"><span class="label">Total Revenue (SAR)</span><span class="value">${fmt.money(f.revenue_sar)}</span></div>
        <div class="budget-row"><span class="label">Δ Cost</span><span class="value">${fmt.money(f.total_change_cost || 0)}</span></div>
        <div class="budget-row"><span class="label">Δ Revenue</span><span class="value" style="color: ${(f.total_change_revenue || 0) < 0 ? 'var(--red)' : 'var(--green)'}">${(f.total_change_revenue || 0) < 0 ? '(' + fmt.money(Math.abs(f.total_change_revenue || 0)) + ')' : fmt.money(f.total_change_revenue || 0)}</span></div>
        <div class="budget-row highlight"><span class="label">Profit</span><span class="value">${fmt.money(f.profit_sar)} · ${fmt.decimal((f.profit_pct || 0) * 100)}%</span></div>
      </div>
    </div>
  `;

  // Changes log
  if (data.changes && data.changes.length) {
    html += `<div class="card"><h3 class="card-title">Approved Budget Changes</h3>
      <table class="data-table"><thead><tr>
        <th>Reason</th><th>Plan / CR ID</th>
        <th class="num">Δ Cost (SAR)</th><th class="num">Δ Revenue (SAR)</th></tr></thead><tbody>`;
    data.changes.forEach(c => {
      const rev = c.changes_revenue || 0;
      const cost = c.changes_cost || 0;
      html += `<tr>
        <td>${c.reason || '—'}</td>
        <td>${c.plan_id || '—'}</td>
        <td class="num">${cost ? fmt.money(cost) : '—'}</td>
        <td class="num" style="color: ${rev < 0 ? 'var(--red)' : 'var(--green)'}">${rev ? (rev < 0 ? '(' + fmt.money(Math.abs(rev)) + ')' : fmt.money(rev)) : '—'}</td>
      </tr>`;
    });
    html += '</tbody></table></div>';
  }
  return html;
}

function renderProfitability(data) {
  if (!data.months || !data.months.length) {
    return '<div class="loading">No profitability data</div>';
  }
  // Pick key columns
  const keyCols = [
    { k: 'Month', label: 'Month', type: 'date' },
    { k: 'Estimated Effort MDs', label: 'Estimated MDs', type: 'num' },
    { k: 'This month MDs', label: 'This Month', type: 'num' },
    { k: 'Actual Effort to Date (MD)', label: 'Actual MDs', type: 'num' },
    { k: '% Completion from plan', label: '% Complete', type: 'pct' },
    { k: 'Estimated Remaining (MD)', label: 'Remaining (MD)', type: 'num' },
    { k: 'EAC MDs', label: 'EAC MDs', type: 'num' },
    { k: 'Variance', label: 'Variance', type: 'money' },
    { k: 'Variance (%)', label: 'Var %', type: 'pct' },
    { k: 'CPI', label: 'CPI', type: 'num' },
    { k: 'Profit at Completion', label: 'Profit @ Comp', type: 'money' },
    { k: 'Profit at Completion (%)', label: 'Profit %', type: 'pct' },
  ];

  let html = '<div class="card"><h3 class="card-title">Monthly Variance</h3><div class="table-scroll"><table class="data-table"><thead><tr>';
  keyCols.forEach(c => html += `<th class="${c.type !== 'date' ? 'num' : ''}">${c.label}</th>`);
  html += '</tr></thead><tbody>';
  data.months.forEach(m => {
    html += '<tr>';
    keyCols.forEach(c => {
      let v = m[c.k];
      let cell = '—';
      if (v != null && v !== '') {
        if (c.type === 'date') {
          cell = String(v).slice(0, 10);
        } else if (c.type === 'pct') {
          cell = fmt.decimal((parseFloat(v) || 0) * 100) + '%';
        } else if (c.type === 'money') {
          cell = fmt.money(v);
        } else {
          cell = fmt.decimal(v);
        }
      }
      html += `<td class="${c.type !== 'date' ? 'num' : ''}">${cell}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table></div></div>';

  // KPI summary from latest month
  const latest = data.months[data.months.length - 1];
  if (latest) {
    const completion = (parseFloat(latest['% Completion from plan']) || 0) * 100;
    const variance = parseFloat(latest['Variance']) || 0;
    const remainingMD = parseFloat(latest['Estimated Remaining (MD)']) || 0;
    html = `
      <div class="kpi-strip kpi-strip-small">
        <div class="kpi-card kpi-blue compact">
          <div class="kpi-label">% COMPLETION</div>
          <div class="kpi-value">${fmt.decimal(completion)}<span class="kpi-unit">%</span></div>
          <div class="kpi-foot">from plan (latest month)</div>
        </div>
        <div class="kpi-card kpi-amber compact">
          <div class="kpi-label">REMAINING MDs</div>
          <div class="kpi-value">${fmt.num(remainingMD)}</div>
        </div>
        <div class="kpi-card ${variance < 0 ? 'kpi-red' : 'kpi-green'} compact">
          <div class="kpi-label">COST VARIANCE</div>
          <div class="kpi-value">${fmt.money(Math.abs(variance))}</div>
          <div class="kpi-foot" style="color: ${variance < 0 ? 'var(--red)' : 'var(--green)'};">${variance < 0 ? 'Over budget' : 'Under budget'}</div>
        </div>
        <div class="kpi-card kpi-navy compact">
          <div class="kpi-label">CPI</div>
          <div class="kpi-value">${fmt.decimal(parseFloat(latest['CPI']) || 0)}</div>
          <div class="kpi-foot">cost performance</div>
        </div>
      </div>
    ` + html;
  }
  return html;
}

function renderEffort(data) {
  if (!data.team || !data.team.length) {
    return '<div class="loading">No effort data</div>';
  }
  let html = '<div class="card"><h3 class="card-title">Team Effort by Month <span class="muted-text">(scroll right for all months)</span></h3><div class="table-scroll"><table class="data-table effort-table"><thead><tr>';
  html += '<th>Name</th><th>Position</th><th class="num">Hour Rate</th>';
  data.months.forEach(m => {
    html += `<th colspan="3" class="month-header">${m}</th>`;
  });
  html += '<th class="num">Total Cost</th><th class="num">MDs</th></tr><tr>';
  html += '<th></th><th></th><th></th>';
  data.months.forEach(() => {
    html += '<th class="num small-th">Reg</th><th class="num small-th">Ram</th><th class="num small-th">OT</th>';
  });
  html += '<th></th><th></th></tr></thead><tbody>';

  data.team.forEach(m => {
    html += `<tr>
      <td><b>${m.name || '—'}</b></td>
      <td><span class="muted-text" style="font-size: 11px;">${m.position || '—'}</span></td>
      <td class="num">$${fmt.decimal(m.hour_rate)}</td>`;
    m.monthly.forEach(mn => {
      html += `<td class="num small-num">${mn.regular || ''}</td>
               <td class="num small-num">${mn.ramadan || ''}</td>
               <td class="num small-num">${mn.overtime || ''}</td>`;
    });
    html += `<td class="num"><b>$${fmt.money(m.total_cost)}</b></td>
             <td class="num">${fmt.decimal(m.current_mds)}</td>
           </tr>`;
  });
  html += '</tbody></table></div></div>';
  return html;
}

function renderEstimated(data) {
  if (!data.positions || !data.positions.length) {
    return '<div class="loading">No estimated cost data</div>';
  }
  const cols = data.columns.filter(c => c && !c.startsWith('col_'));
  let html = '<div class="card"><h3 class="card-title">Estimated Cost by Position</h3><div class="table-scroll"><table class="data-table"><thead><tr>';
  cols.forEach(c => html += `<th>${c}</th>`);
  html += '</tr></thead><tbody>';
  data.positions.forEach(p => {
    html += '<tr>';
    cols.forEach(c => {
      let v = p[c];
      let cell = '—';
      if (v != null && v !== '') {
        if (typeof v === 'number') cell = fmt.decimal(v);
        else cell = v;
      }
      html += `<td>${cell}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table></div></div>';
  return html;
}

// ====== TRAVEL & ONSITE ======
async function renderTravelSubTab() {
  const cont = document.getElementById('varianceContent');
  cont.innerHTML = `
    <div class="banner banner-info">
      <strong>Travel & Onsite Records:</strong>
      Track when team members travel onsite. Rates differ between Egypt and onsite work.
      Leave end date empty if travel is open-ended (returns automatically tracked from today).
    </div>

    <div class="card">
      <h3 class="card-title">Add Travel Record</h3>
      <div class="travel-form">
        <div class="form-row">
          <label>Employee Name <input type="text" id="trName" placeholder="e.g., Moatasem Hatem" class="search-input"></label>
          <label>Position <input type="text" id="trPos" placeholder="e.g., Lead Business Analyst" class="search-input"></label>
        </div>
        <div class="form-row">
          <label>Travel Start <input type="date" id="trStart" class="search-input"></label>
          <label>End Date <small class="muted-text">(optional)</small> <input type="date" id="trEnd" class="search-input"></label>
        </div>
        <div class="form-row">
          <label class="full-width">Notes <input type="text" id="trNotes" placeholder="Optional notes..." class="search-input"></label>
        </div>
        <div class="form-actions">
          <button id="trAdd" class="btn-primary">+ Add Record</button>
        </div>
      </div>
    </div>

    <div class="card">
      <h3 class="card-title">Travel Records <span class="muted-text">— click "End trip" to set return date</span></h3>
      <div class="table-scroll">
        <table class="data-table" id="travelTable">
          <thead><tr>
            <th>Name</th><th>Position</th><th>Start</th><th>End</th>
            <th class="num">Days</th><th>Status</th><th>Notes</th><th></th>
          </tr></thead>
          <tbody><tr><td colspan="8" class="loading">Loading…</td></tr></tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById('trAdd').addEventListener('click', addTravel);
  await loadTravelRecords();
}

async function loadTravelRecords() {
  const res = await fetch('/api/travel');
  const d = await res.json();
  const tbody = document.querySelector('#travelTable tbody');
  if (!d.records || !d.records.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="loading">No travel records yet — add one above</td></tr>';
    return;
  }
  tbody.innerHTML = '';
  d.records.forEach(r => {
    const tr = document.createElement('tr');
    const statusClass = r.status === 'Returned' ? 'status-Done' :
                        r.status === 'Onsite' ? 'status-In-Progress' :
                        r.status === 'Onsite (open-ended)' ? 'status-At-Risk' : 'status-Not-Started';
    tr.innerHTML = `
      <td><b>${r.name}</b></td>
      <td><span class="muted-text" style="font-size: 11px;">${r.position || '—'}</span></td>
      <td><span style="font-family: var(--mono); font-size: 12px;">${r.start_date}</span></td>
      <td><span style="font-family: var(--mono); font-size: 12px;">${r.end_date || '<span style="color: var(--amber); font-weight: 600;">— open —</span>'}</span></td>
      <td class="num"><b>${r.days_onsite || 0}</b></td>
      <td><span class="status-pill ${statusClass}">${r.status}</span></td>
      <td><span class="muted-text" style="font-size: 11px;">${r.notes || ''}</span></td>
      <td>
        ${!r.end_date ? `<button class="see-details-btn" data-end-id="${r.id}">End trip</button>` : ''}
        <button class="btn-ghost" style="padding: 4px 10px; font-size: 11px;" data-del-id="${r.id}">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
  // Wire actions
  tbody.querySelectorAll('[data-end-id]').forEach(b => {
    b.addEventListener('click', async () => {
      const id = b.dataset.endId;
      const today = new Date().toISOString().split('T')[0];
      const end = prompt('Set return date (YYYY-MM-DD):', today);
      if (!end) return;
      await fetch(`/api/travel/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ end_date: end })
      });
      loadTravelRecords();
    });
  });
  tbody.querySelectorAll('[data-del-id]').forEach(b => {
    b.addEventListener('click', async () => {
      if (!confirm('Delete this travel record?')) return;
      await fetch(`/api/travel/${b.dataset.delId}`, { method: 'DELETE' });
      loadTravelRecords();
    });
  });
}

async function addTravel() {
  const body = {
    name: document.getElementById('trName').value.trim(),
    position: document.getElementById('trPos').value.trim(),
    start_date: document.getElementById('trStart').value,
    end_date: document.getElementById('trEnd').value || null,
    notes: document.getElementById('trNotes').value.trim(),
  };
  if (!body.name || !body.start_date) {
    alert('Name and start date are required');
    return;
  }
  const res = await fetch('/api/travel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (res.ok) {
    document.getElementById('trName').value = '';
    document.getElementById('trPos').value = '';
    document.getElementById('trStart').value = '';
    document.getElementById('trEnd').value = '';
    document.getElementById('trNotes').value = '';
    loadTravelRecords();
  } else {
    const e = await res.json();
    alert('Error: ' + (e.error || 'failed to add'));
  }
}
