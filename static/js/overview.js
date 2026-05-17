// Instantly correct nav tabs before Odoo API (reads session only, fast)
(function(){
  async function _fixTabs(){
    try{
      const d = await fetch('/api/project-info').then(r=>r.json());
      const bog = d.is_bog !== false;
      if(window.AppState){ if(!AppState._overviewData) AppState._overviewData={}; AppState._overviewData.is_bog=bog; }
      ['services','missing','risks','roadmap'].forEach(function(t){
        var el = document.querySelector('.exec-tab[data-tab="'+t+'"]');
        if(el) el.style.display = bog ? '' : 'none';
      });
      console.log('[tabs] is_bog='+bog+' → tabs fixed instantly');
    }catch(e){ console.warn('[tabs] error',e); }
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', _fixTabs);
  else _fixTabs();
})();

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

  // Tags wiring
  AppState.currentTagPhase = AppState.currentTagPhase || 'development';
  AppState.activeTagPhases = null;
  AppState.expandedTags = AppState.expandedTags || new Set();
  document.querySelectorAll('#tagSubTabs .sub-tab').forEach(b => {
    b.addEventListener('click', () => {
      const ph = b.dataset.tagphase;
      AppState.currentTagPhase = ph;
      AppState.activeTagPhases = null;
      document.querySelectorAll('#tagSubTabs .sub-tab').forEach(x =>
        x.classList.toggle('active', x.dataset.tagphase === ph));
      loadTagsAnalysis();
    });
  });
  await loadTagsAnalysis();
};

async function loadTagsAnalysis() {
  const cont = document.getElementById('ovTagsContent');
  const summary = document.getElementById('ovTagsSummary');
  if (!cont) return;
  cont.innerHTML = '<div class="loading">Loading tags from Odoo…</div>';

  const phaseGroup = AppState.currentTagPhase || 'development';
  const params = new URLSearchParams();
  params.set('phase_group', phaseGroup);
  if (AppState.activeTagPhases && AppState.activeTagPhases.length) {
    params.set('phases', AppState.activeTagPhases.join(','));
  }

  try {
    const res = await fetch('/api/overview/tags-analysis?' + params.toString());
    const d = await res.json();

    if (!d.connected) {
      cont.innerHTML = `<div class="banner banner-warn"><strong>${d.error || 'Odoo unreachable'}</strong></div>`;
      summary.innerHTML = '';
      return;
    }

    // No phases found for this tab
    if (d.no_phases) {
      cont.innerHTML = `<div class="card" style="padding:24px;text-align:center;color:var(--text-muted);">
        <div style="font-size:28px;margin-bottom:8px;">📭</div>
        <div style="font-size:13px;font-weight:600;color:var(--text);">No ${phaseGroup} phases found</div>
        <div style="font-size:11px;margin-top:6px;max-width:400px;margin-inline:auto;">${d.note || 'No tasks assigned to phases matching ' + phaseGroup + ' keywords'}</div>
      </div>`;
      summary.innerHTML = '';
      return;
    }

    AppState.tagsData = d;
    if (!AppState.activeTagPhases) AppState.activeTagPhases = d.phases_active || [];

    const isBogTags = AppState._overviewData?.is_bog !== false;
    renderTagPhaseFilters(phaseGroup, d.phases_available || []);
    if (!isBogTags && (!d.phases_available || !d.phases_available.length)) {
      AppState.activeTagPhases = null;
    } else if (!isBogTags && d.phases_available?.length) {
      if (!AppState.activeTagPhases || AppState.activeTagPhases.length === 0) {
        AppState.activeTagPhases = [...d.phases_available];
      }
    }

    if (!d.tags || !d.tags.length) {
      cont.innerHTML = '<div class="card"><div class="loading">No tagged tasks found in this phase.</div></div>';
      summary.innerHTML = '';
      return;
    }

    const s = d.summary;
    summary.innerHTML = `
      <div class="kpi-strip kpi-strip-small" style="margin-bottom: 16px;">
        <div class="kpi-card kpi-blue compact">
          <div class="kpi-label">TOTAL TAGS</div>
          <div class="kpi-value">${s.total_tags || 0}</div>
        </div>
        <div class="kpi-card kpi-navy compact">
          <div class="kpi-label">PLANNED</div>
          <div class="kpi-value">${fmt.num(s.total_planned || 0)}<span class="kpi-unit">h</span></div>
        </div>
        <div class="kpi-card kpi-green compact">
          <div class="kpi-label">ACTUAL</div>
          <div class="kpi-value">${fmt.num(s.total_actual || 0)}<span class="kpi-unit">h</span></div>
        </div>
        <div class="kpi-card kpi-amber compact">
          <div class="kpi-label">REMAINING</div>
          <div class="kpi-value">${fmt.num(s.total_remaining || 0)}<span class="kpi-unit">h</span></div>
        </div>
      </div>
    `;

    let html = `<div class="card"><h3 class="card-title" style="margin-bottom: 12px;">Tags Breakdown <span class="muted-text">— click a tag to see per-task breakdown</span></h3><div class="tags-grid">`;

    d.tags.forEach(tag => {
      const p = tag.progress_pct || 0;
      let progressColor;
      if (p === 0) progressColor = '#9CA3AF';
      else if (p >= 100) progressColor = '#10B981';
      else if (p >= 75) progressColor = '#10B981';
      else if (p >= 40) progressColor = '#F59E0B';
      else progressColor = '#3B82F6';

      const widthBar = Math.min(100, p);
      const tagColorClass = tag.color ? `tag-color-${tag.color}` : 'tag-color-default';
      const empPills = (tag.top_employees || []).slice(0, 4).map(e =>
        `<span class="alloc-pill-mini" title="${e.hours}h">${e.name} <small>${fmt.decimal(e.hours)}h</small></span>`
      ).join('');
      const moreEmpCount = Math.max(0, (tag.employees_count || 0) - 4);
      const isExpanded = AppState.expandedTags.has(tag.tag_id);

      html += `
        <div class="tag-card ${isExpanded ? 'tag-card-expanded' : ''}">
          <div class="tag-card-head" data-tag-toggle="${tag.tag_id}" style="cursor: pointer;">
            <div class="tag-name-block">
              <div class="tag-name-row">
                <span class="tag-pill ${tagColorClass}">🏷️ ${tag.name}</span>
                <span class="tag-task-count">${tag.tasks_count} task${tag.tasks_count !== 1 ? 's' : ''}</span>
                <span class="tag-expand-arrow">${isExpanded ? '▼' : '▶'}</span>
              </div>
            </div>
            <div class="tag-progress-num" style="color: ${progressColor};">
              ${fmt.decimal(p)}<small>%</small>
            </div>
          </div>
          <div class="tcc-progress-bar">
            <div class="tcc-progress-fill" style="width: ${widthBar}%; background: ${progressColor};"></div>
          </div>
          <div class="tag-stats">
            <div class="tag-stat">
              <div class="tag-stat-lbl">PLANNED</div>
              <div class="tag-stat-val">${fmt.decimal(tag.planned_hours)}<small>h</small></div>
              <div class="tag-stat-sub">${fmt.decimal(tag.planned_days)}d</div>
            </div>
            <div class="tag-stat">
              <div class="tag-stat-lbl">ACTUAL</div>
              <div class="tag-stat-val" style="color: ${progressColor};">${fmt.decimal(tag.actual_hours)}<small>h</small></div>
              <div class="tag-stat-sub">${fmt.decimal(tag.actual_days)}d</div>
            </div>
            <div class="tag-stat">
              <div class="tag-stat-lbl">REMAINING</div>
              <div class="tag-stat-val">${fmt.decimal(tag.remaining_hours)}<small>h</small></div>
            </div>
          </div>
          ${empPills ? `
            <div class="tag-employees">
              <div class="tag-emp-label">Contributors (${tag.employees_count}):</div>
              <div class="tag-emp-list">
                ${empPills}
                ${moreEmpCount ? `<span class="tcc-more">+${moreEmpCount}</span>` : ''}
              </div>
            </div>
          ` : ''}
          ${isExpanded && tag.tasks ? `
            <div class="tag-tasks-list">
              <div class="tag-tasks-header">📋 Tasks under this tag (${tag.tasks.length}):</div>
              ${tag.tasks.map(t => {
                const tp = t.planned_hours > 0 ? Math.min(100, t.actual_hours / t.planned_hours * 100) : 0;
                const tc = tp >= 100 ? '#10B981' : tp >= 75 ? '#10B981' : tp >= 40 ? '#F59E0B' : '#3B82F6';
                const tEmps = (t.employees || []).slice(0, 3).map(e =>
                  `<span class="alloc-pill-mini">${e.name} ${fmt.decimal(e.hours)}h</span>`).join('');
                return `
                  <div class="tag-task-row">
                    <div class="tag-task-name" dir="auto">${t.name}</div>
                    <div class="tag-task-stats">
                      <span class="tag-task-stat">P: <b>${fmt.decimal(t.planned_hours)}h</b></span>
                      <span class="tag-task-stat">A: <b style="color: ${tc};">${fmt.decimal(t.actual_hours)}h</b></span>
                      <span class="tag-task-stat">${fmt.decimal(tp)}%</span>
                    </div>
                    ${tEmps ? `<div class="tag-task-emps">${tEmps}</div>` : ''}
                  </div>
                `;
              }).join('')}
            </div>
          ` : ''}
        </div>
      `;
    });

    html += '</div></div>';
    cont.innerHTML = html;

    // Wire tag expand/collapse
    cont.querySelectorAll('[data-tag-toggle]').forEach(el => {
      el.addEventListener('click', () => {
        const id = parseInt(el.dataset.tagToggle);
        if (AppState.expandedTags.has(id)) AppState.expandedTags.delete(id);
        else AppState.expandedTags.add(id);
        loadTagsAnalysis();
      });
    });
  } catch (e) {
    cont.innerHTML = `<div class="banner banner-warn"><strong>Error:</strong> ${e.message}</div>`;
  }
}

