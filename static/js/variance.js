// variance.js v3.1 - unassigned hours check
// Hide Travel & Promotions tabs from variance - they've moved to /manage
(function hideLegacyTabs() {
  const hidePhases = ['travel', 'promotions'];
  function doHide() {
    document.querySelectorAll('[data-phase]').forEach(el => {
      if (hidePhases.includes(el.dataset.phase)) {
        el.style.display = 'none';
      }
    });
    // Also hide by text content
    document.querySelectorAll('.phase-tab, .sub-tab, [data-phase]').forEach(el => {
      const txt = (el.textContent || '').toLowerCase();
      if (txt.includes('travel') || txt.includes('promotion')) {
        el.style.display = 'none';
      }
    });
  }
  // Run on DOM ready and after any dynamic render
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', doHide);
  } else {
    doHide();
  }
  // Also observe for dynamic additions
  const obs = new MutationObserver(doHide);
  obs.observe(document.body, {childList: true, subtree: true});
  setTimeout(doHide, 500); // fallback
})();


function profFillFromTasks(phaseKey) {
  const remMD = AppState._taskRemainingMDs && AppState._taskRemainingMDs[phaseKey];
  if (!remMD) {
    alert('No Tasks Analysis data found — open the Overview tab first and let it load, then come back here.');
    return;
  }
  // Set remaining in the LAST row that has actual effort (not 0)
  const table = document.getElementById(`profit-table-${phaseKey}`);
  if (!table) return;
  const rows = Array.from(table.querySelectorAll('tr[data-month-key]'));
  // Find last row with actual MDs
  let targetRow = rows[rows.length - 1];
  for (let i = rows.length - 1; i >= 0; i--) {
    const effortMDs = (AppState._effortMonthMDs && AppState._effortMonthMDs[phaseKey]) || {};
    const mk = rows[i].dataset.monthKey;
    if ((effortMDs[mk] || 0) > 0) { targetRow = rows[i]; break; }
  }
  if (!targetRow) return;
  const remInp = targetRow.querySelector('.remaining-input');
  if (remInp) {
    remInp.value = remMD.toFixed(2);
    remInp.dispatchEvent(new Event('blur'));
  }
  profRecomputeAll(phaseKey);
  // Flash feedback
  const btn = document.querySelector(`[onclick="profFillFromTasks('${phaseKey}')"]`);
  if (btn) { btn.textContent = '✓ Filled!'; btn.style.color='var(--green)'; setTimeout(()=>{btn.textContent='📋 Fill from Tasks';btn.style.color='';},2000); }
}

/* Variance tab — mirrors variance.xlsx with sub-tabs */

window.loadVariance = async function() {
  if (!AppState.loaded.variance) {
    AppState.loaded.variance = true;
    // Wire or create export button
    let exportBtn = document.getElementById('varianceExport');
    if (!exportBtn) {
      exportBtn = document.createElement('button');
      exportBtn.id = 'varianceExport';
      exportBtn.innerHTML = '⬇ Export Excel';
      exportBtn.style.cssText = [
        'position:fixed;bottom:24px;right:24px;z-index:999',
        'padding:10px 20px;background:#1B2A4E;color:white',
        'border:none;border-radius:8px;font-size:13px;font-weight:600',
        'cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,.3)',
        'display:none'  // hidden until variance tab is active
      ].join(';');
      document.body.appendChild(exportBtn);
      // Show when variance tab active, hide otherwise
      document.querySelectorAll('.exec-tab').forEach(t => {
        t.addEventListener('click', () => {
          exportBtn.style.display = t.dataset.tab === 'variance' ? 'block' : 'none';
        });
      });
    }
    if (exportBtn) {
      exportBtn.style.display = 'block';
      exportBtn.addEventListener('click', () => { exportVariancePMO(); });
    }
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

  // Check if this is BOG project (has variance.xlsx) or another project
  const isBog = AppState._overviewData?.is_bog !== false;

  // Update sub-tab buttons based on project type
  const subTabBar = document.querySelector('#variance .sub-tabs-bar');
  if (subTabBar) {
    if (isBog) {
      // BOG: Development / Consultation / Support / Travel / Promotions
      subTabBar.innerHTML = `
        <button class="sub-tab active" data-subtab="development">Development</button>
        <button class="sub-tab" data-subtab="consultation">Consultation</button>
        <button class="sub-tab" data-subtab="support">Support</button>
        <button class="sub-tab" data-subtab="travel">Travel &amp; Onsite</button>
        <button class="sub-tab" data-subtab="promotions">🎯 Promotions</button>`;
    } else {
      // Non-BOG: Services / Support (support shown after phase check)
      subTabBar.innerHTML = `
        <button class="sub-tab active" data-subtab="services">Services</button>
        <button class="sub-tab" data-subtab="support">Support</button>`;
    }
    // Re-wire tab click handlers
    subTabBar.querySelectorAll('.sub-tab').forEach(b => {
      b.addEventListener('click', () => {
        subTabBar.querySelectorAll('.sub-tab').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        switchSubTab(b.dataset.subtab);
      });
    });
  }

  if (!isBog) {
    // Non-BOG: fetch config FIRST, then build tabs
    cont.innerHTML = '<div class="loading">Loading…</div>';
    let hasSupport = false;
    try {
      const cfg = await fetch('/api/project-phases-available').then(r=>r.json());
      hasSupport = !!cfg.has_support;
    } catch(e) {}

    const _sections = () => ([
      {key:'budget',        label:'Budget',        data:{approved:{},final:{},changes:[]}},
      {key:'profitability', label:'Profitability',  data:{months:[]}},
      {key:'effort',        label:'Current Effort', data:{}},
      {key:'estimated',     label:'Estimated Cost', data:{positions:[],columns:[]}},
    ]);

    const tabs = { services: { label:'Services', sections: _sections() } };
    if (hasSupport) tabs.support = { label:'Support', sections: _sections() };
    AppState.varianceData = { tabs };

    // Rebuild sub-tab buttons based on actual config
    const subTabBar = document.querySelector('#variance .sub-tabs-bar');
    if (subTabBar) {
      subTabBar.innerHTML = `
        <button class="sub-tab active" data-subtab="services">Services</button>
        ${hasSupport ? '<button class="sub-tab" data-subtab="support">Support</button>' : ''}`;
      subTabBar.querySelectorAll('.sub-tab').forEach(b => {
        b.addEventListener('click', () => {
          subTabBar.querySelectorAll('.sub-tab').forEach(x => x.classList.remove('active'));
          b.classList.add('active');
          switchSubTab(b.dataset.subtab);
        });
      });
    }

    switchSubTab('services');
    return;
  }

  try {
    const res = await fetch('/api/variance');
    const d = await res.json();
    if (!d.available) {
      cont.innerHTML = '<div class="banner banner-warn"><strong>Not configured:</strong> variance.xlsx not found in /data folder. Budget & Profitability still available below.</div>';
      AppState.varianceData = { tabs: {
        development: { label:'Development', sections:[
          {key:'budget', label:'Budget', data:{approved:{},final:{},changes:[]}},
          {key:'profitability', label:'Profitability', data:{months:[]}},
          {key:'effort', label:'Current Effort', data:{}},
          {key:'estimated', label:'Estimated Cost', data:{positions:[],columns:[]}},
        ]},
        consultation: { label:'Consultation', sections:[
          {key:'budget', label:'Budget', data:{approved:{},final:{},changes:[]}},
          {key:'profitability', label:'Profitability', data:{months:[]}},
          {key:'effort', label:'Current Effort', data:{}},
          {key:'estimated', label:'Estimated Cost', data:{positions:[],columns:[]}},
        ]},
        support: { label:'Support', sections:[
          {key:'budget', label:'Budget', data:{approved:{},final:{},changes:[]}},
          {key:'estimated', label:'Estimated Cost', data:{positions:[],columns:[]}},
        ]},
      }};
      switchSubTab('development');
      return;
    }
    AppState.varianceData = d;
    switchSubTab('development');
  } catch(e) {
    cont.innerHTML = `<div class="banner banner-warn"><strong>Error loading variance:</strong> ${e.message}</div>`;
  }
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
      try {
        if (sect.key === 'budget') html += renderBudget(sect.data, key);
        else if (sect.key === 'profitability') html += renderProfitability(sect.data, key);
        else if (sect.key === 'effort') html += renderEffort(sect.data, key);
        else if (sect.key === 'estimated') html += renderEstimated(sect.data, key);
      } catch(e) {
        html += `<div class="banner banner-warn"><strong>Render error (${sect.key}):</strong> ${e.message}</div>`;
        console.error('Render error:', sect.key, e);
      }
    }
    html += '</div>';
  });

  cont.innerHTML = html;

  // Wire up auto-save for any budget inputs
  wireBudgetInputs(cont);

  // Load order: Effort first (has cost/MDs data), then everything that depends on it
  const effortContainerId = `effort-live-${key}`;

  // Step 1: Load effort (contains MDs + costs per month)
  if (tab.sections.some(s => s.key === 'effort')) {
    setTimeout(async () => {
      await loadEffortLive(key, effortContainerId);
      // Step 2: After effort loads, load estimated (contains total MDs + total cost)
      if (tab.sections.some(s => s.key === 'estimated')) {
        const wrap = document.getElementById('estimatedLiveWrap');
        if (wrap) await loadEstimatedLive(key, 'estimatedLiveWrap');
      }
      // Step 3: After estimated loads, recalc budget
      if (tab.sections.some(s => s.key === 'budget')) {
        budgetAutoCalc(key);
      }
      // Step 4: Rebuild profitability with fresh data
      if (tab.sections.some(s => s.key === 'profitability')) {
        profBuildTable(key);
      }
    }, 100);
  }

  // Load budget changes + revenue (independent of effort)
  if (tab.sections.some(s => s.key === 'budget')) {
    setTimeout(() => loadBudgetChanges(key), 150);
  }

  // Estimated standalone (if no effort section)
  if (!tab.sections.some(s => s.key === 'effort') && tab.sections.some(s => s.key === 'estimated')) {
    setTimeout(() => {
      const wrap = document.getElementById('estimatedLiveWrap');
      if (wrap) loadEstimatedLive(key, 'estimatedLiveWrap');
    }, 200);
  }
}

