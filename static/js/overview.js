/* Overview tab — Roadmap KPIs + Tasks Analysis with multi-phase + employee filter */

window.loadOverview = async function() {
  if (!AppState.loaded.overview) {
    AppState.loaded.overview = true;
    AppState.currentOverviewPhase = 'development';
    AppState.expandedTasks = new Set();
    AppState.activePhases = null; // null = use defaults

    document.querySelectorAll('#overviewSubTabs .sub-tab').forEach(b => {
      b.addEventListener('click', () => {
        const phase = b.dataset.ovphase;
        AppState.currentOverviewPhase = phase;
        AppState.activePhases = null; // reset to defaults
        AppState.activeEmployees = [];
        document.querySelectorAll('#overviewSubTabs .sub-tab').forEach(x =>
          x.classList.toggle('active', x.dataset.ovphase === phase));
        loadTaskAnalysis(phase);
      });
    });

    document.getElementById('ovTaskSearch').addEventListener('input', () =>
      renderTaskList(AppState.currentOverviewPhase));
    document.getElementById('ovTaskType').addEventListener('change', () =>
      renderTaskList(AppState.currentOverviewPhase));
    document.getElementById('ovTaskStatus').addEventListener('change', () =>
      renderTaskList(AppState.currentOverviewPhase));
  }

  await loadOverviewKPIs();
  await loadTaskAnalysis(AppState.currentOverviewPhase);
};

async function loadOverviewKPIs() {
  try {
    const res = await fetch('/api/overview');
    const d = await res.json();
    document.getElementById('ovPeriod').textContent =
      `${d.roadmap_start} → ${d.roadmap_end}` + (d.duration_months ? ` (${d.duration_months} months)` : '');
    document.getElementById('kpiServices').textContent = d.total_services || 0;
    document.getElementById('kpiMandays').textContent = fmt.num(d.total_mandays || 0);
    document.getElementById('kpiTeams').textContent = d.teams_count || 0;
    document.getElementById('kpiTeamsList').textContent = (d.teams || []).join(' · ') || '—';
    document.getElementById('kpiProgress').textContent = d.progress_pct || 0;
    document.getElementById('kpiDays').textContent =
      `${d.days_elapsed || 0} days elapsed · ${d.days_remaining || 0} days remaining`;
  } catch (e) {
    console.error('Overview KPIs error:', e);
  }
}

async function loadTaskAnalysis(phaseGroup) {
  const cont = document.getElementById('ovAnalysisContent');
  const summary = document.getElementById('ovAnalysisSummary');
  cont.innerHTML = '<div class="loading">Loading task analysis from Odoo…</div>';
  summary.innerHTML = '';

  // Build query string
  const params = new URLSearchParams();
  if (AppState.activePhases && AppState.activePhases.length) {
    params.set('phases', AppState.activePhases.join(','));
  }
  if (AppState.activeEmployees && AppState.activeEmployees.length) {
    params.set('employees', AppState.activeEmployees.join(','));
  }

  try {
    const res = await fetch(`/api/overview/analysis/${phaseGroup}?` + params.toString());
    const d = await res.json();

    if (!d.connected) {
      cont.innerHTML = `<div class="banner banner-warn"><strong>${d.error || 'Odoo unreachable'}</strong></div>`;
      return;
    }

    AppState.ovAnalysisData = d;
    if (!AppState.activePhases) AppState.activePhases = d.phases_active || [];
    if (!AppState.activeEmployees) AppState.activeEmployees = [];

    renderPhaseFilters(phaseGroup, d.phases_available || []);
    renderEmployeeFilter(d.employees_available || []);
    renderSummary(d.summary);
    renderTaskList(phaseGroup);
  } catch (e) {
    cont.innerHTML = `<div class="banner banner-warn"><strong>Error:</strong> ${e.message}</div>`;
  }
}

