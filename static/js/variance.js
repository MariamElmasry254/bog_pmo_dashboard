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
  } else if (key === 'promotions') {
    renderPromotionsSubTab();
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
      if (sect.key === 'budget') html += renderBudget(sect.data, key);
      else if (sect.key === 'profitability') html += renderProfitability(sect.data, key);
      else if (sect.key === 'effort') html += renderEffort(sect.data, key);
      else if (sect.key === 'estimated') html += renderEstimated(sect.data, key);
    }
    html += '</div>';
  });

  cont.innerHTML = html;

  // Wire up auto-save for any budget inputs
  wireBudgetInputs(cont);

  // Load live effort + estimated tables AFTER DOM is set
  if (tab.sections.some(s => s.key === 'effort')) {
    const effortContainerId = `effort-live-${key}`;
    setTimeout(() => loadEffortLive(key, effortContainerId), 100);
  }
  if (tab.sections.some(s => s.key === 'estimated')) {
    setTimeout(() => {
      const wrap = document.getElementById('estimatedLiveWrap');
      if (wrap) loadEstimatedLive(key, 'estimatedLiveWrap');
    }, 200);
  }
}

function renderBudget(data, phaseKey) {
  let html = '';
  // KPI cards from approved/final
  const a = data.approved || {};
  const f = data.final || {};

  // Helper to make an editable budget cell
  // type: 'money' | 'pct' | 'num'
  function editableCell(value, path, type) {
    const v = value === null || value === undefined ? '' : value;
    const step = type === 'pct' ? '0.0001' : '0.01';
    const cls = type === 'pct' ? 'budget-input budget-input-pct' : 'budget-input';
    return `<input type="number" step="${step}" class="${cls}" data-phase="${phaseKey}" data-path="${path}" value="${v}">`;
  }

  // Helper for non-numeric (text) editable cells
  function editableText(value, path) {
    const v = value === null || value === undefined ? '' : value;
    return `<input type="text" class="budget-input budget-input-text" data-phase="${phaseKey}" data-path="${path}" value="${String(v).replace(/"/g, '&quot;')}">`;
  }

  // Compute display values for KPI cards (use saved overrides)
  const profitPctApproved = (a.profit_pct || 0) * 100;
  const profitPctFinal = (f.profit_pct || 0) * 100;

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
        <div class="kpi-value">${fmt.decimal(profitPctApproved)}<span class="kpi-unit">%</span></div>
        <div class="kpi-foot">${fmt.money(a.profit_sar)} SAR</div>
      </div>
      <div class="kpi-card kpi-amber compact">
        <div class="kpi-label">FINAL PROFIT</div>
        <div class="kpi-value">${fmt.decimal(profitPctFinal)}<span class="kpi-unit">%</span></div>
        <div class="kpi-foot">${fmt.money(f.profit_sar)} SAR</div>
      </div>
    </div>
  `;

  // Editable hint
  const overrideBadge = data._has_overrides
    ? '<span class="badge badge-blue" style="margin-left:8px;">Has saved overrides</span>'
    : '';

  // Approved vs Final side-by-side - WITH EDITABLE INPUTS
  html += `
    <div class="card" style="margin-bottom: 12px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <h3 class="card-title" style="margin: 0;">Budget — Editable ${overrideBadge}</h3>
        <span style="font-size: 11px; color: var(--text-muted);">All fields auto-save on edit · Stored in Railway Volume</span>
      </div>
    </div>
    <div class="grid-2">
      <div class="card budget-card">
        <h3 class="card-title">Approved Project Budget</h3>
        <div class="budget-row">
          <span class="label">Total Mandays</span>
          <span class="value">${editableCell(a.total_mandays, 'approved.total_mandays', 'num')}</span>
        </div>
        <div class="budget-row">
          <span class="label">Total Cost (USD)</span>
          <span class="value">$${editableCell(a.cost_usd, 'approved.cost_usd', 'money')}</span>
        </div>
        <div class="budget-row">
          <span class="label">Total Cost (SAR)</span>
          <span class="value">${editableCell(a.cost_sar, 'approved.cost_sar', 'money')}</span>
        </div>
        <div class="budget-row">
          <span class="label">Total Revenue (SAR)</span>
          <span class="value">${editableCell(a.revenue_sar, 'approved.revenue_sar', 'money')}</span>
        </div>
        <div class="budget-row highlight">
          <span class="label">Profit (SAR)</span>
          <span class="value">${editableCell(a.profit_sar, 'approved.profit_sar', 'money')}</span>
        </div>
        <div class="budget-row highlight">
          <span class="label">Profit %</span>
          <span class="value">${editableCell(a.profit_pct, 'approved.profit_pct', 'pct')} <span style="font-size:10px;color:var(--text-muted);">(decimal: 0.4 = 40%)</span></span>
        </div>
      </div>
      <div class="card budget-card budget-final">
        <h3 class="card-title">Final Budget <span class="badge badge-amber">After Changes</span></h3>
        <div class="budget-row">
          <span class="label">Total Cost (SAR)</span>
          <span class="value">${editableCell(f.cost_sar, 'final.cost_sar', 'money')}</span>
        </div>
        <div class="budget-row">
          <span class="label">Total Revenue (SAR)</span>
          <span class="value">${editableCell(f.revenue_sar, 'final.revenue_sar', 'money')}</span>
        </div>
        <div class="budget-row">
          <span class="label">Δ Cost</span>
          <span class="value">${editableCell(f.total_change_cost, 'final.total_change_cost', 'money')}</span>
        </div>
        <div class="budget-row">
          <span class="label">Δ Revenue</span>
          <span class="value">${editableCell(f.total_change_revenue, 'final.total_change_revenue', 'money')}</span>
        </div>
        <div class="budget-row highlight">
          <span class="label">Profit (SAR)</span>
          <span class="value">${editableCell(f.profit_sar, 'final.profit_sar', 'money')}</span>
        </div>
        <div class="budget-row highlight">
          <span class="label">Profit %</span>
          <span class="value">${editableCell(f.profit_pct, 'final.profit_pct', 'pct')} <span style="font-size:10px;color:var(--text-muted);">(decimal: 0.4 = 40%)</span></span>
        </div>
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

// Wire up auto-save for budget inputs
function wireBudgetInputs(container) {
  if (!container) return;
  container.querySelectorAll('.budget-input').forEach(inp => {
    inp.addEventListener('blur', async () => {
      const phase = inp.dataset.phase;
      const path = inp.dataset.path;
      const isText = inp.classList.contains('budget-input-text');
      let value = isText ? inp.value : (parseFloat(inp.value) || 0);
      // Empty value → null (delete override)
      if (inp.value === '' || inp.value === null) value = null;

      try {
        const res = await fetch('/api/variance/budget-override', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phase, path, value })
        });
        if (res.ok) {
          inp.style.borderColor = 'var(--green)';
          setTimeout(() => { inp.style.borderColor = ''; }, 1200);
        } else {
          inp.style.borderColor = 'var(--red)';
        }
      } catch (e) {
        inp.style.borderColor = 'var(--red)';
        console.error('Budget save failed:', e);
      }
    });
  });
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
  const containerId = `effort-live-${phaseKey}`;
  // Store containerId on window for renderVarianceSubTab to use
  window._effortContainerId = containerId;
  window._effortPhaseKey = phaseKey;

  return `
    <div class="card">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 8px;">
        <div>
          <h3 style="margin: 0; font-size: 14px;">Current Effort — Excel Style</h3>
          <span class="muted-text" style="font-size: 11px;">Live from Odoo · Starting from first month with logs · Regular / Ramadan / Overtime split per country rules</span>
        </div>
        <button class="btn-primary" id="effort-reload-${phaseKey}" onclick="loadEffortLive('${phaseKey}','${containerId}')">↻ Refresh from Odoo</button>
      </div>
      <div id="${containerId}"><div class="loading">Loading from Odoo…</div></div>
    </div>
  `;
}

