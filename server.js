const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');

const app = express();

const PORT = Number(process.env.PORT || 3100);
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-me-strong-password';
const APPS_ROOT = process.env.APPS_ROOT || '/home/s55mz/apps';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const AI_MAX_TOKENS = Number(process.env.AI_MAX_TOKENS || 280);

const TERMINAL_ENABLED = process.env.TERMINAL_ENABLED === 'true';
const TERMINAL_TIMEOUT_MS = Number(process.env.TERMINAL_TIMEOUT_MS || 20000);
const TERMINAL_MAX_OUTPUT = Number(process.env.TERMINAL_MAX_OUTPUT || 12000);
const TERMINAL_HISTORY_MAX = Number(process.env.TERMINAL_HISTORY_MAX || 200);

const baseDir = __dirname;
const dataDir = path.join(baseDir, 'data');
const logsDir = path.join(baseDir, 'logs');
const scriptsDir = path.join(baseDir, 'scripts');
const storePath = path.join(dataDir, 'store.json');

for (const dir of [dataDir, logsDir]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const sessions = new Map();
const terminalSessions = new Map();

const nowIso = () => new Date().toISOString();

const safeExec = (cmd, args = []) => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf-8' }).trim();
  } catch (_e) {
    return '';
  }
};

const serviceState = (name) => {
  if (!name) return 'unknown';
  const out = safeExec('systemctl', ['is-active', name]);
  return out || 'unknown';
};

const parseDiskUsagePercent = (dfRootText) => {
  const lines = String(dfRootText || '').split('\n').filter(Boolean);
  if (lines.length < 2) return null;
  const cols = lines[1].trim().split(/\s+/);
  const p = cols.find((c) => c.endsWith('%'));
  if (!p) return null;
  const n = Number(p.replace('%', ''));
  return Number.isFinite(n) ? n : null;
};

const ensureStoreShape = (store) => {
  if (!store || typeof store !== 'object') return { projects: [], jobs: [] };
  if (!Array.isArray(store.projects)) store.projects = [];
  if (!Array.isArray(store.jobs)) store.jobs = [];
  return store;
};

const ensureMainProject = (store) => {
  if (process.env.MAIN_PROJECT_ENABLED === 'false') return false;
  const mainDomain = process.env.MAIN_PROJECT_DOMAIN || 'finance-pro.space';
  const mainSlug = process.env.MAIN_PROJECT_SLUG || 'finance-pro-main';
  const mainService = process.env.MAIN_PROJECT_SERVICE || 'finance-pro-main.service';
  const mainPort = Number(process.env.MAIN_PROJECT_PORT || 3001);
  const mainRepoUrl = process.env.MAIN_PROJECT_REPO_URL || '';
  const mainBranch = process.env.MAIN_PROJECT_BRANCH || 'main';

  if (store.projects.some((p) => p.isMain || p.domain === mainDomain)) return false;

  store.projects.push({
    id: Date.now(),
    name: 'メインドメイン',
    slug: mainSlug,
    domain: mainDomain,
    repoUrl: mainRepoUrl,
    branch: mainBranch,
    port: mainPort,
    serviceName: mainService,
    isMain: true,
    createdAt: nowIso(),
    updatedAt: nowIso()
  });
  return true;
};

const loadStore = () => {
  let store;
  if (!fs.existsSync(storePath)) store = { projects: [], jobs: [] };
  else store = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
  store = ensureStoreShape(store);
  if (ensureMainProject(store)) saveStore(store);
  return store;
};

const saveStore = (store) => {
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2), 'utf-8');
};

const auth = (req, res, next) => {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token || !sessions.has(token)) {
    res.status(401).json({ error: '未認証です' });
    return;
  }
  req.user = sessions.get(token);
  req.token = token;
  next();
};

const isSafeSlug = (v) => /^[a-z0-9][a-z0-9-]{1,39}$/.test(v);
const isSafeDomain = (v) => /^[a-z0-9][a-z0-9.-]+$/.test(v) && !v.includes('..');

const makeProjectStatus = (project) => {
  const dir = path.join(APPS_ROOT, project.slug);
  const dirExists = fs.existsSync(dir);
  const gitExists = fs.existsSync(path.join(dir, '.git'));
  const svc = serviceState(project.serviceName || `${project.slug}.service`);
  return { serviceState: svc, directoryExists: dirExists, gitReady: gitExists, provisioned: dirExists || svc === 'active' };
};

const updateJob = (jobId, patch) => {
  const store = loadStore();
  const idx = store.jobs.findIndex((j) => j.id === jobId);
  if (idx >= 0) {
    store.jobs[idx] = { ...store.jobs[idx], ...patch };
    saveStore(store);
  }
};

