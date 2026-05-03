/* Risks & Issues tab */

window.loadRisks = async function() {
  if (!AppState.loaded.risks) {
    AppState.loaded.risks = true;
    AppState.currentRiskPhase = 'development';

    document.querySelectorAll('#risksSubTabs .sub-tab').forEach(b => {
      b.addEventListener('click', () => {
        const ph = b.dataset.rphase;
        AppState.currentRiskPhase = ph;
        document.querySelectorAll('#risksSubTabs .sub-tab').forEach(x =>
          x.classList.toggle('active', x.dataset.rphase === ph));
        loadRisksList();
      });
    });

    document.getElementById('addRiskBtn').addEventListener('click', () => openRiskModal(null));
    document.getElementById('riskModalClose').addEventListener('click', closeRiskModal);
    document.getElementById('riskCancelBtn').addEventListener('click', closeRiskModal);
    document.getElementById('riskSaveBtn').addEventListener('click', saveRisk);
    document.getElementById('riskDeleteBtn').addEventListener('click', deleteRisk);
    document.querySelector('.risk-modal-overlay').addEventListener('click', closeRiskModal);

    document.getElementById('riskSevFilter').addEventListener('change', renderRisks);
    document.getElementById('riskStatusFilter').addEventListener('change', renderRisks);
    document.getElementById('riskTypeFilter').addEventListener('change', renderRisks);
  }
  await loadRisksList();
};

async function loadRisksList() {
  const cont = document.getElementById('risksContent');
  cont.innerHTML = '<div class="loading">Loading…</div>';
  try {
    const phase = AppState.currentRiskPhase || 'development';
    const res = await fetch(`/api/risks?phase_group=${phase}`);
    const d = await res.json();
    AppState.risksData = d.risks || [];
    renderRisks();
  } catch (e) {
    cont.innerHTML = `<div class="banner banner-warn"><strong>Error:</strong> ${e.message}</div>`;
  }
}

function renderRisks() {
  const cont = document.getElementById('risksContent');
  const kpis = document.getElementById('risksKpis');
  let risks = AppState.risksData || [];

  const sevF = document.getElementById('riskSevFilter')?.value || 'all';
  const statF = document.getElementById('riskStatusFilter')?.value || 'all';
  const typeF = document.getElementById('riskTypeFilter')?.value || 'all';

  if (sevF !== 'all') risks = risks.filter(r => r.severity === sevF);
  if (statF !== 'all') risks = risks.filter(r => r.status === statF);
  if (typeF !== 'all') risks = risks.filter(r => r.type === typeF);

  // KPIs
  const all = AppState.risksData || [];
  const openCount = all.filter(r => r.status === 'Open' || r.status === 'In Progress').length;
  const critHigh = all.filter(r => (r.severity === 'Critical' || r.severity === 'High') && r.status !== 'Resolved' && r.status !== 'Closed').length;
  const resolvedCount = all.filter(r => r.status === 'Resolved' || r.status === 'Closed').length;
  kpis.innerHTML = `
    <div class="kpi-card kpi-blue compact">
      <div class="kpi-label">TOTAL</div>
      <div class="kpi-value">${all.length}</div>
    </div>
    <div class="kpi-card kpi-red compact">
      <div class="kpi-label">CRITICAL/HIGH OPEN</div>
      <div class="kpi-value">${critHigh}</div>
    </div>
    <div class="kpi-card kpi-amber compact">
      <div class="kpi-label">OPEN/IN PROGRESS</div>
      <div class="kpi-value">${openCount}</div>
    </div>
    <div class="kpi-card kpi-green compact">
      <div class="kpi-label">RESOLVED</div>
      <div class="kpi-value">${resolvedCount}</div>
    </div>
  `;

  if (!risks.length) {
    cont.innerHTML = `
      <div class="card">
        <div class="empty-state">
          <div class="empty-icon">⚠️</div>
          <div class="empty-text">No risks or issues yet for ${AppState.currentRiskPhase}.</div>
          <div class="empty-sub">Click "Add Risk/Issue" to start tracking.</div>
        </div>
      </div>`;
    return;
  }

  let html = '<div class="risks-grid">';
  risks.forEach(r => {
    const sevColor = sevColorMap(r.severity);
    const sevIcon = sevIconMap(r.severity);
    const statusColor = statusColorMap(r.status);
    const typeIcon = r.type === 'Issue' ? '🔥' : '⚠️';

    html += `
      <div class="risk-card severity-${r.severity?.toLowerCase()}" data-risk-id="${r.id}">
        <div class="risk-card-strip" style="background: ${sevColor};"></div>
        <div class="risk-card-body">
          <div class="risk-card-head">
            <div class="risk-title-row">
              <span class="risk-type-pill">${typeIcon} ${r.type || 'Risk'}</span>
              <span class="risk-sev-pill" style="background: ${sevColor}20; color: ${sevColor}; border: 1px solid ${sevColor};">
                ${sevIcon} ${r.severity || 'Medium'}
              </span>
              <span class="risk-status-pill" style="background: ${statusColor}20; color: ${statusColor};">
                ${r.status || 'Open'}
              </span>
            </div>
            <button class="risk-edit-btn" data-edit-id="${r.id}" title="Edit">✏️</button>
          </div>
          <div class="risk-title">${r.title || '(no title)'}</div>
          ${r.description ? `<div class="risk-desc"><b>Description:</b> ${r.description}</div>` : ''}
          ${r.mitigation ? `<div class="risk-mit"><b>🛡️ Mitigation:</b> ${r.mitigation}</div>` : ''}
          <div class="risk-meta">
            ${r.owner ? `<span>👤 ${r.owner}</span>` : ''}
            ${r.date_identified ? `<span>📅 Identified: ${r.date_identified}</span>` : ''}
            ${r.target_date ? `<span>🎯 Target: ${r.target_date}</span>` : ''}
            <span class="risk-meta-updated">Updated ${(r.updated_at || '').slice(0, 10)}</span>
          </div>
        </div>
      </div>
    `;
  });
  html += '</div>';
  cont.innerHTML = html;

  // Wire edit clicks
  cont.querySelectorAll('.risk-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.editId;
      const risk = (AppState.risksData || []).find(r => r.id === id);
      if (risk) openRiskModal(risk);
    });
  });
}

