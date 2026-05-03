window.loadBudget = async function() {
  AppState.loaded.budget = true;
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
};
