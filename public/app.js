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
  if (s === 'active' || s === 'success') return `<span class="badge ok">${state}</span>`;
  if (s === 'inactive' || s === 'activating' || s === 'running') return `<span class="badge warn">${state}</span>`;
  return `<span class="badge err">${state || 'unknown'}</span>`;
};

const setGauge = (id, textId, percent, suffix = '%') => {
  const value = Math.max(0, Math.min(100, Number(percent || 0)));
  const gauge = el(id);
  const text = el(textId);
  if (gauge) gauge.style.setProperty('--p', value.toFixed(2));
  if (text) text.textContent = `${value.toFixed(1)}${suffix}`;
};

const fillProjectForm = (p) => {
  el('editingId').value = p.id;
  el('name').value = p.name || '';
  el('slug').value = p.slug || '';
  el('domain').value = p.domain || '';
  el('repoUrl').value = p.repoUrl || '';
  el('branch').value = p.branch || 'main';
  el('port').value = p.port || '';
  el('serviceName').value = p.serviceName || '';
  el('project-msg').textContent = `編集中: ${p.name}`;
};

const clearProjectForm = () => {
  el('editingId').value = '';
  el('name').value = '';
  el('slug').value = '';
  el('domain').value = '';
  el('repoUrl').value = '';
  el('branch').value = 'main';
  el('port').value = '';
  el('serviceName').value = '';
};

const projectMap = new Map();

const refreshProjectSelectors = (projects) => {
  const chatTarget = el('chat-project-id');
  const current = chatTarget.value;
  chatTarget.innerHTML = '<option value="">(未選択)</option>';
  projects.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = String(p.id);
    opt.textContent = `${p.name} (${p.slug})`;
    chatTarget.appendChild(opt);
  });
  chatTarget.value = current;

  const quick = el('terminal-project-quick');
  quick.innerHTML = '';
  projects.forEach((p) => {
    const b = document.createElement('button');
    b.className = 'ghost';
    b.textContent = `cd ${p.slug}`;
    b.onclick = async () => {
      try {
        const r = await request('/api/terminal/cd-project', { method: 'POST', body: JSON.stringify({ projectId: p.id }) });
        el('terminal-cwd').textContent = r.cwd;
        appendTerminalLine(`${r.prompt} cd ${p.slug}\n${r.message}\n`);
      } catch (e) {
        el('terminal-msg').textContent = e.message;
      }
    };
    quick.appendChild(b);
  });
};

const refreshJobSelector = (jobs) => {
  const target = el('chat-job-id');
  const current = target.value;
  target.innerHTML = '<option value="">(未選択)</option>';
  jobs.forEach((j) => {
    const opt = document.createElement('option');
    opt.value = String(j.id);
    opt.textContent = `#${j.id} ${j.type}/${j.status}`;
    target.appendChild(opt);
  });
  target.value = current;
};

const renderProjects = (projects) => {
  const root = el('projects');
  root.innerHTML = '';
  projectMap.clear();

  if (!projects.length) {
    root.innerHTML = '<p class="msg">プロジェクトがまだありません。</p>';
    refreshProjectSelectors([]);
    return;
  }

  projects.forEach((p) => {
    projectMap.set(String(p.id), p);
    const status = p.status || {};
    const d = document.createElement('div');
    d.className = 'item';
    d.innerHTML = `
      <strong>${p.name}${p.isMain ? ' (MAIN)' : ''}</strong> <small>${p.slug}</small><br>
      domain: ${p.domain} / port: ${p.port}<br>
      repo: ${p.repoUrl || '(未設定)'} (${p.branch || '-'})<br>
      service: ${p.serviceName || `${p.slug}.service`}<br>
      status: ${badge(status.serviceState || 'unknown')} / dir: ${status.directoryExists ? 'yes' : 'no'} / git: ${status.gitReady ? 'yes' : 'no'}
      <div class="toolbar">
        <button data-action="edit" data-id="${p.id}" class="ghost">編集</button>
        <button data-action="provision" data-id="${p.id}" class="ghost">初期構築</button>
        <button data-action="deploy" data-id="${p.id}">アップデート</button>
        <button data-action="delete" data-id="${p.id}" class="danger">削除</button>
      </div>
    `;
    root.appendChild(d);
  });

  refreshProjectSelectors(projects);
};

