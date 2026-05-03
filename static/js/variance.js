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
    // Pre-load positions list
    try {
      const pres = await fetch('/api/positions');
      const pd = await pres.json();
      AppState.positions = pd.positions || [];
    } catch (e) {
      AppState.positions = [];
    }
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
      else if (sect.key === 'profitability') html += renderProfitability(sect.data, key);
      else if (sect.key === 'effort') html += renderEffort(sect.data, key);
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

function renderProfitability(data, phaseKey) {
  if (!data.months || !data.months.length) {
    return '<div class="loading">No profitability data</div>';
  }

  // Pre-fetch overrides
  fetch('/api/plan-overrides').then(r => r.json()).then(o => {
    AppState.planOverrides = o.plan_overrides || {};
    setTimeout(() => applyPlanOverrides(phaseKey), 100);
  });

  // Latest month KPIs (using current sheet values for now)
  const latest = data.months[data.months.length - 1];
  let kpiHtml = '';
  if (latest) {
    const completion = (parseFloat(latest['% Completion from plan']) || 0) * 100;
    const variance = parseFloat(latest['Variance']) || 0;
    const remainingMD = parseFloat(latest['Estimated Remaining (MD)']) || 0;
    kpiHtml = `
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
    `;
  }

  // Editable: % Completion and Remaining MDs
  const cols = [
    { k: 'Month', label: 'Month', type: 'date' },
    { k: 'Estimated Effort MDs', label: 'Estimated MDs', type: 'num' },
    { k: 'This month MDs', label: 'This Month', type: 'num' },
    { k: 'Actual Effort to Date (MD)', label: 'Actual MDs', type: 'num' },
    { k: '% Completion', label: '% Completion (editable)', type: 'editable-pct' },
    { k: 'Remaining', label: 'Remaining MDs (editable)', type: 'editable-num' },
    { k: 'Plan MDs', label: 'Plan MDs (auto)', type: 'computed-plan' },
    { k: 'EAC MDs', label: 'EAC MDs', type: 'num' },
    { k: 'Variance', label: 'Variance', type: 'money' },
    { k: 'CPI', label: 'CPI', type: 'num' },
    { k: 'Profit at Completion', label: 'Profit @ Comp', type: 'money' },
    { k: 'Profit at Completion (%)', label: 'Profit %', type: 'pct' },
  ];

  let html = kpiHtml + `<div class="card">
    <h3 class="card-title">Monthly Variance
      <span class="muted-text">— % Completion & Remaining editable; Plan auto-calculated · auto-saved on change</span>
    </h3>
    <div class="table-scroll"><table class="data-table" id="profit-table-${phaseKey}">
    <thead><tr>`;
  cols.forEach(c => html += `<th class="${c.type !== 'date' ? 'num' : ''}">${c.label}</th>`);
  html += '</tr></thead><tbody>';

  data.months.forEach((m, idx) => {
    const monthDate = String(m['Month'] || '').slice(0, 10);
    const monthKey = monthDate.slice(0, 7);
    const actual = parseFloat(m['Actual Effort to Date (MD)']) || 0;
    // Default % Completion from sheet
    const sheetCompletionPct = (parseFloat(m['% Completion from plan']) || 0) * 100;
    const sheetRemaining = parseFloat(m['Estimated Remaining (MD)']) || 0;

    html += `<tr data-month-key="${monthKey}" data-actual="${actual}">`;
    cols.forEach(c => {
      let cell = '—';
      if (c.type === 'date') {
        cell = monthDate;
      } else if (c.type === 'editable-pct') {
        cell = `<input type="number" step="0.01" min="0" max="200" class="completion-input" data-phase="${phaseKey}" data-month="${monthKey}" data-field="completion" value="${sheetCompletionPct.toFixed(2)}" style="width: 80px; padding: 4px 8px; font-family: var(--mono); font-size: 12px; text-align: right; border: 1px solid var(--border-strong); border-radius: 4px;"><span style="font-size: 11px; color: var(--text-muted);">%</span>`;
      } else if (c.type === 'editable-num') {
        cell = `<input type="number" step="0.01" min="0" class="remaining-input" data-phase="${phaseKey}" data-month="${monthKey}" data-field="remaining" value="${sheetRemaining.toFixed(2)}" style="width: 95px; padding: 4px 8px; font-family: var(--mono); font-size: 12px; text-align: right; border: 1px solid var(--border-strong); border-radius: 4px;">`;
      } else if (c.type === 'computed-plan') {
        cell = `<span class="computed-plan-${monthKey}">—</span>`;
      } else {
        let v = m[c.k];
        if (v != null && v !== '') {
          if (c.type === 'pct') cell = fmt.decimal((parseFloat(v) || 0) * 100) + '%';
          else if (c.type === 'money') cell = fmt.money(v);
          else cell = fmt.decimal(v);
        }
      }
      const align = c.type !== 'date' ? 'num' : '';
      html += `<td class="${align}">${cell}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table></div></div>';

  setTimeout(() => {
    const table = document.getElementById(`profit-table-${phaseKey}`);
    if (!table) return;
    // Initial render of computed Plan
    table.querySelectorAll('tr[data-month-key]').forEach(tr => recomputePlanRow(tr));
    // Wire inputs
    table.querySelectorAll('.completion-input, .remaining-input').forEach(inp => {
      inp.addEventListener('input', () => recomputePlanRow(inp.closest('tr')));
      inp.addEventListener('change', () => saveOverride(inp));
      // Auto-save on blur as well (debounced)
      inp.addEventListener('blur', () => saveOverride(inp));
    });
  }, 50);

  return html;
}

function recomputePlanRow(tr) {
  if (!tr) return;
  const actual = parseFloat(tr.dataset.actual) || 0;
  const compInp = tr.querySelector('.completion-input');
  const remInp = tr.querySelector('.remaining-input');
  const completionPct = parseFloat(compInp?.value) || 0;
  const remaining = parseFloat(remInp?.value) || 0;
  // Plan = Actual + Remaining (this is what the % Completion implies)
  // Or: Plan = Actual / (completion / 100)
  // We use Actual + Remaining since both are editable (more direct)
  const plan = actual + remaining;
  const planEl = tr.querySelector('span[class*="computed-plan"]');
  if (planEl) {
    planEl.textContent = fmt.decimal(plan);
    planEl.style.fontWeight = '600';
    planEl.style.color = 'var(--blue)';
  }
}

async function saveOverride(inp) {
  const phase = inp.dataset.phase;
  const monthKey = inp.dataset.month;
  const field = inp.dataset.field;
  const value = parseFloat(inp.value) || 0;
  await fetch('/api/plan-overrides', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phase, month_key: monthKey, field, value })
  });
  inp.style.borderColor = 'var(--green)';
  setTimeout(() => { inp.style.borderColor = 'var(--border-strong)'; }, 1200);
}

function applyPlanOverrides(phaseKey) {
  const overrides = (AppState.planOverrides || {})[phaseKey] || {};
  document.querySelectorAll(`#profit-table-${phaseKey} tr[data-month-key]`).forEach(tr => {
    const monthKey = tr.dataset.monthKey;
    const monthOverrides = overrides[monthKey] || {};
    if (monthOverrides.completion !== undefined) {
      const inp = tr.querySelector('.completion-input');
      if (inp) inp.value = parseFloat(monthOverrides.completion).toFixed(2);
    }
    if (monthOverrides.remaining !== undefined) {
      const inp = tr.querySelector('.remaining-input');
      if (inp) inp.value = parseFloat(monthOverrides.remaining).toFixed(2);
    }
    recomputePlanRow(tr);
  });
}

function renderEffort(data, phaseKey) {
  // Container with placeholder; we fetch live data after render
  const containerId = `effort-live-${phaseKey}`;
  const monthSelectId = `effort-month-${phaseKey}`;
  const yearSelectId = `effort-year-${phaseKey}`;

  // Default: April 2026
  const today = new Date();
  let defaultYear = 2026;
  let defaultMonth = 4;

  // Build month options (April → today's month)
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  let html = `
    <div class="card">
      <div style="display: flex; gap: 12px; align-items: flex-end; margin-bottom: 16px; flex-wrap: wrap;">
        <div class="filter-group">
          <label class="filter-label">YEAR</label>
          <select id="${yearSelectId}" class="search-input" style="width: 100px;">
            <option value="2026">2026</option>
            <option value="2025">2025</option>
          </select>
        </div>
        <div class="filter-group">
          <label class="filter-label">MONTH</label>
          <select id="${monthSelectId}" class="search-input" style="width: 160px;">
            ${months.map((m, i) => `<option value="${i+1}" ${i+1 === defaultMonth ? 'selected' : ''}>${m}</option>`).join('')}
          </select>
        </div>
        <button class="btn-primary" id="effort-reload-${phaseKey}">Refresh from Odoo</button>
        <span class="muted-text" style="margin-left: auto;">
          📡 Live from Odoo timesheets · Computed using country-aware Ramadan + weekend rules
        </span>
      </div>
      <div id="${containerId}"><div class="loading">Loading from Odoo…</div></div>
    </div>
  `;

  // After insertion, attach event listeners and load data
  setTimeout(() => {
    const reload = () => loadEffortLive(phaseKey, containerId, yearSelectId, monthSelectId);
    document.getElementById(`effort-reload-${phaseKey}`).addEventListener('click', reload);
    document.getElementById(yearSelectId).addEventListener('change', reload);
    document.getElementById(monthSelectId).addEventListener('change', reload);
    reload();
  }, 50);

  return html;
}

async function loadEffortLive(phaseKey, containerId, yearSelectId, monthSelectId) {
  const year = document.getElementById(yearSelectId).value;
  const month = document.getElementById(monthSelectId).value;
  const cont = document.getElementById(containerId);
  cont.innerHTML = '<div class="loading">Loading from Odoo…</div>';

  try {
    const res = await fetch(`/api/effort/${phaseKey}?year=${year}&month=${month}`);
    const d = await res.json();

    if (d.error) {
      cont.innerHTML = `<div class="banner banner-warn"><strong>Error:</strong> ${d.error}</div>`;
      return;
    }

    if (!d.team || !d.team.length) {
      cont.innerHTML = `<div class="loading">No timesheet entries found for ${d.month_label || 'this month'}</div>`;
      return;
    }

    // Build positions dropdown options for inline override
    const positions = AppState.positions || [];
    const posOptions = positions.map(p => `<option value="${p.name}">${p.name}</option>`).join('');

    let totalReg = 0, totalRam = 0, totalOT = 0, totalMD = 0;
    let html = `
      <div class="banner banner-info" style="margin-bottom: 12px;">
        <strong>${d.month_label}</strong> · ${d.team.length} team members ·
        Country detected from Odoo employee code (E=EGY, R=KSA, T=TUN) ·
        Onsite days from Travel records
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Country</th>
              <th>Resolved Position</th>
              <th class="num">Onsite Days</th>
              <th class="num">Regular MH</th>
              <th class="num">Ramadan MH</th>
              <th class="num">Overtime MH</th>
              <th class="num">Total Hours</th>
              <th class="num">MDs</th>
              <th class="num">Eff. Rate ($)</th>
            </tr>
          </thead>
          <tbody>
    `;
    d.team.forEach(m => {
      totalReg += m.regular_mh || 0;
      totalRam += m.ramadan_mh || 0;
      totalOT += m.overtime_mh || 0;
      totalMD += m.mds || 0;

      // Position display: show resolved position with badges
      let posBadges = '';
      if (!m.has_base_rate && m.country !== 'TUN') {
        posBadges += ' <span class="badge badge-amber" style="font-size: 9px;">no base rate</span>';
      }
      if (m.onsite_days > 0 && !m.has_onsite_rate && m.country !== 'TUN') {
        posBadges += ' <span class="badge badge-amber" style="font-size: 9px;">no onsite rate</span>';
      }
      // Allow manually overriding the position by selecting from positions list
      const selectedRole = m.odoo_role || '';
      const allPositionNames = positions.map(p => p.name).filter(n => !n.endsWith(' - onsite'));
      const overrideOptions = allPositionNames.map(p => {
        // Strip country prefix to show just the role
        const cleanRole = p.replace(/^(EGY|KSA|TUN)\s*-\s*/, '').replace(/\s*-\s*onsite\s*$/, '');
        return `<option value="${cleanRole}" ${cleanRole === selectedRole ? 'selected' : ''}>${cleanRole}</option>`;
      }).filter((v, i, a) => a.indexOf(v) === i);

      const posDisplay = `
        <div style="display: flex; flex-direction: column; gap: 4px;">
          <span style="font-size: 11px;" dir="auto">
            ${m.position || '<i class="muted-text">— no position —</i>'}${posBadges}
          </span>
          <select class="position-override" data-emp="${encodeURIComponent(m.name)}" style="font-size: 10px; padding: 2px 4px; max-width: 220px; ${m.has_base_rate ? 'border-color: var(--green); background: var(--green-light);' : ''}">
            <option value="">— change role —</option>
            ${overrideOptions.join('')}
          </select>
        </div>`;

      const onsiteCell = m.onsite_days > 0
        ? `<b style="color: var(--amber);">${m.onsite_days}</b><span class="muted-text" style="font-size: 10px;"> d</span>`
        : `<span class="muted-text">—</span>`;
      const rateCell = m.effective_hour_rate
        ? `$${fmt.decimal(m.effective_hour_rate)}${m.onsite_hours > 0 && m.has_onsite_rate ? '<span class="muted-text" style="font-size: 9px;"> blend</span>' : ''}`
        : `<span class="muted-text">—</span>`;
      const countryColor = m.country === 'KSA' ? '#10B981' : m.country === 'TUN' ? '#F59E0B' : '#3B82F6';

      html += `
        <tr>
          <td><b>${m.name}</b><br><span class="muted-text" style="font-size: 10px;">${m.odoo_role || ''}</span></td>
          <td><span class="team-pill" style="font-size: 10px; background: ${countryColor}20; color: ${countryColor}; border-color: ${countryColor};">${m.country}</span></td>
          <td>${posDisplay}</td>
          <td class="num">${onsiteCell}</td>
          <td class="num">${fmt.decimal(m.regular_mh)}</td>
          <td class="num" style="color: ${m.ramadan_mh > 0 ? 'var(--amber)' : 'var(--text-muted)'};">${m.ramadan_mh > 0 ? fmt.decimal(m.ramadan_mh) : '—'}</td>
          <td class="num" style="color: ${m.overtime_mh > 0 ? 'var(--red)' : 'var(--text-muted)'};">${m.overtime_mh > 0 ? fmt.decimal(m.overtime_mh) : '—'}</td>
          <td class="num"><b>${fmt.decimal(m.total_hours)}</b></td>
          <td class="num"><b style="color: var(--blue);">${fmt.decimal(m.mds)}</b></td>
          <td class="num">${rateCell}</td>
        </tr>
      `;
    });
    html += `
        <tr style="background: var(--bg-subtle); font-weight: 700;">
          <td colspan="3"><b>TOTAL</b></td>
          <td class="num">—</td>
          <td class="num">${fmt.decimal(totalReg)}</td>
          <td class="num">${fmt.decimal(totalRam)}</td>
          <td class="num">${fmt.decimal(totalOT)}</td>
          <td class="num">${fmt.decimal(totalReg + totalRam + totalOT)}</td>
          <td class="num"><b style="color: var(--blue);">${fmt.decimal(totalMD)}</b></td>
          <td class="num">—</td>
        </tr>
      </tbody></table></div>
    `;
    cont.innerHTML = html;

    // Wire position overrides
    cont.querySelectorAll('.position-override').forEach(sel => {
      sel.addEventListener('change', async () => {
        const name = decodeURIComponent(sel.dataset.emp);
        const position = sel.value;
        await fetch('/api/position-overrides', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, position })
        });
        loadEffortLive(phaseKey, containerId, yearSelectId, monthSelectId);
      });
    });
  } catch (err) {
    cont.innerHTML = `<div class="banner banner-warn"><strong>Error:</strong> ${err.message}</div>`;
  }
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

  // Load employees + positions in parallel
  let employees = [];
  let positions = AppState.positions || [];
  try {
    const r = await fetch('/api/project-employees');
    const d = await r.json();
    employees = d.employees || [];
  } catch (e) {}

  AppState.travelEmployees = employees;
  AppState.travelPositions = positions;

  cont.innerHTML = `
    <div class="banner banner-info">
      <strong>Travel & Onsite Records:</strong>
      Track when team members travel onsite. Rates differ between Egypt and onsite work.
      Leave end date empty if travel is open-ended.
    </div>

    <div class="card">
      <h3 class="card-title" id="travelFormTitle">Add Travel Record</h3>
      <div class="travel-form">
        <div class="form-row">
          <label>Employee Name
            <input list="empNamesList" id="trName" placeholder="Type or pick from list..." class="search-input" autocomplete="off">
            <datalist id="empNamesList">
              ${employees.map(e => `<option value="${e.name}" data-position="${e.position || ''}">`).join('')}
            </datalist>
          </label>
          <label>Position
            <input list="positionsList" id="trPos" placeholder="Type or pick from list..." class="search-input" autocomplete="off">
            <datalist id="positionsList">
              ${positions.map(p => `<option value="${p.name}">`).join('')}
            </datalist>
          </label>
        </div>
        <div class="form-row">
          <label>Travel Start <input type="date" id="trStart" class="search-input"></label>
          <label>End Date <small class="muted-text">(optional · leave empty for open trip)</small> <input type="date" id="trEnd" class="search-input"></label>
        </div>
        <div class="form-row">
          <label class="full-width">Notes <input type="text" id="trNotes" placeholder="Optional notes..." class="search-input"></label>
        </div>
        <div class="form-actions">
          <button id="trCancel" class="btn-ghost" style="display:none;">Cancel Edit</button>
          <button id="trSubmit" class="btn-primary">+ Add Record</button>
        </div>
        <input type="hidden" id="trEditingId" value="">
      </div>
    </div>

    <div class="card">
      <h3 class="card-title">Travel Records <span class="muted-text">— click "Edit" to update</span></h3>
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

  // Auto-fill position when name selected
  document.getElementById('trName').addEventListener('input', (e) => {
    const name = e.target.value;
    const emp = (AppState.travelEmployees || []).find(x => x.name === name);
    if (emp && emp.position && !document.getElementById('trPos').value) {
      // Strip "- onsite" suffix to land on the dropdown value (PM picks onsite manually here)
      const cleanPos = emp.position.replace(/\s*-\s*onsite\s*$/i, '').trim();
      document.getElementById('trPos').value = cleanPos;
    }
  });

  document.getElementById('trSubmit').addEventListener('click', submitTravel);
  document.getElementById('trCancel').addEventListener('click', cancelEdit);
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
  AppState.travelRecords = d.records;
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
        <button class="see-details-btn" data-edit-id="${r.id}">Edit</button>
        <button class="btn-ghost" style="padding: 4px 10px; font-size: 11px;" data-del-id="${r.id}">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll('[data-edit-id]').forEach(b => {
    b.addEventListener('click', () => startEdit(b.dataset.editId));
  });
  tbody.querySelectorAll('[data-del-id]').forEach(b => {
    b.addEventListener('click', async () => {
      if (!confirm('Delete this travel record?')) return;
      await fetch(`/api/travel/${b.dataset.delId}`, { method: 'DELETE' });
      loadTravelRecords();
    });
  });
}

function startEdit(id) {
  const r = (AppState.travelRecords || []).find(x => String(x.id) === String(id));
  if (!r) return;
  document.getElementById('trName').value = r.name || '';
  document.getElementById('trPos').value = r.position || '';
  document.getElementById('trStart').value = r.start_date || '';
  document.getElementById('trEnd').value = r.end_date || '';
  document.getElementById('trNotes').value = r.notes || '';
  document.getElementById('trEditingId').value = r.id;
  document.getElementById('trSubmit').textContent = '✓ Save Changes';
  document.getElementById('trSubmit').className = 'btn-export';
  document.getElementById('trCancel').style.display = '';
  document.getElementById('travelFormTitle').textContent = `Edit Travel Record #${r.id} — ${r.name}`;
  // Scroll to form
  document.querySelector('.travel-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function cancelEdit() {
  document.getElementById('trEditingId').value = '';
  ['trName','trPos','trStart','trEnd','trNotes'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('trSubmit').textContent = '+ Add Record';
  document.getElementById('trSubmit').className = 'btn-primary';
  document.getElementById('trCancel').style.display = 'none';
  document.getElementById('travelFormTitle').textContent = 'Add Travel Record';
}

async function submitTravel() {
  const editingId = document.getElementById('trEditingId').value;
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
  let res;
  if (editingId) {
    res = await fetch(`/api/travel/${editingId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } else {
    res = await fetch('/api/travel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  }
  if (res.ok) {
    cancelEdit();
    loadTravelRecords();
  } else {
    const e = await res.json();
    alert('Error: ' + (e.error || 'failed'));
  }
}
