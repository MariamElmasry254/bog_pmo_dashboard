/* Sales Orders & Invoices Tab */

const _SUPP_KWS = ['support','operation','maintenance','hypercare','production','production activities','دعم','الدعم','تشغيل'];

function phaseOf(name) {
  const n = (name||'').toLowerCase();
  if (_SUPP_KWS.some(k => n.includes(k))) return 'support';
  if (n.includes('license') || n.includes('3rd party') || n.includes('third party') || n.includes('software')) return 'license';
  if (n.includes('consultation') || n.includes('consult')) return 'consultation';
  return 'development';
}

function phaseLabel(key) {
  return {development:'Development', consultation:'Consultation', support:'Support', license:'License (excl.)', services:'Services'}[key] || key;
}

function isVarPhase(key) {
  // License and 3rd party are excluded from variance profitability
  return key !== 'license';
}

window.loadSalesOrders = async function() {
  // Use the sales panel directly — salesContent is inside it
  const panel = document.getElementById('sales');
  const cont  = document.getElementById('salesContent') || panel;
  if (!cont) { console.error('No sales panel found'); return; }
  cont.innerHTML = '<div class="loading" style="padding:40px;text-align:center;">Loading Sales Orders from Odoo…</div>';

  // Load saved SO line → variance tab mapping from DB
  try {
    const mapRes = await fetch('/api/plan-overrides');
    if (mapRes.ok) {
      const mapData = await mapRes.json();
      const soMap = mapData.plan_overrides?.so_line_map || {};
      if (!window.AppState._soLineVarMap) window.AppState._soLineVarMap = {};
      for (const [lineId, fields] of Object.entries(soMap)) {
        if (fields.var_tab) window.AppState._soLineVarMap[lineId] = fields.var_tab;
      }
    }
  } catch(e) {}

  try {
    const res = await fetch('/api/sales-orders');
    const d   = await res.json();

    if (!d.ok) {
      cont.innerHTML = `<div class="banner banner-warn"><strong>Error:</strong> ${d.error}</div>`;
      return;
    }

    if (!d.orders || !d.orders.length) {
      // Show direct invoices if available
      if (d.direct_invoices && d.direct_invoices.length) {
        cont.innerHTML = renderDirectInvoices(d.direct_invoices, d.note, d.summary);
      } else {
        cont.innerHTML = `<div class="card" style="text-align:center;padding:40px;">
          <div style="font-size:32px;margin-bottom:12px;">📋</div>
          <div style="font-size:14px;font-weight:600;">No Sales Orders found for this project</div>
          ${d.note ? `<div style="font-size:12px;color:var(--text-muted);margin-top:8px;">${d.note}</div>` : ''}
        </div>`;
      }
      return;
    }

    const s = d.summary;
    const fSAR = v => new Intl.NumberFormat('en-US', {maximumFractionDigits:0}).format(v || 0);
    const fPct = v => `${(v||0).toFixed(1)}%`;

    // Collect unique phases from order lines (product names)
    const allPhases = [...new Set(d.orders.flatMap(o =>
      (o.lines||[]).map(l => phaseLabel(phaseOf(Array.isArray(l.product_id) ? l.product_id[1] : (l.name||''))))
    ))].sort();

    window._salesPhaseFilter = null; // null = all

    // KPI strip
    let html = `
      <div class="kpi-strip kpi-strip-small" style="margin-bottom:20px;">
        <div class="kpi-card kpi-navy compact">
          <div class="kpi-label">TOTAL ORDERS</div>
          <div class="kpi-value">${s.total_orders}</div>
        </div>
        <div class="kpi-card kpi-blue compact">
          <div class="kpi-label">TOTAL VALUE (excl. VAT)</div>
          <div class="kpi-value">${fSAR(s.total_untaxed)}</div>
          <div class="kpi-foot">SAR</div>
        </div>
        <div class="kpi-card kpi-green compact">
          <div class="kpi-label">TOTAL INVOICED</div>
          <div class="kpi-value">${fSAR(s.total_invoiced)}</div>
          <div class="kpi-foot">${fPct(s.overall_invoiced_pct)} of total</div>
        </div>
        <div class="kpi-card kpi-amber compact">
          <div class="kpi-label">REMAINING</div>
          <div class="kpi-value">${fSAR(s.total_remaining)}</div>
          <div class="kpi-foot">SAR</div>
        </div>
      </div>`;

    // Phase filter bar
    if (allPhases.length > 1) {
      html += `<div style="display:flex;gap:8px;margin-bottom:16px;align-items:center;">
        <span style="font-size:11px;color:var(--text-muted);font-weight:600;">FILTER BY PHASE:</span>
        <button onclick="setSalesPhase(null,this)" class="so-phase-btn" style="font-size:11px;padding:4px 12px;border-radius:4px;border:1px solid var(--navy);background:var(--navy);color:white;cursor:pointer;">All</button>
        ${allPhases.map(p => `<button onclick="setSalesPhase('${p}',this)" class="so-phase-btn" style="font-size:11px;padding:4px 12px;border-radius:4px;border:1px solid var(--border);background:var(--bg-subtle);cursor:pointer;">${p}</button>`).join('')}
      </div>`;
    }

    // Orders table
    html += `
      <div class="card" style="margin-bottom:20px;">
        <h3 class="card-title" style="margin-bottom:16px;">Sales Orders</h3>
        <div class="table-scroll">
          <table class="data-table" style="font-size:12px;">
            <thead>
              <tr>
                <th>SO Number</th>
                <th>Customer</th>
                <th>Date</th>
                <th>Status</th>
                <th class="num">Amount (excl. VAT)</th>
                <th class="num">VAT</th>
                <th class="num">Total (incl. VAT)</th>
                <th class="num">Delivered %</th>
                <th class="num">Invoiced</th>
                <th class="num">Remaining</th>
                <th></th>
              </tr>
            </thead>
            <tbody>`;

    d.orders.forEach(o => {
      const statusColor = o.state === 'sale' ? 'var(--green)' : o.state === 'done' ? 'var(--blue)' : 'var(--text-muted)';
      const statusLabel = o.state === 'sale' ? 'Confirmed' : o.state === 'done' ? 'Done' : o.state === 'draft' ? 'Quotation' : o.state;
      const invColor    = o.invoiced_pct >= 100 ? 'var(--green)' : o.invoiced_pct > 0 ? 'var(--amber)' : 'var(--text-muted)';
      const invStatus   = o.invoice_status === 'invoiced' ? '✅ Fully Invoiced' : o.invoice_status === 'to invoice' ? '⏳ To Invoice' : o.invoice_status === 'nothing' ? '—' : o.invoice_status;

      html += `<tr>
        <td><b>${o.name}</b></td>
        <td style="color:var(--text-muted);font-size:11px;">${o.partner || '—'}</td>
        <td style="font-family:var(--mono);font-size:11px;">${o.date || '—'}</td>
        <td><span style="font-size:11px;font-weight:600;color:${statusColor};">${statusLabel}</span></td>
        <td class="num"><b>${fSAR(o.amount_untaxed)}</b></td>
        <td class="num" style="color:var(--text-muted);">${fSAR(o.amount_tax)}</td>
        <td class="num">${fSAR(o.amount_total)}</td>
        <td class="num">
          <div style="display:flex;align-items:center;gap:6px;justify-content:flex-end;">
            <div style="width:50px;height:5px;background:#F3F4F6;border-radius:3px;">
              <div style="width:${Math.min(100,o.delivered_pct)}%;height:100%;background:var(--blue);border-radius:3px;"></div>
            </div>
            <span>${fPct(o.delivered_pct)}</span>
          </div>
        </td>
        <td class="num" style="color:${invColor};">
          ${fSAR(o.invoiced_amt)}<br>
          <span style="font-size:10px;">${invStatus}</span>
        </td>
        <td class="num" style="color:${o.remaining > 0 ? 'var(--amber)' : 'var(--green)'};">
          <b>${fSAR(o.remaining)}</b>
        </td>
        <td style="white-space:nowrap;display:flex;gap:6px;">
          <button onclick="toggleSODetail('so-lines-${o.id}')"
            style="font-size:11px;padding:3px 10px;background:#EFF6FF;border:1px solid #BFDBFE;color:#1D4ED8;border-radius:4px;cursor:pointer;font-weight:600;">
            📋 ${o.lines.length} line${o.lines.length !== 1 ? 's' : ''}
          </button>
          <button onclick="toggleSODetail('so-inv-${o.id}')"
            style="font-size:11px;padding:3px 10px;background:var(--bg-subtle);border:1px solid var(--border);border-radius:4px;cursor:pointer;">
            🧾 ${o.invoices.length} invoice${o.invoices.length !== 1 ? 's' : ''}
          </button>
        </td>
      </tr>
      <tr id="so-lines-${o.id}" style="display:none;">
        <td colspan="11" style="padding:0 8px 12px 32px;background:#F0F9FF;border-bottom:1px solid #BFDBFE;">
          ${renderSOLines(o.lines)}
        </td>
      </tr>
      <tr id="so-inv-${o.id}" style="display:none;">
        <td colspan="11" style="padding:0 8px 12px 32px;background:var(--bg-subtle);border-bottom:1px solid var(--border);">
          ${renderSOInvoices(o.invoices, o.name)}
        </td>
      </tr>`;
    });

    html += `</tbody></table></div></div>`;
    cont.innerHTML = html;

  } catch(e) {
    cont.innerHTML = `<div class="banner banner-warn"><strong>Error:</strong> ${e.message}</div>`;
  }
};

