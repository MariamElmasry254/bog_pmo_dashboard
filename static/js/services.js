/* Services tab — department sub-tabs with auto-save */

const STATUS_OPTIONS = ['Not Started', 'In Progress', 'At Risk', 'Done', 'Overdue'];

window.loadServices = async function() {
  const cont = document.getElementById('servicesContent');
  cont.innerHTML = '<div class="loading">Loading services…</div>';

  try {
    const res = await fetch('/api/services');
    const d = await res.json();
    AppState.servicesData = d;
    AppState.currentDept = AppState.currentDept || 'Dev';
    AppState.loaded.services = true;

    renderDeptTabs(d.departments);
    updateKpis();
    renderDeptTable(AppState.currentDept);
    wireFilters();
  } catch (err) {
    cont.innerHTML = `<div class="banner banner-warn"><strong>Error:</strong> ${err.message}</div>`;
  }
};

function renderDeptTabs(departments) {
  const bar = document.getElementById('deptTabsBar');
  if (!bar) return;
  bar.innerHTML = '';
  departments.forEach(dept => {
    const btn = document.createElement('button');
    btn.className = 'sub-tab' + (dept === AppState.currentDept ? ' active' : '');
    btn.dataset.dept = dept;
    // Count services in this dept
    const count = (AppState.servicesData?.services || [])
      .filter(s => s.departments[dept]?.has_baseline).length;
    btn.innerHTML = `${dept} <span class="phase-count-badge" style="margin-left: 6px;">${count}</span>`;
    btn.addEventListener('click', () => {
      AppState.currentDept = dept;
      document.querySelectorAll('#deptTabsBar .sub-tab').forEach(b =>
        b.classList.toggle('active', b.dataset.dept === dept));
      renderDeptTable(dept);
    });
    bar.appendChild(btn);
  });
}

function updateKpis() {
  const services = AppState.servicesData?.services || [];
  let total = 0, inProgress = 0, done = 0, overdue = 0;
  // Count distinct services with at least one dept having baseline
  const seen = new Set();
  services.forEach(s => {
    let hasAny = false;
    Object.values(s.departments).forEach(d => {
      if (d.has_baseline) {
        hasAny = true;
        if (d.status === 'In Progress') inProgress++;
        else if (d.status === 'Done') done++;
        else if (d.status === 'Overdue') overdue++;
      }
    });
    if (hasAny && !seen.has(s.name)) {
      seen.add(s.name);
      total++;
    }
  });
  document.getElementById('svcKpiTotal').textContent = total;
  document.getElementById('svcKpiProgress').textContent = inProgress;
  document.getElementById('svcKpiDone').textContent = done;
  document.getElementById('svcKpiOverdue').textContent = overdue;
}

function wireFilters() {
  document.getElementById('svcSearch').addEventListener('input', () =>
    renderDeptTable(AppState.currentDept));
  document.getElementById('svcStatusFilter').addEventListener('change', () =>
    renderDeptTable(AppState.currentDept));
}

