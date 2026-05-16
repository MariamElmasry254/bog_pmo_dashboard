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

  // Always reload SO line → variance tab mapping fresh from DB
  window.AppState._soLineVarMap = {};
  try {
    const mapRes = await fetch('/api/plan-overrides');
    if (mapRes.ok) {
      const mapData = await mapRes.json();
      const soMap = mapData.plan_overrides?.so_line_map || {};
      for (const [lineId, fields] of Object.entries(soMap)) {
        // load_plan_overrides returns: {lineId: {var_tab: 'support'}}
        if (fields && typeof fields === 'object' && fields.var_tab) {
          window.AppState._soLineVarMap[lineId] = fields.var_tab;
        } else if (typeof fields === 'string' && fields) {
          window.AppState._soLineVarMap[lineId] = fields;
        }
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
        window._soSummary = d.so_summary || {};
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
  const fSAR = v => new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(v||0);
  const fPct = v => (v||0).toFixed(1)+'%';
  const payColor = p => p==='paid'?'var(--green)':p==='partial'?'var(--amber)':'var(--red)';
  const payLabel = p => p==='paid'?'✅ Paid':p==='partial'?'⚡ Partial':'❌ Unpaid';
  const isBog      = window.AppState?._overviewData?.is_bog !== false;
  const phaseOpts  = isBog ? ['development','consultation','support','license'] : ['services','support','license'];
  const phaseLabels= {services:'Services',development:'Development',consultation:'Consultation',support:'Support',license:'License / 3rd Party'};
  const phKpiColor = {development:'#1E3A5F',consultation:'#1E3A5F',services:'#1E3A5F',support:'#D97706',license:'#6B7280'};
  const phBgColor  = {services:'#EFF6FF',development:'#EFF6FF',consultation:'#EFF6FF',support:'#FEF3C7',license:'#F3F4F6'};
  const phTxtColor = {services:'#1D4ED8',development:'#1D4ED8',consultation:'#1D4ED8',support:'#92400E',license:'#374151'};
  const phBdColor  = {services:'#BFDBFE',development:'#BFDBFE',consultation:'#BFDBFE',support:'#FCD34D',license:'#D1D5DB'};
  const phSectionBorder={services:'#3B82F6',development:'#3B82F6',consultation:'#1E3A5F',support:'#F59E0B',license:'#9CA3AF'};
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const kpiPhases  = isBog
    ? [['development','Development'],['consultation','Consultation'],['support','Support'],['license','License']]
    : [['services','Services'],['support','Support'],['license','License']];

  invoices.forEach((inv,i) => { inv._idx = i; });
  window._directInvoices = invoices;
  if (!window._salesFilter) window._salesFilter = {year:null,month:null,sort:'asc',view:'table'};
  const SF = window._salesFilter;

  // ── Filter & sort ─────────────────────────────────────────────────────────
  let filtered = invoices.filter(i=>i.state==='posted');
  if (SF.year)  filtered = filtered.filter(i=>(i.date||'').startsWith(SF.year));
  if (SF.month) filtered = filtered.filter(i=>(i.date||'').startsWith(SF.month));
  filtered = [...filtered].sort((a,b)=>{
    const cmp=(a.date||'').localeCompare(b.date||'');
    return SF.sort==='desc'?-cmp:cmp;
  });

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const totalExclVAT = filtered.reduce((s,i)=>s+i.amount_untaxed,0);
  const byPh={};
  filtered.forEach(i=>{ byPh[i.phase]=(byPh[i.phase]||0)+i.amount_untaxed; });

  // ── Year/Month buttons ────────────────────────────────────────────────────
  const allYears  = [...new Set(invoices.map(i=>(i.date||'').substring(0,4)).filter(Boolean))].sort();
  const allMonths = [...new Set(invoices.map(i=>(i.date||'').substring(0,7)).filter(Boolean))].sort();
  const visMonths = SF.year ? allMonths.filter(m=>m.startsWith(SF.year)) : allMonths;
  const bs=(active,col)=>
    `font-size:12px;padding:4px 13px;border-radius:4px;cursor:pointer;font-weight:${active?700:500};`+
    `border:1px solid ${active?col:'var(--border)'};background:${active?col:'var(--bg-subtle)'};color:${active?'white':'var(--text)'}`;
  const yearBtns = ['All',...allYears].map(y=>{
    const val=y==='All'?'':y,active=(y==='All'&&!SF.year)||y===SF.year;
    return `<button onclick="_salesSetYear('${val}')" style="${bs(active,'var(--navy)')}">${y}</button>`;
  }).join('');
  const monthBtns = visMonths.map(mk=>{
    const active=mk===SF.month;
    const lbl=monthNames[parseInt(mk.substring(5,7))-1]+" '"+mk.substring(2,4);
    return `<button onclick="_salesSetMonth('${mk}')" style="${bs(active,'var(--amber)')}">${lbl}</button>`;
  }).join('');
  const sortIcon=SF.sort==='asc'?'↑ Oldest':'↓ Newest';

  // ── Pills helper ──────────────────────────────────────────────────────────
  const renderPills = inv => phaseOpts.map(p=>{
    const active=inv.phase===p;
    return `<button onclick="_pillSet(${inv._idx},'${p}')"
      style="font-size:11px;padding:2px 10px;border-radius:20px;cursor:pointer;font-weight:${active?700:500};
             border:1px solid ${active?phBdColor[p]:'var(--border)'};
             background:${active?phBgColor[p]:'var(--bg-subtle)'};
             color:${active?phTxtColor[p]:'var(--text-muted)'}">
      ${phaseLabels[p].replace(' / 3rd Party','')}
    </button>`;
  }).join('');

  // ── SO Summary panel ──────────────────────────────────────────────────────
  const soSum = window._soSummary || {};
  const soKeys = Object.keys(soSum).sort();
  let soPanel = '';
  if (soKeys.length) {
    const soRows = soKeys.map(soName => {
      const so = soSum[soName];
      const issuedPct = so.amount_untaxed > 0 ? (so.issued / so.amount_untaxed * 100) : 0;
      const remColor  = so.remaining > 0 ? 'var(--amber)' : 'var(--green)';
      const stateLabel= so.state==='sale'?'Confirmed':so.state==='done'?'Done':so.state==='draft'?'Draft':so.state||'—';
      const invStatus = so.invoice_status==='invoiced'?'✅ Fully Invoiced':
                        so.invoice_status==='to invoice'?'⏳ To Invoice':
                        so.invoice_status==='nothing'?'—':so.invoice_status||'—';
      // Which invoices reference this SO
      const linkedInvs = filtered.filter(i=>(i.invoice_origin||'').includes(soName));
      const invNames   = linkedInvs.map(i=>
        `<span style="font-size:10px;background:#EFF6FF;color:#1D4ED8;padding:1px 7px;
                      border-radius:10px;border:1px solid #BFDBFE;">${i.name}</span>`
      ).join(' ');

      return `<tr style="border-bottom:1px solid var(--border);">
        <td style="padding:10px 14px;font-weight:700;font-size:13px;white-space:nowrap;">${soName}</td>
        <td style="padding:10px 14px;font-size:12px;color:var(--text-muted);">${so.partner||'—'}</td>
        <td style="padding:10px 14px;font-size:11px;font-family:var(--mono);white-space:nowrap;">${so.date||'—'}</td>
        <td style="padding:10px 14px;"><span style="font-size:11px;font-weight:600;color:var(--blue);">${stateLabel}</span></td>
        <td style="text-align:right;padding:10px 14px;font-size:13px;font-weight:600;">${fSAR(so.amount_untaxed)}</td>
        <td style="text-align:right;padding:10px 14px;">
          <div style="display:flex;align-items:center;gap:8px;justify-content:flex-end;">
            <div style="width:60px;height:5px;background:#F3F4F6;border-radius:3px;">
              <div style="width:${Math.min(100,issuedPct).toFixed(0)}%;height:100%;background:var(--green);border-radius:3px;"></div>
            </div>
            <span style="font-size:13px;font-weight:700;color:var(--green);">${fSAR(so.issued)}</span>
            <span style="font-size:10px;color:var(--text-muted);">${fPct(issuedPct)}</span>
          </div>
        </td>
        <td style="text-align:right;padding:10px 14px;font-size:13px;font-weight:700;color:${remColor};">${fSAR(so.remaining)}</td>
        <td style="padding:10px 14px;font-size:11px;">${invStatus}</td>
        <td style="padding:10px 14px;">${invNames||'<span style="font-size:11px;color:var(--text-muted);">—</span>'}</td>
      </tr>`;
    }).join('');

    const totalSOAmt    = soKeys.reduce((s,k)=>s+soSum[k].amount_untaxed,0);
    const totalSOIssued = soKeys.reduce((s,k)=>s+soSum[k].issued,0);
    const totalSORem    = soKeys.reduce((s,k)=>s+soSum[k].remaining,0);

    soPanel = `
      <div class="card" style="margin-bottom:20px;border-top:3px solid var(--navy);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
          <h3 class="card-title" style="margin:0;">📋 Sales Orders linked to Invoices
            <span style="font-size:11px;font-weight:400;color:var(--text-muted);margin-left:8px;">detected via invoice origin</span>
          </h3>
        </div>
        <div class="table-scroll">
          <table style="width:100%;border-collapse:collapse;font-size:12px;">
            <thead><tr style="background:var(--navy);color:white;">
              <th style="padding:10px 14px;text-align:left;font-size:11px;letter-spacing:.4px;">SO #</th>
              <th style="padding:10px 14px;text-align:left;font-size:11px;letter-spacing:.4px;">CUSTOMER</th>
              <th style="padding:10px 14px;text-align:left;font-size:11px;letter-spacing:.4px;white-space:nowrap;">DATE</th>
              <th style="padding:10px 14px;text-align:left;font-size:11px;letter-spacing:.4px;">STATUS</th>
              <th style="padding:10px 14px;text-align:right;font-size:11px;letter-spacing:.4px;white-space:nowrap;">SO VALUE (excl.VAT)</th>
              <th style="padding:10px 14px;text-align:right;font-size:11px;letter-spacing:.4px;white-space:nowrap;">ISSUED SAR</th>
              <th style="padding:10px 14px;text-align:right;font-size:11px;letter-spacing:.4px;white-space:nowrap;">REMAINING</th>
              <th style="padding:10px 14px;text-align:left;font-size:11px;letter-spacing:.4px;white-space:nowrap;">INV. STATUS</th>
              <th style="padding:10px 14px;text-align:left;font-size:11px;letter-spacing:.4px;">LINKED INVOICES</th>
            </tr></thead>
            <tbody>${soRows}</tbody>
            <tfoot><tr style="background:#F8FAFC;border-top:2px solid var(--navy);font-weight:700;">
              <td colspan="4" style="padding:10px 14px;font-size:13px;">TOTAL (${soKeys.length} SOs)</td>
              <td style="text-align:right;padding:10px 14px;font-size:13px;">${fSAR(totalSOAmt)}</td>
              <td style="text-align:right;padding:10px 14px;font-size:13px;color:var(--green);">${fSAR(totalSOIssued)}</td>
              <td style="text-align:right;padding:10px 14px;font-size:13px;color:var(--amber);">${fSAR(totalSORem)}</td>
              <td colspan="2"></td>
            </tr></tfoot>
          </table>
        </div>
      </div>`;
  }

  // ════════════════════════════════════════════════════════════════════════
  // VIEW 1: Flat table with checkboxes + bulk assign + pills
  // ════════════════════════════════════════════════════════════════════════
  const renderTableView = () => {
    const rows = filtered.map(inv=>{
      const purposeTxt=(inv.purpose||'').replace(/<[^>]+>/g,'').substring(0,200);
      const originBadge=inv.invoice_origin
        ? `<span style="font-size:10px;color:#6B7280;margin-left:6px;">↗ ${inv.invoice_origin}</span>` : '';
      return `<tr data-idx="${inv._idx}" style="cursor:default;border-bottom:1px solid var(--border);">
        <td style="padding:12px 14px;width:36px;vertical-align:middle;">
          <input type="checkbox" class="inv-chk" data-idx="${inv._idx}" onchange="_salesChkChange()"
            style="width:16px;height:16px;cursor:pointer;accent-color:var(--navy);">
        </td>
        <td style="padding:12px 14px;vertical-align:middle;min-width:155px;">
          <div style="font-weight:700;font-size:13px;margin-bottom:2px;">${inv.name}${originBadge}</div>
          <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:5px;">${renderPills(inv)}</div>
        </td>
        <td style="font-family:var(--mono);font-size:12px;padding:12px 14px;white-space:nowrap;vertical-align:middle;">${inv.date||'—'}</td>
        <td style="font-size:12px;color:var(--text-muted);padding:12px 14px;max-width:260px;white-space:normal;vertical-align:middle;line-height:1.5;">${purposeTxt||'—'}</td>
        <td style="text-align:right;font-size:13px;font-weight:600;padding:12px 14px;white-space:nowrap;vertical-align:middle;">${fSAR(inv.amount_untaxed)}</td>
        <td style="text-align:right;font-size:12px;color:var(--text-muted);padding:12px 14px;white-space:nowrap;vertical-align:middle;">${fSAR(inv.amount_tax)}</td>
        <td style="text-align:right;font-size:13px;font-weight:700;padding:12px 14px;white-space:nowrap;vertical-align:middle;">${fSAR(inv.amount_total)}</td>
        <td style="padding:12px 14px;white-space:nowrap;vertical-align:middle;">
          <span style="font-size:12px;font-weight:600;color:${payColor(inv.payment_state)};">${payLabel(inv.payment_state)}</span>
        </td>
      </tr>`;
    }).join('');

    return `
      <div id="bulk-toolbar" style="display:none;align-items:center;gap:10px;padding:10px 16px;
        background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px;margin-bottom:12px;flex-wrap:wrap;">
        <span id="bulk-count" style="font-size:13px;font-weight:700;color:#1E3A5F;">0 selected</span>
        <span style="font-size:13px;color:#1E40AF;">→ Assign to:</span>
        <select id="bulk-phase-select" style="font-size:13px;padding:5px 10px;border-radius:6px;
          border:1px solid #93C5FD;background:white;font-weight:600;cursor:pointer;min-width:160px;">
          <option value="">— choose phase —</option>
          ${phaseOpts.map(p=>`<option value="${p}">${phaseLabels[p]}</option>`).join('')}
        </select>
        <button onclick="_salesBulkAssign()" style="font-size:13px;padding:5px 18px;background:var(--navy);
          color:white;border:none;border-radius:6px;cursor:pointer;font-weight:700;">Apply</button>
        <button onclick="_salesClearSelection()" style="font-size:12px;padding:5px 12px;background:white;
          color:var(--text-muted);border:1px solid var(--border);border-radius:6px;cursor:pointer;">Cancel</button>
        <span id="bulk-saved-msg" style="font-size:12px;color:var(--green);opacity:0;transition:opacity .4s;">✓ saved</span>
      </div>
      <div class="card" style="padding:0;overflow:hidden;">
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;">
            <thead><tr style="background:var(--navy);color:white;">
              <th style="padding:12px 14px;width:36px;">
                <input type="checkbox" id="chk-all" onchange="_salesSelectAll(this)"
                  style="width:16px;height:16px;cursor:pointer;accent-color:#93C5FD;">
              </th>
              <th style="text-align:left;padding:12px 14px;font-size:11px;letter-spacing:.5px;">INVOICE # / PHASE</th>
              <th style="text-align:left;padding:12px 14px;font-size:11px;letter-spacing:.5px;white-space:nowrap;">DATE</th>
              <th style="text-align:left;padding:12px 14px;font-size:11px;letter-spacing:.5px;">PURPOSE</th>
              <th style="text-align:right;padding:12px 14px;font-size:11px;letter-spacing:.5px;white-space:nowrap;">EXCL. VAT</th>
              <th style="text-align:right;padding:12px 14px;font-size:11px;letter-spacing:.5px;white-space:nowrap;">VAT</th>
              <th style="text-align:right;padding:12px 14px;font-size:11px;letter-spacing:.5px;white-space:nowrap;">TOTAL INCL. VAT</th>
              <th style="text-align:left;padding:12px 14px;font-size:11px;letter-spacing:.5px;white-space:nowrap;">PAYMENT</th>
            </tr></thead>
            <tbody id="inv-tbody">${rows||'<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--text-muted);">No invoices match selected filters</td></tr>'}</tbody>
            <tfoot><tr style="background:#F8FAFC;border-top:2px solid var(--navy);">
              <td colspan="4" style="padding:12px 14px;font-weight:700;font-size:13px;">
                TOTAL <span style="font-weight:400;color:var(--text-muted);">(${filtered.length})</span></td>
              <td style="text-align:right;padding:12px 14px;font-weight:700;font-size:13px;">${fSAR(totalExclVAT)}</td>
              <td style="text-align:right;padding:12px 14px;font-weight:600;font-size:12px;color:var(--text-muted);">${fSAR(filtered.reduce((s,i)=>s+i.amount_tax,0))}</td>
              <td style="text-align:right;padding:12px 14px;font-weight:700;font-size:14px;">${fSAR(filtered.reduce((s,i)=>s+i.amount_total,0))}</td>
              <td></td>
            </tr></tfoot>
          </table>
        </div>
      </div>`;
  };

  // ════════════════════════════════════════════════════════════════════════
  // VIEW 2: Grouped by phase
  // ════════════════════════════════════════════════════════════════════════
  const renderGroupView = () => phaseOpts.map(ph=>{
    const phInvs=filtered.filter(i=>i.phase===ph);
    if(!phInvs.length) return `
      <div style="border:1px solid var(--border);border-radius:8px;margin-bottom:12px;overflow:hidden;opacity:.45;">
        <div style="padding:10px 16px;background:${phBgColor[ph]};display:flex;justify-content:space-between;">
          <span style="font-size:13px;font-weight:700;color:${phTxtColor[ph]};">${phaseLabels[ph]}</span>
          <span style="font-size:12px;color:${phTxtColor[ph]};">0 invoices</span>
        </div>
        <div style="padding:12px 16px;font-size:12px;color:var(--text-muted);">No invoices assigned to this phase</div>
      </div>`;
    const phTotal=phInvs.reduce((s,i)=>s+i.amount_untaxed,0);
    const rows=phInvs.map(inv=>{
      const purposeTxt=(inv.purpose||'').replace(/<[^>]+>/g,'').substring(0,180);
      const originBadge=inv.invoice_origin
        ? `<span style="font-size:10px;color:#6B7280;">↗ ${inv.invoice_origin}</span>` : '';
      return `<tr style="border-bottom:1px solid var(--border);">
        <td style="padding:10px 16px;vertical-align:middle;min-width:155px;">
          <div style="font-weight:700;font-size:13px;margin-bottom:2px;">${inv.name}</div>
          ${originBadge}
          <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:5px;">${renderPills(inv)}</div>
        </td>
        <td style="font-family:var(--mono);font-size:12px;padding:10px 14px;white-space:nowrap;vertical-align:middle;">${inv.date||'—'}</td>
        <td style="font-size:12px;color:var(--text-muted);padding:10px 14px;max-width:260px;white-space:normal;vertical-align:middle;">${purposeTxt||'—'}</td>
        <td style="text-align:right;font-size:13px;font-weight:600;padding:10px 14px;white-space:nowrap;vertical-align:middle;">${fSAR(inv.amount_untaxed)}</td>
        <td style="text-align:right;font-size:12px;color:var(--text-muted);padding:10px 14px;white-space:nowrap;">${fSAR(inv.amount_tax)}</td>
        <td style="text-align:right;font-size:13px;font-weight:700;padding:10px 14px;white-space:nowrap;">${fSAR(inv.amount_total)}</td>
        <td style="padding:10px 14px;white-space:nowrap;">
          <span style="font-size:12px;font-weight:600;color:${payColor(inv.payment_state)};">${payLabel(inv.payment_state)}</span>
        </td>
      </tr>`;
    }).join('');
    return `
      <div style="border:1px solid ${phBdColor[ph]};border-left:4px solid ${phSectionBorder[ph]};
                  border-radius:8px;margin-bottom:14px;overflow:hidden;">
        <div style="padding:10px 16px;background:${phBgColor[ph]};border-bottom:1px solid ${phBdColor[ph]};
                    display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:14px;font-weight:700;color:${phTxtColor[ph]};">${phaseLabels[ph]}</span>
          <span style="font-size:13px;font-weight:700;color:${phTxtColor[ph]};">${phInvs.length} inv · ${fSAR(phTotal)} SAR</span>
        </div>
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;">
            <thead><tr style="background:rgba(0,0,0,.03);">
              <th style="text-align:left;padding:7px 16px;font-size:10px;letter-spacing:.5px;color:var(--text-muted);">INVOICE # / CHANGE PHASE</th>
              <th style="text-align:left;padding:7px 14px;font-size:10px;letter-spacing:.5px;color:var(--text-muted);white-space:nowrap;">DATE</th>
              <th style="text-align:left;padding:7px 14px;font-size:10px;letter-spacing:.5px;color:var(--text-muted);">PURPOSE</th>
              <th style="text-align:right;padding:7px 14px;font-size:10px;letter-spacing:.5px;color:var(--text-muted);white-space:nowrap;">EXCL. VAT</th>
              <th style="text-align:right;padding:7px 14px;font-size:10px;letter-spacing:.5px;color:var(--text-muted);white-space:nowrap;">VAT</th>
              <th style="text-align:right;padding:7px 14px;font-size:10px;letter-spacing:.5px;color:var(--text-muted);white-space:nowrap;">TOTAL</th>
              <th style="text-align:left;padding:7px 14px;font-size:10px;letter-spacing:.5px;color:var(--text-muted);white-space:nowrap;">PAYMENT</th>
            </tr></thead>
            <tbody>${rows}</tbody>
            <tfoot><tr style="background:rgba(0,0,0,.03);border-top:1px solid ${phBdColor[ph]};">
              <td colspan="3" style="padding:8px 16px;font-weight:700;font-size:12px;color:${phTxtColor[ph]};">SUBTOTAL</td>
              <td style="text-align:right;padding:8px 14px;font-weight:700;font-size:13px;color:${phTxtColor[ph]};">${fSAR(phTotal)}</td>
              <td style="text-align:right;padding:8px 14px;font-weight:600;font-size:12px;color:var(--text-muted);">${fSAR(phInvs.reduce((s,i)=>s+i.amount_tax,0))}</td>
              <td style="text-align:right;padding:8px 14px;font-weight:700;font-size:13px;color:${phTxtColor[ph]};">${fSAR(phInvs.reduce((s,i)=>s+i.amount_total,0))}</td>
              <td></td>
            </tr></tfoot>
          </table>
        </div>
      </div>`;
  }).join('');

  const isTable = SF.view !== 'group';

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

    <!-- Filters + view toggle -->
    <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:16px;">
      <div style="display:flex;gap:5px;align-items:center;">
        <span style="font-size:12px;font-weight:700;color:var(--text-muted);">YEAR:</span>${yearBtns}
      </div>
      ${monthBtns?`<div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap;">
        <span style="font-size:12px;font-weight:700;color:var(--text-muted);">MONTH:</span>${monthBtns}
      </div>`:''}
      <div style="display:flex;gap:0;margin-left:auto;border:1px solid var(--border);border-radius:6px;overflow:hidden;">
        <button onclick="_salesSetView('table')" style="font-size:12px;padding:5px 14px;cursor:pointer;font-weight:600;
          border:none;background:${isTable?'var(--navy)':'var(--bg-subtle)'};color:${isTable?'white':'var(--text)'};">
          ☰ Table</button>
        <button onclick="_salesSetView('group')" style="font-size:12px;padding:5px 14px;cursor:pointer;font-weight:600;
          border-left:1px solid var(--border);border-top:none;border-right:none;border-bottom:none;
          background:${!isTable?'var(--navy)':'var(--bg-subtle)'};color:${!isTable?'white':'var(--text)'};">
          ⊞ By Phase</button>
      </div>
      <button onclick="_salesToggleSort()" style="font-size:12px;padding:5px 14px;border-radius:4px;
        cursor:pointer;border:1px solid var(--border);background:var(--bg-subtle);font-weight:600;">${sortIcon}</button>
    </div>

    <!-- SO Summary (always shown if data exists) -->
    ${soPanel}

    <!-- View content -->
    <div id="inv-view-content">
      ${isTable ? renderTableView() : renderGroupView()}
    </div>`;
}

// ── Handlers ──────────────────────────────────────────────────────────────
window._salesChkChange = function() {
  const checked=document.querySelectorAll('.inv-chk:checked');
  const toolbar=document.getElementById('bulk-toolbar');
  const countEl=document.getElementById('bulk-count');
  const allChk=document.getElementById('chk-all');
  const total=document.querySelectorAll('.inv-chk').length;
  if(toolbar) toolbar.style.display=checked.length>0?'flex':'none';
  if(countEl) countEl.textContent=checked.length+' selected';
  if(allChk)  allChk.indeterminate=checked.length>0&&checked.length<total;
  document.querySelectorAll('#inv-tbody tr[data-idx]').forEach(tr=>{
    tr.style.background=tr.querySelector('.inv-chk')?.checked?'#EFF6FF':'';
  });
};
window._salesSelectAll = function(c) {
  document.querySelectorAll('.inv-chk').forEach(x=>x.checked=c.checked);
  _salesChkChange();
};
window._salesClearSelection = function() {
  document.querySelectorAll('.inv-chk').forEach(x=>x.checked=false);
  const a=document.getElementById('chk-all');
  if(a){a.checked=false;a.indeterminate=false;}
  _salesChkChange();
};
window._salesBulkAssign = async function() {
  const sel=document.getElementById('bulk-phase-select');
  const newPhase=sel?.value;
  if(!newPhase){alert('Please choose a phase first');return;}
  const checked=document.querySelectorAll('.inv-chk:checked');
  if(!checked.length) return;
  const idxs=[...checked].map(c=>parseInt(c.dataset.idx));
  await Promise.all(idxs.map(idx=>_salesDoReclassify(idx,newPhase,false)));
  _rebuildSalesByPhase();
  _salesRerender();
  const msg=document.getElementById('bulk-saved-msg');
  if(msg){msg.style.opacity=1;setTimeout(()=>msg.style.opacity=0,1800);}
};
window._pillSet = async function(idx,newPhase) { await _salesDoReclassify(idx,newPhase,true); };
window._salesSetView  = function(v){window._salesFilter.view=v;_salesRerender();};
window._salesSetYear  = function(y){window._salesFilter.year=y||null;window._salesFilter.month=null;_salesRerender();};
window._salesSetMonth = function(m){window._salesFilter.month=(window._salesFilter.month===m)?null:m;_salesRerender();};
window._salesToggleSort=function(){window._salesFilter.sort=window._salesFilter.sort==='asc'?'desc':'asc';_salesRerender();};
function _salesRerender(){
  const cont=document.getElementById('salesContent')||document.getElementById('sales');
  if(cont&&window._directInvoices) cont.innerHTML=renderDirectInvoices(window._directInvoices,'',{});
}
async function _salesDoReclassify(idx,newPhase,doRerender=true){
  if(!window._directInvoices) return;
  const inv=window._directInvoices[idx];
  if(!inv) return;
  inv.phase=newPhase;
  try{
    await fetch('/api/plan-overrides',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({phase:'direct_inv_phase',month_key:inv.name.replace(/\//g,'_'),field:'phase',value:newPhase})});
  }catch(e){console.warn('Save failed:',e);}
  if(doRerender){_rebuildSalesByPhase();_salesRerender();}
}
function _rebuildSalesByPhase(){
  if(!window._directInvoices) return;
  const nbp={};
  window._directInvoices.forEach(i=>{
    if(i.state!=='posted') return;
    const ph=i.phase||'services',mk=(i.date||'').substring(0,7);
    if(!mk) return;
    if(!nbp[ph]) nbp[ph]={};
    nbp[ph][mk]=(nbp[ph][mk]||0)+i.amount_untaxed;
  });
  const cum={};
  Object.keys(nbp).forEach(ph=>{
    let r=0;cum[ph]={};
    Object.keys(nbp[ph]).sort().forEach(mk=>{r+=nbp[ph][mk];cum[ph][mk]={month:nbp[ph][mk],cumulative:r};});
  });
  if(window.AppState){window.AppState._salesInvoicesByPhase=cum;window.AppState._invoiceCumulative={};}
}
window.reclassifyDirectInv=async function(idx,newPhase){await _salesDoReclassify(idx,newPhase);};