function renderTagPhaseFilters(phaseGroup, available) {
  const cont = document.getElementById('tagPhaseFilters');
  if (!cont) return;
  if (!available.length) { cont.innerHTML = ''; return; }

  let html = '<label class="filter-label">PHASES (multi-select)</label>';
  html += '<div class="phase-dropdown" id="tagPhaseDropdown">';
  html += '<button type="button" class="phase-toggle" id="tagPhaseToggle">';
  html += `<span id="tagPhaseLabel">${tagPhaseLabel(AppState.activeTagPhases || [], available.length)}</span>`;
  html += '<span style="margin-left:8px; color: var(--text-muted);">▼</span>';
  html += '</button>';
  html += '<div class="phase-menu" id="tagPhaseMenu" style="display:none;">';
  html += '<div class="phase-menu-actions"><a id="tagPhaseAll">Select all</a><a id="tagPhaseNone">Clear</a></div>';
  available.filter(p => p && p !== 'undefined' && p !== 'null').forEach(p => {
    const checked = (AppState.activeTagPhases || []).includes(p);
    const label = p === 'No Phase' ? '📭 No Phase' : p;
    html += `<label class="phase-option ${checked ? 'selected' : ''}" data-phase="${encodeURIComponent(p)}">
      <input type="checkbox" ${checked ? 'checked' : ''}><span dir="auto">${label}</span>
    </label>`;
  });
  html += '</div></div>';
  cont.innerHTML = html;

  const toggle = document.getElementById('tagPhaseToggle');
  const menu = document.getElementById('tagPhaseMenu');
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
    toggle.classList.toggle('open', menu.style.display === 'block');
  });
  document.addEventListener('click', (e) => {
    if (!document.getElementById('tagPhaseDropdown')?.contains(e.target)) {
      menu.style.display = 'none';
      toggle.classList.remove('open');
    }
  });

  menu.querySelectorAll('.phase-option').forEach(opt => {
    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      const phase = decodeURIComponent(opt.dataset.phase);
      const cb = opt.querySelector('input');
      if (e.target !== cb) cb.checked = !cb.checked;
      AppState.activeTagPhases = AppState.activeTagPhases || [];
      if (cb.checked) {
        if (!AppState.activeTagPhases.includes(phase)) AppState.activeTagPhases.push(phase);
        opt.classList.add('selected');
      } else {
        AppState.activeTagPhases = AppState.activeTagPhases.filter(p => p !== phase);
        opt.classList.remove('selected');
      }
      document.getElementById('tagPhaseLabel').textContent = tagPhaseLabel(AppState.activeTagPhases, available.length);
      loadTagsAnalysis();
    });
  });
  menu.querySelector('#tagPhaseAll').addEventListener('click', (e) => {
    e.stopPropagation();
    AppState.activeTagPhases = [...available];
    loadTagsAnalysis();
  });
  menu.querySelector('#tagPhaseNone').addEventListener('click', (e) => {
    e.stopPropagation();
    AppState.activeTagPhases = [];
    loadTagsAnalysis();
  });
}

function tagPhaseLabel(phases, total) {
  if (!phases || phases.length === 0) return 'No phase selected';
  if (phases.length === 1) return phases[0];
  if (phases.length === total) return `All phases (${total})`;
  return `${phases.length} phases selected`;
}