function renderDeptTable(dept) {
  const cont = document.getElementById('servicesContent');
  const services = AppState.servicesData?.services || [];
  const today = AppState.servicesData?.today || new Date().toISOString().split('T')[0];

  const search = (document.getElementById('svcSearch')?.value || '').toLowerCase().trim();
  const statusFilter = document.getElementById('svcStatusFilter')?.value || '';

  // Filter to services with baseline in this dept
  let rows = services.filter(s => s.departments[dept]?.has_baseline);

  if (search) {
    rows = rows.filter(s => s.name.toLowerCase().includes(search));
  }
  if (statusFilter) {
    rows = rows.filter(s => s.departments[dept]?.status === statusFilter);
  }

  // Sort: Done items go to bottom; everything else by planned_start (roadmap order)
  rows.sort((a, b) => {
    const aDone = a.departments[dept]?.status === 'Done' ? 1 : 0;
    const bDone = b.departments[dept]?.status === 'Done' ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    // Then by planned start
    const aStart = a.planned_start || '9999-12-31';
    const bStart = b.planned_start || '9999-12-31';
    if (aStart !== bStart) return aStart < bStart ? -1 : 1;
    return (a.name || '').localeCompare(b.name || '');
  });

  if (!rows.length) {
    cont.innerHTML = `<div class="card"><div class="loading">No services with baseline for <b>${dept}</b> matching the filters.</div></div>`;
    return;
  }

  let html = `
    <div class="card">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <h3 class="card-title" style="margin: 0;">${dept} Services <span class="muted-text">— ${rows.length} item${rows.length !== 1 ? 's' : ''}</span></h3>
        <span class="muted-text" style="font-size: 11px;">Sorted by Planned Start (Roadmap order) · Auto-saved on change</span>
      </div>
      <div class="table-scroll">
        <table class="data-table services-table">
          <thead>
            <tr>
              <th>Service Name</th>
              <th class="num">Baseline<br><small style="font-weight: 400;">(Presales)</small></th>
              <th class="num">Planned</th>
              <th class="num">Actuals<br><small style="font-weight: 400;">(Odoo)</small></th>
              <th>Assignation</th>
              <th class="num">Remaining</th>
              <th>Status</th>
              <th>Planned Start</th>
              <th>Actual Start</th>
              <th>Planned End</th>
              <th>Actual End</th>
            </tr>
          </thead>
          <tbody>
  `;

  rows.forEach(s => {
    const dd = s.departments[dept];
    const safeName = encodeURIComponent(s.name);
    const status = dd.status || 'Not Started';
    const statusClass = 'status-' + status.replace(/\s+/g, '-');

    // Status options HTML
    const statusOpts = STATUS_OPTIONS.map(o =>
      `<option value="${o}" ${o === status ? 'selected' : ''}>${o}</option>`
    ).join('');

    // Date formatting + visual cues
    const plannedStart = s.planned_start || '—';
    const plannedEnd = s.planned_end || '—';
    const actualStart = s.actual_start || '—';
    const actualEnd = s.actual_end || '—';
    const isOverdue = s.planned_end && s.planned_end < today && status !== 'Done';

    html += `
      <tr data-svc="${safeName}" data-dept="${dept}" class="${status === 'Done' ? 'row-done' : ''}">
        <td><b style="color: var(--navy);" dir="auto">${s.name}</b></td>
        <td class="num"><b>${fmt.decimal(dd.baseline)}</b><small class="muted-text"> d</small></td>
        <td class="num">
          <input type="number" step="0.5" min="0" class="svc-input"
                 data-field="planned" data-svc="${safeName}" data-dept="${dept}"
                 value="${dd.planned != null ? dd.planned : ''}"
                 placeholder="${fmt.decimal(dd.baseline)}"
                 style="width: 75px; padding: 4px 6px; font-family: var(--mono); font-size: 12px; text-align: right; border: 1px solid var(--border-strong); border-radius: 4px;">
        </td>
        <td class="num">${fmt.decimal(dd.actuals_days || 0)}<small class="muted-text"> d</small></td>
        <td>
          <input type="text" class="svc-input"
                 data-field="assignation" data-svc="${safeName}" data-dept="${dept}"
                 value="${dd.assignation || ''}"
                 placeholder="—"
                 style="width: 130px; padding: 4px 6px; font-size: 11px; border: 1px solid var(--border-strong); border-radius: 4px;">
        </td>
        <td class="num">
          <input type="number" step="0.5" class="svc-input"
                 data-field="remaining" data-svc="${safeName}" data-dept="${dept}"
                 value="${dd.remaining != null ? dd.remaining : ''}"
                 placeholder="—"
                 style="width: 70px; padding: 4px 6px; font-family: var(--mono); font-size: 12px; text-align: right; border: 1px solid var(--border-strong); border-radius: 4px;">
        </td>
        <td>
          <select class="svc-input status-select ${statusClass}"
                  data-field="status" data-svc="${safeName}" data-dept="${dept}">
            ${statusOpts}
          </select>
        </td>
        <td><span style="font-family: var(--mono); font-size: 11px;">${plannedStart}</span></td>
        <td>
          ${actualStart !== '—'
            ? `<span style="font-family: var(--mono); font-size: 11px; color: var(--blue);">${actualStart}</span>`
            : '<span class="muted-text">—</span>'}
        </td>
        <td>
          <span style="font-family: var(--mono); font-size: 11px; ${isOverdue ? 'color: var(--red); font-weight: 600;' : ''}">${plannedEnd}</span>
          ${isOverdue ? '<br><small style="color: var(--red); font-size: 9px;">overdue</small>' : ''}
        </td>
        <td>
          ${actualEnd !== '—'
            ? `<span style="font-family: var(--mono); font-size: 11px; color: var(--green); font-weight: 600;">${actualEnd}</span>`
            : '<span class="muted-text">—</span>'}
        </td>
      </tr>
    `;
  });

  html += `</tbody></table></div></div>`;
  cont.innerHTML = html;

  // Wire auto-save
  cont.querySelectorAll('.svc-input').forEach(inp => {
    const event = inp.tagName === 'SELECT' ? 'change' : 'change';
    inp.addEventListener(event, () => saveServiceField(inp));
    if (inp.tagName === 'SELECT') {
      // Update visual class on change
      inp.addEventListener('change', () => {
        const newClass = 'svc-input status-select status-' + inp.value.replace(/\s+/g, '-');
        inp.className = newClass;
      });
    }
  });
}

async function saveServiceField(inp) {
  const service_name = decodeURIComponent(inp.dataset.svc);
  const department = inp.dataset.dept;
  const field = inp.dataset.field;
  const value = inp.value;

  try {
    const res = await fetch('/api/services/override', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service_name, department, field, value })
    });
    if (res.ok) {
      // Visual feedback
      inp.style.borderColor = 'var(--green)';
      setTimeout(() => { inp.style.borderColor = 'var(--border-strong)'; }, 1500);

      // Update in-memory state so KPIs/filters reflect change
      const svc = (AppState.servicesData?.services || []).find(s => s.name === service_name);
      if (svc && svc.departments[department]) {
        if (field === 'planned' || field === 'remaining') {
          svc.departments[department][field] = parseFloat(value) || 0;
        } else {
          svc.departments[department][field] = value;
        }
      }
      // If status changed, update KPIs and re-sort (Done goes to bottom)
      if (field === 'status') {
        updateKpis();
        // Re-render the table to apply new sort
        renderDeptTable(AppState.currentDept);
      }
    } else {
      inp.style.borderColor = 'var(--red)';
    }
  } catch (e) {
    inp.style.borderColor = 'var(--red)';
    console.error('Save failed:', e);
  }
}
