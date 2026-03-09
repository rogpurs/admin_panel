let token = localStorage.getItem('admin_token') || '';

const el = (id) => document.getElementById(id);
const fmt = (v) => Number(v || 0).toLocaleString();
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString() : '-');

const request = async (url, options = {}) => {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { ...options, headers });
  const type = res.headers.get('content-type') || '';
  if (!res.ok) {
    const body = type.includes('application/json') ? await res.json() : { error: await res.text() };
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return type.includes('application/json') ? res.json() : res.text();
};

const showView = (name) => {
  document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
  document.querySelectorAll('.menu').forEach((m) => m.classList.remove('active'));
  el(`view-${name}`).classList.add('active');
  document.querySelector(`.menu[data-view="${name}"]`)?.classList.add('active');
};

document.querySelectorAll('.menu').forEach((btn) => {
  btn.addEventListener('click', () => showView(btn.dataset.view));
});

const badge = (state) => {
  const s = String(state || '').toLowerCase();
  if (s === 'active') return `<span class="badge ok">${state}</span>`;
  if (s === 'inactive' || s === 'activating') return `<span class="badge warn">${state}</span>`;
  return `<span class="badge err">${state || 'unknown'}</span>`;
};

const renderProjects = (projects) => {
  const root = el('projects');
  root.innerHTML = '';
  if (!projects.length) {
    root.innerHTML = '<p class="msg">プロジェクトがまだありません。</p>';
    return;
  }
  projects.forEach((p) => {
    const d = document.createElement('div');
    d.className = 'item';
    d.innerHTML = `
      <strong>${p.name}</strong> <small>${p.slug}</small><br>
      domain: ${p.domain} / port: ${p.port}<br>
      repo: ${p.repoUrl} (${p.branch})<br>
      service: ${p.serviceName || `${p.slug}.service`}
      <div class="toolbar">
        <button data-action="provision" data-id="${p.id}" class="ghost">初期構築</button>
        <button data-action="deploy" data-id="${p.id}">アップデート</button>
      </div>
    `;
    root.appendChild(d);
  });
};

const renderJobs = (jobs) => {
  const root = el('jobs');
  root.innerHTML = '';
  if (!jobs.length) {
    root.innerHTML = '<p class="msg">ジョブはまだありません。</p>';
    return;
  }
  jobs.forEach((j) => {
    const d = document.createElement('div');
    d.className = 'item';
    d.innerHTML = `
      <strong>#${j.id}</strong> ${j.type} / ${j.status} / project=${j.projectId}
      <div><small>開始: ${fmtDate(j.startedAt)} / 終了: ${fmtDate(j.finishedAt)} / code: ${j.exitCode ?? '-'}</small></div>
      <div class="toolbar"><button data-action="log" data-id="${j.id}" class="ghost">ログ表示</button></div>
    `;
    root.appendChild(d);
  });
};

const renderMonitor = (m) => {
  el('mon-host').textContent =
`hostname: ${m.host.hostname}
platform: ${m.host.platform} ${m.host.release}
uptime: ${m.host.uptimePretty || `${m.host.uptimeSec} sec`}
now: ${m.now}`;

  el('mon-cpu').textContent =
`arch: ${m.cpu.arch}
cores: ${m.cpu.cores}
model: ${m.cpu.model}
loadavg: ${m.cpu.loadavg.join(', ')}`;

  el('mon-mem').textContent =
`total: ${fmt(m.memory.total)}
used: ${fmt(m.memory.used)}
free: ${fmt(m.memory.free)}
usage: ${m.memory.usagePercent}%`;

  el('mon-disk').textContent = m.disk.dfRoot || 'N/A';

  el('mon-svc').innerHTML =
`nginx: ${badge(m.services.nginx)}
cloudflared: ${badge(m.services.cloudflared)}
admin-panel: ${badge(m.services.adminPanel)}`;

  el('mon-count').textContent = `projects: ${m.counters.projects}\njobs: ${m.counters.jobs}`;
};

const loadProjects = async () => {
  const data = await request('/api/projects');
  renderProjects(data);
};

const loadJobs = async () => {
  const data = await request('/api/jobs');
  renderJobs(data);
};

const loadMonitor = async () => {
  const data = await request('/api/monitor');
  renderMonitor(data);
  el('monitor-msg').textContent = `最終更新: ${new Date().toLocaleTimeString()}`;
};

el('login-btn').onclick = async () => {
  try {
    const r = await request('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username: el('username').value, password: el('password').value })
    });
    token = r.token;
    localStorage.setItem('admin_token', token);
    el('auth-msg').textContent = 'ログイン成功';
    await Promise.all([loadProjects(), loadJobs(), loadMonitor()]);
    showView('dashboard');
  } catch (e) {
    el('auth-msg').textContent = e.message;
  }
};

el('logout-btn').onclick = async () => {
  try {
    if (token) await request('/api/logout', { method: 'POST' });
  } catch (_) {}
  token = '';
  localStorage.removeItem('admin_token');
  el('auth-msg').textContent = 'ログアウトしました';
};

el('create-btn').onclick = async () => {
  try {
    const body = {
      name: el('name').value,
      slug: el('slug').value,
      domain: el('domain').value,
      repoUrl: el('repoUrl').value,
      branch: el('branch').value || 'main',
      port: Number(el('port').value)
    };
    await request('/api/projects', { method: 'POST', body: JSON.stringify(body) });
    el('project-msg').textContent = 'プロジェクトを作成しました';
    await Promise.all([loadProjects(), loadMonitor()]);
  } catch (e) {
    el('project-msg').textContent = e.message;
  }
};

el('refresh-projects').onclick = () => loadProjects().catch((e) => (el('project-msg').textContent = e.message));
el('refresh-jobs').onclick = () => loadJobs().catch((e) => (el('job-log').textContent = e.message));
el('refresh-monitor').onclick = () => loadMonitor().catch((e) => (el('monitor-msg').textContent = e.message));

document.body.addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const id = btn.dataset.id;
  try {
    if (action === 'deploy') {
      await request(`/api/projects/${id}/deploy`, { method: 'POST' });
      await loadJobs();
      showView('jobs');
    }
    if (action === 'provision') {
      await request(`/api/projects/${id}/provision`, { method: 'POST' });
      await loadJobs();
      showView('jobs');
    }
    if (action === 'log') {
      const txt = await request(`/api/jobs/${id}/log`);
      el('job-log').textContent = txt;
    }
  } catch (e) {
    el('job-log').textContent = e.message;
    showView('jobs');
  }
});

if (token) {
  Promise.all([loadProjects(), loadJobs(), loadMonitor()]).catch(() => {
    el('auth-msg').textContent = '再ログインしてください';
  });
}

setInterval(() => {
  if (!token) return;
  loadMonitor().catch(() => {});
}, 10000);