function renderBudget(data, phaseKey) {
  const a = data.approved || {};
  const f = data.final || {};

  function editableCell(value, path, type, autoId) {
    const v = value === null || value === undefined ? '' : value;
    const step = type === 'pct' ? '0.0001' : '0.01';
    const cls = type === 'pct' ? 'budget-input budget-input-pct' : 'budget-input';
    const id = autoId ? `id="${autoId}"` : '';
    return `<input type="number" step="${step}" class="${cls}" ${id} data-phase="${phaseKey}" data-path="${path}" value="${v}"
      oninput="budgetAutoCalc('${phaseKey}')"
      onblur="budgetSaveRevenue('${phaseKey}')">`;
  }

  const overrideBadge = data._has_overrides
    ? '<span class="badge badge-blue" style="margin-left:8px;">Has saved overrides</span>' : '';

  // KPI strip
  let html = `
    <div class="kpi-strip kpi-strip-small">
      <div class="kpi-card kpi-blue compact">
        <div class="kpi-label">PRESALES MDs (FINAL)</div>
        <div class="kpi-value" id="kpi-mds-${phaseKey}">${fmt.num(a.total_mandays || 0)}</div>
        <div class="kpi-foot">from Estimated Cost</div>
      </div>
      <div class="kpi-card kpi-navy compact">
        <div class="kpi-label">REVENUE (FINAL)</div>
        <div class="kpi-value" id="kpi-rev-${phaseKey}">—</div>
        <div class="kpi-foot">after changes</div>
      </div>
      <div class="kpi-card kpi-navy compact">
        <div class="kpi-label">TOTAL COST (FINAL)</div>
        <div class="kpi-value" id="kpi-cost-${phaseKey}">—</div>
        <div class="kpi-foot">after changes</div>
      </div>
      <div class="kpi-card kpi-green compact">
        <div class="kpi-label">PROFIT % (FINAL)</div>
        <div class="kpi-value" id="kpi-final-pct-${phaseKey}">—</div>
        <div class="kpi-foot" id="kpi-final-sar-${phaseKey}" style="font-size:13px;font-weight:700;color:inherit;">—</div>
      </div>
    </div>

    <div class="card" style="margin-bottom:12px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <h3 class="card-title" style="margin:0;">Budget — Editable ${overrideBadge}</h3>
        <span style="font-size:11px; color:var(--text-muted);">All fields auto-save on edit · Profit auto-calculated</span>
      </div>
    </div>

    <div class="grid-2">
      <!-- APPROVED -->
      <div class="card budget-card" style="border-top: 3px solid var(--blue);">
        <h3 class="card-title" style="margin-bottom:20px;">Approved Project Budget</h3>

        <div style="display:flex; flex-direction:column; gap:14px;">
          <div style="display:flex; justify-content:space-between; align-items:center; padding-bottom:10px; border-bottom:1px solid var(--border-light);">
            <span style="font-size:12px; color:var(--text-muted); font-weight:600; text-transform:uppercase;">Total Mandays</span>
            <span style="font-size:16px; font-weight:700; color:var(--navy);" id="bud-mds-${phaseKey}">${fmt.num(a.total_mandays || 0)}</span>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; padding-bottom:10px; border-bottom:1px solid var(--border-light);">
            <span style="font-size:12px; color:var(--text-muted); font-weight:600; text-transform:uppercase;">Total Cost (USD)</span>
            <span style="font-size:16px; font-weight:700; color:var(--navy);" id="bud-cost-usd-${phaseKey}">$${fmtExact(a.cost_usd || 0)}</span>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; padding-bottom:10px; border-bottom:1px solid var(--border-light);">
            <span style="font-size:12px; color:var(--text-muted); font-weight:600; text-transform:uppercase;">Total Cost (SAR)</span>
            <span style="font-size:16px; font-weight:700; color:var(--navy);" id="bud-cost-sar-${phaseKey}">${fmt.money(a.cost_sar || 0)}</span>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; padding-bottom:10px; border-bottom:1px solid var(--border-light);">
            <span style="font-size:12px; color:var(--text-muted); font-weight:600; text-transform:uppercase;">Total Revenue (SAR)</span>
            <span>${editableCell(a.revenue_sar, 'approved.revenue_sar', 'money', `inp-rev-${phaseKey}`)}</span>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; padding:12px; background:var(--bg-subtle); border-radius:8px;">
            <span style="font-size:13px; font-weight:700; color:var(--navy);">Profit (SAR)</span>
            <span style="font-size:22px; font-weight:800;" id="bud-profit-sar-${phaseKey}">—</span>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; padding:12px; background:var(--bg-subtle); border-radius:8px;">
            <span style="font-size:13px; font-weight:700; color:var(--navy);">Profit %</span>
            <span style="font-size:22px; font-weight:800;" id="bud-profit-pct-${phaseKey}">—</span>
          </div>
        </div>
      </div>

      <!-- FINAL -->
      <div class="card budget-card" style="border-top: 3px solid var(--amber);">
        <h3 class="card-title" style="margin-bottom:20px;">Final Budget <span class="badge badge-amber">After Changes</span></h3>

        <div style="display:flex; flex-direction:column; gap:14px;">
          <div style="display:flex; justify-content:space-between; align-items:center; padding-bottom:10px; border-bottom:1px solid var(--border-light);">
            <span style="font-size:12px; color:var(--text-muted); font-weight:600; text-transform:uppercase;">Total Cost (SAR)</span>
            <span style="font-size:16px; font-weight:700; color:var(--navy);" id="fin-cost-sar-${phaseKey}">—</span>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; padding-bottom:10px; border-bottom:1px solid var(--border-light);">
            <span style="font-size:12px; color:var(--text-muted); font-weight:600; text-transform:uppercase;">Total Revenue (SAR)</span>
            <span style="font-size:16px; font-weight:700; color:var(--navy);" id="fin-rev-sar-${phaseKey}">—</span>
          </div>
          <div id="fin-delta-cost-row-${phaseKey}" style="display:none; justify-content:space-between; align-items:center; padding-bottom:10px; border-bottom:1px solid var(--border-light);">
            <span style="font-size:12px; color:var(--text-muted); font-weight:600; text-transform:uppercase;">Δ Cost (SAR)</span>
            <span style="font-size:16px; font-weight:700;" id="fin-delta-cost-${phaseKey}">—</span>
          </div>
          <div id="fin-delta-rev-row-${phaseKey}" style="display:none; justify-content:space-between; align-items:center; padding-bottom:10px; border-bottom:1px solid var(--border-light);">
            <span style="font-size:12px; color:var(--text-muted); font-weight:600; text-transform:uppercase;">Δ Revenue (SAR)</span>
            <span style="font-size:16px; font-weight:700;" id="fin-delta-rev-${phaseKey}">—</span>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; padding:12px; background:var(--bg-subtle); border-radius:8px;">
            <span style="font-size:13px; font-weight:700; color:var(--navy);">Profit (SAR)</span>
            <span style="font-size:22px; font-weight:800;" id="fin-profit-sar-${phaseKey}">—</span>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; padding:12px; background:var(--bg-subtle); border-radius:8px;">
            <span style="font-size:13px; font-weight:700; color:var(--navy);">Profit %</span>
            <span style="font-size:22px; font-weight:800;" id="fin-profit-pct-${phaseKey}">—</span>
          </div>
        </div>
      </div>
    </div>

    <!-- APPROVED BUDGET CHANGES -->
    <div class="card" id="budget-changes-card-${phaseKey}">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
        <div>
          <h3 class="card-title" style="margin:0;">Approved Budget Changes</h3>
          <p class="muted-text" style="font-size:11px; margin:4px 0 0;">Changes to cost or revenue vs. approved baseline · auto-saved</p>
        </div>
        <button class="btn-primary" style="font-size:12px; padding:6px 14px;" onclick="budgetAddChange('${phaseKey}')">+ Add Change</button>
      </div>
      <div id="budget-changes-body-${phaseKey}"></div>
    </div>
  `;

  return html;
}

// ── Budget Changes state ──
const _budgetChanges = {};  // { phaseKey: [{id, reason, plan_id, delta_cost, delta_rev}] }

async function loadBudgetChanges(phaseKey) {
  // Load changes
  try {
    const r = await fetch(`/api/budget-changes?phase=${phaseKey}`);
    if (r.ok) {
      const d = await r.json();
      _budgetChanges[phaseKey] = d.changes || [];
      // Load planned profit history
      if (d.planned_profit_history) {
        if (!AppState._plannedProfitHistory) AppState._plannedProfitHistory = {};
        AppState._plannedProfitHistory[phaseKey] = d.planned_profit_history;
      }
    }
  } catch (e) {}
  if (!_budgetChanges[phaseKey]) _budgetChanges[phaseKey] = [];

  // Load saved revenue override and populate input (always override with saved value)
  try {
    const r = await fetch(`/api/variance/budget-override/${phaseKey}`);
    if (r.ok) {
      const d = await r.json();
      const overrides = d.overrides || {};
      const savedRev = overrides['approved.revenue_sar'];
      if (savedRev !== undefined && savedRev !== null) {
        // Save to AppState for profitability to use even before budget DOM loads
        if (!AppState._savedRevenue) AppState._savedRevenue = {};
        AppState._savedRevenue[phaseKey] = parseFloat(savedRev);
        const revEl = document.getElementById(`inp-rev-${phaseKey}`);
        if (revEl) revEl.value = savedRev;
      }
    }
  } catch(e) {}

  renderBudgetChanges(phaseKey);
  // Delay to ensure estimated cost rows are loaded first
  setTimeout(() => budgetAutoCalc(phaseKey), 300);
}

