// variance2.js — Excel import extension for Estimated Cost
// Safe to add to any project without touching variance.js (BOG-specific)

async function estImportExcel(input, phaseKey) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';

  const wrap = document.getElementById('estimatedLiveWrap');
  if (wrap) wrap.innerHTML = '<div class="loading">Reading Excel…</div>';

  const form = new FormData();
  form.append('file', file);
  form.append('phase', phaseKey || window._estPhase || 'development');

  try {
    const res = await fetch('/api/estimated-rows/import-excel', { method: 'POST', body: form });
    const d   = await res.json();
    if (!d.ok) {
      alert('Import failed: ' + (d.error || 'Unknown'));
      if (wrap && window.loadEstimatedLive) await loadEstimatedLive(window._estPhase, 'estimatedLiveWrap');
      return;
    }
    window._estRows  = d.rows || [];
    window._estPhase = d.phase || phaseKey;
    if (window.estSave) await estSave();
    if (window.renderEstimatedTable) {
      renderEstimatedTable(
        document.getElementById('estimatedLiveWrap'),
        window._estRows,
        window._estPositions || [],
        window._estPhase
      );
    }
    setTimeout(() => { if (window.budgetAutoCalc) budgetAutoCalc(window._estPhase); }, 100);
  } catch (e) {
    alert('Error: ' + e.message);
    if (wrap && window.loadEstimatedLive) await loadEstimatedLive(window._estPhase, 'estimatedLiveWrap');
  }
}