function renderPhaseFilters(phaseGroup, available) {
  const cont = document.getElementById('ovPhaseFilters');
  if (!cont) return;
  if (!available.length) {
    cont.innerHTML = '';
    return;
  }
  let html = '<label class="filter-label">PHASES (multi-select)</label>';
  html += '<div class="phase-dropdown" id="ovPhaseDropdown">';
  html += '<button type="button" class="phase-toggle" id="ovPhaseToggle">';
  html += `<span id="ovPhaseLabel">${phaseLabel(AppState.activePhases || [])}</span>`;
  html += '<span style="margin-left:8px; color: var(--text-muted);">▼</span>';
  html += '</button>';
  html += '<div class="phase-menu" id="ovPhaseMenu" style="display:none;">';
  html += '<div class="phase-menu-actions">';
  html += '<a id="ovPhaseAll">Select all</a>';
  html += '<a id="ovPhaseNone">Clear</a>';
  html += '</div>';
  available.forEach(p => {
    const checked = (AppState.activePhases || []).includes(p);
    html += `<label class="phase-option ${checked ? 'selected' : ''}" data-phase="${encodeURIComponent(p)}">
      <input type="checkbox" ${checked ? 'checked' : ''}>
      <span dir="auto">${p}</span>
    </label>`;
  });
  html += '</div></div>';
  cont.innerHTML = html;

  // Wire dropdown toggle
  const toggle = document.getElementById('ovPhaseToggle');
  const menu = document.getElementById('ovPhaseMenu');
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
    toggle.classList.toggle('open', menu.style.display === 'block');
  });
  document.addEventListener('click', (e) => {
    if (!document.getElementById('ovPhaseDropdown')?.contains(e.target)) {
      menu.style.display = 'none';
      toggle.classList.remove('open');
    }
  });

  // Wire checkboxes
  menu.querySelectorAll('.phase-option').forEach(opt => {
    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      const phase = decodeURIComponent(opt.dataset.phase);
      const cb = opt.querySelector('input');
      if (e.target !== cb) cb.checked = !cb.checked;
      AppState.activePhases = AppState.activePhases || [];
      if (cb.checked) {
        if (!AppState.activePhases.includes(phase)) AppState.activePhases.push(phase);
        opt.classList.add('selected');
      } else {
        AppState.activePhases = AppState.activePhases.filter(p => p !== phase);
        opt.classList.remove('selected');
      }
      document.getElementById('ovPhaseLabel').textContent = phaseLabel(AppState.activePhases);
      // Reload data with new filter
      loadTaskAnalysis(phaseGroup);
    });
  });
  menu.querySelector('#ovPhaseAll').addEventListener('click', (e) => {
    e.stopPropagation();
    AppState.activePhases = [...available];
    loadTaskAnalysis(phaseGroup);
  });
  menu.querySelector('#ovPhaseNone').addEventListener('click', (e) => {
    e.stopPropagation();
    AppState.activePhases = [];
    loadTaskAnalysis(phaseGroup);
  });
}

function phaseLabel(phases) {
  const total = (AppState.ovAnalysisData?.phases_available || []).length;
  if (!phases || phases.length === 0) return 'No phase selected';
  if (phases.length === 1) return phases[0];
  if (phases.length === total) return `All phases (${total})`;
  return `${phases.length} phases selected`;
}