async function loadEffortLive(phaseKey, containerId) {
  const cont = document.getElementById(containerId);
  cont.innerHTML = '<div class="loading">Loading from Odoo (this may take a moment)…</div>';

  try {
    const res = await fetch(`/api/effort/${phaseKey}/all-months`);
    const d = await res.json();

    if (d.error) {
      cont.innerHTML = `<div class="banner banner-warn"><strong>Error:</strong> ${d.error}</div>`;
      return;
    }

    if (!d.employees || !d.employees.length) {
      cont.innerHTML = `<div class="loading">No timesheet entries found for this phase</div>`;
      return;
    }

    const months = d.months || [];

    // Build column headers: # | Name | Position | Hour Rate | Overtime | [month1: 3 cols] | [month2: 3 cols] ...
    let monthHeaders1 = '';  // top row - month names spanning 3 cols
    let monthHeaders2 = '';  // bottom row - Reg/Ram/OT labels
    months.forEach(m => {
      monthHeaders1 += `<th colspan="3" class="num eff-month-head" style="border-left: 2px solid var(--border-strong);">${m.label}</th>`;
      monthHeaders2 += `
        <th class="num" style="border-left: 2px solid var(--border-strong); font-size: 9px;">Regular<br>(MH)</th>
        <th class="num" style="font-size: 9px;">Ramadan<br>Hours</th>
        <th class="num" style="font-size: 9px;">Overtime<br>(MH)</th>
      `;
    });

    let html = `
      <div class="banner banner-info" style="margin-bottom: 12px; font-size: 12px;">
        <strong>${d.total_employees} team members</strong> · 
        Showing <strong>${months.length} month${months.length !== 1 ? 's' : ''}</strong>
        (from <strong>${months[0]?.label || '—'}</strong> to <strong>${months[months.length-1]?.label || '—'}</strong>) ·
        Rates from Odoo (SAR÷3.75) with DB fallback · Overtime = Hour Rate × 1.5
      </div>
      <div class="table-scroll eff-table-scroll">
        <table class="data-table eff-table">
          <thead>
            <tr class="eff-row-month">
              <th rowspan="2" style="position: sticky; left: 0; background: var(--navy); color: white; z-index: 3;">#</th>
              <th rowspan="2" style="position: sticky; left: 40px; background: var(--navy); color: white; z-index: 3;">Name</th>
              <th rowspan="2" style="position: sticky; background: var(--navy); color: white; z-index: 3;">Position</th>
              <th rowspan="2" class="num">Hour Rate ($)</th>
              <th rowspan="2" class="num">Overtime Rate</th>
              ${monthHeaders1}
              <th rowspan="2" class="num" style="border-left: 2px solid var(--border-strong);">Total<br>Cost ($)</th>
              <th rowspan="2" class="num">Current<br>MDs done</th>
            </tr>
            <tr class="eff-row-subhead">
              ${monthHeaders2}
            </tr>
          </thead>
          <tbody>
    `;

    let grandTotalCost = 0;
    let grandTotalHours = 0;
    let grandTotalMDs = 0;

    // Current month key
    const now = new Date();
    const thisMonthKey = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    let grandThisMonthMDs = 0;

    // Per-month MD totals for TOTAL row
    const monthMDTotals = {};
    months.forEach(m => { monthMDTotals[m.key] = 0; });

    d.employees.forEach((emp, idx) => {
      grandTotalCost += emp.total_cost_usd || 0;
      grandTotalHours += emp.total_hours || 0;
      grandTotalMDs += emp.current_mds || 0;

      // Accumulate per-month MDs
      months.forEach(m => {
        const cell = emp.months?.[m.key] || { regular: 0, ramadan: 0, overtime: 0 };
        monthMDTotals[m.key] += (cell.regular + cell.overtime) / 8 + cell.ramadan / 6;
      });

      // This month MDs for summary strip
      const thisCell = emp.months?.[thisMonthKey] || { regular: 0, ramadan: 0, overtime: 0 };
      grandThisMonthMDs += (thisCell.regular + thisCell.overtime) / 8 + thisCell.ramadan / 6;

      // Country color
      const countryColor = emp.country === 'KSA' ? '#10B981'
                         : emp.country === 'TUN' ? '#F59E0B'
                         : '#3B82F6';

      // Onsite badge
      const onsiteBadge = emp.is_onsite
        ? '<span class="badge badge-amber" style="font-size: 9px; margin-left: 4px;">ONSITE</span>'
        : '';

      // Rate source badge
      let sourceBadge = '';
      if (emp.rate_source === 'odoo') {
        sourceBadge = '<span class="badge" style="font-size: 9px; background: #d1fae5; color: #065f46;">Odoo</span>';
      } else if (emp.rate_source && emp.rate_source.includes('onsite')) {
        sourceBadge = '<span class="badge" style="font-size: 9px; background: #fef3c7; color: #92400e;">Onsite DB</span>';
      } else if (emp.rate_source) {
        sourceBadge = '<span class="badge" style="font-size: 9px; background: #e0e7ff; color: #3730a3;">DB</span>';
      }

      // Build month cells
      let monthCells = '';
      months.forEach(m => {
        const cell = emp.months[m.key] || { regular: 0, ramadan: 0, overtime: 0 };
        monthCells += `
          <td class="num" style="border-left: 2px solid var(--border-strong);">${cell.regular > 0 ? fmt.decimal(cell.regular) : '<span class="muted-text">—</span>'}</td>
          <td class="num" style="color: ${cell.ramadan > 0 ? 'var(--amber)' : 'var(--text-muted)'};">${cell.ramadan > 0 ? fmt.decimal(cell.ramadan) : '—'}</td>
          <td class="num" style="color: ${cell.overtime > 0 ? 'var(--red)' : 'var(--text-muted)'};">${cell.overtime > 0 ? fmt.decimal(cell.overtime) : '—'}</td>
        `;
      });

      html += `
        <tr>
          <td style="position: sticky; left: 0; background: white; z-index: 2; font-weight: 600;">${idx + 1}</td>
          <td style="position: sticky; left: 40px; background: white; z-index: 2;">
            <b>${emp.name}</b>${onsiteBadge}<br>
            <span class="muted-text" style="font-size: 10px;">${emp.code} · <span style="color: ${countryColor};">${emp.country}</span></span>
          </td>
          <td style="position: sticky; background: white; z-index: 2; font-size: 11px;">${emp.position}${sourceBadge ? ' ' + sourceBadge : ''}</td>
          <td class="num"><b>${emp.hour_rate ? '$' + fmt.decimal(emp.hour_rate) : '<span style="color: var(--red);">—</span>'}</b></td>
          <td class="num">${emp.overtime_rate ? '$' + fmt.decimal(emp.overtime_rate) : '—'}</td>
          ${monthCells}
          <td class="num" style="border-left: 2px solid var(--border-strong);"><b style="color: var(--blue);">$${fmt.num(Math.round(emp.total_cost_usd))}</b></td>
          <td class="num"><b>${fmt.decimal(emp.current_mds)}</b></td>
        </tr>
      `;
    });

    // Totals row — with per-month MD subtotals
    html += `
      <tr style="background: var(--bg-subtle); font-weight: 700;">
        <td colspan="2" style="position: sticky; left: 0; background: var(--bg-subtle); z-index: 2;">TOTAL</td>
        <td colspan="3" style="position: sticky; background: var(--bg-subtle); z-index: 2;">${d.total_employees} employees</td>
    `;
    months.forEach(m => {
      const mds = monthMDTotals[m.key] || 0;
      html += `
        <td colspan="3" class="num" style="border-left: 2px solid var(--border-strong); vertical-align: middle;">
          ${mds > 0 ? `<div style="font-size:10px; color:var(--text-muted); font-weight:400; margin-bottom:1px;">MDs</div><span style="color:var(--blue); font-size:13px;">${fmt.decimal(mds)}</span>` : '—'}
        </td>`;
    });
    html += `
        <td class="num" style="border-left: 2px solid var(--border-strong);"><b style="color: var(--blue);">$${fmt.num(Math.round(grandTotalCost))}</b></td>
        <td class="num"><b style="color: var(--blue);">${fmt.decimal(grandTotalMDs)}</b></td>
      </tr>
      </tbody></table></div>
    `;

    // ── Summary strip OUTSIDE the table ──
    const totalCostSAR = grandTotalCost * 3.75;
    const avgCostPerMD = grandTotalMDs > 0 ? totalCostSAR / grandTotalMDs : 0;
    html += `
      <div style="display: flex; gap: 32px; align-items: center; flex-wrap: wrap; margin-top: 16px; padding: 14px 18px; background: #EFF6FF; border-radius: 8px; border: 1px solid #BFDBFE;">
        <div>
          <div style="font-size: 10px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 2px;">Total Cost in SAR</div>
          <div style="font-size: 20px; font-weight: 700; color: var(--navy);">SAR ${fmt.num(Math.round(totalCostSAR))}</div>
        </div>
        <div style="width: 1px; height: 36px; background: #BFDBFE;"></div>
        <div>
          <div style="font-size: 10px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 2px;">Average Cost per MD</div>
          <div style="font-size: 20px; font-weight: 700; color: var(--navy);">SAR ${fmt.num(Math.round(avgCostPerMD))}</div>
        </div>
        <div style="width: 1px; height: 36px; background: #BFDBFE;"></div>
        <div>
          <div style="font-size: 10px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 2px;">This Month MDs</div>
          <div style="font-size: 20px; font-weight: 700; color: var(--blue);">${fmt.decimal(grandThisMonthMDs)}</div>
        </div>
        <div style="font-size: 11px; color: var(--text-muted); margin-left: auto;">$1 = SAR 3.75 · Total MDs: <b style="color:var(--navy)">${fmt.decimal(grandTotalMDs)}</b></div>
      </div>
    `;
    cont.innerHTML = html;
  } catch (err) {
    cont.innerHTML = `<div class="banner banner-warn"><strong>Error:</strong> ${err.message}</div>`;
  }
}

