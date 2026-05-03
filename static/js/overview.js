/* Overview tab — Roadmap KPIs + Task analysis from Odoo */

window.loadOverview = async function() {
  if (!AppState.loaded.overview) {
    AppState.loaded.overview = true;
    AppState.currentOverviewPhase = 'development';

    // Wire sub-tab clicks
    document.querySelectorAll('#overviewSubTabs .sub-tab').forEach(b => {
      b.addEventListener('click', () => {
        const phase = b.dataset.ovphase;
        AppState.currentOverviewPhase = phase;
        document.querySelectorAll('#overviewSubTabs .sub-tab').forEach(x =>
          x.classList.toggle('active', x.dataset.ovphase === phase));
        loadTaskAnalysis(phase);
      });
    });

    // Wire filters
    document.getElementById('ovTaskSearch').addEventListener('input', () =>
      renderTaskList(AppState.currentOverviewPhase));
    document.getElementById('ovTaskType').addEventListener('change', () =>
      renderTaskList(AppState.currentOverviewPhase));
    document.getElementById('ovTaskStatus').addEventListener('change', () =>
      renderTaskList(AppState.currentOverviewPhase));
  }

  // Load KPIs
  await loadOverviewKPIs();
  // Load default phase analysis
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

async function loadTaskAnalysis(phase) {
  const cont = document.getElementById('ovAnalysisContent');
  const summary = document.getElementById('ovAnalysisSummary');
  cont.innerHTML = '<div class="loading">Loading task analysis from Odoo…</div>';
  summary.innerHTML = '';

  try {
    const res = await fetch(`/api/overview/analysis/${phase}`);
    const d = await res.json();

    if (d.error || !d.connected) {
      cont.innerHTML = `<div class="banner banner-warn"><strong>${d.error || 'Odoo unreachable'}</strong></div>`;
      return;
    }

    AppState.ovAnalysisData = d;

    // Render summary KPIs
    if (d.summary) {
      const s = d.summary;
      const overallColor = s.overall_progress_pct >= 100 ? 'kpi-green'
        : s.overall_progress_pct >= 75 ? 'kpi-blue'
        : s.overall_progress_pct >= 40 ? 'kpi-amber' : 'kpi-red';
      summary.innerHTML = `
        <div class="kpi-strip kpi-strip-small" style="margin-bottom: 16px;">
          <div class="kpi-card kpi-blue compact">
            <div class="kpi-label">TOTAL TASKS</div>
            <div class="kpi-value">${s.total_tasks || 0}</div>
            <div class="kpi-foot">${s.tasks_with_planning || 0} with planning</div>
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

    renderTaskList(phase);
  } catch (e) {
    cont.innerHTML = `<div class="banner banner-warn"><strong>Error:</strong> ${e.message}</div>`;
  }
}

function renderTaskList(phase) {
  const cont = document.getElementById('ovAnalysisContent');
  const data = AppState.ovAnalysisData;
  if (!data || !data.tasks) {
    cont.innerHTML = '<div class="loading">No data</div>';
    return;
  }

  const search = (document.getElementById('ovTaskSearch')?.value || '').toLowerCase().trim();
  const typeFilter = document.getElementById('ovTaskType')?.value || 'all';
  const statusFilter = document.getElementById('ovTaskStatus')?.value || 'all';

  let tasks = data.tasks;

  // Filters
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

  let html = `<div class="card">
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
      <h3 class="card-title" style="margin:0;">Task-Level Breakdown <span class="muted-text">— ${tasks.length} task${tasks.length !== 1 ? 's' : ''}</span></h3>
      <span class="muted-text" style="font-size: 11px;">Live from Odoo · Sorted by parent / progress</span>
    </div>
    <div class="task-analysis-grid">`;

  tasks.forEach(t => {
    // Determine progress color
    const p = t.progress_pct || 0;
    let progressColor, progressLabel;
    if (p === 0) {
      progressColor = 'var(--text-muted)';
      progressLabel = 'Not started';
    } else if (p >= 100 && p <= 110) {
      progressColor = 'var(--green)';
      progressLabel = 'Done';
    } else if (p > 110) {
      progressColor = 'var(--red)';
      progressLabel = 'Over budget';
    } else if (p >= 75) {
      progressColor = '#10B981'; // green
      progressLabel = 'On track';
    } else if (p >= 40) {
      progressColor = '#F59E0B'; // amber
      progressLabel = 'In progress';
    } else {
      progressColor = '#EF4444'; // red
      progressLabel = 'Behind';
    }

    // Allocation pills (top 3)
    const allocHtml = (t.allocation || []).slice(0, 4).map(a => `
      <span class="alloc-pill" title="${a.hours}h">
        ${a.name} <small>${fmt.decimal(a.hours)}h</small>
      </span>
    `).join('');
    const moreCount = Math.max(0, (t.allocation?.length || 0) - 4);

    const dateRange = t.first_log
      ? `${t.first_log}${t.last_log && t.last_log !== t.first_log ? ' → ' + t.last_log : ''}`
      : '—';

    const widthBar = Math.min(150, p);

    html += `
      <div class="task-card ${t.is_parent ? 'task-parent' : 'task-sub'}">
        <div class="task-card-head">
          <div style="flex: 1; min-width: 0;">
            ${t.parent_name ? `<div class="task-parent-link" dir="auto">↳ ${t.parent_name}</div>` : ''}
            <div class="task-name" dir="auto">${t.is_parent ? '📁 ' : ''}${t.name || '—'}</div>
            <div class="task-meta">
              ${t.phase ? `<span class="task-meta-badge">${t.phase}</span>` : ''}
              ${t.stage ? `<span class="task-meta-badge stage-badge">${t.stage}</span>` : ''}
              ${t.deadline ? `<span class="task-meta-badge deadline-badge">⏰ ${t.deadline}</span>` : ''}
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

        ${t.first_log ? `<div class="task-dates">📅 ${dateRange}</div>` : ''}
      </div>
    `;
  });

  html += `</div></div>`;
  cont.innerHTML = html;
}
