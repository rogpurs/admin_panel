let token = localStorage.getItem('admin_token') || '';

const el = (id) => document.getElementById(id);
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString() : '-');
const fmtPct = (n) => `${Number(n || 0).toFixed(1)}%`;

const VIEW_META = {
  dashboard: { title: 'ダッシュボード', sub: 'サーバー状態と全体の稼働を確認します。' },
  projects: { title: 'サイト管理', sub: '作成・編集・更新・削除を一箇所で行います。' },
  jobs: { title: 'ジョブ履歴', sub: '構築/更新/削除ジョブのログを追跡します。' },
  terminal: { title: 'ターミナル', sub: 'Webから直接サーバー操作を実行します。' },
  help: { title: 'ヘルプ', sub: '運用ガイドと管理パネル更新を行います。' },
  auth: { title: 'ログイン', sub: '管理者認証の開始/終了を行います。' }
};

const request = async (url, options = {}) => {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, { ...options, headers });
  const type = res.headers.get('content-type') || '';
  const body = type.includes('application/json') ? await res.json().catch(() => ({})) : await res.text();

  if (!res.ok) {
    const msg = typeof body === 'string' ? body : (body.error || `HTTP ${res.status}`);
    throw new Error(msg);
  }
  return body;
};

const setTopMeta = (view) => {
  const meta = VIEW_META[view] || VIEW_META.dashboard;
  el('top-title').textContent = meta.title;
  el('top-sub').textContent = meta.sub;
};

const showView = (name) => {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
  el(`view-${name}`)?.classList.add('active');
  document.querySelector(`.nav-btn[data-view="${name}"]`)?.classList.add('active');
  setTopMeta(name);
};

document.querySelectorAll('.nav-btn[data-view]').forEach((btn) => {
  btn.addEventListener('click', () => showView(btn.dataset.view));
});

const statusBadge = (raw) => {
  const state = String(raw || 'unknown').toLowerCase();
  const cls = (state === 'active' || state === 'success' || state === 'running')
    ? 'ok'
    : (state === 'inactive' || state === 'activating' || state === 'queued')
      ? 'warn'
      : 'err';
  return `<span class="badge ${cls}">${raw || 'unknown'}</span>`;
};

const setMeter = (barId, labelId, percent) => {
  const n = Math.max(0, Math.min(100, Number(percent || 0)));
  const bar = el(barId);
  if (bar) bar.style.width = `${n}%`;
  if (labelId && el(labelId)) el(labelId).textContent = fmtPct(n);
};

const projectMap = new Map();

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

const fillProjectForm = (p) => {
  el('editingId').value = p.id;
  el('name').value = p.name || '';
  el('slug').value = p.slug || '';
  el('domain').value = p.domain || '';
  el('repoUrl').value = p.repoUrl || '';
  el('branch').value = p.branch || 'main';
  el('port').value = p.port || '';
  el('serviceName').value = p.serviceName || '';
  el('project-msg').textContent = `編集中: ${p.name} (${p.slug})`;
};

const nextPortSuggestion = (projects) => {
  const used = new Set(projects.map((p) => Number(p.port)).filter((n) => Number.isFinite(n)));
  for (let port = 3200; port <= 3999; port += 1) {
    if (!used.has(port)) return port;
  }
  return 4000;
};

const refreshProjectQuickSelectors = (projects) => {
  const chatProject = el('chat-project-id');
  const curr = chatProject.value;
  chatProject.innerHTML = '<option value="">(未選択)</option>';
  projects.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = String(p.id);
    opt.textContent = `${p.name} (${p.slug})`;
    chatProject.appendChild(opt);
  });
  chatProject.value = curr;

  const quickRoot = el('terminal-project-quick');
  quickRoot.innerHTML = '';
  projects.forEach((p) => {
    const btn = document.createElement('button');
    btn.className = 'ghost';
    btn.textContent = `${p.slug} に移動`;
    btn.onclick = async () => {
      try {
        const r = await request('/api/terminal/cd-project', {
          method: 'POST',
          body: JSON.stringify({ projectId: p.id })
        });
        el('terminal-cwd').textContent = r.cwd;
        el('terminal-prompt').textContent = r.prompt;
        appendTerminalEntry({ prompt: r.prompt, command: `cd ${p.slug}`, stdout: r.message, stderr: '', code: 0 });
      } catch (e) {
        el('terminal-msg').textContent = e.message;
      }
    };
    quickRoot.appendChild(btn);
  });
};