function renderEstimated(data, phaseKey) {
  // Build interactive estimated cost table — editable rows, auto-calc from positions catalog
  return `<div id="estimatedLiveWrap">
    <div class="loading">Loading estimated cost table…</div>
  </div>`;
}

let _estPositions = [];
let _estRows = [];
let _estPhase = '';

// Format number with exact 2 decimal places + thousand separators, no rounding
function fmtExact(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function makeEstRow(position = '', hourRate = '', actualTime = 176, estMonths = '') {
  return { id: Date.now() + Math.random(), position, hourRate, actualTime, estMonths };
}

async function loadEstimatedLive(phaseKey, containerId) {
  const wrap = document.getElementById(containerId || 'estimatedLiveWrap');
  if (!wrap) { console.warn('estimatedLiveWrap not found'); return; }
  wrap.innerHTML = '<div class="loading">Loading estimated cost table…</div>';

  // Load positions catalog from DB
  let positions = [];
  try {
    const r = await fetch('/api/positions');
    const d = await r.json();
    positions = (d.positions || []).filter(p => p.hour_rate)
      .sort((a,b) => (a.position||a.name||'').localeCompare(b.position||b.name||''));
  } catch (e) { console.warn('positions load failed:', e); }

  // Load saved rows from server
  let rows = [];
  try {
    const r = await fetch('/api/estimated-rows?phase=' + encodeURIComponent(phaseKey || 'development'));
    if (r.ok) {
      const d = await r.json();
      rows = d.rows || [];
    }
  } catch (e) {}
  if (!rows.length) rows = [makeEstRow()];

  // Auto-update hour rates from DB for any saved rows with a position set
  rows = rows.map(r => {
    if (r.position) {
      const pos = positions.find(p => (p.position || p.name) === r.position);
      if (pos && pos.hour_rate) r.hourRate = parseFloat(pos.hour_rate);
    }
    return r;
  });

  _estPositions = positions;
  _estRows = rows;
  _estPhase = phaseKey;
  renderEstimatedTable(wrap, rows, positions, phaseKey);
}

function renderEstimatedTable(wrap, rows, positions, phaseKey) {
  _estPositions = positions;
  _estRows = rows;
  _estPhase = phaseKey;

  const posOptions = positions.map(p =>
    `<option value="${p.position || p.name}">${p.position || p.name} — $${p.hour_rate}/h</option>`
  ).join('');

  // Compute totals
  let totalUSD = 0, totalMDs = 0;
  let sumCostPerMonth = 0;  // sum(hour_rate × actual_time) = TOTAL USD per month
  let sumActualTime = 0;    // sum(actual_time MH) for MDs/month
  rows.forEach(r => {
    const hr = parseFloat(r.hourRate) || 0;
    const at = parseFloat(r.actualTime) || 0;
    const em = parseFloat(r.estMonths) || 0;
    sumCostPerMonth += hr * at;
    sumActualTime += at;
    totalUSD += hr * at * em;
    totalMDs += at * em / 8;
  });

  const totalSAR = totalUSD * 3.75;
  // Correct equations:
  const totalUSDperMonth = sumCostPerMonth;            // sum(Cost per month)
  const totalSARperMonth = totalUSDperMonth * 3.75;    // × 3.75
  const estMDsPerMonth = sumActualTime / 8;            // sum(Actual Time MH) / 8
  const costPerMDSAR = estMDsPerMonth > 0 ? totalSARperMonth / estMDsPerMonth : 0; // SAR/month ÷ MDs/month

  let html = `
    <div class="card">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <h3 class="card-title" style="margin:0;">Estimated Cost by Position <span class="muted-text" style="font-size:12px;">— editable · auto-calculates from DB rates</span></h3>
        <div style="display:flex;gap:8px;">
          <button class="btn-outline" style="font-size:11px;" onclick="estAddRow()">+ Add Row</button>
          <button class="btn-outline" style="font-size:11px; color:var(--red);" onclick="estClearAll()">🗑 Clear All</button>
        </div>
      </div>
      <div class="table-scroll">
        <table class="data-table" id="estTable">
          <thead>
            <tr>
              <th>#</th>
              <th style="min-width:220px;">Position</th>
              <th class="num">Hour Rate ($)</th>
              <th class="num">Actual Time<br><small>(MH/month)</small></th>
              <th class="num">Cost per Month<br><small>($)</small></th>
              <th class="num">Est. # of<br>Months</th>
              <th class="num">Total Cost<br>USD</th>
              <th class="num">Total No<br>of MDs</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
  `;

  rows.forEach((r, i) => {
    const hr = parseFloat(r.hourRate) || 0;
    const at = parseFloat(r.actualTime) || 0;
    const em = parseFloat(r.estMonths) || 0;
    const costPerMonth = hr > 0 && at > 0 ? hr * at : null;
    const totalCost = hr > 0 && at > 0 && em > 0 ? hr * at * em : null;  // full precision, no intermediate rounding
    const mds = at > 0 && em > 0 ? at * em / 8 : null;

    html += `
      <tr data-row="${r.id}">
        <td style="color:var(--text-muted); font-size:11px;">${i + 1}</td>
        <td>
          <select class="svc-input est-pos-select" data-rowid="${r.id}" style="width:100%; padding:4px 6px; font-size:12px; border:1px solid var(--border-strong); border-radius:4px;"
            onchange="estOnPosChange(this)">
            <option value="">— select position —</option>
            ${posOptions}
          </select>
          <script>document.querySelector('[data-row="${r.id}"] select').value = ${JSON.stringify(r.position || '')};</script>
        </td>
        <td class="num">
          <input type="number" step="0.01" class="svc-input" data-rowid="${r.id}" data-field="hourRate"
            value="${r.hourRate ? parseFloat(r.hourRate).toFixed(2) : ''}" placeholder="$"
            style="width:75px; padding:4px 6px; text-align:right; border:1px solid var(--border-strong); border-radius:4px; font-size:12px;"
            oninput="estOnChange(this)">
        </td>
        <td class="num">
          <input type="number" step="1" class="svc-input" data-rowid="${r.id}" data-field="actualTime"
            value="${r.actualTime || 176}" placeholder="176"
            style="width:60px; padding:4px 6px; text-align:right; border:1px solid var(--border-strong); border-radius:4px; font-size:12px;"
            oninput="estOnChange(this)">
        </td>
        <td class="num" style="font-weight:600; color:var(--navy);">${costPerMonth !== null ? '$' + fmtExact(costPerMonth) : '—'}</td>
        <td class="num">
          <input type="number" step="1" min="1" class="svc-input" data-rowid="${r.id}" data-field="estMonths"
            value="${r.estMonths || ''}" placeholder="#"
            style="width:55px; padding:4px 6px; text-align:right; border:1px solid var(--border-strong); border-radius:4px; font-size:12px;"
            oninput="estOnChange(this)">
        </td>
        <td class="num"><b style="color:var(--blue);">${totalCost !== null ? '$' + fmtExact(totalCost) : '—'}</b></td>
        <td class="num">${mds !== null ? fmt.decimal(mds) : '—'}</td>
        <td><button style="background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:14px;" onclick="estDeleteRow('${r.id}')">✕</button></td>
      </tr>
    `;
  });

  html += `
          </tbody>
          <tfoot>
            <tr style="background:var(--navy); color:white; font-weight:700;">
              <td colspan="6" style="text-align:right; padding:8px 12px;">TOTAL</td>
              <td class="num" style="color:#93C5FD;">$${fmt.num(Math.round(totalUSD))}</td>
              <td class="num" style="color:#93C5FD;">${fmt.decimal(totalMDs)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>

    <!-- Summary strip (mirrors Excel summary block) -->
    <div class="card" style="margin-top:12px; background:#F8FAFC;">
      <div style="display:grid; grid-template-columns:1fr 1fr 1fr 1fr; gap:0; border:1px solid var(--border-strong); border-radius:6px; overflow:hidden;">
        ${[
          ['TOTAL USD per month (22 days)', `$${fmtExact(totalUSDperMonth)} USD`],
          ['TOTAL Estimated Cost per month (22 days) SAR', `${fmtExact(totalSARperMonth)} SAR`],
          ['Estimated MDs / Month', fmtExact(estMDsPerMonth)],
          ['TOTAL Estimated Cost per MD SAR', `${fmtExact(costPerMDSAR)} SAR`],
        ].map(([label, val]) => `
          <div style="padding:12px 16px; border-right:1px solid var(--border-strong);">
            <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:4px;">${label}</div>
            <div class="est-summary-val" style="font-size:16px; font-weight:700; color:var(--navy);">${val}</div>
          </div>
        `).join('')}
      </div>
      <div style="margin-top:10px; padding:14px 18px; background:var(--navy); border-radius:6px; display:flex; justify-content:space-between; align-items:center;">
        <span style="color:#93C5FD; font-size:13px; font-weight:600;">Total Project Estimated Cost (SAR)</span>
        <span class="est-total-sar" style="color:white; font-size:22px; font-weight:700;">SAR ${fmt.num(Math.round(totalSAR))}</span>
      </div>
    </div>
  `;

  wrap.innerHTML = html;

  // Set select values properly after render
  rows.forEach(r => {
    const sel = wrap.querySelector(`[data-row="${r.id}"] select`);
    if (sel && r.position) sel.value = r.position;
  });
}

async function estSave() {
  try {
    await fetch('/api/estimated-rows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phase: _estPhase, rows: _estRows })
    });
  } catch (e) { console.warn('estSave failed:', e); }
}

