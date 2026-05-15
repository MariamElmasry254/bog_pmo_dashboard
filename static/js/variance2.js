// variance2.js — Estimated Cost summary import for non-BOG projects
// Reads summary data from Excel (Total MDs, Cost SAR, etc.) per sheet/tab

// ── Upload handler ──
async function estImportExcel(input, phaseKey) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';

  const wrap = document.getElementById('estimatedLiveWrap');
  if (wrap) wrap.innerHTML = '<div class="loading">Reading Excel sheets…</div>';

  const form = new FormData();
  form.append('file', file);
  form.append('phase', phaseKey || window._estPhase || 'development');

  try {
    // Step 1: Get sheet list
    const res = await fetch('/api/estimated-rows/import-summary-excel', { method: 'POST', body: form });
    const d   = await res.json();

    if (!d.ok) {
      alert('Error: ' + (d.error || 'Unknown'));
      if (wrap) wrap.innerHTML = '';
      return;
    }

    if (d.needs_sheet_selection && d.sheets) {
      // Step 2: Ask user which sheet
      _showSheetPicker(file, d.sheets, phaseKey || window._estPhase || 'development');
    } else if (d.summary) {
      // Direct result (sheet was specified)
      _renderEstSummary(d.summary, d.phase, wrap);
    }
  } catch (e) {
    alert('Error: ' + e.message);
    if (wrap) wrap.innerHTML = '';
  }
}

// ── Sheet picker modal ──
function _showSheetPicker(file, sheets, phase) {
  // Remove existing picker
  const existing = document.getElementById('sheetPickerModal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'sheetPickerModal';
  modal.style.cssText = `position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.5);
    display:flex;align-items:center;justify-content:center;`;

  const box = document.createElement('div');
  box.style.cssText = `background:white;border-radius:12px;padding:24px;width:480px;max-width:95vw;
    max-height:80vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.3);`;

  box.innerHTML = `
    <div style="font-size:16px;font-weight:700;color:#1E3A5F;margin-bottom:6px;">📊 Select Sheet</div>
    <div style="font-size:12px;color:#6B7280;margin-bottom:16px;">
      Choose the tab that matches this project's Estimated Cost data:
    </div>
    <div id="sheetList" style="display:flex;flex-direction:column;gap:6px;margin-bottom:16px;">
      ${sheets.map(s => `
        <button onclick="_pickSheet(this,'${s.replace(/'/g,"\\'")}','${phase}')"
          style="text-align:left;padding:10px 14px;border:1px solid #D1D5DB;border-radius:8px;
                 background:white;cursor:pointer;font-size:13px;font-weight:500;
                 transition:all .15s;"
          onmouseover="this.style.background='#EFF6FF';this.style.borderColor='#3B82F6'"
          onmouseout="this.style.background='white';this.style.borderColor='#D1D5DB'">
          ${s}
        </button>`).join('')}
    </div>
    <button onclick="document.getElementById('sheetPickerModal').remove()"
      style="width:100%;padding:8px;border:1px solid #D1D5DB;border-radius:8px;
             background:white;cursor:pointer;font-size:13px;color:#6B7280;">
      Cancel
    </button>`;

  modal.appendChild(box);
  document.body.appendChild(modal);

  // Store file reference for when sheet is picked
  window._pendingEstFile = file;
}

async function _pickSheet(btn, sheet, phase) {
  btn.style.background = '#DBEAFE';
  btn.textContent = '⏳ Loading…';
  btn.disabled = true;

  const file = window._pendingEstFile;
  if (!file) return;

  const form = new FormData();
  form.append('file', file);
  form.append('phase', phase);
  form.append('sheet', sheet);

  try {
    const res = await fetch('/api/estimated-rows/import-summary-excel', { method: 'POST', body: form });
    const d   = await res.json();
    document.getElementById('sheetPickerModal')?.remove();
    window._pendingEstFile = null;

    if (!d.ok) { alert('Error: ' + (d.error || 'Unknown')); return; }

    const wrap = document.getElementById('estimatedLiveWrap');
    if (wrap) _renderEstSummary(d.summary, d.phase, wrap);

    // Trigger budget recalc
    setTimeout(() => { if (window.budgetAutoCalc) budgetAutoCalc(phase); }, 200);
  } catch (e) {
    alert('Error: ' + e.message);
    document.getElementById('sheetPickerModal')?.remove();
  }
}