const renderJobs = (jobs) => {
  const root = el('jobs');
  root.innerHTML = '';
  if (!jobs.length) {
    root.innerHTML = '<p class="msg">ジョブはまだありません。</p>';
    refreshJobSelector([]);
    return;
  }
  jobs.forEach((j) => {
    const d = document.createElement('div');
    d.className = 'item';
    d.innerHTML = `
      <strong>#${j.id}</strong> ${j.type} / ${badge(j.status)} / project=${j.projectSlug || j.projectId}
      <div><small>開始: ${fmtDate(j.startedAt)} / 終了: ${fmtDate(j.finishedAt)} / code: ${j.exitCode ?? '-'}</small></div>
      <div class="toolbar"><button data-action="log" data-id="${j.id}" class="ghost">ログ表示</button></div>
    `;
    root.appendChild(d);
  });
  refreshJobSelector(jobs);
};

const renderMonitor = (m) => {
  const cores = Number(m.cpu.cores || 1);
  const load1 = Number(m.cpu.loadavg?.[0] || 0);
  const cpuLoad = Math.min(100, (load1 / cores) * 100);

  setGauge('gauge-memory', 'gauge-memory-text', m.memory.usagePercent || 0);
  setGauge('gauge-disk', 'gauge-disk-text', m.disk.usagePercent || 0);
  setGauge('gauge-cpu', 'gauge-cpu-text', cpuLoad || 0);

  el('mon-host').textContent =
`hostname: ${m.host.hostname}
platform: ${m.host.platform} ${m.host.release}
ips: ${(m.host.ips || []).join(', ') || '-'}
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

  el('mon-count').textContent =
`projects: ${m.counters.projects}
jobs: ${m.counters.jobs}
running_jobs: ${m.counters.runningJobs}`;

  el('monitor-msg').textContent = `最終更新: ${new Date().toLocaleTimeString()}`;
};

const collectProjectBody = () => ({
  name: el('name').value,
  slug: el('slug').value,
  domain: el('domain').value,
  repoUrl: el('repoUrl').value,
  branch: el('branch').value || 'main',
  port: Number(el('port').value),
  serviceName: el('serviceName').value || undefined
});

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
};

const loadConfig = async () => {
  const cfg = await request('/api/config');
  el('feature-flags').textContent = `AI: ${cfg.aiEnabled ? 'ON' : 'OFF'} / Terminal: ${cfg.terminalEnabled ? 'ON' : 'OFF'}`;
  if (!cfg.terminalEnabled) el('terminal-msg').textContent = 'TERMINAL_ENABLED=false のため実行不可';
};

const appendTerminalLine = (text) => {
  const area = el('terminal-output');
  area.textContent += text;
  area.scrollTop = area.scrollHeight;
};

const loadTerminalState = async () => {
  const state = await request('/api/terminal/history');
  el('terminal-cwd').textContent = state.cwd;
  const lines = [];
  (state.history || []).forEach((h) => {
    lines.push(`${h.prompt} ${h.command}`);
    if (h.stdout) lines.push(h.stdout);
    if (h.stderr) lines.push(h.stderr);
  });
  el('terminal-output').textContent = lines.join('\n') + (lines.length ? '\n' : '');
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
    await Promise.all([loadProjects(), loadJobs(), loadMonitor(), loadConfig(), loadTerminalState()]);
    showView('dashboard');
  } catch (e) {
    el('auth-msg').textContent = e.message;
  }
};

el('logout-btn').onclick = async () => {
  try { if (token) await request('/api/logout', { method: 'POST' }); } catch (_) {}
  token = '';
  localStorage.removeItem('admin_token');
  el('auth-msg').textContent = 'ログアウトしました';
};

el('create-btn').onclick = async () => {
  try {
    const result = await request('/api/projects', { method: 'POST', body: JSON.stringify(collectProjectBody()) });
    clearProjectForm();
    el('project-msg').textContent = `作成完了。自動初期構築ジョブ #${result.autoProvisionJobId} を開始しました`;
    await Promise.all([loadProjects(), loadJobs(), loadMonitor()]);
  } catch (e) {
    el('project-msg').textContent = e.message;
  }
};

el('save-btn').onclick = async () => {
  const id = el('editingId').value;
  if (!id) return (el('project-msg').textContent = '編集対象を選択してください');
  try {
    await request(`/api/projects/${id}`, { method: 'PUT', body: JSON.stringify(collectProjectBody()) });
    el('project-msg').textContent = '更新しました';
    await loadProjects();
  } catch (e) {
    el('project-msg').textContent = e.message;
  }
};

el('clear-form-btn').onclick = () => {
  clearProjectForm();
  el('project-msg').textContent = '入力をクリアしました';
};