let _estSaveTimer = null;
function estScheduleSave() {
  clearTimeout(_estSaveTimer);
  _estSaveTimer = setTimeout(async () => {
    try {
      const res = await fetch('/api/estimated-rows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phase: _estPhase, rows: _estRows })
      });
      if (!res.ok) console.warn('estSave failed', res.status);
    } catch (e) { console.warn('estSave error:', e); }
  }, 800);
}

async function estSave() {
  try {
    await fetch('/api/estimated-rows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phase: _estPhase, rows: _estRows })
    });
  } catch (e) { console.warn('estSave error:', e); }
}

async function estOnPosChange(sel) {
  const rowId = sel.dataset.rowid;
  const posName = sel.value;
  const row = _estRows.find(r => String(r.id) === String(rowId));
  if (!row) return;
  row.position = posName;

  // Get rate from catalog (exact value stored in DB)
  const pos = _estPositions.find(p => (p.position || p.name) === posName);
  if (pos && pos.hour_rate) {
    row.hourRate = parseFloat(pos.hour_rate);
    // Update the input field with exact value
    const hrInput = document.querySelector(`tr[data-row="${rowId}"] input[data-field="hourRate"]`);
    if (hrInput) hrInput.value = parseFloat(pos.hour_rate).toFixed(2);
  }

  estScheduleSave();
  estUpdateRowCalc(rowId);
  estUpdateTotals();
}