async function loadOverviewKPIs() {
  // ── 1. Overview API (Odoo project + Variance) ──────────────────────
  try {
    const res = await fetch('/api/overview');
    const d   = await res.json();
    AppState._overviewData = d;

    // Hide BOG-only tabs for non-BOG projects
    const _isBog = d.is_bog !== false;
    ['services', 'missing', 'risks', 'roadmap'].forEach(tab => {
      const btn = document.querySelector(`.exec-tab[data-tab="${tab}"]`);
      if (btn) btn.style.display = _isBog ? '' : 'none';
    });

    // Register callback for variance profitability to update overview KPIs
    window._overviewUpdateProfKPIs = function(phaseKey) {
      const d = AppState._latestProfData?.[phaseKey];
      if (!d) return;
      const fmtN = n => n ? new Intl.NumberFormat('en-US',{maximumFractionDigits:1}).format(n) : '—';
      const setOv = (id, val) => { const el=document.getElementById(id); if(el) el.textContent=val; };
      // services/consultation → Con prefix, support/development → Dev prefix
      // services/consultation → Con, support → Sup, development → Dev
      let pre = 'Con';
      if (phaseKey === 'support') pre = 'Sup';
      else if (phaseKey === 'development') pre = 'Dev';
      const pct = d.completionPct || 0;
      setOv(`kpi${pre}Progress`,  pct > 0 ? fmtN(pct) : '—');
      setOv(`kpi${pre}Remaining`, d.remainingMDs ? fmtN(d.remainingMDs) + ' MD' : '—');
      setOv(`kpi${pre}EAC`,       d.eacMDs       ? fmtN(d.eacMDs)               : '—');
      const bar = document.getElementById(`kpi${pre}ProgressBar`);
      if (bar) bar.style.width = Math.min(pct, 100) + '%';
      if (d.monthKey) {
        // Update footer with "as of YYYY-MM"
        const card = document.getElementById(`kpi${pre}Progress`)?.closest('[style*="border-radius"]');
        const foot = card?.querySelector('[style*="font-size:11px"], .kpi-foot');
        if (foot) foot.textContent = `as of ${d.monthKey}`;
      }
    };

    // For non-BOG: switch default phase to 'services' and rewire sub-tabs
    if (!_isBog) {
      AppState.currentOverviewPhase = 'services';
      AppState.currentTagPhase      = 'services';

      // Update sub-tab buttons to use services/support
      const ovSubTabs = document.getElementById('overviewSubTabs');
      if (ovSubTabs) {
        ovSubTabs.innerHTML = `
          <button class="sub-tab active" data-ovphase="services" id="ovTabSvc">Services</button>
          <button class="sub-tab" data-ovphase="support" id="ovTabSup">Support</button>`;
        ovSubTabs.querySelectorAll('.sub-tab').forEach(b => {
          b.addEventListener('click', () => {
            const phase = b.dataset.ovphase;
            AppState.currentOverviewPhase = phase;
            AppState.activePhases = null;
            AppState.activeEmployees = [];
            ovSubTabs.querySelectorAll('.sub-tab').forEach(x =>
              x.classList.toggle('active', x.dataset.ovphase === phase));
            loadTaskAnalysis(phase);
          });
        });
      }
      // Tags sub-tabs — Services / Support for non-BOG
      const tagSubTabsEl = document.getElementById('tagSubTabs');
      if (tagSubTabsEl) {
        tagSubTabsEl.innerHTML = `
          <button class="sub-tab active" data-tagphase="services" id="tagTabSvc">Services</button>
          <button class="sub-tab" data-tagphase="support" id="tagTabSup">Support</button>`;
        tagSubTabsEl.querySelectorAll('.sub-tab').forEach(b => {
          b.addEventListener('click', () => {
            const ph = b.dataset.tagphase;
            AppState.currentTagPhase = ph;
            AppState.activeTagPhases = null;
            tagSubTabsEl.querySelectorAll('.sub-tab').forEach(x =>
              x.classList.toggle('active', x.dataset.tagphase === ph));
            loadTagsAnalysis(ph);
          });
        });
      }
    }

    // Rename phase labels for non-BOG: Consultation→Services, hide Development
    if (!_isBog) {
      // id → new text (null = hide element)
      const renameMap = {
        // Revenue card
        'labelConRev':      'Services',
        'labelDevRev':      null,
        'labelSupRev':      'Support',
        // Current Cost card
        'labelConCost':     'Services',
        'labelDevCost':     null,
        // EAC card
        'labelConEAC':      'Services',
        'labelDevEAC':      null,
        // Progress bars
        'labelConProgress': 'Services — Progress',
        'labelDevProgress': null,
        // Sub-tabs (tasks analysis & overview)
        'ovTabCon':         'Services',
        'ovTabDev':         null,
        'tagTabCon':        'Services',
        'tagTabDev':        null,
      };
      Object.entries(renameMap).forEach(([id, label]) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (label === null) {
          const row = el.closest('[style*="justify-content:space-between"]') || el.parentElement;
          if (row) row.style.display = 'none';
          else el.style.display = 'none';
        } else {
          el.textContent = label;
        }
      });
      // Hide Development progress card entirely
      const devProgressCard = document.getElementById('labelDevProgress')?.closest('[style*="border-radius:10px"]');
      if (devProgressCard) devProgressCard.style.display = 'none';

      // Show Support rows in Cost + EAC cards (hidden by default)
      fetch('/api/project-phases-available').then(r=>r.json()).then(cfg => {
        if (cfg.has_support) {
          ['rowSupCost','rowSupEAC'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'flex';
          });
          // Add Support progress card after Services
          const progressRow = document.getElementById('progressRow');
          if (progressRow && !document.getElementById('supProgressCard')) {
            const card = document.createElement('div');
            card.id = 'supProgressCard';
            card.style.cssText = 'background:var(--bg-card);border:1px solid var(--border);border-top:3px solid var(--amber);border-radius:10px;padding:16px 20px;';
            card.innerHTML = `
              <div style="font-size:10px;font-weight:700;color:var(--amber);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Support — Progress</div>
              <div style="display:flex;align-items:baseline;gap:4px;margin-bottom:8px;">
                <span style="font-size:30px;font-weight:700;line-height:1;" id="kpiSupProgress">—</span>
                <span style="font-size:14px;color:var(--muted);">%</span>
              </div>
              <div style="height:6px;background:#F3F4F6;border-radius:3px;margin-bottom:8px;">
                <div id="kpiSupProgressBar" style="height:100%;background:var(--amber);border-radius:3px;width:0%;transition:width .6s;"></div>
              </div>
              <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted);">
                <span id="kpiSupProgressFoot" style="font-size:11px;color:var(--muted);">Remaining MDs</span>
                <span style="font-size:13px;font-weight:700;color:var(--text);" id="kpiSupRemaining">—</span>
              </div>`;
            progressRow.appendChild(card);
            // Re-run phase progress to fill Support card now that element exists
            setTimeout(_loadPhaseProgress, 100);
          }
        }
      }).catch(()=>{});
    }

    const set = (id, v) => { const el=document.getElementById(id); if(el&&v!==null&&v!==undefined) el.textContent=v; };

    // Header
    set('headerPM',    d.project_manager || '—');
    set('headerCoord', d.coordinator     || '—');
    // headerSubtitle removed — period shown in overview section only
    const pEl = document.getElementById('ovPeriod');
    if (pEl) pEl.textContent = [d.roadmap_start, d.roadmap_end].filter(Boolean).join(' → ')
      + (d.duration_months ? ` (${d.duration_months} months)` : '');

    // Revenue (Odoo project value)
    const revEl = document.getElementById('kpiRevenue');
    if (revEl) revEl.textContent = d.project_value_sar
      ? fmt.money(Math.round(d.project_value_sar)) : '—';

    // Phase revenues from Final Budget (async, non-blocking)
    _loadPhaseRevenues();

    if (!_isBog) {
      // Non-BOG: load Progress/Remaining from DB (plan_overrides), update when Variance opens
      _loadPhaseProgress();
      // Load Current Cost from effort API
      _loadPhaseCostKPIs();
    } else {
      // BOG: Phase progress from API
      set('kpiDevProgress',  d.progress_pct || '—');
      set('kpiDevRemaining', d.remaining_mds !== undefined ? fmt.decimal(d.remaining_mds) + ' MD' : '—');
      const devBar = document.getElementById('kpiDevProgressBar');
      if (devBar) devBar.style.width = Math.min(100, d.progress_pct || 0) + '%';

      set('kpiConProgress',  d.con_progress_pct  !== undefined ? d.con_progress_pct  : '—');
      set('kpiConRemaining', d.con_remaining_mds !== undefined ? fmt.decimal(d.con_remaining_mds) + ' MD' : '—');
      const conBar = document.getElementById('kpiConProgressBar');
      if (conBar) conBar.style.width = Math.min(100, d.con_progress_pct || 0) + '%';
    }

  } catch(e) { console.error('Overview KPIs error:', e); }

  // ── 2. Phase costs + EAC ──────────────────────────────────────────
  _loadPhaseCostKPIs();

  // ── 3. Team members (from effort API, split by phase) ─────────────
  // Load team count from effort API
  _loadTeamCount();

  // Wire team modal close (once)
  if (!window._teamModalWired) {
    window._teamModalWired = true;
    document.getElementById('teamModalClose')?.addEventListener('click', closeTeamModal);
    document.getElementById('teamModalOverlay')?.addEventListener('click', closeTeamModal);
    // ESC key
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        const m = document.getElementById('teamModal');
        if (m && m.style.display !== 'none') closeTeamModal();
      }
    });
  }
}

