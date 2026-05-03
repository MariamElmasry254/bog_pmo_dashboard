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
    populateStageFilter(d.stages_used || []);
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

function populateStageFilter(stagesUsed) {
  const sel = document.getElementById('ovTaskStatus');
  if (!sel) return;
  const currentValue = sel.value;
  // Get unique stage names
  const stageNames = (stagesUsed || []).map(s => s.name).filter(Boolean);
  const uniqueStages = [...new Set(stageNames)].sort();

  let html = '<option value="all">All stages</option>';
  uniqueStages.forEach(name => {
    html += `<option value="${name.toLowerCase()}">${name}</option>`;
  });
  sel.innerHTML = html;
  // Restore selection if still valid
  if ([...sel.options].some(o => o.value === currentValue)) {
    sel.value = currentValue;
  }
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

  // Build full task lookup
  const allTasks = data.tasks;
  const taskById = new Map(allTasks.map(t => [t.id, t]));

  // Build set of parent IDs (tasks that have at least one child in the dataset)
  const parentIdsInData = new Set();
  allTasks.forEach(t => {
    if (t.parent_id && taskById.has(t.parent_id)) parentIdsInData.add(t.parent_id);
  });

  // Step 1: find which tasks match the filters (direct matches)
  let matchedIds = new Set();
  allTasks.forEach(t => {
    let pass = true;
    if (search) {
      const matchSearch = (t.name || '').toLowerCase().includes(search);
      if (!matchSearch) pass = false;
    }
    const isActuallyParent = parentIdsInData.has(t.id);
    if (pass && typeFilter === 'parents' && !isActuallyParent) pass = false;
    if (pass && typeFilter === 'subtasks' && isActuallyParent) pass = false;
    if (pass && statusFilter && statusFilter !== 'all') {
      // Stage filter: match by stage name (case insensitive)
      const taskStage = (t.stage || '').toLowerCase().trim();
      if (taskStage !== statusFilter.toLowerCase()) pass = false;
    }
    if (pass) matchedIds.add(t.id);
  });

  // Step 2: include all ancestors of matched tasks (so the tree shows context)
  const visibleIds = new Set(matchedIds);
  const expandedForSearch = new Set();
  matchedIds.forEach(id => {
    let cur = taskById.get(id);
    while (cur && cur.parent_id) {
      const parent = taskById.get(cur.parent_id);
      if (!parent) break;
      visibleIds.add(parent.id);
      // Auto-expand parents when searching so matches are visible
      if (search) expandedForSearch.add(parent.id);
      cur = parent;
    }
  });

  let tasks = allTasks.filter(t => visibleIds.has(t.id));

  if (!tasks.length) {
    cont.innerHTML = '<div class="card"><div class="loading">No tasks match the filters.</div></div>';
    return;
  }

  // Group all tasks by their immediate parent_id (handles multi-level hierarchy)
  const byParent = new Map();
  const taskIdSet = new Set(tasks.map(t => t.id));
  const rootTasks = [];

  tasks.forEach(t => {
    if (t.parent_id && taskIdSet.has(t.parent_id)) {
      if (!byParent.has(t.parent_id)) byParent.set(t.parent_id, []);
      byParent.get(t.parent_id).push(t);
    } else {
      rootTasks.push(t);
    }
  });

  function renderTaskBranch(task, depth) {
    const children = byParent.get(task.id) || [];
    let html = renderTaskCard(task, children.length, depth, matchedIds.has(task.id));
    const isExpanded = AppState.expandedTasks.has(task.id) || expandedForSearch.has(task.id);
    if (children.length && isExpanded) {
      html += `<div class="task-children" style="margin-left: ${Math.min(depth * 12, 36)}px;">`;
      children.sort((a, b) => (b.progress_pct || 0) - (a.progress_pct || 0)
                              || (a.name || '').localeCompare(b.name || ''));
      children.forEach(c => { html += renderTaskBranch(c, depth + 1); });
      html += '</div>';
    }
    return html;
  }

  rootTasks.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  let html = `<div class="card">
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
      <h3 class="card-title" style="margin:0;">Tasks <span class="muted-text">— ${matchedIds.size} match${matchedIds.size !== 1 ? 'es' : ''}${matchedIds.size < tasks.length ? ` · ${tasks.length - matchedIds.size} parent context` : ''}</span></h3>
      <span class="muted-text" style="font-size: 11px;">Click parent to expand · Live from Odoo</span>
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

function renderTaskCard(t, childCount, depth, isMatched) {
  // For PARENT (has children): use roll-up data from sub-tasks
  // For LEAF (no children, has its own work): use direct data
  const hasChildren = childCount > 0;

  let plannedH, actualH, remainingH, progressP;
  if (hasChildren) {
    // Parent: show sum of sub-tasks
    plannedH = t.subtask_planned_hours || 0;
    actualH = t.subtask_actual_hours || 0;
    remainingH = Math.max(0, plannedH - actualH);
    progressP = plannedH > 0 ? Math.min(150, (actualH / plannedH * 100)) : 0;
  } else {
    // Leaf task: own data
    plannedH = t.planned_hours || 0;
    actualH = t.actual_hours || 0;
    remainingH = Math.max(0, plannedH - actualH);
    progressP = t.progress_pct || 0;
  }

  let progressColor, progressLabel;
  if (progressP === 0) { progressColor = '#9CA3AF'; progressLabel = 'Not started'; }
  else if (progressP >= 100 && progressP <= 110) { progressColor = '#10B981'; progressLabel = 'Done'; }
  else if (progressP > 110) { progressColor = '#EF4444'; progressLabel = 'Over budget'; }
  else if (progressP >= 75) { progressColor = '#10B981'; progressLabel = 'On track'; }
  else if (progressP >= 40) { progressColor = '#F59E0B'; progressLabel = 'In progress'; }
  else { progressColor = '#EF4444'; progressLabel = 'Behind'; }

  const stageColor = stageColorMap(t.stage);
  const isExpanded = AppState.expandedTasks.has(t.id);
  const widthBar = Math.min(150, progressP);
  const isChild = depth > 0;

  // For parent display, show rolled-up allocation; for leaf, show own
  const displayAlloc = hasChildren
    ? Object.entries(t.rollup_allocation || {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, h]) => ({ name: n, hours: h }))
    : (t.allocation || []).slice(0, 3);

  const allocHtml = displayAlloc.map(a =>
    `<span class="alloc-pill-mini" title="${a.hours}h">${a.name}</span>`
  ).join('');
  const totalAllocCount = hasChildren
    ? Object.keys(t.rollup_allocation || {}).length
    : (t.allocation?.length || 0);
  const moreCount = Math.max(0, totalAllocCount - 3);

  const expandIcon = hasChildren
    ? `<span class="task-expand-icon" data-expand-id="${t.id}">${isExpanded ? '▼' : '▶'}</span>`
    : '<span class="task-expand-spacer"></span>';

  const matchedClass = isMatched ? '' : ' task-context-only';

  return `
    <div class="task-card-compact ${hasChildren ? 'task-parent-c' : 'task-leaf-c'}${matchedClass}">
      <div class="tcc-row1">
        ${expandIcon}
        <div class="tcc-name-block">
          <div class="tcc-name" dir="auto">
            ${hasChildren ? '📁' : '📄'} ${t.name || '—'}
            ${hasChildren ? `<span class="tcc-sub-count" data-expand-id="${t.id}">${childCount} sub${childCount !== 1 ? 's' : ''}</span>` : ''}
          </div>
          <div class="tcc-meta">
            ${t.stage ? `<span class="tcc-pill" style="background: ${stageColor}18; color: ${stageColor}; border-color: ${stageColor}40;">${t.stage}</span>` : ''}
            ${t.deadline ? `<span class="tcc-pill tcc-deadline">⏰ ${t.deadline}</span>` : ''}
          </div>
        </div>
        <div class="tcc-stats">
          <div class="tcc-stat">
            <div class="tcc-stat-lbl">${hasChildren ? 'SUB-PLANNED' : 'PLANNED'}</div>
            <div class="tcc-stat-val">${fmt.decimal(plannedH)}<small>h</small></div>
          </div>
          <div class="tcc-stat">
            <div class="tcc-stat-lbl">${hasChildren ? 'SUB-SPENT' : 'SPENT'}</div>
            <div class="tcc-stat-val" style="color: ${progressColor};">${fmt.decimal(actualH)}<small>h</small></div>
          </div>
          <div class="tcc-stat">
            <div class="tcc-stat-lbl">REMAIN</div>
            <div class="tcc-stat-val">${fmt.decimal(remainingH)}<small>h</small></div>
          </div>
          <div class="tcc-progress-num" style="color: ${progressColor};">
            ${fmt.decimal(progressP)}<small>%</small>
          </div>
        </div>
      </div>
      <div class="tcc-progress-bar">
        <div class="tcc-progress-fill" style="width: ${widthBar}%; background: ${progressColor};"></div>
        ${progressP > 100 ? `<div class="tcc-progress-over" style="width: ${Math.min(50, progressP - 100)}%;"></div>` : ''}
      </div>
      ${(allocHtml || progressLabel) ? `
        <div class="tcc-row2">
          <span class="tcc-status" style="background: ${progressColor}18; color: ${progressColor};">${progressLabel}</span>
          ${allocHtml ? `<div class="tcc-allocs">${allocHtml}${moreCount ? `<span class="tcc-more">+${moreCount}</span>` : ''}</div>` : ''}
        </div>
      ` : ''}
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