function renderBudgetChanges(phaseKey) {
  const cont = document.getElementById(`budget-changes-body-${phaseKey}`);
  if (!cont) return;
  const changes = _budgetChanges[phaseKey] || [];

  if (!changes.length) {
    cont.innerHTML = `<p style="color:var(--text-muted);font-size:12px;padding:12px 0;">No changes yet — click "+ Add Change"</p>`;
    return;
  }

  const totalDeltaCost = changes.reduce((s,c) => s+(parseFloat(c.delta_cost)||0), 0);
  const totalDeltaRev  = changes.reduce((s,c) => s+(parseFloat(c.delta_rev) ||0), 0);

  const LBL = `display:block;font-size:11px;font-weight:600;color:var(--text-muted);
               text-transform:uppercase;letter-spacing:.4px;margin-bottom:3px;`;

  const rows = changes.map((c, i) => {
    const rev  = parseFloat(c.delta_rev)  || 0;
    const cost = parseFloat(c.delta_cost) || 0;
    const revColor  = rev  < 0 ? 'color:var(--red)' : rev  > 0 ? 'color:var(--green)' : '';
    const costColor = cost > 0 ? 'color:var(--red)' : cost < 0 ? 'color:var(--green)' : '';
    const net = cost + rev;
    const netColor  = net < 0 ? 'var(--green)' : net > 0 ? 'var(--red)' : 'var(--text-muted)';
    const netSign   = net > 0 ? '+' : '';
    const accent    = (cost > 0 || rev < 0) ? 'var(--amber)' : 'var(--blue)';

    const safeR = (c.reason ||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;');
    const safeP = (c.plan_id||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;');

    return `<div style="border-left:3px solid ${accent};padding:10px 12px;margin-bottom:8px;
                         background:var(--bg-subtle);border-radius:0 6px 6px 0;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">

        <!-- Left block: Reason + grid of fields -->
        <div style="flex:1;min-width:0;">
          <div style="margin-bottom:8px;">
            <label style="${LBL}">Reason / Description</label>
            <input type="text" class="svc-input" style="width:100%;font-size:12px;"
              placeholder="e.g. Third party license"
              value="${safeR}"
              oninput="_budgetChanges['${phaseKey}'][${i}].reason=this.value;budgetSaveChanges('${phaseKey}')">
          </div>
          <div style="display:grid;grid-template-columns:1fr 100px 130px 130px 80px;gap:8px;align-items:end;">
            <div>
              <label style="${LBL}">Plan / CR ID</label>
              <input type="text" class="svc-input" style="font-size:12px;width:100%;"
                placeholder="CR-001" value="${safeP}"
                oninput="_budgetChanges['${phaseKey}'][${i}].plan_id=this.value;budgetSaveChanges('${phaseKey}')">
            </div>
            <div>
              <label style="${LBL}">Date</label>
              <input type="date" class="svc-input" style="font-size:12px;width:100%;"
                value="${c.change_date||''}"
                oninput="_budgetChanges['${phaseKey}'][${i}].change_date=this.value;
                         budgetSaveChanges('${phaseKey}');budgetAutoCalc('${phaseKey}')">
            </div>
            <div>
              <label style="${LBL}">Δ Cost (SAR)</label>
              <input type="number" step="1" class="svc-input"
                style="font-size:12px;width:100%;text-align:right;${costColor};"
                placeholder="0" value="${c.delta_cost||''}"
                oninput="_budgetChanges['${phaseKey}'][${i}].delta_cost=parseFloat(this.value)||0;
                         budgetSaveChanges('${phaseKey}');budgetAutoCalc('${phaseKey}');
                         this.style.color=parseFloat(this.value)>0?'var(--red)':parseFloat(this.value)<0?'var(--green)':''">
            </div>
            <div>
              <label style="${LBL}">Δ Revenue (SAR)</label>
              <input type="number" step="1" class="svc-input"
                style="font-size:12px;width:100%;text-align:right;${revColor};"
                placeholder="0" value="${c.delta_rev||''}"
                oninput="_budgetChanges['${phaseKey}'][${i}].delta_rev=parseFloat(this.value)||0;
                         budgetSaveChanges('${phaseKey}');budgetAutoCalc('${phaseKey}');
                         this.style.color=parseFloat(this.value)<0?'var(--red)':parseFloat(this.value)>0?'var(--green)':''">
            </div>
            <div>
              <label style="${LBL}">Δ MDs</label>
              <input type="number" step="0.1" class="svc-input"
                style="font-size:12px;width:100%;text-align:right;"
                placeholder="0" value="${c.delta_mds||''}"
                oninput="_budgetChanges['${phaseKey}'][${i}].delta_mds=parseFloat(this.value)||0;
                         budgetSaveChanges('${phaseKey}');budgetAutoCalc('${phaseKey}')">
            </div>
          </div>
        </div>

        <!-- Right block: net impact + delete -->
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0;">
          <button onclick="budgetDeleteChange('${phaseKey}',${i})"
            style="background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:12px;
                   padding:2px 4px;line-height:1;" title="Remove"
            onmouseover="this.style.color='var(--red)'"
            onmouseout="this.style.color='var(--text-muted)'">✕</button>
          ${(cost !== 0 || rev !== 0) ? `
          <div style="text-align:right;margin-top:auto;">
            <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.3px;">Net</div>
            <div style="font-size:13px;font-weight:700;color:${netColor};">${netSign}${fmt.money(Math.round(net))}</div>
          </div>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');

  // Summary row
  const fD = v => {
    if (!v) return '<span style="color:var(--text-muted)">—</span>';
    const s = v>0?'+':'', c = v<0?'var(--red)':'var(--green)';
    return `<b style="color:${c}">${s}${fmt.money(Math.round(v))}</b>`;
  };
  const summary = `<div style="display:flex;gap:20px;padding:8px 12px;background:var(--bg-card);
                               border:1px solid var(--border-light);border-radius:6px;font-size:12px;align-items:center;">
    <span style="color:var(--text-muted);font-size:11px;">${changes.length} change${changes.length!==1?'s':''}</span>
    <span style="margin-left:auto;color:var(--text-muted);">Σ Δ Cost: ${fD(totalDeltaCost)}</span>
    <span style="color:var(--text-muted);">Σ Δ Revenue: ${fD(totalDeltaRev)}</span>
  </div>`;

  cont.innerHTML = rows + summary;
}
// Auto-save revenue input
async function budgetSaveRevenue(phaseKey) {
  const revEl = document.getElementById(`inp-rev-${phaseKey}`);
  if (!revEl) return;
  const value = parseFloat(revEl.value) || null;
  // Save to AppState immediately
  if (!AppState._savedRevenue) AppState._savedRevenue = {};
  AppState._savedRevenue[phaseKey] = value;
  try {
    await fetch('/api/variance/budget-override', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ phase: phaseKey, path: 'approved.revenue_sar', value })
    });
    revEl.style.borderColor = 'var(--green)';
    setTimeout(() => { revEl.style.borderColor = ''; }, 1200);
  } catch(e) {}
}

async function budgetSaveChanges(phaseKey) {
  try {
    await fetch('/api/budget-changes', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ phase: phaseKey, changes: _budgetChanges[phaseKey] || [] })
    });
  } catch(e) {}
}

function budgetAddChange(phaseKey) {
  if (!_budgetChanges[phaseKey]) _budgetChanges[phaseKey] = [];
  _budgetChanges[phaseKey].push({ id: Date.now(), reason:'', plan_id:'', delta_cost:0, delta_rev:0 });
  budgetSaveChanges(phaseKey);
  renderBudgetChanges(phaseKey);
  budgetAutoCalc(phaseKey);
}

function budgetDeleteChange(phaseKey, idx) {
  if (!_budgetChanges[phaseKey]) return;
  _budgetChanges[phaseKey].splice(idx, 1);
  budgetSaveChanges(phaseKey);
  renderBudgetChanges(phaseKey);
  budgetAutoCalc(phaseKey);
}