function estOnChange(inp) {
  const rowId = inp.dataset.rowid;
  const field = inp.dataset.field;
  const row = _estRows.find(r => String(r.id) === String(rowId));
  if (!row) return;
  row[field] = inp.value;
  estScheduleSave();
  // Only update the computed cells, not re-render the whole table
  estUpdateRowCalc(rowId);
  estUpdateTotals();
}

function estUpdateRowCalc(rowId) {
  const row = _estRows.find(r => String(r.id) === String(rowId));
  if (!row) return;
  const hr = parseFloat(row.hourRate) || 0;
  const at = parseFloat(row.actualTime) || 0;
  const em = parseFloat(row.estMonths) || 0;
  const costPerMonth = hr > 0 && at > 0 ? hr * at : null;
  const totalCost = hr > 0 && at > 0 && em > 0 ? hr * at * em : null;
  const mds = at > 0 && em > 0 ? at * em / 8 : null;

  const tr = document.querySelector(`tr[data-row="${rowId}"]`);
  if (!tr) return;
  const cells = tr.querySelectorAll('td');
  // cells: #, position, hourRate, actualTime, costPerMonth(4), estMonths(5), totalCost(6), mds(7)
  if (cells[4]) cells[4].innerHTML = costPerMonth !== null ? `<b style="color:var(--navy);">$${fmtExact(costPerMonth)}</b>` : '—';
  if (cells[6]) cells[6].innerHTML = totalCost !== null ? `<b style="color:var(--blue);">$${fmtExact(totalCost)}</b>` : '—';
  if (cells[7]) cells[7].textContent = mds !== null ? fmt.decimal(mds) : '—';
}

