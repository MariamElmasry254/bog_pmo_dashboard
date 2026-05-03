/* Shared utilities */
window.fmt = {
  num: n => new Intl.NumberFormat('en-US').format(Math.round(n || 0)),
  decimal: n => (n ?? 0).toLocaleString('en-US', { maximumFractionDigits: 1 }),
  money: n => new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n || 0),
};

// Global state
window.AppState = {
  loaded: { overview: false, budget: false, services: false, timesheets: false, missing: false, roadmap: false },
  charts: {},
};

// Helper: get default date range (last 30 days)
window.getDefaultDates = function() {
  const today = new Date();
  const back = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
  return {
    from: back.toISOString().split('T')[0],
    to: today.toISOString().split('T')[0],
  };
};

// Initial generated time
document.getElementById('generatedTime').textContent =
  new Date().toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' });