function sevColorMap(sev) {
  return { Low: '#10B981', Medium: '#F59E0B', High: '#F97316', Critical: '#DC2626' }[sev] || '#6B7280';
}
function sevIconMap(sev) {
  return { Low: '🟢', Medium: '🟡', High: '🟠', Critical: '🔴' }[sev] || '';
}
function statusColorMap(stat) {
  return { Open: '#DC2626', 'In Progress': '#3B82F6', Resolved: '#10B981', Closed: '#6B7280' }[stat] || '#6B7280';
}

function openRiskModal(risk) {
  document.getElementById('riskModal').style.display = 'flex';
  document.getElementById('riskModalTitle').textContent = risk ? 'Edit Risk/Issue' : 'Add New Risk/Issue';
  document.getElementById('riskId').value = risk?.id || '';
  document.getElementById('riskType').value = risk?.type || 'Risk';
  document.getElementById('riskSeverity').value = risk?.severity || 'Medium';
  document.getElementById('riskStatus').value = risk?.status || 'Open';
  document.getElementById('riskTitle').value = risk?.title || '';
  document.getElementById('riskDescription').value = risk?.description || '';
  document.getElementById('riskMitigation').value = risk?.mitigation || '';
  document.getElementById('riskOwner').value = risk?.owner || '';
  document.getElementById('riskDateId').value = risk?.date_identified || new Date().toISOString().split('T')[0];
  document.getElementById('riskTargetDate').value = risk?.target_date || '';
  document.getElementById('riskDeleteBtn').style.display = risk ? 'inline-block' : 'none';
}
function closeRiskModal() {
  document.getElementById('riskModal').style.display = 'none';
}

async function saveRisk() {
  const id = document.getElementById('riskId').value;
  const title = document.getElementById('riskTitle').value.trim();
  if (!title) { alert('Title is required'); return; }

  const body = {
    phase_group: AppState.currentRiskPhase || 'development',
    type: document.getElementById('riskType').value,
    severity: document.getElementById('riskSeverity').value,
    status: document.getElementById('riskStatus').value,
    title: title,
    description: document.getElementById('riskDescription').value.trim(),
    mitigation: document.getElementById('riskMitigation').value.trim(),
    owner: document.getElementById('riskOwner').value.trim(),
    date_identified: document.getElementById('riskDateId').value,
    target_date: document.getElementById('riskTargetDate').value,
  };
  if (id) body.id = id;

  try {
    const saveBtn = document.getElementById('riskSaveBtn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    const res = await fetch('/api/risks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const d = await res.json();
    if (d.ok) {
      closeRiskModal();
      await loadRisksList();
    } else {
      alert('Save failed: ' + (d.error || 'unknown'));
    }
    saveBtn.disabled = false;
    saveBtn.textContent = '💾 Save';
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

async function deleteRisk() {
  const id = document.getElementById('riskId').value;
  if (!id) return;
  if (!confirm('Are you sure you want to delete this risk/issue?')) return;
  try {
    await fetch(`/api/risks/${id}`, { method: 'DELETE' });
    closeRiskModal();
    await loadRisksList();
  } catch (e) {
    alert('Error: ' + e.message);
  }
}