function estUpdateTotals() {
  let totalUSD = 0, totalMDs = 0;
  let sumCostPerMonth = 0, sumActualTime = 0;
  _estRows.forEach(r => {
    const hr = parseFloat(r.hourRate) || 0;
    const at = parseFloat(r.actualTime) || 0;
    const em = parseFloat(r.estMonths) || 0;
    sumCostPerMonth += hr * at;
    sumActualTime += at;
    totalUSD += hr * at * em;
    totalMDs += at * em / 8;
  });
  const totalSAR = totalUSD * 3.75;
  const totalUSDperMonth = sumCostPerMonth;
  const totalSARperMonth = totalUSDperMonth * 3.75;
  const estMDsPerMonth = sumActualTime / 8;
  const costPerMDSAR = estMDsPerMonth > 0 ? totalSARperMonth / estMDsPerMonth : 0;

  // Update tfoot — cols: #(0), pos(1), hr(2), at(3), cpm(4), months(5), totalUSD(6), mds(7), del(8)
  const tfoot = document.querySelector('#estTable tfoot tr');
  if (tfoot) {
    const cells = tfoot.querySelectorAll('td');
    if (cells[1]) cells[1].innerHTML = `<span style="color:#93C5FD;">$${fmt.num(Math.round(totalUSD))}</span>`;
    if (cells[2]) cells[2].innerHTML = `<span style="color:#93C5FD;">${fmt.decimal(totalMDs)}</span>`;
  }

  // Update summary strip
  const summaryEls = document.querySelectorAll('.est-summary-val');
  if (summaryEls.length >= 4) {
    summaryEls[0].textContent = `$${fmtExact(totalUSDperMonth)} USD`;
    summaryEls[1].textContent = `${fmtExact(totalSARperMonth)} SAR`;
    summaryEls[2].textContent = fmtExact(estMDsPerMonth);
    summaryEls[3].textContent = `${fmtExact(costPerMDSAR)} SAR`;
  }
  const totalEl = document.querySelector('.est-total-sar');
  if (totalEl) totalEl.textContent = `SAR ${fmtExact(totalSAR)}`;
}

