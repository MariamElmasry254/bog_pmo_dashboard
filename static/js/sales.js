/* Sales Orders & Invoices Tab */

window.loadSalesOrders = async function() {
  // Use the sales panel directly — salesContent is inside it
  const panel = document.getElementById('sales');
  const cont  = document.getElementById('salesContent') || panel;
  if (!cont) { console.error('No sales panel found'); return; }
  cont.innerHTML = '<div class="loading" style="padding:40px;text-align:center;">Loading Sales Orders from Odoo…</div>';

  try {
    const res = await fetch('/api/sales-orders');
    const d   = await res.json();

    if (!d.ok) {
      cont.innerHTML = `<div class="banner banner-warn"><strong>Error:</strong> ${d.error}</div>`;
      return;
    }

    if (!d.orders || !d.orders.length) {
      cont.innerHTML = `<div class="card" style="text-align:center;padding:40px;">
        <div style="font-size:32px;margin-bottom:12px;">📋</div>
        <div style="font-size:14px;font-weight:600;">No Sales Orders found for this project</div>
      </div>`;
      return;
    }

    const s = d.summary;
    const fSAR = v => new Intl.NumberFormat('en-US', {maximumFractionDigits:0}).format(v || 0);
    const fPct = v => `${(v||0).toFixed(1)}%`;

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
        <td>
          <button onclick="toggleSOInvoices('so-inv-${o.id}')"
            style="font-size:11px;padding:3px 10px;background:var(--bg-subtle);border:1px solid var(--border);border-radius:4px;cursor:pointer;">
            ${o.invoices.length} invoice${o.invoices.length !== 1 ? 's' : ''} ▾
          </button>
        </td>
      </tr>
      <tr id="so-inv-${o.id}" style="display:none;">
        <td colspan="11" style="padding:0 8px 12px 24px;background:var(--bg-subtle);">
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

function renderSOInvoices(invoices, soName) {
  if (!invoices || !invoices.length) {
    return `<p style="color:var(--text-muted);font-size:12px;padding:8px 0;">No invoices for ${soName}</p>`;
  }
  const fSAR = v => new Intl.NumberFormat('en-US', {maximumFractionDigits:0}).format(v || 0);
  const payColor = p => p === 'paid' ? 'var(--green)' : p === 'partial' ? 'var(--amber)' : p === 'not_paid' ? 'var(--red)' : 'var(--text-muted)';
  const payLabel = p => p === 'paid' ? '✅ Paid' : p === 'partial' ? '⚡ Partial' : p === 'not_paid' ? '❌ Unpaid' : p || '—';

  let html = `<table class="data-table" style="font-size:11px;margin-top:8px;width:100%;">
    <thead><tr>
      <th>Invoice #</th><th>Date</th><th>Due Date</th>
      <th class="num">Amount (excl. VAT)</th><th class="num">VAT</th><th class="num">Total</th>
      <th>Status</th><th>Payment</th>
    </tr></thead><tbody>`;

  invoices.forEach(inv => {
    const stateLabel = inv.state === 'posted' ? 'Posted' : inv.state === 'draft' ? 'Draft' : inv.state;
    html += `<tr>
      <td><b>${inv.name}</b></td>
      <td style="font-family:var(--mono);">${inv.date || '—'}</td>
      <td style="font-family:var(--mono);">${inv.due_date || '—'}</td>
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

function toggleSOInvoices(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.display = el.style.display === 'none' ? '' : 'none';
}