function renderSOLines(lines) {
  if (!lines || !lines.length) return '<p style="color:var(--text-muted);font-size:12px;padding:8px 0;">No order lines</p>';
  const fSAR = v => new Intl.NumberFormat('en-US', {maximumFractionDigits:0}).format(v || 0);
  const fNum = v => new Intl.NumberFormat('en-US', {maximumFractionDigits:1}).format(v || 0);

  let totalAmt = 0, totalDeliveredAmt = 0, totalInvoicedAmt = 0, totalRemainingAmt = 0;

  let rows = lines.map((l, idx) => {
    const amt          = l.price_subtotal    || 0;
    const deliveredAmt = l.delivered_amt     || 0;
    const invoicedAmt  = l.invoiced_amt      || 0;
    const remainingAmt = l.remaining_amt     || 0;
    const ordered      = l.product_uom_qty   || 0;
    const delPct       = amt > 0 ? deliveredAmt / amt * 100 : 0;
    const delColor     = delPct >= 100 ? 'var(--green)' : delPct > 0 ? 'var(--amber)' : 'var(--text-muted)';
    const invColor     = invoicedAmt >= amt ? 'var(--green)' : invoicedAmt > 0 ? 'var(--amber)' : 'var(--text-muted)';
    const lineInvs     = l.line_invoices || [];
    const lineId       = `line-inv-${l.id || idx}`;

    totalAmt          += amt;
    totalDeliveredAmt += deliveredAmt;
    totalInvoicedAmt  += invoicedAmt;
    totalRemainingAmt += remainingAmt;

    const prod = l.product_id ? (Array.isArray(l.product_id) ? l.product_id[1] : l.product_id) : '—';
    const disc = l.discount ? `<span style="font-size:10px;color:var(--red);">-${l.discount}%</span>` : '';

    const invBtn = lineInvs.length > 0
      ? `<button onclick="toggleSODetail('${lineId}')"
           style="font-size:10px;padding:2px 7px;background:#FEF3C7;border:1px solid #FCD34D;color:#92400E;border-radius:3px;cursor:pointer;margin-left:6px;">
           🧾 ${lineInvs.length}
         </button>` : '';

    // Variance tab mapping selector
    const isBog = window.AppState?._overviewData?.is_bog !== false;
    const varTabs = isBog
      ? ['development','consultation','support']
      : ['services','support'];
    const linePhaseKey = phaseOf(Array.isArray(l.product_id) ? l.product_id[1] : (l.name||''));
    const savedVarTab = (window.AppState?._soLineVarMap || {})[String(l.id)] || linePhaseKey;

    // License/3rd party: show badge only, no variance tab
    const varSelector = !isVarPhase(linePhaseKey)
      ? `<span style="font-size:10px;padding:2px 7px;background:#F3F4F6;border:1px solid #D1D5DB;color:#6B7280;border-radius:3px;margin-left:6px;">Excl. from Variance</span>`
      : `<select data-line-id="${l.id}" onchange="setSoLineVarTab(${l.id},this.value)"
          style="font-size:10px;padding:2px 4px;border:1px solid var(--border);border-radius:3px;margin-left:6px;background:var(--bg-subtle);">
          ${varTabs.map(t => `<option value="${t}" ${savedVarTab===t?'selected':''}>${phaseLabel(t)}</option>`).join('')}
        </select>`;

    const invDetail = lineInvs.length > 0 ? `
      <tr id="${lineId}" style="display:none;">
        <td colspan="8" style="padding:4px 8px 12px 32px;background:#FFFBEB;border-bottom:1px solid #FDE68A;">
          <table style="font-size:11px;width:100%;">
            <thead><tr style="color:var(--text-muted);font-size:10px;text-transform:uppercase;letter-spacing:.3px;">
              <th style="text-align:left;padding:4px 6px;">Invoice #</th>
              <th style="text-align:left;padding:4px 6px;">Issue Date</th>
              <th style="text-align:left;padding:4px 6px;">Purpose</th>
              <th style="text-align:right;padding:4px 6px;">Qty</th>
              <th style="text-align:right;padding:4px 6px;">Amount excl. VAT</th>
              <th style="text-align:right;padding:4px 6px;">VAT (15%)</th>
              <th style="text-align:right;padding:4px 6px;">Total incl. VAT</th>
            </tr></thead>
            <tbody>
              ${lineInvs.map(i => {
                const amtExcl = i.amount || 0;
                const vat     = Math.round(amtExcl * 0.15);
                const total   = amtExcl + vat;
                return `<tr style="border-top:1px solid #FEF3C7;">
                  <td style="padding:4px 6px;font-weight:700;color:var(--navy);">${i.move_name}</td>
                  <td style="padding:4px 6px;font-family:var(--mono);font-size:10px;">${i.inv_date || '—'}</td>
                  <td style="padding:4px 6px;color:var(--text-muted);font-size:10px;max-width:200px;white-space:normal;">${i.purpose || i.name || '—'}</td>
                  <td style="text-align:right;padding:4px 6px;">${fNum(i.qty)}</td>
                  <td style="text-align:right;padding:4px 6px;font-weight:600;color:var(--green);">${fSAR(amtExcl)}</td>
                  <td style="text-align:right;padding:4px 6px;color:var(--text-muted);">${fSAR(vat)}</td>
                  <td style="text-align:right;padding:4px 6px;font-weight:700;">${fSAR(total)}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </td>
      </tr>` : '';

    const linePhase = phaseLabel(phaseOf(Array.isArray(l.product_id) ? l.product_id[1] : (l.name||'')));
    const purpose = (l.name && l.name !== prod) ? l.name : '—';
    return `<tr style="cursor:default;" data-line-phase="${linePhase}" data-detail-id="${lineId}">
      <td style="max-width:160px;white-space:normal;">
        <div style="font-weight:600;font-size:12px;">${prod} ${invBtn}</div>
        <div style="margin-top:3px;">${varSelector}</div>
      </td>
      <td style="max-width:200px;white-space:normal;font-size:11px;color:var(--text-muted);">${purpose}</td>
      <td class="num">${fSAR(l.price_unit)} ${disc}</td>
      <td class="num">${fNum(ordered)}</td>
      <td class="num" style="color:${delColor};">
        ${fSAR(deliveredAmt)}
        <div style="width:36px;height:3px;background:#F3F4F6;border-radius:2px;display:inline-block;vertical-align:middle;margin-left:4px;">
          <div style="width:${Math.min(100,delPct)}%;height:100%;background:${delColor};border-radius:2px;"></div>
        </div>
      </td>
      <td class="num" style="color:${invColor};">${fSAR(invoicedAmt)}</td>
      <td class="num" style="color:${remainingAmt > 0 ? 'var(--amber)' : 'var(--green)'};">
        <b>${fSAR(remainingAmt)}</b>
      </td>
      <td class="num"><b>${fSAR(amt)}</b></td>
    </tr>${invDetail}`;
  }).join('');

  return `<table class="data-table" style="font-size:11px;margin-top:8px;width:100%;">
    <thead><tr>
      <th>Product</th>
      <th>Purpose / Description</th>
      <th class="num">Unit Price</th>
      <th class="num">Qty</th>
      <th class="num">Delivered (SAR)</th>
      <th class="num">Invoiced (SAR)</th>
      <th class="num">Remaining (SAR)</th>
      <th class="num">Total (SAR)</th>
    </tr></thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr style="background:var(--navy);color:white;font-weight:700;">
        <td colspan="4" style="padding:8px 12px;">TOTAL</td>
        <td class="num">${fSAR(totalDeliveredAmt)}</td>
        <td class="num">${fSAR(totalInvoicedAmt)}</td>
        <td class="num" style="color:#FCD34D;">${fSAR(totalRemainingAmt)}</td>
        <td class="num" style="color:#93C5FD;">${fSAR(totalAmt)}</td>
      </tr>
    </tfoot>
  </table>`;
}

function renderSOInvoices(invoices, soName) {
  if (!invoices || !invoices.length) {
    return `<p style="color:var(--text-muted);font-size:12px;padding:8px 0;">No invoices for ${soName}</p>`;
  }
  const fSAR = v => new Intl.NumberFormat('en-US', {maximumFractionDigits:0}).format(v || 0);
  const payColor = p => p === 'paid' ? 'var(--green)' : p === 'partial' ? 'var(--amber)' : p === 'not_paid' ? 'var(--red)' : 'var(--text-muted)';
  const payLabel = p => p === 'paid' ? '✅ Paid' : p === 'partial' ? '⚡ Partial' : p === 'not_paid' ? '❌ Unpaid' : p || '—';

  let html = `<table class="data-table" style="font-size:11px;margin-top:8px;width:100%;">
    <thead><tr>
      <th>Invoice #</th><th>Date</th><th>Due Date</th><th>Purpose</th>
      <th class="num">Amount (excl. VAT)</th><th class="num">VAT</th><th class="num">Total</th>
      <th>Status</th><th>Payment</th>
    </tr></thead><tbody>`;

  invoices.forEach(inv => {
    const stateLabel = inv.state === 'posted' ? 'Posted' : inv.state === 'draft' ? 'Draft' : inv.state;
    html += `<tr>
      <td><b>${inv.name}</b></td>
      <td style="font-family:var(--mono);">${inv.date || '—'}</td>
      <td style="font-family:var(--mono);">${inv.due_date || '—'}</td>
      <td style="font-size:10px;color:var(--text-muted);max-width:180px;white-space:normal;">${(inv.purpose||'').replace(/<[^>]+>/g,'').substring(0,120) || '—'}</td>
      <td class="num">${fSAR(inv.amount_untaxed)}</td>
      <td class="num" style="color:var(--text-muted);">${fSAR(inv.amount_tax)}</td>
      <td class="num"><b>${fSAR(inv.amount_total)}</b></td>
      <td><span style="font-size:10px;color:${inv.state==='posted'?'var(--green)':'var(--text-muted)'};">${stateLabel}</span></td>
      <td><span style="font-size:10px;font-weight:600;color:${payColor(inv.payment_state)};">${payLabel(inv.payment_state)}</span></td>
    </tr>`;
  });

  html += '</tbody></table>';
  return html;
}

function toggleSODetail(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.display = el.style.display === 'none' ? '' : 'none';
}


window.setSalesPhase = function(phase, btn) {
  window._salesPhaseFilter = phase;
  document.querySelectorAll('.so-phase-btn').forEach(b => {
    b.style.background = 'var(--bg-subtle)';
    b.style.color = 'var(--text)';
    b.style.borderColor = 'var(--border)';
  });
  btn.style.background = 'var(--navy)';
  btn.style.color = 'white';
  btn.style.borderColor = 'var(--navy)';

  // Show/hide order line rows by phase
  document.querySelectorAll('tbody tr[data-line-phase]').forEach(tr => {
    const linePhase = tr.dataset.linePhase;
    tr.style.display = (!phase || linePhase === phase) ? '' : 'none';
    // Also hide/show associated detail rows
    const detailId = tr.dataset.detailId;
    if (detailId) {
      const det = document.getElementById(detailId);
      if (det) det.style.display = 'none'; // collapse on filter change
    }
  });
};


window.setSoLineVarTab = function(lineId, varTab) {
  if (!window.AppState._soLineVarMap) window.AppState._soLineVarMap = {};
  window.AppState._soLineVarMap[String(lineId)] = varTab;
  // Save to DB
  fetch('/api/plan-overrides', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({phase: 'so_line_map', month_key: String(lineId), field: 'var_tab', value: varTab})
  }).catch(()=>{});
  // Reset invoice cache so profitability reloads with new mapping
  if (window.AppState._invoiceCumulative) delete window.AppState._invoiceCumulative[varTab];
  if (window.AppState._salesInvoicesByPhase) window.AppState._salesInvoicesByPhase = null;
};


function renderDirectInvoices(invoices, note, summary) {
  const fSAR = v => new Intl.NumberFormat('en-US', {maximumFractionDigits:0}).format(v||0);
  const payColor = p => p==='paid'?'var(--green)':p==='partial'?'var(--amber)':'var(--red)';
  const payLabel = p => p==='paid'?'✅ Paid':p==='partial'?'⚡ Partial':'❌ Unpaid';
  const isBog   = window.AppState?._overviewData?.is_bog !== false;
  const phaseOpts   = isBog ? ['development','consultation','support','license'] : ['services','support','license'];
  const phaseLabels = {services:'Services',development:'Development',consultation:'Consultation',support:'Support',license:'License / 3rd Party'};
  const phKpiColor  = {development:'#1E3A5F',consultation:'#1E3A5F',services:'#1E3A5F',support:'#D97706',license:'#6B7280'};
  const monthNames  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  window._directInvoices = invoices;

  // ── Filter state ─────────────────────────────────────────────────────────
  if (!window._salesFilter) window._salesFilter = {year:null, month:null, sort:'asc'};
  const SF = window._salesFilter;

  // ── All posted invoices ──────────────────────────────────────────────────
  let filtered = invoices.filter(i => i.state === 'posted');
  if (SF.year)  filtered = filtered.filter(i=>(i.date||'').startsWith(SF.year));
  if (SF.month) filtered = filtered.filter(i=>(i.date||'').startsWith(SF.month));
  filtered = [...filtered].sort((a,b)=>{
    const cmp = (a.date||'').localeCompare(b.date||'');
    return SF.sort==='desc' ? -cmp : cmp;
  });

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const totalExclVAT = filtered.reduce((s,i)=>s+i.amount_untaxed,0);
  const byPh = {};
  filtered.forEach(i=>{ byPh[i.phase]=(byPh[i.phase]||0)+i.amount_untaxed; });
  const kpiPhases = isBog
    ? [['development','Development'],['consultation','Consultation'],['support','Support'],['license','License']]
    : [['services','Services'],['support','Support'],['license','License']];

  // ── Year / Month filter buttons ──────────────────────────────────────────
  const allYears  = [...new Set(invoices.map(i=>(i.date||'').substring(0,4)).filter(Boolean))].sort();
  const allMonths = [...new Set(invoices.map(i=>(i.date||'').substring(0,7)).filter(Boolean))].sort();
  const visMonths = SF.year ? allMonths.filter(m=>m.startsWith(SF.year)) : allMonths;

  const btnStyle = (active, color) =>
    `font-size:11px;padding:3px 11px;border-radius:4px;cursor:pointer;font-weight:${active?700:400};` +
    `border:1px solid ${active?color:'var(--border)'};` +
    `background:${active?color:'var(--bg-subtle)'};color:${active?'white':'var(--text)'}`;

  const yearBtns = ['All',...allYears].map(y=>{
    const val = y==='All'?'':y;
    const active = (y==='All'&&!SF.year)||y===SF.year;
    return `<button onclick="_salesSetYear('${val}')" style="${btnStyle(active,'var(--navy)')}">${y}</button>`;
  }).join('');

  const monthBtns = visMonths.map(mk=>{
    const active = mk===SF.month;
    const lbl = monthNames[parseInt(mk.substring(5,7))-1]+" '"+mk.substring(2,4);
    return `<button onclick="_salesSetMonth('${mk}')" style="${btnStyle(active,'var(--amber)')}">${lbl}</button>`;
  }).join('');

  const sortIcon = SF.sort==='asc'?'↑ Oldest first':'↓ Newest first';

  // ── Monthly breakdown rows ────────────────────────────────────────────────
  const byMonth = {};
  filtered.forEach(i=>{
    const mk=(i.date||'').substring(0,7); if(!mk) return;
    if(!byMonth[mk]) byMonth[mk]={total:0,byPhase:{}};
    byMonth[mk].total+=i.amount_untaxed;
    byMonth[mk].byPhase[i.phase]=(byMonth[mk].byPhase[i.phase]||0)+i.amount_untaxed;
  });
  const sortedMk = Object.keys(byMonth).sort((a,b)=>SF.sort==='desc'?b.localeCompare(a):a.localeCompare(b));
  const phHdrs   = kpiPhases.map(([,l])=>`<th class="num" style="font-size:11px;">${l}<br><small style="font-weight:400;font-size:9px;">excl. VAT</small></th>`).join('');

  const monthlyRows = sortedMk.map(mk=>{
    const row = byMonth[mk];
    const lbl = monthNames[parseInt(mk.substring(5,7))-1]+' '+mk.substring(0,4);
    const cells = kpiPhases.map(([pk])=>
      `<td class="num" style="color:${phKpiColor[pk]||'var(--navy)'};">${row.byPhase[pk]?fSAR(row.byPhase[pk]):'—'}</td>`
    ).join('');
    return `<tr style="cursor:pointer;" onclick="_salesToggleMonth('${mk}')" title="Click to expand">
      <td style="font-weight:700;padding:9px 12px;">${lbl}</td>${cells}
      <td class="num" style="font-weight:700;color:var(--navy);">${fSAR(row.total)}</td>
      <td style="text-align:center;color:var(--text-muted);font-size:12px;" id="arr-${mk}">▼</td>
    </tr>
    <tr id="mdet-${mk}" style="display:none;background:#F8FAFC;">
      <td colspan="${kpiPhases.length+3}" style="padding:0;">
        <div style="padding:4px 0 8px;">
          <p style="padding:8px 16px;font-size:11px;color:var(--text-muted);margin:0;">
            ↓ See full invoice details in the <b>All Invoices</b> table below — filter by this month to focus.
          </p>
        </div>
      </td>
    </tr>`;
  }).join('');

  // ── All Invoices flat table rows ─────────────────────────────────────────
  const allInvRows = filtered.map(inv=>{
    const purposeTxt  = (inv.purpose||'').replace(/<[^>]+>/g,'').substring(0,150);
    const phaseSelect = `<select onchange="reclassifyDirectInv(${inv._idx},this.value)"
      style="font-size:10px;padding:2px 4px;border:1px solid var(--border);border-radius:3px;
             background:var(--bg-subtle);margin-top:3px;display:block;">
      ${phaseOpts.map(p=>`<option value="${p}" ${inv.phase===p?'selected':''}>${phaseLabels[p]||p}</option>`).join('')}
    </select>`;
    const phColor = phKpiColor[inv.phase]||'var(--navy)';
    const phBadge = `<span style="font-size:9px;font-weight:700;color:${phColor};text-transform:uppercase;
      letter-spacing:.4px;">${phaseLabels[inv.phase]||inv.phase}</span>`;
    return `<tr>
      <td style="padding:7px 12px;">
        <b style="font-size:12px;">${inv.name}</b>
        ${phBadge}
        ${phaseSelect}
      </td>
      <td style="font-family:var(--mono);font-size:11px;padding:7px 8px;white-space:nowrap;">${inv.date||'—'}</td>
      <td style="font-family:var(--mono);font-size:11px;padding:7px 8px;white-space:nowrap;">${inv.due_date||'—'}</td>
      <td style="font-size:10px;color:var(--text-muted);max-width:220px;white-space:normal;padding:7px 8px;">${purposeTxt||'—'}</td>
      <td class="num" style="font-weight:600;padding:7px 8px;">${fSAR(inv.amount_untaxed)}</td>
      <td class="num" style="color:var(--text-muted);padding:7px 8px;">${fSAR(inv.amount_tax)}</td>
      <td class="num" style="font-weight:700;padding:7px 8px;">${fSAR(inv.amount_total)}</td>
      <td style="padding:7px 8px;"><span style="font-size:10px;font-weight:600;color:${payColor(inv.payment_state)};">${payLabel(inv.payment_state)}</span></td>
    </tr>`;
  }).join('');

  // ── Assemble HTML ─────────────────────────────────────────────────────────
  return `
    <div class="banner banner-info" style="margin-bottom:16px;">
      <b>No Sales Orders linked to this project.</b> Showing direct invoices grouped by phase.
      ${note?`<br><small style="color:var(--text-muted);">${note}</small>`:''}
    </div>

    <!-- KPI strip -->
    <div class="kpi-strip kpi-strip-small" style="margin-bottom:16px;flex-wrap:wrap;">
      <div class="kpi-card kpi-navy compact">
        <div class="kpi-label">TOTAL INVOICES</div>
        <div class="kpi-value">${filtered.length}</div>
        <div class="kpi-foot">${SF.year||'all years'}${SF.month?' · '+monthNames[parseInt(SF.month.substring(5,7))-1]:''}</div>
      </div>
      <div class="kpi-card kpi-blue compact">
        <div class="kpi-label">TOTAL (excl. VAT)</div>
        <div class="kpi-value">${fSAR(totalExclVAT)}</div>
        <div class="kpi-foot">SAR</div>
      </div>
      ${kpiPhases.map(([pk,plbl])=>`
        <div class="kpi-card compact" style="border-top:3px solid ${phKpiColor[pk]};background:white;">
          <div class="kpi-label" style="color:${phKpiColor[pk]};">${plbl.toUpperCase()}</div>
          <div class="kpi-value" style="color:${phKpiColor[pk]};font-size:18px;">${fSAR(byPh[pk]||0)}</div>
          <div class="kpi-foot">excl. VAT · SAR</div>
        </div>`).join('')}
    </div>

    <!-- Filters -->
    <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:16px;">
      <div style="display:flex;gap:5px;align-items:center;">
        <span style="font-size:11px;font-weight:700;color:var(--text-muted);">YEAR:</span>${yearBtns}
      </div>
      ${monthBtns?`<div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap;">
        <span style="font-size:11px;font-weight:700;color:var(--text-muted);">MONTH:</span>${monthBtns}
      </div>`:''}
      <button onclick="_salesToggleSort()"
        style="margin-left:auto;font-size:11px;padding:4px 14px;border-radius:4px;cursor:pointer;
               border:1px solid var(--border);background:var(--bg-subtle);font-weight:600;">${sortIcon}</button>
    </div>

    <!-- Monthly Breakdown (collapsible summary) -->
    <div class="card" style="margin-bottom:20px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <h3 class="card-title" style="margin:0;">📅 Monthly Breakdown</h3>
        <span style="font-size:11px;color:var(--text-muted);">Summary by phase per month</span>
      </div>
      <div class="table-scroll">
        <table class="data-table" style="font-size:12px;">
          <thead><tr><th>Month</th>${phHdrs}<th class="num">Total (excl. VAT)</th><th></th></tr></thead>
          <tbody>${monthlyRows}</tbody>
          <tfoot>
            <tr style="background:var(--navy);color:white;font-weight:700;">
              <td style="padding:8px 12px;">TOTAL</td>
              ${kpiPhases.map(([pk])=>`<td class="num">${fSAR(byPh[pk]||0)}</td>`).join('')}
              <td class="num">${fSAR(totalExclVAT)}</td><td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>

    <!-- All Invoices flat table -->
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <h3 class="card-title" style="margin:0;">🧾 All Invoices
          <span style="font-size:11px;font-weight:400;color:var(--text-muted);margin-left:8px;">
            ${filtered.length} invoice${filtered.length!==1?'s':''} · Change phase via dropdown
          </span>
        </h3>
      </div>
      <div class="table-scroll">
        <table class="data-table" style="font-size:11px;">
          <thead><tr>
            <th>Invoice # / Phase</th>
            <th>Date</th>
            <th>Due Date</th>
            <th>Purpose</th>
            <th class="num">excl. VAT</th>
            <th class="num">VAT</th>
            <th class="num">Total incl. VAT</th>
            <th>Payment</th>
          </tr></thead>
          <tbody>${allInvRows || '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--text-muted);">No invoices match selected filters</td></tr>'}</tbody>
          <tfoot>
            <tr style="background:var(--navy);color:white;font-weight:700;">
              <td colspan="4" style="padding:8px 12px;">TOTAL (${filtered.length} invoices)</td>
              <td class="num">${fSAR(totalExclVAT)}</td>
              <td class="num">${fSAR(filtered.reduce((s,i)=>s+i.amount_tax,0))}</td>
              <td class="num">${fSAR(filtered.reduce((s,i)=>s+i.amount_total,0))}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>`;
}