async function estAddRow() {
  _estRows.push(makeEstRow('', '', 176, ''));
  await estSave();
  renderEstimatedTable(document.getElementById('estimatedLiveWrap'), _estRows, _estPositions, _estPhase);
}

async function estDeleteRow(id) {
  _estRows = _estRows.filter(r => String(r.id) !== String(id));
  if (!_estRows.length) _estRows = [makeEstRow()];
  await estSave();
  renderEstimatedTable(document.getElementById('estimatedLiveWrap'), _estRows, _estPositions, _estPhase);
}

async function estClearAll() {
  if (!confirm('Clear all rows?')) return;
  _estRows = [makeEstRow()];
  await estSave();
  renderEstimatedTable(document.getElementById('estimatedLiveWrap'), _estRows, _estPositions, _estPhase);
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

// ============================================================
// PROMOTIONS SUB-TAB
// ============================================================
async function renderPromotionsSubTab() {
  const cont = document.getElementById('varianceContent');
  cont.innerHTML = '<div class="loading">Loading promotions…</div>';

  try {
    // Load employees for datalist
    const [promoRes, empRes] = await Promise.all([
      fetch('/api/promotions'),
      fetch('/api/project-employees'),
    ]);
    const promoData = await promoRes.json();
    const empData = await empRes.json();
    const employees = (empData.employees || []).map(e => e.name);
    const records = promoData.records || [];

    const empOptions = employees.map(e => `<option value="${e}">`).join('');

    cont.innerHTML = `
      <div class="card" style="margin-bottom: 16px;">
        <h3 class="card-title" id="promoFormTitle">Add Promotion Record</h3>
        <p class="muted-text" style="font-size: 12px; margin-bottom: 12px;">
          Track mid-project promotions so cost calculations use the correct rate before and after promotion date.
        </p>
        <datalist id="promoEmpList">${empOptions}</datalist>
        <div class="travel-form" style="display: grid; grid-template-columns: 1fr 1fr 1fr auto; gap: 10px; align-items: end;">
          <div>
            <label class="filter-label">EMPLOYEE NAME</label>
            <input type="text" id="promoName" list="promoEmpList" placeholder="Type name…" class="svc-input" style="width:100%; padding:6px 8px; border:1px solid var(--border-strong); border-radius:4px;"
              oninput="promoFetchOdooPosition()">
          </div>
          <div>
            <label class="filter-label">PROMOTION DATE</label>
            <input type="date" id="promoDate" class="svc-input" style="width:100%; padding:6px 8px; border:1px solid var(--border-strong); border-radius:4px;">
          </div>
          <div>
            <label class="filter-label">OLD POSITION <span class="muted-text">(before date)</span></label>
            <input type="text" id="promoOldPos" placeholder="e.g. Business Analyst" class="svc-input" style="width:100%; padding:6px 8px; border:1px solid var(--border-strong); border-radius:4px;">
          </div>
          <div>
            <label class="filter-label">NEW POSITION <span class="muted-text">(after date)</span></label>
            <input type="text" id="promoNewPos" placeholder="e.g. Senior Business Analyst" class="svc-input" style="width:100%; padding:6px 8px; border:1px solid var(--border-strong); border-radius:4px;">
          </div>
        </div>
        <div style="display: flex; gap: 8px; margin-top: 10px; align-items: center;">
          <button class="btn-primary" onclick="submitPromotion()">💾 Save Promotion</button>
          <button class="btn-outline" id="promoCancelBtn" onclick="cancelPromoEdit()" style="display:none;">✕ Cancel</button>
          <span id="promoOdooHint" class="muted-text" style="font-size: 11px;"></span>
        </div>
        <input type="hidden" id="promoEditId" value="">
      </div>

      <div class="card">
        <h3 class="card-title">Promotion Records <span class="muted-text">(${records.length})</span></h3>
        <div class="table-scroll">
          <table class="data-table" id="promoTable">
            <thead>
              <tr>
                <th>#</th>
                <th>Employee</th>
                <th>Promotion Date</th>
                <th>Old Position (before)</th>
                <th>New Position (after)</th>
                <th>Notes</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="promoTableBody"></tbody>
          </table>
        </div>
      </div>
    `;
    loadPromoRecords(records);
  } catch (e) {
    cont.innerHTML = `<div class="banner banner-warn"><strong>Error:</strong> ${e.message}</div>`;
  }
}

function loadPromoRecords(records) {
  const tbody = document.getElementById('promoTableBody');
  if (!tbody) return;
  if (!records || !records.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="loading">No promotion records yet</td></tr>';
    return;
  }
  tbody.innerHTML = records.map((r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><b>${r.name}</b></td>
      <td style="font-family: var(--mono); font-size: 12px;">${r.promotion_date || '—'}</td>
      <td style="color: var(--text-muted); font-size: 12px;">${r.old_position || '—'}</td>
      <td style="color: var(--blue); font-size: 12px; font-weight: 600;">${r.new_position || '—'}</td>
      <td class="muted-text" style="font-size: 11px;">${r.notes || ''}</td>
      <td>
        <button class="btn-outline" style="font-size: 11px; padding: 3px 8px;" onclick="startPromoEdit(${r.id})">✏️ Edit</button>
        <button class="btn-outline" style="font-size: 11px; padding: 3px 8px; color: var(--red);" onclick="deletePromo(${r.id})">🗑</button>
      </td>
    </tr>
  `).join('');
}

async function promoFetchOdooPosition() {
  const name = document.getElementById('promoName')?.value?.trim();
  const hint = document.getElementById('promoOdooHint');
  if (!name || name.length < 3) { if (hint) hint.textContent = ''; return; }
  if (hint) hint.textContent = 'Fetching position from Odoo…';
  try {
    const res = await fetch(`/api/promotions/employee-odoo-position?name=${encodeURIComponent(name)}`);
    const d = await res.json();
    if (d.current_position) {
      const newPosEl = document.getElementById('promoNewPos');
      const oldPosEl = document.getElementById('promoOldPos');
      if (newPosEl && !newPosEl.value) newPosEl.value = d.current_position;
      if (oldPosEl && !oldPosEl.value && d.suggested_old_position) oldPosEl.value = d.suggested_old_position;
      if (hint) hint.textContent = `✓ Odoo position: ${d.current_position}`;
    } else {
      if (hint) hint.textContent = 'Position not found in Odoo';
    }
  } catch (e) {
    if (hint) hint.textContent = '';
  }
}

async function submitPromotion() {
  const id = document.getElementById('promoEditId')?.value;
  const body = {
    name: document.getElementById('promoName')?.value?.trim(),
    promotion_date: document.getElementById('promoDate')?.value,
    old_position: document.getElementById('promoOldPos')?.value?.trim(),
    new_position: document.getElementById('promoNewPos')?.value?.trim(),
    notes: '',
  };
  if (!body.name || !body.promotion_date) { alert('Name and promotion date are required'); return; }

  const url = id ? `/api/promotions/${id}` : '/api/promotions';
  const method = id ? 'PUT' : 'POST';
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (res.ok) {
    cancelPromoEdit();
    renderPromotionsSubTab();
  } else {
    const e = await res.json();
    alert('Error: ' + (e.error || 'failed'));
  }
}

async function startPromoEdit(id) {
  const res = await fetch('/api/promotions');
  const d = await res.json();
  const r = (d.records || []).find(x => x.id === id);
  if (!r) return;
  document.getElementById('promoEditId').value = id;
  document.getElementById('promoName').value = r.name || '';
  document.getElementById('promoDate').value = r.promotion_date || '';
  document.getElementById('promoOldPos').value = r.old_position || '';
  document.getElementById('promoNewPos').value = r.new_position || '';
  document.getElementById('promoFormTitle').textContent = `Edit Promotion — ${r.name}`;
  document.getElementById('promoCancelBtn').style.display = '';
}

function cancelPromoEdit() {
  document.getElementById('promoEditId').value = '';
  document.getElementById('promoName').value = '';
  document.getElementById('promoDate').value = '';
  document.getElementById('promoOldPos').value = '';
  document.getElementById('promoNewPos').value = '';
  document.getElementById('promoFormTitle').textContent = 'Add Promotion Record';
  const btn = document.getElementById('promoCancelBtn');
  if (btn) btn.style.display = 'none';
  const hint = document.getElementById('promoOdooHint');
  if (hint) hint.textContent = '';
}

async function deletePromo(id) {
  if (!confirm('Delete this promotion record?')) return;
  await fetch(`/api/promotions/${id}`, { method: 'DELETE' });
  renderPromotionsSubTab();
}