function budgetAutoCalc(phaseKey) {
  const setEl = (id, val, color) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = val;
    if (color) el.style.color = color;
  };

  // Cost from Estimated Cost rows (BOG) or summary (non-BOG)
  let mds = 0, costUSD = 0, costSAR = 0;
  const isBogBudget = AppState._overviewData?.is_bog !== false;

  if (!isBogBudget && AppState._estSummary && AppState._estSummary[phaseKey]) {
    // Non-BOG: use summary from Excel import
    const s = AppState._estSummary[phaseKey];
    mds     = s.total_mds      || 0;
    costUSD = s.total_cost_usd || 0;
    costSAR = s.total_cost_sar || (costUSD * 3.75);
  } else if (_estPhase === phaseKey && _estRows && _estRows.length) {
    // BOG: use editable rows
    _estRows.forEach(r => {
      const hr = parseFloat(r.hourRate)||0, at = parseFloat(r.actualTime)||0, em = parseFloat(r.estMonths)||0;
      mds     += at * em / 8;
      costUSD += hr * at * em;
    });
    costSAR = costUSD * 3.75;
  } else {
    costSAR = costUSD * 3.75;
  }

  // Revenue from input
  const revEl = document.getElementById(`inp-rev-${phaseKey}`);
  const approvedRevSAR = revEl ? (parseFloat(revEl.value)||0) : 0;
  const approvedCostSAR = costSAR;

  // Changes totals
  const changes = _budgetChanges[phaseKey] || [];
  const deltaCostTotal = changes.reduce((s,c) => s + (parseFloat(c.delta_cost)||0), 0);
  const deltaRevTotal  = changes.reduce((s,c) => s + (parseFloat(c.delta_rev)||0), 0);

  // Final = Approved + Σ Changes
  const finCostSAR = approvedCostSAR + deltaCostTotal;
  const finRevSAR  = approvedRevSAR + deltaRevTotal;

  // Approved profit
  const appProfit    = approvedRevSAR - approvedCostSAR;
  const appProfitPct = approvedRevSAR > 0 ? appProfit / approvedRevSAR * 100 : 0;

  // Final profit
  const finProfit    = finRevSAR - finCostSAR;
  const finProfitPct = finRevSAR > 0 ? finProfit / finRevSAR * 100 : 0;

  const profColor = (p) => p >= 40 ? 'var(--green)' : p >= 20 ? 'var(--amber)' : 'var(--red)';

  // Approved section
  setEl(`bud-mds-${phaseKey}`, mds > 0 ? fmt.num(Math.round(mds)) : '—');
  setEl(`bud-cost-usd-${phaseKey}`, costUSD > 0 ? fmtExact(costUSD) : '—');
  setEl(`bud-cost-sar-${phaseKey}`, costSAR > 0 ? fmt.money(Math.round(costSAR)) : '—');
  setEl(`bud-profit-sar-${phaseKey}`, approvedRevSAR > 0 ? fmt.money(Math.round(appProfit)) + ' SAR' : '—', profColor(appProfitPct));
  setEl(`bud-profit-pct-${phaseKey}`, approvedRevSAR > 0 ? fmt.decimal(appProfitPct) + '%' : '—', profColor(appProfitPct));

  // Final section — show only what changed, compute from approved + delta
  setEl(`fin-cost-sar-${phaseKey}`,   fmt.money(Math.round(finCostSAR)) + ' SAR');
  setEl(`fin-rev-sar-${phaseKey}`,    fmt.money(Math.round(finRevSAR))  + ' SAR');

  // Show/hide delta rows based on whether there are changes
  const hasCostChanges = changes.some(c => parseFloat(c.delta_cost) !== 0 && c.delta_cost !== '' && c.delta_cost !== null && c.delta_cost !== undefined);
  const hasRevChanges  = changes.some(c => parseFloat(c.delta_rev)  !== 0 && c.delta_rev  !== '' && c.delta_rev  !== null && c.delta_rev  !== undefined);
  const showDeltaCostRow = document.getElementById(`fin-delta-cost-row-${phaseKey}`);
  const showDeltaRevRow  = document.getElementById(`fin-delta-rev-row-${phaseKey}`);
  if (showDeltaCostRow) showDeltaCostRow.style.display = hasCostChanges ? '' : 'none';
  if (showDeltaRevRow)  showDeltaRevRow.style.display  = hasRevChanges  ? '' : 'none';

  if (deltaCostTotal !== 0) {
    setEl(`fin-delta-cost-${phaseKey}`, (deltaCostTotal > 0 ? '+' : '') + fmt.money(Math.abs(deltaCostTotal)) + ' SAR',
      deltaCostTotal > 0 ? 'var(--red)' : 'var(--green)');
  }
  if (deltaRevTotal !== 0) {
    setEl(`fin-delta-rev-${phaseKey}`,
      deltaRevTotal < 0 ? '(' + fmt.money(Math.abs(deltaRevTotal)) + ')' : '+' + fmt.money(deltaRevTotal) + ' SAR',
      deltaRevTotal > 0 ? 'var(--green)' : 'var(--red)');
  }

  setEl(`fin-profit-sar-${phaseKey}`, finRevSAR > 0 ? fmt.money(Math.round(finProfit)) + ' SAR' : '—', profColor(finProfitPct));
  setEl(`fin-profit-pct-${phaseKey}`, finRevSAR > 0 ? fmt.decimal(finProfitPct) + '%' : '—', profColor(finProfitPct));

  // KPI strip
  // Save final profit % for profitability to use (with date for history)
  if (finRevSAR > 0) {
    if (!AppState._finalProfitPct) AppState._finalProfitPct = {};
    const newProfitPct = finProfit / finRevSAR;
    const prevPct = AppState._finalProfitPct[phaseKey];
    AppState._finalProfitPct[phaseKey] = newProfitPct;

    // Save history: if profit% changed, record when
    if (prevPct !== undefined && Math.abs(newProfitPct - prevPct) > 0.001) {
      if (!AppState._plannedProfitHistory) AppState._plannedProfitHistory = {};
      if (!AppState._plannedProfitHistory[phaseKey]) AppState._plannedProfitHistory[phaseKey] = {};
      const today = new Date().toISOString().slice(0,7); // YYYY-MM
      AppState._plannedProfitHistory[phaseKey][today] = newProfitPct;
      // Persist to DB
      fetch('/api/budget-changes', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ phase: phaseKey, changes: _budgetChanges[phaseKey]||[], 
          planned_profit_history: AppState._plannedProfitHistory[phaseKey] })
      }).catch(()=>{});
    }
  }
  // Final MDs = approved mds + Σ delta_mds from all changes
  const deltaMDsTotal = changes.reduce((s,c) => s + (parseFloat(c.delta_mds)||0), 0);
  const finMDs = mds + deltaMDsTotal;

  setEl(`kpi-mds-${phaseKey}`,       finMDs > 0 ? fmt.num(Math.round(finMDs)) : (mds > 0 ? fmt.num(Math.round(mds)) : '—'));
  setEl(`kpi-rev-${phaseKey}`,       finRevSAR > 0 ? fmt.money(Math.round(finRevSAR)) : '—');
  setEl(`kpi-cost-${phaseKey}`,      finCostSAR > 0 ? fmt.money(Math.round(finCostSAR)) : (costSAR > 0 ? fmt.money(Math.round(costSAR)) : '—'));
  setEl(`kpi-final-pct-${phaseKey}`, finRevSAR > 0 ? fmt.decimal(finProfitPct)+'%' : '—', profColor(finProfitPct));
  setEl(`kpi-final-sar-${phaseKey}`, finRevSAR > 0 ? fmt.money(Math.round(finProfit)) + ' SAR' : '—', profColor(finProfitPct));

  // Save to AppState for profitability
  if (!AppState._budgetApprovedMDs) AppState._budgetApprovedMDs = {};
  if (!AppState._budgetFinalCost)   AppState._budgetFinalCost   = {};
  AppState._budgetApprovedMDs[phaseKey] = mds;          // from estimated rows = approved
  AppState._budgetFinalCost[phaseKey]   = finCostSAR || costSAR;
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
  // Pre-fetch overrides
  fetch('/api/plan-overrides').then(r => r.json()).then(o => {
    AppState.planOverrides = o.plan_overrides || {};
    setTimeout(() => profBuildTable(phaseKey), 100);
  });

  const html = `
    <div class="kpi-strip kpi-strip-small" id="prof-kpi-${phaseKey}">
      <div class="kpi-card kpi-blue compact">
        <div class="kpi-label">% COMPLETION</div>
        <div class="kpi-value" id="prof-kpi-completion-${phaseKey}">—</div>
        <div class="kpi-foot">latest month</div>
      </div>
      <div class="kpi-card kpi-amber compact">
        <div class="kpi-label">REMAINING MDs</div>
        <div class="kpi-value" id="prof-kpi-remaining-${phaseKey}">—</div>
      </div>
      <div class="kpi-card kpi-navy compact">
        <div class="kpi-label">EAC MDs</div>
        <div class="kpi-value" id="prof-kpi-eac-${phaseKey}">—</div>
      </div>
      <div class="kpi-card kpi-green compact">
        <div class="kpi-label">CPI</div>
        <div class="kpi-value" id="prof-kpi-cpi-${phaseKey}">—</div>
        <div class="kpi-foot">cost performance index</div>
      </div>
      <div class="kpi-card kpi-blue compact">
        <div class="kpi-label">PROFIT AT COMPLETION</div>
        <div class="kpi-value" id="prof-kpi-profit-${phaseKey}">—</div>
      </div>
    </div>
    <div class="card" style="margin-top:12px;" id="prof-card-${phaseKey}">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <div>
          <h3 class="card-title" style="margin:0;">Monthly Profitability Variance</h3>
          <span class="muted-text" style="font-size:11px;">Enter % Completion and Remaining MDs per month · all other columns auto-calculated · auto-saved</span>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn-outline" style="font-size:12px;padding:6px 14px;" 
            title="Fill Remaining MDs from Tasks Analysis tab"
            onclick="profFillFromTasks('${phaseKey}')">📋 Fill from Tasks</button>
          <button class="btn-primary" style="font-size:12px;padding:6px 16px;" onclick="profBuildTable('${phaseKey}')">↻ Recalculate</button>
        </div>
      </div>
      <div id="prof-table-wrap-${phaseKey}">
        <div class="loading">Waiting for Current Effort data…</div>
      </div>
    </div>
  `;

  // Build table once effort data is available
  setTimeout(() => profBuildTable(phaseKey), 500);

  return html;
}

async function profBuildTable(phaseKey) {
  const wrap = document.getElementById(`prof-table-wrap-${phaseKey}`);
  if (!wrap) return;

  let months = (AppState._effortMonths && AppState._effortMonths[phaseKey]) || [];

  // If no effort data, fetch it silently from API
  if (!months.length) {
    wrap.innerHTML = '<div class="loading">Loading effort data…</div>';
    try {
      const res = await fetch(`/api/effort/${phaseKey}/all-months`);
      if (!res.ok) throw new Error('Effort API ' + res.status);
      const d = await res.json();
      if (d.months && d.months.length) {
        // Store months in AppState
        if (!AppState._effortMonths)     AppState._effortMonths     = {};
        if (!AppState._effortMonthMDs)   AppState._effortMonthMDs   = {};
        if (!AppState._effortMonthCosts) AppState._effortMonthCosts = {};
        AppState._effortMonths[phaseKey] = d.months;

        // Build MDs and costs per month
        const monthMDTotals   = {};
        const monthCostTotals = {};
        d.months.forEach(m => { monthMDTotals[m.key] = 0; monthCostTotals[m.key] = 0; });
        (d.employees || []).forEach(emp => {
          d.months.forEach(m => {
            const cell = emp.months?.[m.key] || { regular: 0, ramadan: 0, overtime: 0 };
            monthMDTotals[m.key]   += (cell.regular + cell.overtime) / 8 + cell.ramadan / 6;
            const hr  = emp.hour_rate || 0;
            const otr = emp.overtime_rate || hr * 1.5;
            monthCostTotals[m.key] += (cell.regular + cell.ramadan) * hr + cell.overtime * otr;
          });
        });
        AppState._effortMonthMDs[phaseKey]   = monthMDTotals;
        AppState._effortMonthCosts[phaseKey] = monthCostTotals;
        months = d.months;
      }
    } catch(e) {}
  }

  if (!months.length) {
    wrap.innerHTML = '<div class="loading" style="color:var(--text-muted);">No effort data found for this phase</div>';
    return;
  }

  _doBuildProfTable(phaseKey, wrap, months);
}