window._salesSetYear = function(year) {
  window._salesFilter.year  = year||null;
  window._salesFilter.month = null;
  _salesRerender();
};
window._salesSetMonth = function(month) {
  window._salesFilter.month = (window._salesFilter.month===month) ? null : month;
  _salesRerender();
};
window._salesToggleSort = function() {
  window._salesFilter.sort = window._salesFilter.sort==='asc'?'desc':'asc';
  _salesRerender();
};
window._salesToggleMonth = function(mk) {
  const el  = document.getElementById('mdet-'+mk);
  const arr = document.getElementById('arr-'+mk);
  if (!el) return;
  const open = el.style.display==='none';
  el.style.display = open?'':'none';
  if (arr) arr.textContent = open?'▲':'▼';
};
function _salesRerender() {
  const cont = document.getElementById('salesContent')||document.getElementById('sales');
  if (cont && window._directInvoices) cont.innerHTML = renderDirectInvoices(window._directInvoices,'',{});
}


window.reclassifyDirectInv = function(idx, newPhase) {
  if (!window._directInvoices) return;
  const inv = window._directInvoices[idx];
  inv.phase = newPhase;

  // Save to DB: use invoice name as key
  fetch('/api/plan-overrides', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({
      phase: 'direct_inv_phase',
      month_key: inv.name.replace(/\//g,'_'),
      field: 'phase',
      value: newPhase
    })
  }).catch(()=>{});

  // Rebuild AppState._salesInvoicesByPhase
  window.AppState._salesInvoicesByPhase = {};
  window._directInvoices.forEach(i => {
    const ph = i.phase || 'services';
    const mk = (i.date||'').substring(0,7);
    if (!mk || i.state !== 'posted') return;
    if (!window.AppState._salesInvoicesByPhase[ph]) window.AppState._salesInvoicesByPhase[ph] = {};
    window.AppState._salesInvoicesByPhase[ph][mk] = window.AppState._salesInvoicesByPhase[ph][mk] || {month:0,cumulative:0};
    window.AppState._salesInvoicesByPhase[ph][mk].month += i.amount_untaxed;
  });
  // Build cumulatives
  Object.keys(window.AppState._salesInvoicesByPhase).forEach(ph => {
    let running = 0;
    Object.keys(window.AppState._salesInvoicesByPhase[ph]).sort().forEach(mk => {
      running += window.AppState._salesInvoicesByPhase[ph][mk].month;
      window.AppState._salesInvoicesByPhase[ph][mk].cumulative = running;
    });
  });
  // Clear invoice cumulative cache
  if (window.AppState._invoiceCumulative) window.AppState._invoiceCumulative = {};
  // Re-render
  const cont = document.getElementById('salesContent') || document.getElementById('sales');
  if (cont) cont.innerHTML = renderDirectInvoices(window._directInvoices, '', {});
};