function renderEmployeeFilter(employees) {
  const cont = document.getElementById('ovEmployeeFilters');
  if (!cont || !employees.length) {
    if (cont) cont.innerHTML = '';
    return;
  }
  let html = '<label class="filter-label">EMPLOYEE (multi-select)</label>';
  html += '<div class="phase-dropdown" id="ovEmpDropdown">';
  html += '<button type="button" class="phase-toggle" id="ovEmpToggle">';
  html += `<span id="ovEmpLabel">${empLabel(AppState.activeEmployees, employees.length)}</span>`;
  html += '<span style="margin-left:8px; color: var(--text-muted);">▼</span>';
  html += '</button>';
  html += '<div class="phase-menu" id="ovEmpMenu" style="display:none; max-height: 360px;">';
  html += '<div class="phase-menu-actions">';
  html += '<a id="ovEmpAll">Select all</a>';
  html += '<a id="ovEmpNone">Clear</a>';
  html += '</div>';
  employees.forEach(e => {
    const checked = (AppState.activeEmployees || []).includes(e);
    html += `<label class="phase-option ${checked ? 'selected' : ''}" data-emp="${encodeURIComponent(e)}">
      <input type="checkbox" ${checked ? 'checked' : ''}>
      <span dir="auto">${e}</span>
    </label>`;
  });
  html += '</div></div>';
  cont.innerHTML = html;

  const toggle = document.getElementById('ovEmpToggle');
  const menu = document.getElementById('ovEmpMenu');
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
    toggle.classList.toggle('open', menu.style.display === 'block');
  });
  document.addEventListener('click', (e) => {
    if (!document.getElementById('ovEmpDropdown')?.contains(e.target)) {
      menu.style.display = 'none';
      toggle.classList.remove('open');
    }
  });

  menu.querySelectorAll('.phase-option').forEach(opt => {
    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      const emp = decodeURIComponent(opt.dataset.emp);
      const cb = opt.querySelector('input');
      if (e.target !== cb) cb.checked = !cb.checked;
      AppState.activeEmployees = AppState.activeEmployees || [];
      if (cb.checked) {
        if (!AppState.activeEmployees.includes(emp)) AppState.activeEmployees.push(emp);
        opt.classList.add('selected');
      } else {
        AppState.activeEmployees = AppState.activeEmployees.filter(p => p !== emp);
        opt.classList.remove('selected');
      }
      document.getElementById('ovEmpLabel').textContent = empLabel(AppState.activeEmployees, employees.length);
      loadTaskAnalysis(AppState.currentOverviewPhase);
    });
  });
  menu.querySelector('#ovEmpAll').addEventListener('click', (e) => {
    e.stopPropagation();
    AppState.activeEmployees = [...employees];
    loadTaskAnalysis(AppState.currentOverviewPhase);
  });
  menu.querySelector('#ovEmpNone').addEventListener('click', (e) => {
    e.stopPropagation();
    AppState.activeEmployees = [];
    loadTaskAnalysis(AppState.currentOverviewPhase);
  });
}

function empLabel(emps, total) {
  if (!emps || emps.length === 0) return 'All employees';
  if (emps.length === 1) return emps[0];
  if (emps.length === total) return `All (${total})`;
  return `${emps.length} employees selected`;
}

function renderSummary(s) {
  const summary = document.getElementById('ovAnalysisSummary');
  if (!s) { summary.innerHTML = ''; return; }
  const overallColor = s.overall_progress_pct >= 100 ? 'kpi-green'
    : s.overall_progress_pct >= 75 ? 'kpi-blue'
    : s.overall_progress_pct >= 40 ? 'kpi-amber' : 'kpi-red';
  summary.innerHTML = `
    <div class="kpi-strip kpi-strip-small" style="margin-bottom: 16px;">
      <div class="kpi-card kpi-blue compact">
        <div class="kpi-label">TASKS</div>
        <div class="kpi-value">${s.total_tasks || 0}</div>
        <div class="kpi-foot">${s.parent_tasks || 0} parents · ${s.sub_tasks || 0} subs</div>
      </div>
      <div class="kpi-card kpi-navy compact">
        <div class="kpi-label">PLANNED HOURS</div>
        <div class="kpi-value">${fmt.num(s.total_planned_hours || 0)}</div>
        <div class="kpi-foot">${fmt.num(s.total_planned_days || 0)} days</div>
      </div>
      <div class="kpi-card kpi-green compact">
        <div class="kpi-label">ACTUAL HOURS</div>
        <div class="kpi-value">${fmt.num(s.total_actual_hours || 0)}</div>
        <div class="kpi-foot">${fmt.num(s.total_actual_days || 0)} days</div>
      </div>
      <div class="kpi-card ${overallColor} compact">
        <div class="kpi-label">OVERALL PROGRESS</div>
        <div class="kpi-value">${fmt.decimal(s.overall_progress_pct || 0)}<span class="kpi-unit">%</span></div>
        <div class="kpi-foot">${s.tasks_completed || 0} done · ${s.tasks_in_progress || 0} active</div>
      </div>
    </div>
  `;
}

