/* Services tab - baseline / planned / actuals / status */
window.loadServices = async function() {
  AppState.loaded.services = true;
  const res = await fetch('/api/services');
  const services = await res.json();
  AppState.services = services;
  document.getElementById('servicesCount').textContent = services.length;
  document.getElementById('svTotal').textContent = services.length;
  document.getElementById('svInProgress').textContent = services.filter(s => s.status === 'In Progress').length;
  document.getElementById('svDone').textContent = services.filter(s => s.status === 'Done').length;
  document.getElementById('svOverdue').textContent = services.filter(s => s.status === 'Overdue').length;
  renderServices(services);

  // Search filter (case-insensitive)
  document.getElementById('serviceSearch').addEventListener('input', filterServices);
  document.getElementById('statusFilter').addEventListener('change', filterServices);
};

function filterServices() {
  const q = document.getElementById('serviceSearch').value.toLowerCase().trim();
  const status = document.getElementById('statusFilter').value;
  let filtered = AppState.services;
  if (q) {
    filtered = filtered.filter(s => {
      const name = (s['اسم الخدمة المستقبلي'] || '').toString().toLowerCase();
      return name.includes(q);
    });
  }
  if (status) {
    filtered = filtered.filter(s => s.status === status);
  }
  renderServices(filtered);
}

function statusKey(s) {
  return (s || 'Not Started').replace(/\s+/g, '-');
}

function renderServices(services) {
  const tbody = document.querySelector('#servicesTable tbody');
  tbody.innerHTML = '';
  if (!services.length) {
    tbody.innerHTML = '<tr><td colspan="16" class="loading">No matching services</td></tr>';
    return;
  }
  services.forEach((s, i) => {
    const name = s['اسم الخدمة المستقبلي'] || '—';
    const complexity = s['Complexity'] || '';
    const cClass = ['Basic', 'Simple', 'Medium', 'Complex'].includes(complexity)
      ? `complexity-${complexity}` : '';
    const compHtml = complexity ? `<span class="complexity-pill ${cClass}">${complexity}</span>` : '<span class="muted-text">—</span>';

    const baseline = s.baseline_by_dept || {};
    const cells = ['Dev', 'Analysis', 'UI/UX', 'QC', 'UAT', 'PM'].map(d => {
      const v = baseline[d];
      return `<td class="num">${v != null ? fmt.decimal(v) : '<span class="muted-text">—</span>'}</td>`;
    }).join('');

    const total = s['ALL'] != null ? fmt.decimal(s['ALL']) : '—';
    const actuals = s.actuals_days != null ? fmt.decimal(s.actuals_days) : '—';
    const remaining = s.remaining_baseline != null ? fmt.decimal(s.remaining_baseline) : '—';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td dir="auto" style="font-weight:500; min-width: 180px;">${name}</td>
      <td>${compHtml}</td>
      ${cells}
      <td class="num"><b>${total}</b></td>
      <td class="num">${actuals}d</td>
      <td class="num"><b style="color: ${s.remaining_baseline > 0 ? 'var(--amber)' : 'var(--green)'}">${remaining}d</b></td>
      <td>
        <select class="status-select" data-id="${i}">
          <option value="Not Started" ${s.status === 'Not Started' ? 'selected' : ''}>Not Started</option>
          <option value="In Progress" ${s.status === 'In Progress' ? 'selected' : ''}>In Progress</option>
          <option value="At Risk" ${s.status === 'At Risk' ? 'selected' : ''}>At Risk</option>
          <option value="Done" ${s.status === 'Done' ? 'selected' : ''}>Done</option>
          <option value="Overdue" ${s.status === 'Overdue' ? 'selected' : ''}>Overdue</option>
        </select>
      </td>
      <td><span class="muted-text">— TBD —</span></td>
      <td><span style="font-family: var(--mono); font-size: 12px;">${s.planned_end || '—'}</span></td>
      <td><span style="font-family: var(--mono); font-size: 12px; color: ${s.expected_end && s.planned_end && s.expected_end > s.planned_end ? 'var(--red)' : 'var(--text)'}">${s.expected_end || '—'}</span></td>
    `;
    tbody.appendChild(tr);
  });
}