// ── Render summary card ──
function _renderEstSummary(summary, phase, wrap) {
  if (!summary || !Object.keys(summary).length) {
    wrap.innerHTML = '<div class="loading">No summary data found</div>';
    return;
  }

  const fmtSAR = v => v ? new Intl.NumberFormat('en-US', {maximumFractionDigits:0}).format(v) + ' SAR' : '—';
  const fmtUSD = v => v ? '$' + new Intl.NumberFormat('en-US', {maximumFractionDigits:0}).format(v) : '—';
  const fmtNum = v => v ? new Intl.NumberFormat('en-US', {maximumFractionDigits:2}).format(v) : '—';

  // Store in AppState so Budget section can use it
  if (!AppState._estSummary) AppState._estSummary = {};
  AppState._estSummary[phase] = summary;

  // Sync to estimated rows format for budget calc compatibility
  if (window._estPhase === phase || !window._estPhase) {
    window._estPhase = phase;
    // Build a single synthetic row representing the totals
    // so budgetAutoCalc can pick up the cost
    if (!window._estRows || !window._estRows.length) {
      // We'll use the summary directly via AppState
    }
  }

  wrap.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin-bottom:16px;">
      ${[
        ['Total Cost (SAR)',       fmtSAR(summary.total_cost_sar)],
        ['Total Cost (USD)',       fmtUSD(summary.total_cost_usd)],
        ['Total MDs',             fmtNum(summary.total_mds)],
        ['Cost per MD (SAR)',      fmtSAR(summary.cost_per_md_sar)],
        ['Est. MDs / Month',      fmtNum(summary.est_mds_per_month)],
        ['Cost per Month (SAR)',   fmtSAR(summary.total_sar_per_month)],
        ['Cost per Month (USD)',   fmtUSD(summary.total_usd_per_month)],
      ].map(([label, val]) => `
        <div style="background:white;border:1px solid #E5E7EB;border-radius:8px;padding:14px;">
          <div style="font-size:10px;font-weight:700;color:#6B7280;text-transform:uppercase;
                      letter-spacing:.4px;margin-bottom:4px;">${label}</div>
          <div style="font-size:18px;font-weight:700;color:#1E3A5F;">${val}</div>
        </div>`).join('')}
    </div>
    <div style="background:#F0FDF4;border:1px solid #A7F3D0;border-radius:8px;padding:12px;
                display:flex;align-items:center;justify-content:space-between;">
      <span style="font-size:12px;color:#065F46;">✅ Estimated Cost imported from Excel</span>
      <label style="cursor:pointer;">
        <input type="file" accept=".xlsx,.xls" style="display:none;"
          onchange="estImportExcel(this,'${phase}')">
        <span style="font-size:12px;color:#2563EB;cursor:pointer;text-decoration:underline;">
          ↺ Update from Excel
        </span>
      </label>
    </div>`;

  // Update budget KPIs with summary data
  _syncSummaryToBudget(summary, phase);
}

// ── Sync summary to budget display ──
function _syncSummaryToBudget(summary, phase) {
  const setEl = (id, val) => { const el=document.getElementById(id); if(el) el.textContent=val; };
  const fmt = n => new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(n||0);

  const costSAR = summary.total_cost_sar || 0;
  const costUSD = summary.total_cost_usd || 0;
  const mds     = summary.total_mds || 0;

  setEl(`bud-mds-${phase}`,      fmt(mds));
  setEl(`bud-cost-usd-${phase}`, '$' + fmt(costUSD));
  setEl(`bud-cost-sar-${phase}`, fmt(costSAR) + ' SAR');
  setEl(`kpi-mds-${phase}`,      fmt(mds));
  setEl(`kpi-cost-${phase}`,     fmt(costSAR));

  // Store for profitability calculations
  if (!AppState._estSummaryByCost) AppState._estSummaryByCost = {};
  AppState._estSummaryByCost[phase] = { costSAR, costUSD, mds };
}

// ── Auto-load saved summary on tab open ──
async function estLoadSummaryIfSaved(phase, containerId) {
  try {
    const res = await fetch('/api/estimated-summary?phase=' + phase);
    const d   = await res.json();
    if (d.summary && Object.keys(d.summary).length) {
      const wrap = document.getElementById(containerId || 'estimatedLiveWrap');
      if (wrap) _renderEstSummary(d.summary, phase, wrap);
      return true;
    }
  } catch(e) {}
  return false;
}