function renderTaskList(phaseGroup) {
  const cont = document.getElementById('ovAnalysisContent');
  const data = AppState.ovAnalysisData;
  if (!data || !data.tasks) { cont.innerHTML = '<div class="loading">No data</div>'; return; }

  const search = (document.getElementById('ovTaskSearch')?.value || '').toLowerCase().trim();
  const typeFilter = document.getElementById('ovTaskType')?.value || 'all';
  const statusFilter = document.getElementById('ovTaskStatus')?.value || 'all';

  let tasks = data.tasks;

  if (search) {
    tasks = tasks.filter(t =>
      (t.name || '').toLowerCase().includes(search) ||
      (t.parent_name || '').toLowerCase().includes(search)
    );
  }
  if (typeFilter === 'parents') {
    tasks = tasks.filter(t => t.is_parent);
  } else if (typeFilter === 'subtasks') {
    tasks = tasks.filter(t => !t.is_parent);
  }
  if (statusFilter === 'not_started') {
    tasks = tasks.filter(t => t.progress_pct === 0);
  } else if (statusFilter === 'in_progress') {
    tasks = tasks.filter(t => t.progress_pct > 0 && t.progress_pct < 100);
  } else if (statusFilter === 'completed') {
    tasks = tasks.filter(t => t.progress_pct >= 100 && t.progress_pct <= 110);
  } else if (statusFilter === 'overdue') {
    tasks = tasks.filter(t => t.progress_pct > 110);
  }

  if (!tasks.length) {
    cont.innerHTML = '<div class="card"><div class="loading">No tasks match the filters.</div></div>';
    return;
  }

  // Group all tasks by their immediate parent_id (handles multi-level hierarchy)
  const byParent = new Map(); // parent_id -> [children at this level]
  const taskIdSet = new Set(tasks.map(t => t.id));
  const rootTasks = []; // tasks whose parent is NOT in our list

  tasks.forEach(t => {
    if (t.parent_id && taskIdSet.has(t.parent_id)) {
      // Has a parent that's in our task list — group under it
      if (!byParent.has(t.parent_id)) byParent.set(t.parent_id, []);
      byParent.get(t.parent_id).push(t);
    } else {
      // No parent in our list (top-level / orphan)
      rootTasks.push(t);
    }
  });

  // Recursive renderer that handles unlimited nesting
  function renderTaskBranch(task, depth) {
    const children = byParent.get(task.id) || [];
    let html = renderTaskCard(task, children.length, depth > 0);
    if (children.length && AppState.expandedTasks.has(task.id)) {
      html += `<div class="task-children" style="margin-left: ${depth * 12}px;">`;
      // Sort children by progress desc, then name
      children.sort((a, b) => (b.progress_pct || 0) - (a.progress_pct || 0)
                              || (a.name || '').localeCompare(b.name || ''));
      children.forEach(c => { html += renderTaskBranch(c, depth + 1); });
      html += '</div>';
    }
    return html;
  }

  // Sort root tasks alphabetically
  rootTasks.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  let html = `<div class="card">
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
      <h3 class="card-title" style="margin:0;">Tasks <span class="muted-text">— ${tasks.length} item${tasks.length !== 1 ? 's' : ''}</span></h3>
      <span class="muted-text" style="font-size: 11px;">Click parent to expand sub-tasks · Live from Odoo</span>
    </div>
    <div class="task-analysis-list">`;

  rootTasks.forEach(t => {
    html += renderTaskBranch(t, 0);
  });

  html += `</div></div>`;
  cont.innerHTML = html;

  // Wire expand clicks
  cont.querySelectorAll('[data-expand-id]').forEach(el => {
    el.addEventListener('click', () => {
      const id = parseInt(el.dataset.expandId);
      if (AppState.expandedTasks.has(id)) AppState.expandedTasks.delete(id);
      else AppState.expandedTasks.add(id);
      renderTaskList(phaseGroup);
    });
  });
}

