/* Overview tab */
window.loadOverview = async function() {
  const res = await fetch('/api/overview');
  const d = await res.json();
  document.getElementById('kpiServices').textContent = d.total_services;
  document.getElementById('kpiWD').textContent = fmt.num(d.total_working_days);
  document.getElementById('kpiProfit').textContent = d.profit_pct;
  document.getElementById('progressVal').textContent = d.progress_pct;
  document.getElementById('progressBar').style.width = d.progress_pct + '%';

  const ctx = document.getElementById('complexityChart').getContext('2d');
  if (AppState.charts.complexity) AppState.charts.complexity.destroy();
  AppState.charts.complexity = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: Object.keys(d.complexity_distribution),
      datasets: [{
        data: Object.values(d.complexity_distribution),
        backgroundColor: ['#3B82F6', '#10B981', '#F59E0B', '#EF4444'],
        borderColor: '#fff',
        borderWidth: 3,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'right', labels: { color: '#4B5563', font: { family: 'Inter', size: 13 }, padding: 14 } } },
      cutout: '65%'
    }
  });

  loadRecentActivity();
};

async function loadRecentActivity() {
  const today = new Date();
  const lastWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fromStr = lastWeek.toISOString().split('T')[0];
  const cont = document.getElementById('recentActivity');
  try {
    const res = await fetch(`/api/timesheets/employees?from=${fromStr}`);
    const d = await res.json();
    if (!d.employees || !d.employees.length) {
      cont.innerHTML = '<div class="loading">No activity in the last 7 days</div>';
      return;
    }
    cont.innerHTML = '';
    d.employees.slice(0, 8).forEach(e => {
      const row = document.createElement('div');
      row.className = 'activity-row';
      row.innerHTML = `
        <span class="activity-date">last 7 days</span>
        <span class="activity-emp">${e.name}</span>
        <span class="activity-task">${e.days_logged} days · ${e.entries} entries</span>
        <span class="activity-hrs">${fmt.decimal(e.total_hours)}h</span>
      `;
      cont.appendChild(row);
    });
  } catch (e) {
    cont.innerHTML = '<div class="loading">Could not load activity</div>';
  }
}