const renderProjects = (projects) => {
  const root = el('projects');
  root.innerHTML = '';
  projectMap.clear();

  if (!projects.length) {
    root.innerHTML = '<p class="note">まだサイトがありません。上のフォームから追加してください。</p>';
    refreshProjectQuickSelectors([]);
    return;
  }

  projects.forEach((p) => {
    projectMap.set(String(p.id), p);
    const s = p.status || {};
    const card = document.createElement('div');
    card.className = 'item';
    card.innerHTML = `
      <div class="row between">
        <div>
          <strong>${p.name}${p.isMain ? ' (MAIN)' : ''}</strong>
          <div class="note">${p.slug} / ${p.domain}</div>
        </div>
        <div>${statusBadge(s.serviceState)}</div>
      </div>
      <div class="note">port: ${p.port} / branch: ${p.branch || '-'} / service: ${p.serviceName || `${p.slug}.service`}</div>
      <div class="note">repo: ${p.repoUrl || '(未設定)'}</div>
      <div class="note">dir: ${s.directoryExists ? 'OK' : 'NG'} / git: ${s.gitReady ? 'OK' : 'NG'}</div>
      <div class="row wrap">
        <button class="ghost" data-action="edit" data-id="${p.id}">編集</button>
        <button class="ghost" data-action="provision" data-id="${p.id}">初期構築</button>
        <button data-action="deploy" data-id="${p.id}">アップデート</button>
        <button class="danger" data-action="delete" data-id="${p.id}">完全削除</button>
      </div>
    `;
    root.appendChild(card);
  });

  refreshProjectQuickSelectors(projects);

  const suggested = nextPortSuggestion(projects);
  if (!el('port').value) {
    el('port').value = String(suggested);
    el('project-msg').textContent = `次の推奨ポート: ${suggested}`;
  }
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

const renderJobs = (jobs) => {
  const root = el('jobs');
  root.innerHTML = '';
  if (!jobs.length) {
    root.innerHTML = '<p class="note">ジョブはまだありません。</p>';
    refreshJobSelector([]);
    return;
  }

  jobs.forEach((j) => {
    const card = document.createElement('div');
    card.className = 'item';
    card.innerHTML = `
      <div class="row between">
        <strong>#${j.id} ${j.type}</strong>
        <span>${statusBadge(j.status)}</span>
      </div>
      <div class="note">project: ${j.projectSlug || j.projectId || '-'}</div>
      <div class="note">開始: ${fmtDate(j.startedAt)} / 終了: ${fmtDate(j.finishedAt)} / code: ${j.exitCode ?? '-'}</div>
      <div class="row"><button class="ghost" data-action="log" data-id="${j.id}">ログ表示</button></div>
    `;
    root.appendChild(card);
  });

  refreshJobSelector(jobs);
};

const renderMonitor = (m) => {
  const cpuLoad = (() => {
    const cores = Number(m.cpu?.cores || 1);
    const load1 = Number(m.cpu?.loadavg?.[0] || 0);
    return Math.min(100, (load1 / cores) * 100);
  })();

  setMeter('meter-cpu', null, cpuLoad);
  setMeter('meter-mem', null, m.memory?.usagePercent || 0);
  setMeter('meter-disk', null, m.disk?.usagePercent || 0);

  el('kpi-cpu').textContent = `${fmtPct(cpuLoad)} (1m load)`;
  el('kpi-mem').textContent = fmtPct(m.memory?.usagePercent || 0);
  el('kpi-disk').textContent = fmtPct(m.disk?.usagePercent || 0);
  el('kpi-services').innerHTML = `nginx ${statusBadge(m.services?.nginx)} / cloudflared ${statusBadge(m.services?.cloudflared)} / admin ${statusBadge(m.services?.adminPanel)}`;

  el('mon-host').textContent = [
    `hostname: ${m.host?.hostname || '-'}`,
    `platform: ${m.host?.platform || '-'} ${m.host?.release || ''}`,
    `ips: ${(m.host?.ips || []).join(', ') || '-'}`,
    `uptime: ${m.host?.uptimePretty || `${m.host?.uptimeSec || 0}s`}`,
    `now: ${m.now || '-'}`
  ].join('\n');

  el('mon-cpu').textContent = [
    `arch: ${m.cpu?.arch || '-'}`,
    `cores: ${m.cpu?.cores || 0}`,
    `model: ${m.cpu?.model || '-'}`,
    `loadavg: ${(m.cpu?.loadavg || []).join(', ')}`
  ].join('\n');

  el('mon-mem').textContent = [
    `total: ${Number(m.memory?.total || 0).toLocaleString()}`,
    `used: ${Number(m.memory?.used || 0).toLocaleString()}`,
    `free: ${Number(m.memory?.free || 0).toLocaleString()}`,
    `usage: ${fmtPct(m.memory?.usagePercent || 0)}`
  ].join('\n');

  el('mon-disk').textContent = m.disk?.dfRoot || 'N/A';
  el('mon-svc').innerHTML = [
    `nginx: ${statusBadge(m.services?.nginx)}`,
    `cloudflared: ${statusBadge(m.services?.cloudflared)}`,
    `admin-panel: ${statusBadge(m.services?.adminPanel)}`
  ].join('<br>');

  el('mon-count').textContent = [
    `projects: ${m.counters?.projects ?? 0}`,
    `jobs: ${m.counters?.jobs ?? 0}`,
    `running_jobs: ${m.counters?.runningJobs ?? 0}`
  ].join('\n');

  el('monitor-msg').textContent = `最終更新: ${new Date().toLocaleTimeString()}`;
};

const collectProjectBody = () => ({
  name: el('name').value.trim(),
  slug: el('slug').value.trim(),
  domain: el('domain').value.trim(),
  repoUrl: el('repoUrl').value.trim(),
  branch: (el('branch').value || 'main').trim(),
  port: Number(el('port').value),
  serviceName: el('serviceName').value.trim() || undefined
});

const loadProjects = async () => {
  const projects = await request('/api/projects');
  renderProjects(projects);
};

const loadJobs = async () => {
  const jobs = await request('/api/jobs');
  renderJobs(jobs);
};

const loadMonitor = async () => {
  const m = await request('/api/monitor');
  renderMonitor(m);
};

const loadConfig = async () => {
  const cfg = await request('/api/config');
  el('feature-flags').textContent = `AI: ${cfg.aiEnabled ? 'ON' : 'OFF'} / Terminal: ${cfg.terminalEnabled ? 'ON' : 'OFF'}`;
  if (!cfg.terminalEnabled) el('terminal-msg').textContent = 'TERMINAL_ENABLED=false のため無効です';
};

const appendTerminalEntry = ({ prompt, command, stdout, stderr, code, timeout }) => {
  const output = el('terminal-output');
  const box = document.createElement('div');
  box.className = 'term-entry';

  const cmd = document.createElement('div');
  cmd.className = 'term-cmd';
  cmd.textContent = `${prompt} ${command}`;
  box.appendChild(cmd);

  if (stdout) {
    const out = document.createElement('div');
    out.className = 'term-out';
    out.textContent = stdout;
    box.appendChild(out);
  }

  if (stderr) {
    const err = document.createElement('div');
    err.className = 'term-err';
    err.textContent = stderr;
    box.appendChild(err);
  }

  const status = document.createElement('div');
  status.className = code === 0 ? 'note' : 'term-err';
  status.textContent = timeout ? `[timeout] exit=${code}` : `[exit=${code}]`;
  box.appendChild(status);

  output.appendChild(box);
  output.scrollTop = output.scrollHeight;
};

const loadTerminalState = async () => {
  const state = await request('/api/terminal/history');
  el('terminal-cwd').textContent = state.cwd;
  el('terminal-prompt').textContent = state.prompt;

  const output = el('terminal-output');
  output.innerHTML = '';
  (state.history || []).forEach((h) => appendTerminalEntry(h));
};

const execTerminal = async () => {
  const command = el('terminal-command').value.trim();
  if (!command) return;

  try {
    const r = await request('/api/terminal/exec', {
      method: 'POST',
      body: JSON.stringify({ command })
    });

    appendTerminalEntry({ ...r, command });
    el('terminal-cwd').textContent = r.cwd;
    el('terminal-prompt').textContent = r.prompt;
    el('terminal-msg').textContent = `${r.timeout ? 'TIMEOUT' : 'OK'} / exit=${r.code} / ${r.durationMs}ms`;
    el('terminal-command').value = '';
  } catch (e) {
    el('terminal-msg').textContent = e.message;
  }
};

el('terminal-run-btn').onclick = execTerminal;
el('terminal-command').addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') {
    ev.preventDefault();
    execTerminal();
  }
});