async function _doBuildProfTable(phaseKey, wrap, months) {

  // Load saved overrides
  let overrides = {};
  try {
    const r = await fetch('/api/plan-overrides');
    const d = await r.json();
    AppState.planOverrides = d.plan_overrides || {};
    overrides = (AppState.planOverrides[phaseKey]) || {};
  } catch(e) {}

  const tableHtml = `
    <div class="table-scroll">
    <table class="data-table" id="profit-table-${phaseKey}" style="font-size:11px; white-space:nowrap;">
      <thead>
        <tr>
          <th rowspan="2" style="position:sticky;left:0;z-index:3;background:var(--navy);color:white;min-width:70px;">Month</th>
          <th colspan="3" style="text-align:center;background:#1B2A4E;color:#93C5FD;border-left:3px solid #3B82F6;">Presales Budget</th>
          <th colspan="2" style="text-align:center;background:#1B2A4E;color:#FCD34D;border-left:3px solid #F59E0B;">Current Effort</th>
          <th colspan="2" style="text-align:center;background:#1B2A4E;color:#93C5FD;border-left:3px solid #60A5FA;">% Completion & Remaining</th>
          <th colspan="8" style="text-align:center;background:#1B2A4E;color:#6EE7B7;border-left:3px solid #10B981;">Cost Variance</th>
          <th colspan="6" style="text-align:center;background:#1B2A4E;color:#FCA5A5;border-left:3px solid #EF4444;">Profitability</th>
          <th colspan="6" style="text-align:center;background:#1B2A4E;color:#C4B5FD;border-left:3px solid #8B5CF6;">Progress &amp; Virtual Invoice</th>
        </tr>
        <tr style="font-size:10px;background:#f8fafc;">
          <th class="num" style="border-left:3px solid #3B82F6;">Revenue SAR</th>
          <th class="num">Est. Cost SAR</th>
          <th class="num">Est. MDs</th>
          <th class="num" style="border-left:3px solid #F59E0B;">This Month MDs</th>
          <th class="num">Actual MDs to Date</th>
          <th class="num" style="border-left:3px solid #60A5FA;">% Completion</th>
          <th class="num">Remaining MDs</th>
          <th class="num" style="border-left:3px solid #10B981;">Current Cost SAR</th>
          <th class="num">EAC MDs</th>
          <th class="num">Expected Overrun</th>
          <th class="num">Cost to Complete SAR</th>
          <th class="num">Est. at Completion SAR</th>
          <th class="num">CPI</th>
          <th class="num">Variance SAR</th>
          <th class="num">Variance %</th>
          <th class="num" style="border-left:3px solid #EF4444;">Profit at Comp SAR</th>
          <th class="num">Planned Profit SAR</th>
          <th class="num">Profit %</th>
          <th class="num">Prof. Var SAR</th>
          <th class="num">Prof. Var %</th>
          <th class="num" style="border-left:3px solid #8B5CF6;">Total Recog. Revenue</th>
          <th class="num">Progress %</th>
          <th class="num">Production</th>
          <th class="num">Total Issued SAR</th>
          <th class="num">Acc. VI SAR</th>
          <th class="num">This Month VI SAR</th>
        </tr>
      </thead>
      <tbody>
        ${months.map((m) => {
          const monthKey = m.key;
          const mo = overrides[monthKey] || {};
          const savedPct = mo.completion !== undefined ? parseFloat(mo.completion).toFixed(2) : '0.00';
          const savedRem = mo.remaining  !== undefined ? parseFloat(mo.remaining).toFixed(2)  : '0.00';
          return `
          <tr data-month-key="${monthKey}" style="height:52px;">
            <td style="position:sticky;left:0;background:white;z-index:2;font-family:var(--mono);font-size:12px;font-weight:600;padding:8px 10px;">${monthKey}</td>
            <td class="num prof-rev-${phaseKey}" style="border-left:3px solid #3B82F6;">—</td>
            <td class="num prof-estcost-${phaseKey}">—</td>
            <td class="num prof-estmds-${phaseKey}">—</td>
            <td class="num prof-thismonth-${phaseKey}" style="border-left:3px solid #F59E0B;">—</td>
            <td class="num prof-actual-${phaseKey}">—</td>
            <td class="num" style="border-left:3px solid #60A5FA;">
              <input type="number" step="0.01" min="0" max="200"
                class="completion-input" data-phase="${phaseKey}" data-month="${monthKey}" data-field="completion"
                value="${savedPct}"
                style="width:65px;padding:3px 6px;font-size:12px;text-align:right;border:1px solid var(--border-strong);border-radius:4px;font-family:var(--mono);"
                oninput="profRecomputeAll('${phaseKey}')" onblur="saveOverride(this)">
              <span style="font-size:10px;color:var(--text-muted);">%</span>
            </td>
            <td class="num">
              <input type="number" step="0.01" min="0"
                class="remaining-input" data-phase="${phaseKey}" data-month="${monthKey}" data-field="remaining"
                value="${savedRem}"
                style="width:75px;padding:3px 6px;font-size:12px;text-align:right;border:1px solid var(--border-strong);border-radius:4px;font-family:var(--mono);"
                oninput="profRecomputeAll('${phaseKey}')" onblur="saveOverride(this)">
            </td>
            <td class="num" style="border-left:3px solid #10B981;"><span class="pc-currcost-${monthKey}">—</span></td>
            <td class="num"><span class="pc-eac-${monthKey}">—</span></td>
            <td class="num"><span class="pc-overrun-${monthKey}">—</span></td>
            <td class="num"><span class="pc-costtocomplete-${monthKey}">—</span></td>
            <td class="num"><span class="pc-eac-cost-${monthKey}">—</span></td>
            <td class="num"><span class="pc-cpi-${monthKey}">—</span></td>
            <td class="num"><span class="pc-variance-${monthKey}">—</span></td>
            <td class="num"><span class="pc-variance-pct-${monthKey}">—</span></td>
            <td class="num" style="border-left:3px solid #EF4444;"><span class="pc-profit-comp-${monthKey}">—</span></td>
            <td class="num"><span class="pc-planned-profit-${monthKey}">—</span></td>
            <td class="num"><span class="pc-profit-pct-${monthKey}">—</span></td>
            <td class="num"><span class="pc-prof-var-${monthKey}">—</span></td>
            <td class="num"><span class="pc-prof-var-pct-${monthKey}">—</span></td>
            <td class="num" style="border-left:3px solid #8B5CF6;"><span class="pc-rev-todate-${monthKey}">—</span></td>
            <td class="num"><span class="pc-progress-${monthKey}">—</span></td>
            <td class="num"><span class="pc-production-${monthKey}">—</span></td>
            <td class="num"><span class="pc-issued-${monthKey}">—</span></td>
            <td class="num"><span class="pc-vi-acc-${monthKey}">—</span></td>
            <td class="num"><span class="pc-vi-month-${monthKey}">—</span></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
    </div>
  `;

  wrap.innerHTML = tableHtml;
  // Set input values from saved overrides explicitly (HTML value attr may not set DOM value)
  const savedOvs = (AppState.planOverrides?.[phaseKey]) || {};
  document.querySelectorAll(`#profit-table-${phaseKey} tr[data-month-key]`).forEach(tr => {
    const mk = tr.dataset.monthKey;
    const mo = savedOvs[mk] || {};
    const compInp = tr.querySelector('.completion-input');
    const remInp  = tr.querySelector('.remaining-input');
    if (compInp && mo.completion !== undefined) compInp.value = parseFloat(mo.completion).toFixed(2);
    if (remInp  && mo.remaining  !== undefined) remInp.value  = parseFloat(mo.remaining).toFixed(2);
  });

  // Auto-fill remaining MDs from Tasks Analysis if available
  const taskRemMD = AppState._taskRemainingMDs && AppState._taskRemainingMDs[phaseKey];
  if (taskRemMD) {
    setTimeout(() => profFillFromTasks(phaseKey), 50);
  } else {
    setTimeout(() => profRecomputeAll(phaseKey), 50);
  }
}

