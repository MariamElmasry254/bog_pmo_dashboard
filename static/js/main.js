/* Main: tab navigation */
document.querySelectorAll('.exec-tab').forEach(t => {
  t.addEventListener('click', () => {
    const target = t.dataset.tab;
    document.querySelectorAll('.exec-tab').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => { p.classList.remove('active'); p.style.display = 'none'; });
    t.classList.add('active');
    const targetEl = document.getElementById(target);
    if (targetEl) { targetEl.classList.add('active'); targetEl.style.display = ''; }

    if (target === 'services' && !AppState.loaded.services) loadServices();
    else if (target === 'timesheets') loadTimesheets();
    else if (target === 'sales') loadSalesOrders();
    else if (target === 'missing') loadMissing();
    else if (target === 'risks') loadRisks();
    else if (target === 'roadmap' && !AppState.loaded.roadmap) loadRoadmap();
    else if (target === 'variance') loadVariance();
  });
});

// Initial load
loadOverview();
