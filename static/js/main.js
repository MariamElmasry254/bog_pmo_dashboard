/* Main: tab navigation */
document.querySelectorAll('.exec-tab').forEach(t => {
  t.addEventListener('click', () => {
    const target = t.dataset.tab;
    document.querySelectorAll('.exec-tab').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    t.classList.add('active');
    document.getElementById(target).classList.add('active');

    if (target === 'services' && !AppState.loaded.services) loadServices();
    else if (target === 'timesheets') loadTimesheets();
    else if (target === 'missing') loadMissing();
    else if (target === 'risks') loadRisks();
    else if (target === 'roadmap' && !AppState.loaded.roadmap) loadRoadmap();
    else if (target === 'variance') loadVariance();
  });
});

// Initial load
loadOverview();