// ── Team tab switching ──────────────────────────────────────────────
window.switchTeamTab = function(phase) {
  AppState._teamActiveTab = phase;
  const devBtn = document.getElementById('teamTabDev');
  const conBtn = document.getElementById('teamTabCon');
  const navy = 'background:var(--navy);color:white;';
  const idle = 'background:var(--bg-subtle);color:var(--text-muted);';
  if (devBtn) devBtn.style.cssText = devBtn.style.cssText.replace(/background[^;]+;color[^;]+;/, '') + (phase==='development'?navy:idle);
  if (conBtn) conBtn.style.cssText = conBtn.style.cssText.replace(/background[^;]+;color[^;]+;/, '') + (phase==='consultation'?navy:idle);
  _loadTeamKPI(phase);
};

async function _loadPhaseProgress() {
  try {
    const res = await fetch('/api/overview/phase-progress');
    if (!res.ok) return;
    const d = await res.json();
    const fmtN = n => n ? new Intl.NumberFormat('en-US',{maximumFractionDigits:1}).format(n) : '—';
    const setEl = (id, val) => { const el=document.getElementById(id); if(el) el.textContent=val; };

    // Map phase → element prefix: services→Con, support→Sup
    const phaseMap = { services: 'Con', support: 'Sup', development: 'Dev', consultation: 'Con' };
    for (const [phase, data] of Object.entries(d.phases || {})) {
      if (!data.month_key) continue;
      const pre = phaseMap[phase] || 'Con';
      const pct = data.completion || 0;
      setEl(`kpi${pre}Progress`,  pct > 0 ? fmtN(pct) : '—');
      setEl(`kpi${pre}Remaining`, data.remaining > 0 ? fmtN(data.remaining) + ' MD' : '—');
      const bar = document.getElementById(`kpi${pre}ProgressBar`);
      if (bar) bar.style.width = Math.min(pct, 100) + '%';
      // Show "as of YYYY-MM" footer using ID
      const footEl = document.getElementById(`kpi${pre}ProgressFoot`);
      if (footEl) footEl.textContent = `as of ${data.month_key}`;
    }
  } catch(e) { console.warn('Phase progress error:', e); }
}