el('login-btn').onclick = async () => {
  try {
    const r = await request('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username: el('username').value, password: el('password').value })
    });

    token = r.token;
    localStorage.setItem('admin_token', token);
    el('auth-msg').textContent = 'ログイン成功';

    await Promise.all([loadConfig(), loadProjects(), loadJobs(), loadMonitor(), loadTerminalState()]);
    showView('dashboard');
  } catch (e) {
    el('auth-msg').textContent = e.message;
  }
};

el('logout-btn').onclick = async () => {
  try {
    if (token) await request('/api/logout', { method: 'POST' });
  } catch (_e) {
    // ignore
  }
  token = '';
  localStorage.removeItem('admin_token');
  el('auth-msg').textContent = 'ログアウトしました';
};

el('create-btn').onclick = async () => {
  try {
    const r = await request('/api/projects', {
      method: 'POST',
      body: JSON.stringify(collectProjectBody())
    });
    clearProjectForm();
    el('project-msg').textContent = `作成しました。初期構築ジョブ #${r.autoProvisionJobId} を開始`;
    await Promise.all([loadProjects(), loadJobs(), loadMonitor()]);
    showView('jobs');
  } catch (e) {
    el('project-msg').textContent = e.message;
  }
};

el('save-btn').onclick = async () => {
  const id = el('editingId').value;
  if (!id) {
    el('project-msg').textContent = '編集対象を選択してください';
    return;
  }

  try {
    await request(`/api/projects/${id}`, {
      method: 'PUT',
      body: JSON.stringify(collectProjectBody())
    });
    el('project-msg').textContent = '更新しました';
    await Promise.all([loadProjects(), loadMonitor()]);
  } catch (e) {
    el('project-msg').textContent = e.message;
  }
};