async function profRecomputeAll(phaseKey) {
  let totalRevSAR = 0, totalEstCostSAR = 0, totalEstMDs = 0;

  // ── 1. Revenue: DOM → AppState → DB ──
  const revEl = document.getElementById(`inp-rev-${phaseKey}`);
  if (revEl && parseFloat(revEl.value)) {
    totalRevSAR = parseFloat(revEl.value);
  } else if (AppState._savedRevenue?.[phaseKey]) {
    totalRevSAR = AppState._savedRevenue[phaseKey];
  } else {
    try {
      const r = await fetch(`/api/variance/budget-override/${phaseKey}`);
      if (r.ok) {
        const d = await r.json();
        const sv = (d.overrides||{})['approved.revenue_sar'];
        if (sv) { totalRevSAR = parseFloat(sv); if (!AppState._savedRevenue) AppState._savedRevenue={}; AppState._savedRevenue[phaseKey]=totalRevSAR; }
      }
    } catch(e) {}
  }
  // Add delta changes
  const budgChanges = _budgetChanges[phaseKey] || [];
  totalRevSAR += budgChanges.reduce((s,c) => s + (parseFloat(c.delta_rev)||0), 0);

  // Approved bases (from estimated rows, before any changes)
  const approvedRevBase     = AppState._savedRevenue?.[phaseKey] || 0;
  const approvedMDsBase     = AppState._budgetApprovedMDs?.[phaseKey] || totalEstMDs || 0;
  const totalDeltaCostAll   = budgChanges.reduce((s,c) => s + (parseFloat(c.delta_cost)||0), 0);
  const totalDeltaMDsAll    = budgChanges.reduce((s,c) => s + (parseFloat(c.delta_mds)||0), 0);
  const approvedCostBase    = (AppState._budgetFinalCost?.[phaseKey] || totalEstCostSAR) - totalDeltaCostAll;

  // Per-month: apply only changes whose change_date ≤ monthKey
  const _getMonthlyRev = (mk) => {
    let v = approvedRevBase;
    budgChanges.forEach(c => { const cd=(c.change_date||'').slice(0,7); if(!cd||cd<=mk) v+=parseFloat(c.delta_rev)||0; });
    return v;
  };
  const _getMonthlyEstCost = (mk) => {
    let v = approvedCostBase;
    budgChanges.forEach(c => { const cd=(c.change_date||'').slice(0,7); if(!cd||cd<=mk) v+=parseFloat(c.delta_cost)||0; });
    return v;
  };
  const _getMonthlyEstMDs = (mk) => {
    if (totalDeltaMDsAll === 0) return approvedMDsBase;
    let v = approvedMDsBase;
    budgChanges.forEach(c => { const cd=(c.change_date||'').slice(0,7); if(!cd||cd<=mk) v+=parseFloat(c.delta_mds)||0; });
    return v;
  };

  // ── 2. Estimated rows: ALWAYS fetch fresh to ensure totalEstMDs/Cost are set ──
  {
    let rows = (_estPhase === phaseKey && _estRows?.length) ? _estRows : null;
    if (!rows) {
      try {
        const r = await fetch(`/api/estimated-rows?phase=${phaseKey}`);
        if (r.ok) {
          const d = await r.json();
          rows = d.rows || [];
          if (rows.length) { _estRows = rows; _estPhase = phaseKey; }
        }
      } catch(e) {}
    }
    // Also try non-BOG summary
    if ((!rows || !rows.length) && AppState._estSummary?.[phaseKey]) {
      const s = AppState._estSummary[phaseKey];
      totalEstMDs     = s.total_mds      || 0;
      totalEstCostSAR = s.total_cost_sar || 0;
    } else if (rows && rows.length) {
      let costUSD = 0;
      rows.forEach(r => {
        const hr=parseFloat(r.hourRate)||0, at=parseFloat(r.actualTime)||0, em=parseFloat(r.estMonths)||0;
        costUSD += hr*at*em; totalEstMDs += at*em/8;
      });
      totalEstCostSAR = costUSD * 3.75;
    }
  }

  // Fallback to AppState budget values if still 0
  if (totalEstMDs === 0)     totalEstMDs     = AppState._budgetApprovedMDs?.[phaseKey] || 0;
  if (totalEstCostSAR === 0) totalEstCostSAR = AppState._budgetFinalCost?.[phaseKey]   || 0;

  // Save back to AppState
  if (totalEstMDs > 0)     { if(!AppState._budgetApprovedMDs) AppState._budgetApprovedMDs={}; AppState._budgetApprovedMDs[phaseKey]=totalEstMDs; }
  if (totalEstCostSAR > 0) { if(!AppState._budgetFinalCost)   AppState._budgetFinalCost={};   AppState._budgetFinalCost[phaseKey]=totalEstCostSAR; }

  // ── 3. Effort MDs + Costs: AppState → API ──
  let effortMDs = AppState._effortMonthMDs?.[phaseKey];
  let effortCosts = AppState._effortMonthCosts?.[phaseKey];
  let months = AppState._effortMonths?.[phaseKey] || [];

  if (!effortMDs || !months.length) {
    try {
      const res = await fetch(`/api/effort/${phaseKey}/all-months`);
      const d = await res.json();
      if (d.months?.length) {
        months = d.months;
        // Use pre-computed costs from backend (most accurate - uses real rates)
        if (d.month_cost_usd) {
          effortMDs   = d.month_mds   || {};
          effortCosts = d.month_cost_usd;  // USD, multiply by 3.75 for SAR
        } else {
          // Fallback: compute from employees
          const mMDs={}, mCosts={};
          months.forEach(m => { mMDs[m.key]=0; mCosts[m.key]=0; });
          (d.employees||[]).forEach(emp => {
            const hr  = parseFloat(emp.hour_rate)  || 0;
            const otr = parseFloat(emp.overtime_rate) || hr * 1.5;
            months.forEach(m => {
              const cell = emp.months?.[m.key]||{regular:0,ramadan:0,overtime:0};
              mMDs[m.key] += (cell.regular + cell.overtime) / 8 + cell.ramadan / 6;
              if (hr > 0) mCosts[m.key] += (cell.regular + cell.ramadan) * hr + cell.overtime * otr;
              else {
                const totalH = cell.regular + cell.ramadan + cell.overtime;
                mCosts[m.key] += (emp.total_cost_usd||0) * (totalH / (emp.total_hours||1));
              }
            });
          });
          effortMDs=mMDs; effortCosts=mCosts;
        }
        if (!AppState._effortMonths) AppState._effortMonths={};
        if (!AppState._effortMonthMDs) AppState._effortMonthMDs={};
        if (!AppState._effortMonthCosts) AppState._effortMonthCosts={};
        AppState._effortMonths[phaseKey]=months;
        AppState._effortMonthMDs[phaseKey]=effortMDs;
        AppState._effortMonthCosts[phaseKey]=effortCosts;
      }
    } catch(e) { console.warn('Effort fetch error:', e); }
  }

  const costPerMD = totalEstMDs > 0 ? totalEstCostSAR / totalEstMDs : 0;
  const finProfitPct = AppState._finalProfitPct?.[phaseKey];
  // If no saved profit%, calculate from budget: (revenue - est cost) / revenue
  const plannedProfitSAR = finProfitPct != null
    ? finProfitPct * totalRevSAR
    : (totalRevSAR - totalEstCostSAR);

  // Resolve effort data after possible API fetch above
  const effortMDsFinal   = AppState._effortMonthMDs?.[phaseKey]   || {};
  const effortCostsFinal = AppState._effortMonthCosts?.[phaseKey] || {};
  const monthsFinal      = AppState._effortMonths?.[phaseKey]     || [];

  // Avg Cost per MD from effort data
  let effortAvgCostPerMD = AppState._effortAvgCostPerMD?.[phaseKey];
  if (!effortAvgCostPerMD) {
    const allMDs   = Object.values(effortMDsFinal).reduce((s,v) => s+v, 0);
    const allCosts = Object.values(effortCostsFinal).reduce((s,v) => s+v, 0) * 3.75;
    effortAvgCostPerMD = allMDs > 0 ? allCosts / allMDs : costPerMD;
  }

  // ── 4. Issued Invoices: load monthly_cumulative per phase (once, cached) ──
  if (!AppState._invoiceCumulative) AppState._invoiceCumulative = {};
  if (!AppState._invoiceCumulative[phaseKey]) {
    // Load invoices from sales API grouped by variance tab
    try {
      if (!AppState._salesInvoicesByPhase) {
        const salesRes = await fetch('/api/sales-orders');
        if (salesRes.ok) {
          const salesData = await salesRes.json();
          if (salesData.invoices_by_phase) {
            AppState._salesInvoicesByPhase = salesData.invoices_by_phase;
          }
        }
      }
      if (AppState._salesInvoicesByPhase) {
        // Map variance tab → sales phase keys
        // BOG: development & consultation → 'development', support → 'support', license excluded
        // Non-BOG: services → 'development', support → 'support'
        const phaseMapping = {
          development:  ['development'],
          consultation: ['consultation'],
          services:     ['development', 'consultation'],  // non-BOG: services gets dev+consult
          support:      ['support'],
        };
        const matchPhases = phaseMapping[phaseKey] || [phaseKey];

        const monthly = {};
        for (const [srcPhase, phaseData] of Object.entries(AppState._salesInvoicesByPhase)) {
          // Skip license — not part of variance profitability
          if (srcPhase === 'license') continue;
          if (!matchPhases.includes(srcPhase)) continue;
          for (const [mk, v] of Object.entries(phaseData)) {
            monthly[mk] = (monthly[mk] || 0) + (v.month || 0);
          }
        }
        // Build cumulative
        let running = 0;
        const cum = {};
        for (const mk of Object.keys(monthly).sort()) {
          running += monthly[mk];
          cum[mk] = running;
        }
        if (Object.keys(cum).length) {
          AppState._invoiceCumulative[phaseKey] = cum;
        }
      }
    } catch(e) { console.warn('Sales invoice load error:', e); }

    if (!AppState._invoiceCumulative[phaseKey]) AppState._invoiceCumulative[phaseKey] = {};
  }

  const table = document.getElementById(`profit-table-${phaseKey}`);
  if (!table) return;
  const rows = table.querySelectorAll('tr[data-month-key]');
  let accActualMDs=0, latestData={}, prevViAcc=0;

  let rowIdx = 0;
  for (const tr of rows) {
    const idx = rowIdx++;
    const monthKey = tr.dataset.monthKey;
    const thisMonthMDs = effortMDsFinal[monthKey] || 0;
    accActualMDs += thisMonthMDs;
    const actualMDs = accActualMDs;

    const compInp = tr.querySelector('.completion-input');
    const remInp  = tr.querySelector('.remaining-input');
    const completionPct = parseFloat(compInp?.value) || 0;
    const remainingMDs  = parseFloat(remInp?.value)  || 0;

    // Current Cost = cumulative cost from effort (SAR)
    let accCostUSD = 0;
    monthsFinal.forEach(m2 => {
      if (m2.key <= monthKey) accCostUSD += effortCostsFinal[m2.key] || 0;
    });
    const currentCostSAR = accCostUSD * 3.75;  // effortCosts stored in USD
    // ── All equations per reference sheet ──
    const eacMDs = actualMDs + remainingMDs;

    // Expected Overrun = (Actual/EstMDs) / (%Comp/100) - 1
    const expectedOverrun = (completionPct > 0 && totalEstMDs > 0 && actualMDs > 0)
      ? (actualMDs / totalEstMDs) / (completionPct / 100) - 1 : null;


    // Avg cost per MD for this month = Current Cost SAR / Actual MDs to Date (running)
    // This is the "current effort average" - changes each month as more data comes in
    const thisMonthAvgCostPerMD = actualMDs > 0 ? currentCostSAR / actualMDs : (effortAvgCostPerMD || costPerMD);

    // Est Cost to Complete = Remaining MDs × this month's avg cost per MD
    const estCostToComplete = remainingMDs * thisMonthAvgCostPerMD;
    const estAtCompletion   = estCostToComplete + currentCostSAR;
    const cpi               = estAtCompletion > 0 ? totalEstCostSAR / estAtCompletion : 0;
    const costVarianceSAR   = totalEstCostSAR - estAtCompletion;
    const costVariancePct   = totalRevSAR > 0 ? costVarianceSAR / totalRevSAR * 100 : 0;
    const revToDate         = totalRevSAR * (completionPct / 100);
    const profitAtComp      = totalRevSAR - estAtCompletion;
    const profitAtCompPct   = totalRevSAR > 0 ? profitAtComp / totalRevSAR * 100 : 0;

    // Planned Profit - from Final Budget, per-month history
    // Use month-specific override if budget changed that month, else use latest
    const monthPlannedPct = (AppState._plannedProfitHistory?.[phaseKey]?.[monthKey]) 
      ?? (AppState._finalProfitPct?.[phaseKey] ?? (totalRevSAR > 0 ? (totalRevSAR - totalEstCostSAR) / totalRevSAR : 0));
    const plannedProfitMonthSAR = monthPlannedPct * totalRevSAR;

    // Profitability Variance = Profit at Completion - Planned Profit SAR
    const profVar    = profitAtComp - plannedProfitMonthSAR;
    // Profitability Variance % = Profit at Comp % - Planned Profit %
    const profVarPct = profitAtCompPct - (monthPlannedPct * 100);
    // Progress % = Current Cost / EAC Cost
    const progressPct        = estAtCompletion > 0 ? currentCostSAR / estAtCompletion * 100 : 0;

    // Virtual Invoice
    const viThisMonth = revToDate;                                          // = Revenue to Date this month
    const viAcc       = revToDate;                                          // = cumulative recognized revenue

    // Helper to format SAR
    const fSAR = v => fmt.money(Math.round(v));
    const fNum = v => fmt.decimal(v);
    const setSpan = (cls, val, color) => {
      const el = tr.querySelector(`.${cls}`);
      if (el) { el.innerHTML = val; if (color) el.style.color = color; }
    };

    // Presales display: each month shows values effective by that month's date
    const mRev  = _getMonthlyRev(monthKey);
    const mCost = _getMonthlyEstCost(monthKey);
    const mMDs  = _getMonthlyEstMDs(monthKey);
    tr.querySelectorAll(`.prof-rev-${phaseKey}`).forEach(el => el.textContent = mRev  > 0 ? fSAR(mRev)  : '—');
    tr.querySelectorAll(`.prof-estcost-${phaseKey}`).forEach(el => el.textContent = mCost > 0 ? fSAR(mCost) : '—');
    tr.querySelectorAll(`.prof-estmds-${phaseKey}`).forEach(el => el.textContent = mMDs  > 0 ? fNum(mMDs)  : '—');
    // Current effort columns
    tr.querySelectorAll(`.prof-thismonth-${phaseKey}`).forEach(el => el.textContent = thisMonthMDs > 0 ? fNum(thisMonthMDs) : '—');
    tr.querySelectorAll(`.prof-actual-${phaseKey}`).forEach(el => el.textContent = actualMDs > 0 ? fNum(actualMDs) : '—');

    // Computed columns
    setSpan(`pc-currcost-${monthKey}`,      currentCostSAR > 0 ? fSAR(currentCostSAR) : '—');
    setSpan(`pc-eac-${monthKey}`,           `<b style="color:var(--blue);">${fNum(eacMDs)}</b>`);
    const ovColor = (expectedOverrun !== null && expectedOverrun > 0) ? 'var(--red)' : 'var(--green)';
    setSpan(`pc-overrun-${monthKey}`, expectedOverrun !== null ? `<span style="color:${ovColor};">${fmt.decimal(expectedOverrun*100)}%</span>` : '—');
    setSpan(`pc-costtocomplete-${monthKey}`, estCostToComplete > 0 ? fSAR(estCostToComplete) : '—');
    setSpan(`pc-eac-cost-${monthKey}`,       estAtCompletion > 0 ? fSAR(estAtCompletion) : '—');

    const cpiColor = cpi >= 1 ? 'var(--green)' : cpi > 0 ? 'var(--amber)' : 'var(--text-muted)';
    setSpan(`pc-cpi-${monthKey}`,           cpi > 0 ? `<b style="color:${cpiColor};">${fNum(cpi)}</b>` : '—');

    const varColor = costVarianceSAR >= 0 ? 'var(--green)' : 'var(--red)';
    setSpan(`pc-variance-${monthKey}`,      `<span style="color:${varColor};">${fSAR(costVarianceSAR)}</span>`);
    setSpan(`pc-variance-pct-${monthKey}`,  `<span style="color:${varColor};">${fmt.decimal(costVariancePct)}%</span>`);

    const profColor2 = profitAtComp > 0 ? 'var(--green)' : 'var(--red)';
    setSpan(`pc-profit-comp-${monthKey}`,   `<b style="color:${profColor2};">${fSAR(profitAtComp)}</b>`);
    setSpan(`pc-planned-profit-${monthKey}`, 
      `${fSAR(plannedProfitMonthSAR)} <span style="font-size:10px;color:var(--text-muted);">(${fmt.decimal(monthPlannedPct*100)}%)</span>`);
    setSpan(`pc-profit-pct-${monthKey}`,    `<b style="color:${profColor2};">${fmt.decimal(profitAtCompPct)}%</b>`);

    const pvColor = profVar >= 0 ? 'var(--green)' : 'var(--red)';
    setSpan(`pc-prof-var-${monthKey}`,      `<span style="color:${pvColor};">${fSAR(profVar)}</span>`);
    setSpan(`pc-prof-var-pct-${monthKey}`,  `<span style="color:${pvColor};">${fmt.decimal(profVarPct)}%</span>`);

    const recognizedRev  = totalRevSAR * (completionPct / 100);  // = Revenue to Date
    const progressPct2   = estAtCompletion > 0 ? currentCostSAR / estAtCompletion * 100 : 0;

    // Virtual Invoice
    // Issued invoices: use cumulative up to this month from API (not total)
    const prevMonthKey = months[idx - 1]?.key;
    const prevRecogRev = prevMonthKey ? (AppState._profRecogRev?.[phaseKey]?.[prevMonthKey] || 0) : 0;
    const prevAccVI    = prevMonthKey ? (AppState._profAccVI?.[phaseKey]?.[prevMonthKey] || 0) : 0;

    // _invoiceCumulative[phaseKey] = { 'YYYY-MM': cumulativeIssuedSAR }
    // Loaded once before the row loop (see profRecomputeAll)
    const invCum = AppState._invoiceCumulative?.[phaseKey] || {};
    // Find the cumulative issued amount up to this month
    // Use exact month match or last available month <= monthKey
    let issuedUpToMonth = 0;
    const cumMonths = Object.keys(invCum).sort();
    for (const mk of cumMonths) {
      if (mk <= monthKey) issuedUpToMonth = invCum[mk];
    }

    const production  = recognizedRev - prevRecogRev;
    // Acc. VI = Recognized Revenue to Date − Cumulative Issued Invoices up to this month
    const accVI       = recognizedRev - issuedUpToMonth;
    const thisMonthVI = accVI - prevAccVI;
    // VI + Issued = total billing picture
    const viPlusIssued = accVI + issuedUpToMonth;

    // Save for next month's calculation
    if (!AppState._profRecogRev) AppState._profRecogRev = {};
    if (!AppState._profRecogRev[phaseKey]) AppState._profRecogRev[phaseKey] = {};
    if (!AppState._profAccVI) AppState._profAccVI = {};
    if (!AppState._profAccVI[phaseKey]) AppState._profAccVI[phaseKey] = {};
    AppState._profRecogRev[phaseKey][monthKey] = recognizedRev;
    AppState._profAccVI[phaseKey][monthKey]    = accVI;

    setSpan(`pc-rev-todate-${monthKey}`,   completionPct > 0 ? fSAR(recognizedRev) : '—');
    setSpan(`pc-progress-${monthKey}`,     progressPct2 > 0 ? `${fmt.decimal(progressPct2)}%` : '—');
    setSpan(`pc-production-${monthKey}`,   production !== 0 ? fSAR(production) : '—');
    setSpan(`pc-vi-acc-${monthKey}`,       fSAR(accVI));
    setSpan(`pc-vi-month-${monthKey}`,     thisMonthVI !== 0 ? fSAR(thisMonthVI) : '—');
    // Show issued invoices column if it exists
    const issuedEl = tr.querySelector(`.pc-issued-${monthKey}`);
    if (issuedEl) issuedEl.textContent = issuedUpToMonth > 0 ? fSAR(issuedUpToMonth) : '—';

    // Only update latestData if this month has a % completion or remaining entry
    if (completionPct || remainingMDs) {
      latestData = { completionPct, remainingMDs, eacMDs, cpi, profitAtComp, totalRevSAR, monthKey,
                     eacCostSAR: estAtCompletion, currentCostSAR };
    }
    if (!AppState._varianceMonthData) AppState._varianceMonthData = {};
    if (!AppState._varianceMonthData[phaseKey]) AppState._varianceMonthData[phaseKey] = [];
    if (completionPct || remainingMDs || actualMDs) {
      AppState._varianceMonthData[phaseKey].push({
        month: monthKey,
        variancePct: expectedOverrun !== null ? expectedOverrun * 100 : 0,
        actualMDs: actualMDs || 0, completionPct: completionPct || 0,
        remainingMDs: remainingMDs || 0, eacMDs: eacMDs || 0,
        currentCostSAR: currentCostSAR || 0, estAtCompletion: estAtCompletion || 0,
        cpi: cpi || 0, costVarianceSAR: costVarianceSAR || 0,
        profitAtComp: profitAtComp || 0,
        progressPct: progressPct || 0, virtualInvoice: viAcc || 0,
      });
    }
    prevViAcc = viAcc;
  }  // end for..of rows

  // Update KPI strip with last month that has actual values
  const setKPI = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  const kpiMonthLabel = latestData.monthKey ? `as of ${latestData.monthKey}` : 'latest month';
  const kpiFootEl = document.querySelector(`#prof-kpi-${phaseKey} .kpi-foot`);
  if (kpiFootEl) kpiFootEl.textContent = kpiMonthLabel;
  setKPI(`prof-kpi-completion-${phaseKey}`, latestData.completionPct ? fmt.decimal(latestData.completionPct) + '%' : '—');
  setKPI(`prof-kpi-remaining-${phaseKey}`,  latestData.remainingMDs  ? fmt.decimal(latestData.remainingMDs) : '—');
  setKPI(`prof-kpi-eac-${phaseKey}`,        latestData.eacMDs        ? fmt.decimal(latestData.eacMDs) : '—');
  setKPI(`prof-kpi-cpi-${phaseKey}`,        latestData.cpi           ? fmt.decimal(latestData.cpi) : '—');
  setKPI(`prof-kpi-profit-${phaseKey}`,     latestData.profitAtComp  ? fmt.money(Math.round(latestData.profitAtComp)) + ' SAR' : '—');

  // Save to AppState so Overview can display latest profitability KPIs
  if (latestData.monthKey) {
    if (!AppState._latestProfData) AppState._latestProfData = {};
    AppState._latestProfData[phaseKey] = {
      completionPct:  latestData.completionPct,
      remainingMDs:   latestData.remainingMDs,
      eacMDs:         latestData.eacMDs,
      eacCostSAR:     latestData.eacCostSAR,
      currentCostSAR: latestData.currentCostSAR,
      cpi:            latestData.cpi,
      profitAtComp:   latestData.profitAtComp,
      monthKey:       latestData.monthKey,
    };
    // Notify Overview to update its KPIs
    if (window._overviewUpdateProfKPIs) window._overviewUpdateProfKPIs(phaseKey);
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
  });
  // Recompute after applying overrides
  profRecomputeAll(phaseKey);
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
        <button style="font-size:11px;padding:6px 14px;background:#FEF3C7;border:1px solid #F59E0B;color:#92400E;border-radius:6px;cursor:pointer;font-weight:600;" onclick="checkUnassignedHours('${phaseKey}')">⚠ Unassigned Hours</button>
      </div>
      <div id="unassigned-banner-${phaseKey}"></div>
      <div id="${containerId}"><div class="loading">Loading from Odoo…</div></div>
    </div>
  `;
}

async function checkUnassignedHours(phaseKey) {
  const banner = document.getElementById(`unassigned-banner-${phaseKey}`);
  if (!banner) return;
  banner.innerHTML = '<div class="loading" style="padding:8px;">Checking unassigned hours…</div>';
  try {
    const res = await fetch(`/api/effort/${phaseKey}/unassigned-hours`);
    const d   = await res.json();

    if (!d.ok || d.total_hours === 0) {
      banner.innerHTML = `<div style="background:#D1FAE5;border:1px solid #6EE7B7;border-radius:8px;padding:10px 14px;margin-bottom:10px;font-size:12px;color:#065F46;">
        ✅ All hours are assigned to phases. No unassigned timesheets found.
      </div>`;
      setTimeout(() => banner.innerHTML = '', 3000);
      return;
    }

    const fmtH = h => new Intl.NumberFormat('en-US',{maximumFractionDigits:1}).format(h);
    const empRows = (d.employees||[]).slice(0,8).map(e =>
      `<span style="background:#F3F4F6;border-radius:4px;padding:3px 8px;font-size:11px;">${e.name} — ${fmtH(e.hours)}h</span>`
    ).join(' ');

    banner.innerHTML = `
      <div style="background:#FEF3C7;border:1px solid #FCD34D;border-radius:8px;padding:14px 16px;margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
          <div>
            <div style="font-size:13px;font-weight:700;color:#92400E;">⚠ ${fmtH(d.total_hours)}h (${fmtH(d.total_mds)} MDs) not assigned to any phase</div>
            <div style="font-size:11px;color:#92400E;margin-top:3px;">These timesheets exist on project tasks with no phase — not counted in Current Effort above</div>
          </div>
          <button onclick="document.getElementById('unassigned-banner-${phaseKey}').innerHTML=''"
            style="background:none;border:none;cursor:pointer;color:#92400E;font-size:18px;padding:0;">×</button>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">${empRows}</div>
        <div style="font-size:11px;color:#92400E;margin-bottom:10px;">What would you like to do with these hours?</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button onclick="addUnassignedToPhase('${phaseKey}','services')"
            style="background:#2563EB;color:white;border:none;border-radius:6px;padding:7px 16px;font-size:12px;font-weight:600;cursor:pointer;">
            ➕ Add to Services
          </button>
          <button onclick="addUnassignedToPhase('${phaseKey}','support')"
            style="background:#D97706;color:white;border:none;border-radius:6px;padding:7px 16px;font-size:12px;font-weight:600;cursor:pointer;">
            ➕ Add to Support
          </button>
          <button onclick="document.getElementById('unassigned-banner-${phaseKey}').innerHTML=''"
            style="background:#F3F4F6;color:#374151;border:1px solid #D1D5DB;border-radius:6px;padding:7px 16px;font-size:12px;cursor:pointer;">
            Cancel
          </button>
        </div>
      </div>`;
  } catch(e) {
    banner.innerHTML = `<div style="color:var(--red);font-size:12px;padding:8px;">Error: ${e.message}</div>`;
  }
}

async function addUnassignedToPhase(currentPhase, targetPhase) {
  const banner = document.getElementById(`unassigned-banner-${currentPhase}`);
  if (banner) banner.innerHTML = '<div style="padding:8px;font-size:12px;color:#6B7280;">Saving…</div>';
  try {
    // Save override: include unassigned hours in this phase
    await fetch('/api/plan-overrides', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ phase: targetPhase, month_key: 'unassigned', field: 'include_unassigned', value: true })
    });
    if (banner) banner.innerHTML = `
      <div style="background:#D1FAE5;border:1px solid #6EE7B7;border-radius:8px;padding:10px 14px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;">
        <span style="font-size:12px;color:#065F46;font-weight:600;">✅ Unassigned hours will now be included in <b>${targetPhase}</b> Current Effort</span>
        <button onclick="document.getElementById('unassigned-banner-${currentPhase}').innerHTML=''"
          style="background:none;border:none;cursor:pointer;color:#065F46;font-size:16px;">×</button>
      </div>`;
    // Reload effort for target phase
    const containerId = `effort-live-${targetPhase}`;
    if (document.getElementById(containerId)) {
      await loadEffortLive(targetPhase, containerId);
    }
  } catch(e) {
    if (banner) banner.innerHTML = `<div style="color:var(--red);font-size:12px;padding:8px;">Error: ${e.message}</div>`;
  }
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
        <th class="num" style="border-left: 2px solid var(--border-strong); font-size: 9px;">Regular (MH)</th>
        <th class="num" style="font-size: 9px;">Ramadan Hours</th>
        <th class="num" style="font-size: 9px;">Overtime (MH)</th>
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
              <th rowspan="2" class="num" style="border-left: 2px solid var(--border-strong);">Total Cost ($)</th>
              <th rowspan="2" class="num">Current MDs done</th>
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

    // Per-month MD totals for TOTAL row + profitability
    const monthMDTotals = {};
    const monthCostTotals = {};
    months.forEach(m => { monthMDTotals[m.key] = 0; monthCostTotals[m.key] = 0; });

    d.employees.forEach((emp, idx) => {
      grandTotalCost += emp.total_cost_usd || 0;
      grandTotalHours += emp.total_hours || 0;
      grandTotalMDs += emp.current_mds || 0;

      // Accumulate per-month MDs and costs
      months.forEach(m => {
        const cell = emp.months?.[m.key] || { regular: 0, ramadan: 0, overtime: 0 };
        const monthMDs = (cell.regular + cell.overtime) / 8 + cell.ramadan / 6;
        monthMDTotals[m.key] += monthMDs;
        // Cost for this month
        const hr  = parseFloat(emp.hour_rate)  || 0;
        const otr = parseFloat(emp.overtime_rate) || hr * 1.5;
        if (!monthCostTotals[m.key]) monthCostTotals[m.key] = 0;
        if (hr > 0) {
          monthCostTotals[m.key] += (cell.regular + cell.ramadan) * hr + cell.overtime * otr;
        } else {
          // Fallback: distribute total_cost_usd proportionally
          const totalH = cell.regular + cell.ramadan + cell.overtime;
          const empTotalH = emp.total_hours || 1;
          monthCostTotals[m.key] += (emp.total_cost_usd || 0) * (totalH / empTotalH);
        }
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
    // Save for profitability to use
    if (!AppState._effortAvgCostPerMD) AppState._effortAvgCostPerMD = {};
    AppState._effortAvgCostPerMD[phaseKey] = avgCostPerMD;
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
  return `<div id="estimatedLiveWrap">
    <div class="loading">Loading estimated cost…</div>
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
  if (!wrap) { console.warn('estimatedLiveWrap not found for', phaseKey); return; }
  wrap.innerHTML = '<div class="loading">Loading estimated cost…</div>';

  // Non-BOG: try to load saved summary first
  const isBog = AppState._overviewData?.is_bog !== false;
  if (!isBog) {
    if (window.estLoadSummaryIfSaved) {
      const loaded = await estLoadSummaryIfSaved(phaseKey, wrap.id);
      if (loaded) return;
    }
    // No saved summary — show upload prompt
    wrap.innerHTML = `
      <div style="text-align:center;padding:40px;color:#6B7280;">
        <div style="font-size:32px;margin-bottom:12px;">📊</div>
        <div style="font-size:14px;font-weight:600;margin-bottom:8px;">No Estimated Cost data yet</div>
        <div style="font-size:12px;margin-bottom:16px;">Upload the Estimated Cost Excel file</div>
        <label style="cursor:pointer;">
          <input type="file" accept=".xlsx,.xls" style="display:none;"
            onchange="estImportExcel(this,'${phaseKey}')">
          <span style="background:#3B82F6;color:white;padding:10px 20px;border-radius:8px;
                       font-size:13px;font-weight:600;cursor:pointer;">⬆ Upload Excel</span>
        </label>
      </div>`;
    return;
  }

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
  // After estimated loads, update budget calculations
  setTimeout(() => budgetAutoCalc(phaseKey), 50);
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
          ${!AppState._overviewData?.is_bog ? `<label style="cursor:pointer;" title="Import positions from Excel">
            <input type="file" accept=".xlsx,.xls" style="display:none;" onchange="estImportExcel(this,'${phaseKey}')">
            <span class="btn-outline" style="font-size:11px;cursor:pointer;">⬆ Import Excel</span>
          </label>` : ''}
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
              <th class="num">Est. # of Months</th>
              <th class="num">Total Cost USD</th>
              <th class="num">Total No of MDs</th>
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
  const cont = document.getElementById('variance-travel-cont');
  if (!cont) return;
  cont.innerHTML = `
    <div class="banner banner-info" style="display:flex;align-items:center;gap:16px;">
      <span style="font-size:20px;">✈️</span>
      <div>
        <strong>Travel & Onsite records are now managed centrally.</strong><br>
        <span style="font-size:13px;">Go to <a href="/manage" style="color:var(--blue);font-weight:600;">⚙ Manage → Travel Records</a> to view, add, or import travel data.</span>
      </div>
    </div>`;
}