async function _loadPhaseRevenues() {
  try {
    const res = await fetch('/api/overview/financials');
    if (!res.ok) return;
    const d = await res.json();
    const fSAR = v => (v && v > 0) ? fmt.money(Math.round(v)) : '—';
    const set  = (id, v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
    const isBog = AppState._overviewData?.is_bog !== false;
    if (isBog) {
      set('kpiConRev', fSAR(d.consultation));
      set('kpiDevRev', fSAR(d.development));
      set('kpiSupRev', fSAR(d.support));
    } else {
      // Non-BOG: services→Con row, support→Sup row
      set('kpiConRev', fSAR(d.services));
      set('kpiSupRev', fSAR(d.support));
    }
  } catch(e) { console.warn('Phase revenue error:', e); }
}

async function _loadTeamKPI_unused(phase) {
  const listEl  = document.getElementById('kpiTeamList');
  const countEl = document.getElementById('kpiTeamCount');
  if (!listEl) return;
  listEl.innerHTML = '<div style="color:var(--text-muted);font-size:12px;">Loading…</div>';

  try {
    // Get employees from effort API for this phase
    if (!AppState._effortMonths) AppState._effortMonths = {};
    let employees = AppState._effortEmployees?.[phase];
    if (!employees) {
      const res = await fetch(`/api/effort/${phase}/all-months`);
      const d   = await res.json();
      if (!AppState._effortEmployees) AppState._effortEmployees = {};
      AppState._effortEmployees[phase] = d.employees || [];
      employees = AppState._effortEmployees[phase];
      // cache effort data
      if (!AppState._effortMonthCosts) AppState._effortMonthCosts = {};
      if (!AppState._effortMonthMDs)   AppState._effortMonthMDs   = {};
      if (!AppState._effortMonths)     AppState._effortMonths     = {};
      AppState._effortMonthCosts[phase] = d.month_cost_usd || {};
      AppState._effortMonthMDs[phase]   = d.month_mds      || {};
      AppState._effortMonths[phase]     = d.months          || [];
    }

    // Filter: exclude Arabic names + Amr (keep non-Arabic, non-Amr)
    const isArabic = s => /[؀-ۿ]/.test(s || '');
    const team = employees.filter(e => {
      const n = (e.name || '').trim();
      if (!n || n === '—') return false;
      if (isArabic(n)) return false;
      if (/amr/i.test(n)) return false;
      // Onsite-only rows: skip duplicates (keep base row)
      if ((e.is_onsite_row || e.onsite)) return false;
      return true;
    });

    if (!team.length) {
      listEl.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:8px 0;">No team members found</div>';
      if (countEl) countEl.textContent = '0 members';
      return;
    }

    if (countEl) countEl.textContent = `${team.length} member${team.length!==1?'s':''}`;

    listEl.innerHTML = team.map(e => {
      const pos = (e.position || '').replace(/^(KSA|EGY|TUN)\s*-\s*/i, '').replace(/ - onsite$/i,'');
      const country = e.country || (e.position||'').match(/^(KSA|EGY|TUN)/i)?.[1] || '';
      const countryColor = {'KSA':'var(--amber)','EGY':'var(--blue)','TUN':'var(--green)'}[country.toUpperCase()] || 'var(--text-muted)';
      return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border);">
        <div style="width:28px;height:28px;border-radius:50%;background:var(--bg-subtle);
                    display:flex;align-items:center;justify-content:center;
                    font-size:11px;font-weight:700;color:var(--navy);flex-shrink:0;">
          ${(e.name||'?').charAt(0).toUpperCase()}
        </div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:12px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${e.name}</div>
          <div style="font-size:10px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${pos}</div>
        </div>
        ${country ? `<span style="font-size:9px;font-weight:700;color:${countryColor};background:${countryColor}18;
                          padding:1px 5px;border-radius:8px;flex-shrink:0;">${country}</span>` : ''}
      </div>`;
    }).join('');

  } catch(e) {
    listEl.innerHTML = '<div style="color:var(--red);font-size:12px;">Error loading team</div>';
    console.error('Team KPI error:', e);
  }
}

async function _loadTeamCount() {
  try {
    const isBog = AppState._overviewData?.is_bog !== false;
    const phases = isBog ? ['development','consultation'] : ['services'];
    const names = new Set();
    const isArabic = s => /[\u0600-\u06FF]/.test(s||'');
    const filterEmp = e => {
      const n=(e.name||'').trim();
      return n && !isArabic(n) && !/\bamr\b/i.test(n) && !e.is_onsite_row && !e.onsite;
    };
    for (const phase of phases) {
      let emps = AppState._effortEmployees?.[phase];
      if (!emps) {
        const res = await fetch(`/api/effort/${phase}/all-months`);
        const d = await res.json();
        if (!AppState._effortEmployees) AppState._effortEmployees = {};
        AppState._effortEmployees[phase] = d.employees || [];
        emps = d.employees || [];
        if (!AppState._effortMonths)     AppState._effortMonths     = {};
        if (!AppState._effortMonthCosts) AppState._effortMonthCosts = {};
        if (!AppState._effortMonthMDs)   AppState._effortMonthMDs   = {};
        AppState._effortMonths[phase]     = d.months         || [];
        AppState._effortMonthCosts[phase] = d.month_cost_usd || {};
        AppState._effortMonthMDs[phase]   = d.month_mds      || {};
      }
      emps.filter(filterEmp).forEach(e => names.add(e.name));
    }
    // For non-BOG: also include employees_available from task analysis if loaded
    if (!isBog && AppState.ovAnalysisData?.employees_available) {
      AppState.ovAnalysisData.employees_available.forEach(n => names.add(n));
    }
    const countEl = document.getElementById('kpiTeamCount');
    if (countEl) countEl.textContent = names.size || '—';
    // Cache names for modal
    AppState._teamNamesServices = Array.from(names);
  } catch(e) { console.warn('Team count error:', e); }
}

async function _loadPhaseCostKPIs() {
  const fSAR = v => fmt.money(Math.round(v));
  const set   = (id, v) => { const el=document.getElementById(id); if(el) el.textContent=v||'—'; };

  let totalCostSAR = 0;
  let totalEACSAR  = 0;

  const isBogCost = AppState._overviewData?.is_bog !== false;
  const phases = isBogCost ? ['consultation', 'development'] : ['services', 'support'];

  for (const phase of phases) {
    try {
      let months = AppState._effortMonths?.[phase]     || [];
      let mCosts = AppState._effortMonthCosts?.[phase] || {};
      let mMDs   = AppState._effortMonthMDs?.[phase]   || {};

      if (!months.length) {
        const res = await fetch(`/api/effort/${phase}/all-months`);
        const d   = await res.json();
        months = d.months || [];
        mCosts = d.month_cost_usd || {};
        mMDs   = d.month_mds      || {};
        if (!AppState._effortMonths)     AppState._effortMonths     = {};
        if (!AppState._effortMonthCosts) AppState._effortMonthCosts = {};
        if (!AppState._effortMonthMDs)   AppState._effortMonthMDs   = {};
        AppState._effortMonths[phase]     = months;
        AppState._effortMonthCosts[phase] = mCosts;
        AppState._effortMonthMDs[phase]   = mMDs;
      }

      let cumCostUSD = 0;
      months.forEach(m => { cumCostUSD += mCosts[m.key] || 0; });
      const cumCostSAR = cumCostUSD * 3.75;
      totalCostSAR += cumCostSAR;

      const totalMDs = Object.values(mMDs).reduce((s,v)=>s+v, 0);
      const avgCPMD  = totalMDs > 0 ? cumCostSAR / totalMDs : 0;
      // EAC from profitability data if available
      const profData = AppState._latestProfData?.[phase];
      const eacCostSAR = profData?.eacMDs ? cumCostSAR + profData.eacMDs * avgCPMD : cumCostSAR;
      totalEACSAR += eacCostSAR;

      // Map phase to element prefix: services→Con, support→Sup, development→Dev, consultation→Con
      let pre = 'Con';
      if (phase === 'support') pre = 'Sup';
      else if (phase === 'development') pre = 'Dev';
      else if (phase === 'consultation') pre = 'Con';
      else if (phase === 'services') pre = 'Con';
      set(`kpi${pre}Cost`, fSAR(cumCostSAR));
      set(`kpi${pre}EAC`,  fSAR(eacCostSAR));
    } catch(e) {
      console.warn(`Phase cost KPI (${phase}):`, e);
    }
  }

  // Totals
  const tcEl = document.getElementById('kpiTotalCost');
  if (tcEl) tcEl.textContent = totalCostSAR ? fSAR(totalCostSAR) : '—';
  const teEl = document.getElementById('kpiTotalEAC');
  if (teEl) teEl.textContent = totalEACSAR  ? fSAR(totalEACSAR)  : '—';
}


async function openTeamModal() {
  const modal = document.getElementById('teamModal');
  modal.style.display = 'flex';
  const body = document.getElementById('teamModalBody');

  const isBogTeam = AppState._overviewData?.is_bog !== false;
  const teamPhases = isBogTeam
    ? [{id:'modalTabDev', phase:'development', label:'Development'}, {id:'modalTabCon', phase:'consultation', label:'Consultation'}]
    : [{id:'modalTabSvc', phase:'services',    label:'Services'},    {id:'modalTabSup', phase:'support',      label:'Support'}];

  const tabsHtml = teamPhases.map((t, i) => `
    <button id="${t.id}" onclick="switchModalTeamTab('${t.phase}')"
      style="padding:10px 20px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;
             border:none;border-bottom:2px solid ${i===0?'var(--navy)':'transparent'};
             color:${i===0?'var(--navy)':'var(--text-muted)'};background:none;cursor:pointer;">
      ${t.label}
    </button>`).join('');

  body.innerHTML = `
    <div style="display:flex;border-bottom:1px solid var(--border);margin:-20px -24px 16px;padding:0 24px;">
      ${tabsHtml}
    </div>
    <div id="modalTeamContent"><div class="loading">Loading…</div></div>`;

  window._modalTeamPhases = teamPhases;
  window._modalTeamActiveTab = teamPhases[0].phase;
  _loadModalTeamTab(teamPhases[0].phase);
}


window.switchModalTeamTab = function(phase) {
  window._modalTeamActiveTab = phase;
  (window._modalTeamPhases || []).forEach(t => {
    const btn = document.getElementById(t.id);
    if (btn) {
      btn.style.borderBottomColor = t.phase===phase ? 'var(--navy)' : 'transparent';
      btn.style.color = t.phase===phase ? 'var(--navy)' : 'var(--text-muted)';
    }
  });
  _loadModalTeamTab(phase);
};

async function _loadModalTeamTab(phase) {
  const cont = document.getElementById('modalTeamContent');
  if (!cont) return;
  cont.innerHTML = '<div class="loading">Loading…</div>';
  const isBogModal2 = AppState._overviewData?.is_bog !== false;
  try {
    let employees = AppState._effortEmployees?.[phase];
    if (!employees) {
      const res = await fetch(`/api/effort/${phase}/all-months`);
      const d   = await res.json();
      if (!AppState._effortEmployees) AppState._effortEmployees = {};
      AppState._effortEmployees[phase] = d.employees || [];
      employees = AppState._effortEmployees[phase];
      if (!AppState._effortMonths)     AppState._effortMonths     = {};
      if (!AppState._effortMonthCosts) AppState._effortMonthCosts = {};
      if (!AppState._effortMonthMDs)   AppState._effortMonthMDs   = {};
      AppState._effortMonths[phase]     = d.months          || [];
      AppState._effortMonthCosts[phase] = d.month_cost_usd  || {};
      AppState._effortMonthMDs[phase]   = d.month_mds       || {};
    }
    const isArabic = s => /[\u0600-\u06FF]/.test(s||'');
    const team = employees.filter(e => {
      const n = (e.name||'').trim();
      if (!n || isArabic(n) || /\bamr\b/i.test(n)) return false;
      if (e.is_onsite_row || e.onsite) return false;
      return true;
    });
    // For non-BOG services: limit to employees who have timesheets on project phases
    // (effort API returns all project employees regardless of phase)
    if (!isBogModal2 && phase === 'services') {
      const knownEmps = AppState.ovAnalysisData?.employees_available || AppState._teamNamesServices || [];
      if (knownEmps.length > 0) {
        employees = employees.filter(e => knownEmps.includes(e.name));
      }
    }

    const isBogModal = AppState._overviewData?.is_bog !== false;
    // Non-BOG support with no data → show message
    if (!isBogModal && phase === 'support' && !team.length) {
      const cfg = await fetch('/api/project-phases-available').then(r=>r.json()).catch(()=>({}));
      if (!cfg.has_support) {
        cont.innerHTML = `<div style="text-align:center;padding:24px;color:var(--text-muted);">
          <div style="font-size:24px;margin-bottom:8px;">📭</div>
          <div style="font-size:13px;font-weight:600;">No Support phases in this project</div>
          <div style="font-size:11px;margin-top:6px;">All team members are shown under Services</div>
        </div>`;
        return;
      }
    }
    if (!team.length) { cont.innerHTML = '<p style="color:var(--text-muted);font-size:13px;padding:8px 0;">No members found for this phase.</p>'; return; }
    cont.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px;">
      ${team.map(e => {
        const pos = (e.position||'').replace(/^(KSA|EGY|TUN)\s*-\s*/i,'').replace(/ - onsite$/i,'');
        const country = ((e.position||'').match(/^(KSA|EGY|TUN)/i)||[])[1]||'';
        const cc = {'KSA':'var(--amber)','EGY':'var(--blue)','TUN':'var(--green)'}[country.toUpperCase()]||'var(--text-muted)';
        return `<div style="display:flex;align-items:center;gap:8px;padding:8px;background:var(--bg-subtle);border-radius:6px;">
          <div style="width:32px;height:32px;border-radius:50%;background:var(--navy);color:white;
                      display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0;">
            ${(e.name||'?').charAt(0).toUpperCase()}
          </div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${e.name}</div>
            <div style="font-size:10px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${pos}</div>
          </div>
          ${country?`<span style="font-size:9px;font-weight:700;color:${cc};background:${cc}18;padding:2px 6px;border-radius:8px;flex-shrink:0;">${country}</span>`:''}
        </div>`;
      }).join('')}
    </div>`;
  } catch(e) { cont.innerHTML = '<p style="color:var(--red);">Error loading team.</p>'; }
}

function closeTeamModal() {
  document.getElementById('teamModal').style.display = 'none';
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

    // Handle no phases found
    if (d.no_phases) {
      cont.innerHTML = `<div class="card" style="padding:24px;text-align:center;color:var(--text-muted);">
        <div style="font-size:28px;margin-bottom:8px;">📭</div>
        <div style="font-size:13px;font-weight:600;color:var(--text);">No ${phaseGroup} phases found</div>
        <div style="font-size:11px;margin-top:6px;max-width:400px;margin-inline:auto;">${d.note || 'No tasks assigned to phases matching ' + phaseGroup + ' keywords'}</div>
      </div>`;
      return;
    }

    AppState.ovAnalysisData = d;
    if (!AppState.activePhases) AppState.activePhases = d.phases_active || [];
    if (!AppState.activeEmployees) AppState.activeEmployees = [];

    const isBogTA = AppState._overviewData?.is_bog !== false;
    // For non-BOG: show available phases in dropdown (filtered by services/support on backend)
    // For BOG: show all phases
    renderPhaseFilters(phaseGroup, d.phases_available || []);
    if (!isBogTA && (!d.phases_available || !d.phases_available.length)) {
      // No phases returned from backend — show all tasks
      AppState.activePhases = null;
    } else if (!isBogTA && d.phases_available?.length) {
      // Pre-select all available phases
      if (!AppState.activePhases || AppState.activePhases.length === 0) {
        AppState.activePhases = [...d.phases_available];
      }
    }
    renderEmployeeFilter(d.employees_available || []);
    populateStageFilter(d.stages_used || []);
    renderTaskList(phaseGroup);
  } catch (e) {
    cont.innerHTML = `<div class="banner banner-warn"><strong>Error:</strong> ${e.message}</div>`;
  }
}

function renderPhaseFilters(phaseGroup, available) {
  const cont = document.getElementById('ovPhaseFilters');
  if (!cont) return;
  if (!available.length) { cont.innerHTML = ''; return; }

  const total = available.length;
  let html = '<label class="filter-label">PHASES (multi-select)</label>';
  html += '<div class="phase-dropdown" id="ovPhaseDropdown">';
  html += '<button type="button" class="phase-toggle" id="ovPhaseToggle">';
  html += `<span id="ovPhaseLabel">${phaseLabel(AppState.activePhases || [], total)}</span>`;
  html += '<span style="margin-left:8px; color: var(--text-muted);">▼</span>';
  html += '</button>';
  html += '<div class="phase-menu" id="ovPhaseMenu" style="display:none;">';
  html += '<div class="phase-menu-actions"><a id="ovPhaseAll">Select all</a><a id="ovPhaseNone">Clear</a></div>';
  available.filter(p => p && p !== 'undefined' && p !== 'null').forEach(p => {
    const checked = (AppState.activePhases || []).includes(p);
    const label = p === 'No Phase' ? '📭 No Phase' : p;
    html += `<label class="phase-option ${checked ? 'selected' : ''}" data-phase="${encodeURIComponent(p)}">
      <input type="checkbox" ${checked ? 'checked' : ''}><span dir="auto">${label}</span>
    </label>`;
  });
  html += '</div></div>';
  cont.innerHTML = html;

  const toggle = document.getElementById('ovPhaseToggle');
  const menu   = document.getElementById('ovPhaseMenu');
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
      document.getElementById('ovPhaseLabel').textContent = phaseLabel(AppState.activePhases, total);
      loadTaskAnalysis(phaseGroup);
    });
  });
  menu.querySelector('#ovPhaseAll').addEventListener('click', (e) => {
    e.stopPropagation();
    AppState.activePhases = [...available];
    renderPhaseFilters(phaseGroup, available);
    loadTaskAnalysis(phaseGroup);
  });
  menu.querySelector('#ovPhaseNone').addEventListener('click', (e) => {
    e.stopPropagation();
    AppState.activePhases = [];
    renderPhaseFilters(phaseGroup, available);
    loadTaskAnalysis(phaseGroup);
  });
}