function renderTaskCard(t, childCount, isChild) {
  const p = t.progress_pct || 0;
  let progressColor, progressLabel;
  if (p === 0) { progressColor = 'var(--text-muted)'; progressLabel = 'Not started'; }
  else if (p >= 100 && p <= 110) { progressColor = 'var(--green)'; progressLabel = 'Done'; }
  else if (p > 110) { progressColor = 'var(--red)'; progressLabel = 'Over budget'; }
  else if (p >= 75) { progressColor = '#10B981'; progressLabel = 'On track'; }
  else if (p >= 40) { progressColor = '#F59E0B'; progressLabel = 'In progress'; }
  else { progressColor = '#EF4444'; progressLabel = 'Behind'; }

  // Stage badge color
  const stageColor = stageColorMap(t.stage);

  const allocHtml = (t.allocation || []).slice(0, 4).map(a =>
    `<span class="alloc-pill" title="${a.hours}h">${a.name} <small>${fmt.decimal(a.hours)}h</small></span>`
  ).join('');
  const moreCount = Math.max(0, (t.allocation?.length || 0) - 4);

  const dateRange = t.first_log
    ? `${t.first_log}${t.last_log && t.last_log !== t.first_log ? ' → ' + t.last_log : ''}`
    : '';

  const widthBar = Math.min(150, p);
  const isExpanded = AppState.expandedTasks.has(t.id);
  const expandIcon = childCount > 0
    ? `<span class="task-expand-icon" data-expand-id="${t.id}">${isExpanded ? '▼' : '▶'}</span>`
    : '';

  return `
    <div class="task-card ${t.is_parent ? 'task-parent' : 'task-sub'} ${isChild ? 'task-is-child' : ''}">
      <div class="task-card-head">
        <div style="flex: 1; min-width: 0; display: flex; gap: 8px; align-items: flex-start;">
          ${expandIcon}
          <div style="flex: 1; min-width: 0;">
            ${t.parent_name && !isChild ? `<div class="task-parent-link" dir="auto">↳ ${t.parent_name}</div>` : ''}
            <div class="task-name" dir="auto">
              ${t.is_parent ? '📁 ' : ''}${t.name || '—'}
              ${childCount > 0 ? `<span class="subtask-count" data-expand-id="${t.id}">${childCount} sub-task${childCount !== 1 ? 's' : ''}</span>` : ''}
            </div>
            <div class="task-meta">
              ${t.phase ? `<span class="task-meta-badge">${t.phase}</span>` : ''}
              ${t.stage ? `<span class="task-meta-badge stage-pill" style="background: ${stageColor}20; color: ${stageColor}; border: 1px solid ${stageColor};">${t.stage}</span>` : ''}
              ${t.deadline ? `<span class="task-meta-badge deadline-badge">⏰ ${t.deadline}</span>` : ''}
            </div>
          </div>
        </div>
        <div class="task-progress-num" style="color: ${progressColor};">
          ${fmt.decimal(p)}<small>%</small>
        </div>
      </div>

      <div class="task-progress-bar">
        <div class="task-progress-fill" style="width: ${widthBar}%; background: ${progressColor};"></div>
        ${p > 100 ? `<div class="task-progress-overflow" style="width: ${Math.min(50, p - 100)}%;"></div>` : ''}
      </div>

      <div class="task-card-stats">
        <div class="task-stat">
          <div class="task-stat-label">PLANNED</div>
          <div class="task-stat-value">${fmt.decimal(t.planned_hours)}<small>h</small></div>
          <div class="task-stat-sub">${fmt.decimal(t.planned_days)} d</div>
        </div>
        <div class="task-stat-arrow">→</div>
        <div class="task-stat">
          <div class="task-stat-label">ACTUAL</div>
          <div class="task-stat-value" style="color: ${progressColor};">${fmt.decimal(t.actual_hours)}<small>h</small></div>
          <div class="task-stat-sub">${fmt.decimal(t.actual_days)} d</div>
        </div>
        <div class="task-stat-spacer"></div>
        <div class="task-stat-status">
          <span class="status-pill" style="background: ${progressColor}20; color: ${progressColor}; border: 1px solid ${progressColor};">${progressLabel}</span>
        </div>
      </div>

      ${t.allocation && t.allocation.length ? `
        <div class="task-allocation">
          <div class="task-alloc-label">Allocation:</div>
          <div class="task-alloc-list">
            ${allocHtml}
            ${moreCount ? `<span class="alloc-more">+${moreCount} more</span>` : ''}
          </div>
        </div>
      ` : ''}

      ${dateRange ? `<div class="task-dates">📅 ${dateRange}</div>` : ''}
    </div>
  `;
}

function stageColorMap(stage) {
  if (!stage) return 'var(--text-muted)';
  const s = stage.toLowerCase();
  if (s.includes('backlog') || s.includes('new')) return '#6B7280';
  if (s.includes('progress') || s.includes('active') || s.includes('doing')) return '#3B82F6';
  if (s.includes('done') || s.includes('closed') || s.includes('complete')) return '#10B981';
  if (s.includes('block') || s.includes('hold')) return '#EF4444';
  if (s.includes('review') || s.includes('test')) return '#F59E0B';
  return '#6366F1';
}
