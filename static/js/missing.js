/* Missing Hours tab */
window.loadMissing = async function() {
  if (!AppState.loaded.missing) {
    const def = getDefaultDates();
    document.getElementById('msFrom').value = def.from;
    document.getElementById('msTo').value = def.to;
    AppState.loaded.missing = true;
    document.getElementById('msApply').addEventListener('click', refreshMissing);
    document.getElementById('msReset').addEventListener('click', () => {
      const def = getDefaultDates();
      document.getElementById('msFrom').value = def.from;
      document.getElementById('msTo').value = def.to;
      document.getElementById('msSearch').value = '';
      refreshMissing();
    });
    document.getElementById('msSearch').addEventListener('input', filterMissingRows);
  }
  refreshMissing();
};

async function refreshMissing() {
  const from = document.getElementById('msFrom').value;
  const to = document.getElementById('msTo').value;
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);

  const tbody = document.querySelector('#msTable tbody');
  tbody.innerHTML = '<tr><td colspan="7" class="loading">Calculating compliance across all projects…</td></tr>';

  const res = await fetch('/api/missing-hours?' + params.toString());
  const d = await res.json();
  AppState.msEmployees = d.employees;
  renderMissingRows(d.employees);
}

function filterMissingRows() {
  const q = document.getElementById('msSearch').value.toLowerCase().trim();
  const filtered = !q ? AppState.msEmployees :
    AppState.msEmployees.filter(e => e.name.toLowerCase().includes(q));
  renderMissingRows(filtered);
}

function renderMissingRows(employees) {
  const tbody = document.querySelector('#msTable tbody');
  tbody.innerHTML = '';
  if (!employees.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="loading">No employees in this range</td></tr>';
    return;
  }
  employees.forEach((e, idx) => {
    const cls = e.compliance_pct >= 90 ? 'high' : e.compliance_pct >= 70 ? 'med' : 'low';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><b style="color: var(--navy);">${e.name}</b></td>
      <td class="num">${e.expected_days}</td>
      <td class="num">${fmt.decimal(e.logged_hours_project)}h</td>
      <td class="num"><b style="color: var(--blue);">${fmt.decimal(e.logged_hours_total)}h</b></td>
      <td class="num"><b style="color: ${e.missing_hours > 0 ? 'var(--red)' : 'var(--green)'}">${fmt.decimal(e.missing_hours)}h</b></td>
      <td class="compliance-cell">
        <div class="compliance-bar"><div class="compliance-fill ${cls}" style="width:${Math.min(e.compliance_pct, 100)}%"></div></div>
        <div class="compliance-pct">${fmt.decimal(e.compliance_pct)}%</div>
      </td>
      <td>${(e.missing_dates_detail.length || e.underlogged_dates_detail.length) ?
        `<button class="see-details-btn" data-idx="${idx}">See details →</button>` :
        '<span class="muted-text">All clear ✓</span>'}</td>
    `;
    tbody.appendChild(tr);

    // Detail row (hidden initially)
    if (e.missing_dates_detail.length || e.underlogged_dates_detail.length) {
      const detailTr = document.createElement('tr');
      detailTr.className = 'missing-detail-row';
      detailTr.style.display = 'none';
      detailTr.dataset.parent = idx;

      let detailHtml = '<div class="missing-detail-content">';
      if (e.missing_dates_detail.length) {
        detailHtml += '<div style="font-size:11px; font-weight:600; letter-spacing:0.1em; color:var(--red); margin-bottom:4px;">FULL MISSING DAYS (no logs anywhere)</div>';
        e.missing_dates_detail.forEach(m => {
          detailHtml += `
            <div class="missing-day-line">
              <span><b>${m.date}</b></span>
              <span style="color:var(--red);">Missing: ${m.missing_hrs}h</span>
              <span style="color:var(--text-muted);">Logged: ${m.logged_hrs}h</span>
              <span style="color:var(--text-muted);">${m.reason}</span>
            </div>`;
        });
      }
      if (e.underlogged_dates_detail.length) {
        detailHtml += '<div style="font-size:11px; font-weight:600; letter-spacing:0.1em; color:var(--amber); margin: 8px 0 4px;">PARTIAL DAYS (logged less than 8h total)</div>';
        e.underlogged_dates_detail.forEach(m => {
          detailHtml += `
            <div class="missing-day-line under">
              <span><b>${m.date}</b></span>
              <span style="color:var(--amber);">Missing: ${fmt.decimal(m.missing_hrs)}h</span>
              <span style="color:var(--text-secondary);">Logged: ${fmt.decimal(m.logged_hrs)}h</span>
              <span style="color:var(--text-muted);">${m.reason}</span>
            </div>`;
        });
      }
      detailHtml += '</div>';
      detailTr.innerHTML = `<td colspan="7">${detailHtml}</td>`;
      tbody.appendChild(detailTr);
    }
  });

  // Wire see details
  tbody.querySelectorAll('.see-details-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = btn.dataset.idx;
      const detail = tbody.querySelector(`tr.missing-detail-row[data-parent="${idx}"]`);
      if (detail) {
        const visible = detail.style.display !== 'none';
        detail.style.display = visible ? 'none' : 'table-row';
        btn.textContent = visible ? 'See details →' : 'Hide details ↑';
      }
    });
  });
}