el('add-main-btn').onclick = async () => {
  try {
    await request('/api/projects/bootstrap-main', { method: 'POST', body: JSON.stringify({}) });
    el('project-msg').textContent = 'メインドメインを追加しました';
    await loadProjects();
  } catch (e) {
    el('project-msg').textContent = e.message;
  }
};

el('refresh-projects').onclick = () => loadProjects().catch((e) => (el('project-msg').textContent = e.message));
el('refresh-jobs').onclick = () => loadJobs().catch((e) => (el('job-log').textContent = e.message));
el('refresh-monitor').onclick = () => loadMonitor().catch((e) => (el('monitor-msg').textContent = e.message));

el('terminal-run-btn').onclick = async () => {
  try {
    const command = el('terminal-command').value.trim();
    if (!command) return;
    const r = await request('/api/terminal/exec', { method: 'POST', body: JSON.stringify({ command }) });
    appendTerminalLine(`${r.prompt} ${command}\n${r.stdout || ''}${r.stderr || ''}\n`);
    el('terminal-cwd').textContent = r.cwd;
    el('terminal-msg').textContent = `exit=${r.code} / ${r.timeout ? 'TIMEOUT' : 'OK'} / ${r.durationMs}ms`;
    el('terminal-command').value = '';
  } catch (e) {
    el('terminal-msg').textContent = e.message;
  }
};

el('self-update-btn').onclick = async () => {
  try {
    const r = await request('/api/admin/self-update', { method: 'POST' });
    el('self-update-msg').textContent = `${r.message} (job #${r.jobId})`;
  } catch (e) {
    el('self-update-msg').textContent = e.message;
  }
};

document.body.addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const id = btn.dataset.id;

  try {
    if (action === 'edit') {
      const target = projectMap.get(String(id));
      if (!target) return;
      fillProjectForm(target);
      return showView('projects');
    }

    if (action === 'deploy') {
      await request(`/api/projects/${id}/deploy`, { method: 'POST' });
      await loadJobs();
      return showView('jobs');
    }

    if (action === 'provision') {
      await request(`/api/projects/${id}/provision`, { method: 'POST' });
      await loadJobs();
      return showView('jobs');
    }

    if (action === 'delete') {
      const ok = window.confirm('このプロジェクトを完全削除します。続行しますか？');
      if (!ok) return;
      await request(`/api/projects/${id}`, { method: 'DELETE' });
      await Promise.all([loadProjects(), loadJobs(), loadMonitor(), loadTerminalState()]);
      el('project-msg').textContent = '削除ジョブを開始しました';
      return;
    }

    if (action === 'log') {
      const txt = await request(`/api/jobs/${id}/log`);
      el('job-log').textContent = txt;
      return;
    }
  } catch (e) {
    el('job-log').textContent = e.message;
    showView('jobs');
  }
});

const chatWidget = el('chat-widget');
const chatToggle = el('chat-toggle');
const chatClose = el('chat-close');

const addChatBubble = (role, text) => {
  const item = document.createElement('div');
  item.className = `bubble ${role}`;
  item.textContent = text;
  el('chat-log').appendChild(item);
  el('chat-log').scrollTop = el('chat-log').scrollHeight;
};

chatToggle.onclick = () => chatWidget.classList.toggle('hidden');
chatClose.onclick = () => chatWidget.classList.add('hidden');

el('chat-send').onclick = async () => {
  const question = el('chat-question').value.trim();
  if (!question) return;

  const projectId = el('chat-project-id').value || undefined;
  const jobId = el('chat-job-id').value || undefined;

  addChatBubble('user', question);
  el('chat-question').value = '';

  try {
    const r = await request('/api/ai/advice', { method: 'POST', body: JSON.stringify({ question, projectId, jobId }) });
    addChatBubble('assistant', r.answer);
    el('chat-usage').textContent = `tokens: ${r.usage.total_tokens} (p:${r.usage.prompt_tokens} / c:${r.usage.completion_tokens})`;
  } catch (e) {
    addChatBubble('assistant', `エラー: ${e.message}`);
  }
};

if (token) {
  Promise.all([loadProjects(), loadJobs(), loadMonitor(), loadConfig(), loadTerminalState()]).catch(() => {
    el('auth-msg').textContent = '再ログインしてください';
  });
}

setInterval(() => {
  if (!token) return;
  loadMonitor().catch(() => {});
  loadJobs().catch(() => {});
}, 10000);