function phaseLabel(phases, total) {
  const t = total || (AppState.ovAnalysisData?.phases_available || []).length;
  if (!phases || phases.length === 0) return `All phases (${t})`;
  if (phases.length === t) return `All phases (${t})`;
  if (phases.length === 1) return phases[0];
  return `${phases.length} of ${t} phases`;
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
      // Re-render with current data (no backend call needed for employee filter)
      renderTaskList(AppState.currentOverviewPhase);
    });
  });
  menu.querySelector('#ovEmpAll').addEventListener('click', (e) => {
    e.stopPropagation();
    AppState.activeEmployees = [...employees];
    renderEmployeeFilter(employees);  // refresh checkmarks
    renderTaskList(AppState.currentOverviewPhase);
  });
  menu.querySelector('#ovEmpNone').addEventListener('click', (e) => {
    e.stopPropagation();
    AppState.activeEmployees = [];
    renderEmployeeFilter(employees);
    renderTaskList(AppState.currentOverviewPhase);
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

function renderSummary(filteredTasks) {
  const summary = document.getElementById('ovAnalysisSummary');
  if (!summary) return;

  // Compute summary from filtered (non-context) tasks
  // Only count leaves to avoid double-counting via parents' rollups
  const taskList = filteredTasks || [];

  const taskIdsHere = new Set(taskList.map(t => t.id));
  const isParent = (t) => taskList.some(x => x.parent_id === t.id);

  let totalPlanned = 0;
  let totalActual = 0;
  let totalRemaining = 0;
  let parentsCount = 0;
  let subsCount = 0;
  let doneCount = 0;
  let activeCount = 0;
  let notStartedCount = 0;

  taskList.forEach(t => {
    const hasChild = isParent(t);
    if (hasChild) parentsCount++;
    else subsCount++;

    // Only count leaf tasks for hours (avoid double-counting parent rollups)
    if (!hasChild) {
      const stage = (t.stage || '').toLowerCase().trim();
      const isClosed = stage === 'closed' || stage === 'done' || (t.progress_pct >= 100);
      const planned = t.planned_hours || 0;
      const actual = t.actual_hours || 0;
      totalPlanned += planned;
      totalActual += actual;
      // Closed tasks: remaining = 0
      if (isClosed) {
        totalRemaining += 0;
        doneCount++;
      } else if (planned > 0) {
        totalRemaining += Math.max(0, planned - actual);
        if (actual > 0) activeCount++;
        else notStartedCount++;
      } else {
        // Task without planning — show actual as "active" if any
        if (actual > 0) activeCount++;
        else notStartedCount++;
      }
    }
  });

  const totalTasks = taskList.length;
  const overallProgress = totalPlanned > 0 ? Math.min(150, totalActual / totalPlanned * 100) : 0;

  // Color for remaining: more remaining = warning
  const remainingColor = totalRemaining === 0 ? 'kpi-green'
    : totalRemaining > totalPlanned * 0.5 ? 'kpi-red'
    : totalRemaining > totalPlanned * 0.25 ? 'kpi-amber' : 'kpi-blue';

  const totalEAC = totalActual + totalRemaining;
  const eacMD = totalEAC / 8;
  const remMD = totalRemaining / 8;

  // Save remaining MD to AppState for Profitability tab
  if (!AppState._taskRemainingMDs) AppState._taskRemainingMDs = {};
  AppState._taskRemainingMDs[AppState.ovActivePhase || 'development'] = remMD;

  summary.innerHTML = `
    <div class="kpi-strip kpi-strip-small" style="margin-bottom: 16px;">
      <div class="kpi-card kpi-blue compact">
        <div class="kpi-label">TASKS</div>
        <div class="kpi-value">${totalTasks}</div>
        <div class="kpi-foot">${parentsCount} parents · ${subsCount} subs · <span style="color:var(--green)">${doneCount} done</span> · <span style="color:var(--amber)">${activeCount} active</span> · ${notStartedCount} new</div>
      </div>
      <div class="kpi-card kpi-navy compact">
        <div class="kpi-label">PLANNED HOURS</div>
        <div class="kpi-value">${fmt.num(Math.round(totalPlanned))}<span class="kpi-unit">h</span></div>
        <div class="kpi-foot">${fmt.decimal(totalPlanned/8)} MD</div>
      </div>
      <div class="kpi-card kpi-green compact">
        <div class="kpi-label">ACTUAL HOURS</div>
        <div class="kpi-value">${fmt.num(Math.round(totalActual))}<span class="kpi-unit">h</span></div>
        <div class="kpi-foot">${fmt.decimal(totalActual/8)} MD</div>
      </div>
      <div class="kpi-card ${remainingColor} compact">
        <div class="kpi-label">REMAINING</div>
        <div class="kpi-value">${fmt.num(Math.round(totalRemaining))}<span class="kpi-unit">h</span></div>
        <div class="kpi-foot" style="font-weight:700;">${fmt.decimal(remMD)} MD</div>
      </div>
      <div class="kpi-card kpi-blue compact">
        <div class="kpi-label">EAC</div>
        <div class="kpi-value">${fmt.num(Math.round(totalEAC))}<span class="kpi-unit">h</span></div>
        <div class="kpi-foot" style="font-weight:700; color:var(--blue);">${fmt.decimal(eacMD)} MD</div>
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
  const activeEmps = AppState.activeEmployees || [];
  const empFilterActive = activeEmps.length > 0 && activeEmps.length < (data.employees_available || []).length;

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
      const taskStage = (t.stage || '').toLowerCase().trim();
      if (taskStage !== statusFilter.toLowerCase()) pass = false;
    }
    // Employee filter: task must have one of the active employees in allocation OR be assignee
    if (pass && empFilterActive) {
      const taskEmps = new Set();
      (t.allocation || []).forEach(a => taskEmps.add(a.name));
      if (t.assignee) taskEmps.add(t.assignee);
      const hasMatch = activeEmps.some(e => taskEmps.has(e));
      if (!hasMatch) pass = false;
    }
    if (pass) matchedIds.add(t.id);
  });

  // Step 2: include all ancestors of matched tasks (so the tree shows context)
  // EXCEPT when typeFilter is 'subtasks' - then show only sub-tasks flat
  const visibleIds = new Set(matchedIds);
  const expandedForSearch = new Set();
  if (typeFilter !== 'subtasks') {
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
  }

  let tasks = allTasks.filter(t => visibleIds.has(t.id));

  // Update summary KPIs with the matched tasks (excluding context-only ancestors)
  const matchedTasksList = allTasks.filter(t => matchedIds.has(t.id));
  renderSummary(matchedTasksList);

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

  // Pagination: 10 at a time, reset on filter change, can collapse back
  const fKey = [search, typeFilter, statusFilter,
    (AppState.activeEmployees||[]).join(','),
    (AppState.activePhases||[]).join(',')].join('|');
  if (AppState._taskFilterKey !== fKey) {
    AppState._taskFilterKey = fKey;
    AppState._taskPage = 0;
  }
  if (!AppState._taskPage) AppState._taskPage = 0;
  AppState._lastPhaseGroup = phaseGroup;

  const PAGE     = 10;
  const showN    = (AppState._taskPage + 1) * PAGE;
  const shown    = rootTasks.slice(0, showN);
  const remaining = Math.max(0, rootTasks.length - showN);
  const canCollapse = AppState._taskPage > 0;

  let html = `<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <h3 class="card-title" style="margin:0;">Tasks
        <span class="muted-text">— ${matchedIds.size} match${matchedIds.size!==1?'es':''}${matchedIds.size<tasks.length?` · ${tasks.length-matchedIds.size} parent context`:''}</span>
      </h3>
      <span class="muted-text" style="font-size:11px;">Click parent to expand · Live from Odoo</span>
    </div>
    <div class="task-analysis-list">`;

  shown.forEach(t => { html += renderTaskBranch(t, 0); });

  // Show more / collapse buttons
  if (remaining > 0 || canCollapse) {
    html += `<div style="display:flex;gap:8px;justify-content:center;padding:14px 0 4px;">`;
    if (remaining > 0) {
      html += `<button onclick="_ovLoadMore()" style="padding:6px 20px;border:1px solid var(--border);
        border-radius:6px;background:var(--bg-subtle);cursor:pointer;font-size:13px;font-weight:600;color:var(--navy);">
        Show 10 more <span style="color:var(--muted);font-weight:400;font-size:12px;">(${remaining} remaining)</span>
      </button>`;
    }
    if (canCollapse) {
      html += `<button onclick="_ovCollapse()" style="padding:6px 16px;border:1px solid var(--border);
        border-radius:6px;background:transparent;cursor:pointer;font-size:12px;color:var(--muted);">
        ↑ Collapse to 10
      </button>`;
    }
    html += `</div>`;
  }

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

window._ovLoadMore = function() {
  if (!AppState._taskPage) AppState._taskPage = 0;
  AppState._taskPage += 1;
  renderTaskList(AppState._lastPhaseGroup);
};

window._ovCollapse = function() {
  AppState._taskPage = 0;
  renderTaskList(AppState._lastPhaseGroup);
};

function renderTaskCard(t, childCount, depth, isMatched) {
  const hasChildren = childCount > 0;
  const stageLower = (t.stage || '').toLowerCase().trim();
  const isClosed = stageLower === 'closed' || stageLower === 'done';

  let plannedH, actualH, remainingH, progressP;
  if (hasChildren) {
    plannedH = t.subtask_planned_hours || 0;
    actualH = t.subtask_actual_hours || 0;
    remainingH = isClosed ? 0 : Math.max(0, plannedH - actualH);
    progressP = isClosed ? 100 : (plannedH > 0 ? Math.min(150, (actualH / plannedH * 100)) : 0);
  } else {
    plannedH = t.planned_hours || 0;
    actualH = t.actual_hours || 0;
    remainingH = isClosed ? 0 : Math.max(0, plannedH - actualH);
    progressP = isClosed ? 100 : (t.progress_pct || 0);
  }

  let progressColor, progressLabel;
  if (progressP === 0) { progressColor = '#9CA3AF'; progressLabel = 'Not started'; }
  else if (progressP >= 100 && progressP <= 110) { progressColor = '#10B981'; progressLabel = 'Done'; }
  else if (progressP > 110) { progressColor = '#10B981'; progressLabel = 'Done'; }  // treat over 100 as done
  else if (progressP >= 75) { progressColor = '#10B981'; progressLabel = 'On track'; }
  else if (progressP >= 40) { progressColor = '#F59E0B'; progressLabel = 'In progress'; }
  else { progressColor = '#3B82F6'; progressLabel = 'Active'; }

  const stageColor = stageColorMap(t.stage);
  const isExpanded = AppState.expandedTasks.has(t.id);
  const widthBar = Math.min(100, progressP);
  const isChild = depth > 0;

  // For parent display, show rolled-up allocation; for leaf, show own
  let displayAlloc;
  let isInherited = false;
  if (hasChildren) {
    displayAlloc = Object.entries(t.rollup_allocation || {})
      .sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([n, h]) => ({ name: n, hours: h }));
  } else if ((t.allocation || []).length > 0) {
    displayAlloc = (t.allocation || []).slice(0, 3);
  } else if ((t.inherited_allocation || []).length > 0) {
    // Task has no direct allocation - show inherited from parent
    displayAlloc = t.inherited_allocation.slice(0, 3);
    isInherited = true;
  } else {
    displayAlloc = [];
  }

  const allocHtml = displayAlloc.map(a =>
    `<span class="alloc-pill-mini${isInherited ? ' alloc-inherited' : ''}" title="${a.hours}h${isInherited ? ' (inherited from parent)' : ''}">${a.name}</span>`
  ).join('');
  const totalAllocCount = hasChildren
    ? Object.keys(t.rollup_allocation || {}).length
    : (t.allocation?.length || (t.inherited_allocation?.length || 0));
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
          <div class="tcc-stat">
            <div class="tcc-stat-lbl">EAC</div>
            <div class="tcc-stat-val" style="color:var(--blue);">${fmt.decimal(actualH+remainingH)}<small>h</small></div>
          </div>
          <div class="tcc-progress-num" style="color: ${progressColor};">
            ${fmt.decimal(Math.min(100, progressP))}<small>%</small>
          </div>
        </div>
      </div>
      <div class="tcc-progress-bar">
        <div class="tcc-progress-fill" style="width: ${widthBar}%; background: ${progressColor};"></div>
      </div>
      ${(allocHtml || progressLabel) ? `
        <div class="tcc-row2">
          ${progressLabel ? `<span class="tcc-status" style="background: ${progressColor}18; color: ${progressColor};">${progressLabel}</span>` : ''}
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