const createJob = (meta) => {
  const store = loadStore();
  const job = {
    id: Date.now(),
    projectId: meta.projectId ?? null,
    projectSlug: meta.projectSlug ?? 'system',
    type: meta.type,
    status: 'running',
    logFile: path.join(logsDir, `${Date.now()}-${meta.projectSlug || 'system'}-${meta.type}.log`),
    startedAt: nowIso(),
    finishedAt: null,
    exitCode: null
  };
  store.jobs.push(job);
  saveStore(store);
  return job;
};

const runScriptByName = (scriptName, args, meta) => {
  const job = createJob(meta);
  const scriptPath = path.join(scriptsDir, scriptName);
  const logStream = fs.createWriteStream(job.logFile, { flags: 'a' });

  if (!fs.existsSync(scriptPath)) {
    logStream.write(`[${nowIso()}] script not found: ${scriptPath}\n`);
    logStream.end();
    updateJob(job.id, { status: 'failed', exitCode: 127, finishedAt: nowIso() });
    return job;
  }

  const child = spawn('bash', [scriptPath, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, APPS_ROOT }
  });

  child.stdout.on('data', (buf) => logStream.write(buf));
  child.stderr.on('data', (buf) => logStream.write(buf));
  child.on('close', (code) => {
    logStream.write(`\n[${nowIso()}] exited with code ${code}\n`);
    logStream.end();
    updateJob(job.id, { status: code === 0 ? 'success' : 'failed', exitCode: code, finishedAt: nowIso() });
  });

  return job;
};

const runProjectScript = (project, type, extraArgs = []) => {
  const map = { provision: 'provision-project.sh', deploy: 'deploy-project.sh', remove: 'remove-project.sh' };
  const args = [project.slug, project.domain, project.repoUrl, project.branch, String(project.port), ...extraArgs];
  return runScriptByName(map[type], args, { type, projectId: project.id, projectSlug: project.slug });
};

const tailText = (text, maxChars) => (text.length <= maxChars ? text : text.slice(text.length - maxChars));

const buildAiContext = ({ question, projectId, jobId }) => {
  const store = loadStore();
  const ctx = {
    question: String(question || '').slice(0, 1200),
    now: nowIso(),
    host: { hostname: os.hostname(), uptime: safeExec('uptime', ['-p']) || '', loadavg: os.loadavg() },
    project: null,
    job: null,
    jobLogTail: ''
  };

  if (projectId) {
    const project = store.projects.find((p) => p.id === Number(projectId));
    if (project) ctx.project = { ...project, status: makeProjectStatus(project) };
  }

  if (jobId) {
    const job = store.jobs.find((j) => j.id === Number(jobId));
    if (job) {
      ctx.job = { ...job };
      if (job.logFile && fs.existsSync(job.logFile)) {
        ctx.jobLogTail = tailText(fs.readFileSync(job.logFile, 'utf-8'), 2500);
      }
    }
  }

  return ctx;
};