el('clear-form-btn').onclick = () => {
  clearProjectForm();
  el('project-msg').textContent = 'フォームをクリアしました';
};

el('add-main-btn').onclick = async () => {
  try {
    await request('/api/projects/bootstrap-main', { method: 'POST', body: JSON.stringify({}) });
    el('project-msg').textContent = 'メインドメインを登録しました';
    await loadProjects();
  } catch (e) {
    el('project-msg').textContent = e.message;
  }
};

el('refresh-projects').onclick = () => loadProjects().catch((e) => (el('project-msg').textContent = e.message));
el('refresh-jobs').onclick = () => loadJobs().catch((e) => (el('job-log').textContent = e.message));
el('refresh-monitor').onclick = () => loadMonitor().catch((e) => (el('monitor-msg').textContent = e.message));

el('self-update-btn').onclick = async () => {
  try {
    const r = await request('/api/admin/self-update', { method: 'POST' });
    el('self-update-msg').textContent = `${r.message} (job #${r.jobId})`;
    showView('jobs');
    await loadJobs();
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
      const p = projectMap.get(String(id));
      if (!p) return;
      fillProjectForm(p);
      showView('projects');
      return;
    }

    if (action === 'provision') {
      await request(`/api/projects/${id}/provision`, { method: 'POST' });
      await loadJobs();
      showView('jobs');
      return;
    }

    if (action === 'deploy') {
      await request(`/api/projects/${id}/deploy`, { method: 'POST' });
      await loadJobs();
      showView('jobs');
      return;
    }

    if (action === 'delete') {
      const p = projectMap.get(String(id));
      const ok = window.confirm(`プロジェクト「${p?.name || id}」を完全削除します。\nディレクトリ/systemd/nginx設定を削除します。`);
      if (!ok) return;
      await request(`/api/projects/${id}`, { method: 'DELETE' });
      await Promise.all([loadProjects(), loadJobs(), loadMonitor(), loadTerminalState()]);
      showView('jobs');
      return;
    }

    if (action === 'log') {
      const text = await request(`/api/jobs/${id}/log`);
      el('job-log').textContent = text;
      return;
    }
  } catch (e) {
    el('job-log').textContent = e.message;
    showView('jobs');
  }
});

const chatWidget = el('chat-widget');

const addChatBubble = (role, text) => {
  const bubble = document.createElement('div');
  bubble.className = `bubble ${role}`;
  bubble.textContent = text;
  el('chat-log').appendChild(bubble);
  el('chat-log').scrollTop = el('chat-log').scrollHeight;
};

el('chat-toggle').onclick = () => chatWidget.classList.toggle('hidden');
el('chat-close').onclick = () => chatWidget.classList.add('hidden');

el('chat-send').onclick = async () => {
  const question = el('chat-question').value.trim();
  if (!question) return;

  const projectId = el('chat-project-id').value || undefined;
  const jobId = el('chat-job-id').value || undefined;

  addChatBubble('user', question);
  el('chat-question').value = '';

  try {
    const r = await request('/api/ai/advice', {
      method: 'POST',
      body: JSON.stringify({ question, projectId, jobId })
    });
    addChatBubble('assistant', r.answer);
    el('chat-usage').textContent = `tokens: ${r.usage.total_tokens} (p:${r.usage.prompt_tokens} / c:${r.usage.completion_tokens})`;
  } catch (e) {
    addChatBubble('assistant', `エラー: ${e.message}`);
  }
};

el('slug').addEventListener('blur', () => {
  const slug = el('slug').value.trim();
  if (!slug) return;
  if (!el('domain').value.trim()) el('domain').value = `${slug}.finance-pro.space`;
  if (!el('serviceName').value.trim()) el('serviceName').value = `${slug}.service`;
});

const boot = async () => {
  if (!token) {
    showView('auth');
    return;
  }

  try {
    await Promise.all([loadConfig(), loadProjects(), loadJobs(), loadMonitor(), loadTerminalState()]);
    showView('dashboard');
  } catch (_e) {
    el('auth-msg').textContent = 'セッション切れです。再ログインしてください';
    token = '';
    localStorage.removeItem('admin_token');
    showView('auth');
  }
};

boot();

setInterval(() => {
  if (!token) return;
  loadMonitor().catch(() => {});
  loadJobs().catch(() => {});
}, 10000);