async function loadTravelRecords() { {
  let d = { records: [] };
  try {
    const res = await fetch('/api/travel');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    d = await res.json();
  } catch(e) {
    console.error('Travel API error:', e);
  }
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
  const cont = document.getElementById('variance-promotions-cont');
  if (!cont) return;
  cont.innerHTML = `
    <div class="banner banner-info" style="display:flex;align-items:center;gap:16px;">
      <span style="font-size:20px;">🏆</span>
      <div>
        <strong>Promotions are now managed centrally.</strong><br>
        <span style="font-size:13px;">Go to <a href="/manage" style="color:var(--blue);font-weight:600;">⚙ Manage → Promotions</a> to view, add, or import promotion data.</span>
      </div>
    </div>`;
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

}

// ─── PMO Variance Export ──────────────────────────────────────────────
async function exportVariancePMO() {
  const btn = document.getElementById('varianceExport');
  const orig = btn ? btn.textContent : '';
  if (btn) { btn.textContent = '⏳ Generating...'; btn.disabled = true; }
  try {
    const isBog = AppState._overviewData?.is_bog !== false;
    const phaseKeys = isBog ? ['development','consultation'] : ['services','support'];
    const phases = phaseKeys.map(k => ({
      phase: k,
      latestData: AppState._latestProfData?.[k] || {},
      months: AppState._varianceMonthData?.[k] || [],
    }));
    const body = {
      project_name: AppState._overviewData?.project_name || 'Project',
      generated: new Date().toISOString().slice(0,10),
      phases,
    };
    const res = await fetch('/api/variance/export-pmo', {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body),
    });
    if (!res.ok) throw new Error('Server error ' + res.status);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const cd = res.headers.get('Content-Disposition') || '';
    a.download = cd.match(/filename="?([^"]+)"?/)?.[1] || 'variance_report.xlsx';
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  } catch(e) { alert('Export failed: ' + e.message); }
  finally { if (btn) { btn.textContent = orig || '⬇ Export Excel'; btn.disabled = false; } }
}