const askOpenAI = async (ctx) => {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY が未設定です');

  const systemPrompt = [
    'You are a pragmatic DevOps assistant for Raspberry Pi deployment.',
    'Think in English, answer in Japanese.',
    'Keep output concise and actionable.',
    'Use short bullet points and concrete commands when useful.',
    'Do not mention internal chain-of-thought.'
  ].join(' ');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.2,
      max_tokens: AI_MAX_TOKENS,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `User question:\n${ctx.question}\n\nContext JSON:\n${JSON.stringify(ctx)}` }
      ]
    })
  });

  if (!response.ok) {
    const txt = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${txt.slice(0, 300)}`);
  }

  const json = await response.json();
  const msg = json.choices?.[0]?.message?.content?.trim() || '回答を取得できませんでした。';
  const usage = json.usage || {};
  return { message: msg, usage: { prompt_tokens: usage.prompt_tokens || 0, completion_tokens: usage.completion_tokens || 0, total_tokens: usage.total_tokens || 0 } };
};

const ensureTerminalState = (token, username) => {
  const existing = terminalSessions.get(token);
  if (existing && fs.existsSync(existing.cwd)) return existing;
  const state = { cwd: APPS_ROOT, username: username || 'admin', history: [] };
  terminalSessions.set(token, state);
  return state;
};

const promptFor = (username, cwd) => `${username}@${os.hostname()}:${cwd}$`;

const pushTerminalHistory = (state, entry) => {
  state.history.push(entry);
  if (state.history.length > TERMINAL_HISTORY_MAX) {
    state.history = state.history.slice(state.history.length - TERMINAL_HISTORY_MAX);
  }
};

const executeTerminalCommand = async ({ token, username, command }) => {
  if (!TERMINAL_ENABLED) throw new Error('terminal is disabled');

  const cmd = String(command || '').trim();
  if (!cmd) throw new Error('command is required');

  const blockedPatterns = [/rm\s+-rf\s+\/$/i, /reboot/i, /shutdown/i, /mkfs/i, /:\(\)\s*\{\s*:\|:&\s*\};:/, /dd\s+if=.*of=\/dev\//i];
  if (blockedPatterns.some((re) => re.test(cmd))) throw new Error('危険なコマンドは実行できません');

  const state = ensureTerminalState(token, username);
  let cwd = state.cwd;
  const prompt = promptFor(state.username, cwd);

  const cdMatch = cmd.match(/^cd\s+(.+)$/);
  if (cdMatch) {
    const raw = cdMatch[1].trim();
    const dest = raw.startsWith('/') ? raw : path.resolve(cwd, raw);
    if (!fs.existsSync(dest) || !fs.statSync(dest).isDirectory()) {
      const out = { code: 1, timeout: false, durationMs: 0, cwd, stdout: '', stderr: `cd: no such directory: ${raw}`, prompt };
      pushTerminalHistory(state, { at: nowIso(), command: cmd, ...out });
      return out;
    }
    state.cwd = dest;
    const out = { code: 0, timeout: false, durationMs: 0, cwd: dest, stdout: `changed directory to: ${dest}`, stderr: '', prompt };
    pushTerminalHistory(state, { at: nowIso(), command: cmd, ...out });
    return out;
  }

  return new Promise((resolve, reject) => {
    const start = Date.now();
    const child = spawn('/bin/bash', ['-lc', cmd], { cwd });
    let stdout = '';
    let stderr = '';
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
    }, TERMINAL_TIMEOUT_MS);

    child.stdout.on('data', (buf) => {
      stdout += buf.toString('utf-8');
      if (stdout.length > TERMINAL_MAX_OUTPUT) stdout = stdout.slice(stdout.length - TERMINAL_MAX_OUTPUT);
    });
    child.stderr.on('data', (buf) => {
      stderr += buf.toString('utf-8');
      if (stderr.length > TERMINAL_MAX_OUTPUT) stderr = stderr.slice(stderr.length - TERMINAL_MAX_OUTPUT);
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const out = { code, timeout: killed, durationMs: Date.now() - start, cwd: state.cwd, stdout, stderr, prompt };
      pushTerminalHistory(state, { at: nowIso(), command: cmd, ...out });
      resolve(out);
    });
  });
};

app.use(express.json({ limit: '300kb' }));
app.use(express.static(path.join(baseDir, 'public')));

app.get('/api/health', (_req, res) => res.json({ status: 'ok', app: 'admin-panel', now: nowIso() }));

app.get('/api/config', auth, (_req, res) => {
  res.json({ aiEnabled: Boolean(OPENAI_API_KEY), terminalEnabled: TERMINAL_ENABLED, openaiModel: OPENAI_MODEL });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username !== ADMIN_USER || password !== ADMIN_PASSWORD) {
    res.status(401).json({ error: 'ユーザー名またはパスワードが違います' });
    return;
  }
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { username, at: Date.now() });
  ensureTerminalState(token, username);
  res.json({ token });
});

app.post('/api/logout', auth, (req, res) => {
  if (req.token) {
    sessions.delete(req.token);
    terminalSessions.delete(req.token);
  }
  res.json({ message: 'ログアウトしました' });
});

app.get('/api/projects', auth, (_req, res) => {
  const store = loadStore();
  res.json(store.projects.map((p) => ({ ...p, status: makeProjectStatus(p) })));
});

app.post('/api/projects/bootstrap-main', auth, (req, res) => {
  const body = req.body || {};
  const domain = body.domain || 'finance-pro.space';
  const slug = body.slug || 'finance-pro-main';
  const serviceName = body.serviceName || 'finance-pro-main.service';
  const port = Number(body.port || 3001);

  const store = loadStore();
  if (store.projects.some((p) => p.domain === domain || p.isMain)) {
    res.status(409).json({ error: 'メインドメインのプロジェクトは既に登録済みです' });
    return;
  }

  const project = {
    id: Date.now(),
    name: body.name || 'メインドメイン',
    slug,
    domain,
    repoUrl: body.repoUrl || '',
    branch: body.branch || 'main',
    port,
    serviceName,
    isMain: true,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  store.projects.push(project);
  saveStore(store);
  res.status(201).json({ ...project, status: makeProjectStatus(project) });
});

app.post('/api/projects', auth, (req, res) => {
  const { name, slug, domain, repoUrl, branch = 'main', port, serviceName } = req.body || {};
  if (!name || !slug || !domain || !repoUrl || !port) {
    res.status(400).json({ error: 'name/slug/domain/repoUrl/port は必須です' });
    return;
  }
  if (!isSafeSlug(slug)) {
    res.status(400).json({ error: 'slug は英小文字・数字・ハイフンのみで指定してください' });
    return;
  }
  if (!isSafeDomain(domain)) {
    res.status(400).json({ error: 'domain の形式が不正です' });
    return;
  }
  const numPort = Number(port);
  if (!Number.isInteger(numPort) || numPort < 1024 || numPort > 65535) {
    res.status(400).json({ error: 'port は 1024-65535 の整数で指定してください' });
    return;
  }

  const store = loadStore();
  if (store.projects.some((p) => p.slug === slug || p.domain === domain || p.port === numPort)) {
    res.status(409).json({ error: 'slug/domain/port が重複しています' });
    return;
  }

  const project = {
    id: Date.now(),
    name,
    slug,
    domain,
    repoUrl,
    branch,
    port: numPort,
    serviceName: serviceName || `${slug}.service`,
    isMain: false,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  store.projects.push(project);
  saveStore(store);

  const job = runProjectScript(project, 'provision');
  res.status(201).json({ ...project, status: makeProjectStatus(project), autoProvisionJobId: job.id });
});

app.put('/api/projects/:id', auth, (req, res) => {
  const id = Number(req.params.id);
  const store = loadStore();
  const idx = store.projects.findIndex((p) => p.id === id);
  if (idx < 0) {
    res.status(404).json({ error: 'プロジェクトが見つかりません' });
    return;
  }

  const current = store.projects[idx];
  const patch = req.body || {};
  const next = {
    ...current,
    name: patch.name ?? current.name,
    slug: patch.slug ?? current.slug,
    domain: patch.domain ?? current.domain,
    repoUrl: patch.repoUrl ?? current.repoUrl,
    branch: patch.branch ?? current.branch,
    port: patch.port != null ? Number(patch.port) : current.port,
    serviceName: patch.serviceName ?? current.serviceName,
    updatedAt: nowIso()
  };

  if (!isSafeSlug(next.slug)) {
    res.status(400).json({ error: 'slug は英小文字・数字・ハイフンのみで指定してください' });
    return;
  }
  if (!isSafeDomain(next.domain)) {
    res.status(400).json({ error: 'domain の形式が不正です' });
    return;
  }
  if (!Number.isInteger(next.port) || next.port < 1024 || next.port > 65535) {
    res.status(400).json({ error: 'port は 1024-65535 の整数で指定してください' });
    return;
  }
  const duplicated = store.projects.some((p, i) => i !== idx && (p.slug === next.slug || p.domain === next.domain || p.port === next.port));
  if (duplicated) {
    res.status(409).json({ error: 'slug/domain/port が重複しています' });
    return;
  }

  store.projects[idx] = next;
  saveStore(store);
  res.json({ ...next, status: makeProjectStatus(next) });
});

app.delete('/api/projects/:id', auth, (req, res) => {
  const id = Number(req.params.id);
  const store = loadStore();
  const idx = store.projects.findIndex((p) => p.id === id);
  if (idx < 0) {
    res.status(404).json({ error: 'プロジェクトが見つかりません' });
    return;
  }
  const project = store.projects[idx];
  const job = runProjectScript(project, 'remove', ['1']);
  store.projects.splice(idx, 1);
  saveStore(store);
  res.json({ message: '削除ジョブを開始しました', jobId: job.id });
});

app.post('/api/projects/:id/deploy', auth, (req, res) => {
  const store = loadStore();
  const project = store.projects.find((p) => p.id === Number(req.params.id));
  if (!project) {
    res.status(404).json({ error: 'プロジェクトが見つかりません' });
    return;
  }
  const job = runProjectScript(project, 'deploy');
  res.status(202).json(job);
});

app.post('/api/projects/:id/provision', auth, (req, res) => {
  const store = loadStore();
  const project = store.projects.find((p) => p.id === Number(req.params.id));
  if (!project) {
    res.status(404).json({ error: 'プロジェクトが見つかりません' });
    return;
  }
  const job = runProjectScript(project, 'provision');
  res.status(202).json(job);
});

app.get('/api/jobs', auth, (_req, res) => {
  const store = loadStore();
  const jobs = [...store.jobs].sort((a, b) => b.id - a.id).slice(0, 300);
  res.json(jobs);
});

app.get('/api/jobs/:id/log', auth, (req, res) => {
  const store = loadStore();
  const job = store.jobs.find((j) => j.id === Number(req.params.id));
  if (!job) {
    res.status(404).json({ error: 'ジョブが見つかりません' });
    return;
  }
  if (!job.logFile || !fs.existsSync(job.logFile)) {
    res.status(404).json({ error: 'ログが見つかりません' });
    return;
  }
  res.type('text/plain').send(fs.readFileSync(job.logFile, 'utf-8'));
});

app.post('/api/admin/self-update', auth, (_req, res) => {
  const job = runScriptByName('self-update-admin.sh', [], { type: 'self-update', projectId: null, projectSlug: 'admin-panel' });
  res.status(202).json({ message: '管理パネル更新ジョブを開始しました。数秒後に再起動します。', jobId: job.id });
});

app.get('/api/monitor', auth, (_req, res) => {
  const store = loadStore();
  const memTotal = os.totalmem();
  const memFree = os.freemem();
  const diskRoot = safeExec('df', ['-h', '/']);
  const diskUsagePercent = parseDiskUsagePercent(diskRoot);
  const uptimePretty = safeExec('uptime', ['-p']) || '';

  const interfaces = os.networkInterfaces();
  const ips = [];
  Object.values(interfaces).forEach((items) => {
    (items || []).forEach((item) => {
      if (item.family === 'IPv4' && !item.internal) ips.push(item.address);
    });
  });

  res.json({
    now: nowIso(),
    host: {
      hostname: os.hostname(),
      platform: os.platform(),
      release: os.release(),
      uptimeSec: os.uptime(),
      uptimePretty,
      ips
    },
    cpu: {
      arch: os.arch(),
      model: os.cpus()?.[0]?.model || '',
      cores: os.cpus()?.length || 0,
      loadavg: os.loadavg()
    },
    memory: {
      total: memTotal,
      free: memFree,
      used: memTotal - memFree,
      usagePercent: Number((((memTotal - memFree) / memTotal) * 100).toFixed(2))
    },
    disk: {
      dfRoot: diskRoot,
      usagePercent: diskUsagePercent
    },
    services: {
      nginx: serviceState('nginx'),
      cloudflared: serviceState('cloudflared'),
      adminPanel: serviceState('admin-panel.service')
    },
    counters: {
      projects: store.projects.length,
      jobs: store.jobs.length,
      runningJobs: store.jobs.filter((j) => j.status === 'running').length
    }
  });
});

app.post('/api/ai/advice', auth, async (req, res) => {
  try {
    const { question, projectId, jobId } = req.body || {};
    if (!question || String(question).trim().length < 2) {
      res.status(400).json({ error: '質問を入力してください' });
      return;
    }
    const ctx = buildAiContext({ question, projectId, jobId });
    const result = await askOpenAI(ctx);
    res.json({ answer: result.message, usage: result.usage });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'AI相談に失敗しました' });
  }
});

app.post('/api/terminal/exec', auth, async (req, res) => {
  try {
    const { command } = req.body || {};
    const result = await executeTerminalCommand({ token: req.token, username: req.user.username, command });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'terminal execution failed' });
  }
});

app.post('/api/terminal/cd-project', auth, (req, res) => {
  const { projectId } = req.body || {};
  const store = loadStore();
  const project = store.projects.find((p) => p.id === Number(projectId));
  if (!project) {
    res.status(404).json({ error: 'プロジェクトが見つかりません' });
    return;
  }
  const target = path.join(APPS_ROOT, project.slug);
  if (!fs.existsSync(target)) {
    res.status(404).json({ error: '対象ディレクトリが存在しません。先に初期構築してください。' });
    return;
  }
  const state = ensureTerminalState(req.token, req.user.username);
  state.cwd = target;
  const prompt = promptFor(state.username, state.cwd);
  pushTerminalHistory(state, { at: nowIso(), command: `cd ${target}`, code: 0, timeout: false, durationMs: 0, cwd: state.cwd, stdout: `changed directory to: ${target}`, stderr: '', prompt });
  res.json({ cwd: target, prompt, message: `current directory changed to ${target}` });
});

app.get('/api/terminal/cwd', auth, (req, res) => {
  const state = ensureTerminalState(req.token, req.user.username);
  res.json({ cwd: state.cwd, prompt: promptFor(state.username, state.cwd) });
});

app.get('/api/terminal/history', auth, (req, res) => {
  const state = ensureTerminalState(req.token, req.user.username);
  res.json({ cwd: state.cwd, prompt: promptFor(state.username, state.cwd), history: state.history });
});

app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(baseDir, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`admin-panel listening on http://localhost:${PORT}`);
});
