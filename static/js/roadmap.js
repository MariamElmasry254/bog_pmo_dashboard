window.loadRoadmap = async function() {
  AppState.loaded.roadmap = true;
  const res = await fetch('/api/roadmap');
  const d = await res.json();

  const mt = document.getElementById('milestonesTimeline');
  mt.innerHTML = '';
  d.milestones.forEach(m => {
    const div = document.createElement('div');
    div.className = `milestone ${m.type}`;
    div.innerHTML = `
      <div class="milestone-date">${m.date}</div>
      <div class="milestone-title" dir="auto">${m.title}</div>
      <div class="milestone-desc" dir="auto">${m.desc}</div>
    `;
    mt.appendChild(div);
  });

  const tb = document.getElementById('teamBreakdown');
  tb.innerHTML = '';
  Object.values(d.team_breakdown).forEach(team => {
    const card = document.createElement('div');
    card.className = 'team-card';
    card.innerHTML = `
      <h4 dir="auto">${team.name}</h4>
      <div class="big-num">${team.count}</div>
      <div class="small-text">services${team.total_wd ? ` · ${fmt.decimal(team.total_wd)} working days` : ''}</div>
    `;
    tb.appendChild(card);
  });

  const today = new Date().toISOString().split('T')[0];
  const tbody = document.querySelector('#roadmapTable tbody');
  tbody.innerHTML = '';
  d.services.forEach(s => {
    let status = 'not-started', label = 'Not Started';
    if (s.start <= today && s.end >= today) { status = 'in-progress'; label = 'In Progress'; }
    else if (s.end < today) { status = 'done'; label = 'Done'; }
    else { status = 'not-started'; label = 'Upcoming'; }
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${s.id}</td>
      <td dir="auto" style="font-weight:500;">${s.name}</td>
      <td><span class="team-pill" dir="auto">${s.team}</span></td>
      <td><span style="font-family: var(--mono); font-size: 12px;">${s.start}</span></td>
      <td><span style="font-family: var(--mono); font-size: 12px;">${s.end}</span></td>
      <td class="num">${s.wd != null ? fmt.decimal(s.wd) : '—'}</td>
      <td><span class="status-pill status-${status}">${label}</span></td>
    `;
    tbody.appendChild(tr);
  });
};
