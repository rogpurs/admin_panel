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

const baseDir = __dirname;
const dataDir = path.join(baseDir, 'data');
const logsDir = path.join(baseDir, 'logs');
const scriptsDir = path.join(baseDir, 'scripts');
const storePath = path.join(dataDir, 'store.json');

for (const dir of [dataDir, logsDir]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const sessions = new Map();

const loadStore = () => {
  if (!fs.existsSync(storePath)) {
    return { projects: [], jobs: [] };
  }
  return JSON.parse(fs.readFileSync(storePath, 'utf-8'));
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
  next();
};

const isSafeSlug = (v) => /^[a-z0-9][a-z0-9-]{1,39}$/.test(v);
const isSafeDomain = (v) => /^[a-z0-9][a-z0-9.-]+$/.test(v) && !v.includes('..');

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

const updateJob = (jobId, patch) => {
  const store = loadStore();
  const idx = store.jobs.findIndex((j) => j.id === jobId);
  if (idx >= 0) {
    store.jobs[idx] = { ...store.jobs[idx], ...patch };
    saveStore(store);
  }
};

const runScriptJob = (project, type) => {
  const store = loadStore();
  const job = {
    id: Date.now(),
    projectId: project.id,
    type,
    status: 'running',
    logFile: path.join(logsDir, `${Date.now()}-${project.slug}-${type}.log`),
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null
  };
  store.jobs.push(job);
  saveStore(store);

  const scriptName = type === 'provision' ? 'provision-project.sh' : 'deploy-project.sh';
  const scriptPath = path.join(scriptsDir, scriptName);
  const logStream = fs.createWriteStream(job.logFile, { flags: 'a' });

  if (!fs.existsSync(scriptPath)) {
    logStream.write(`[${new Date().toISOString()}] script not found: ${scriptPath}\n`);
    logStream.end();
    updateJob(job.id, {
      status: 'failed',
      exitCode: 127,
      finishedAt: new Date().toISOString()
    });
    return job;
  }

  const args = [
    project.slug,
    project.domain,
    project.repoUrl,
    project.branch,
    String(project.port)
  ];

  const child = spawn('bash', [scriptPath, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      APPS_ROOT: process.env.APPS_ROOT || '/home/s55mz/apps'
    }
  });

  child.stdout.on('data', (buf) => logStream.write(buf));
  child.stderr.on('data', (buf) => logStream.write(buf));
  child.on('close', (code) => {
    logStream.write(`\n[${new Date().toISOString()}] exited with code ${code}\n`);
    logStream.end();
    updateJob(job.id, {
      status: code === 0 ? 'success' : 'failed',
      exitCode: code,
      finishedAt: new Date().toISOString()
    });
  });

  return job;
};

app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(baseDir, 'public')));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', app: 'admin-panel', now: new Date().toISOString() });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username !== ADMIN_USER || password !== ADMIN_PASSWORD) {
    res.status(401).json({ error: 'ユーザー名またはパスワードが違います' });
    return;
  }
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { username, at: Date.now() });
  res.json({ token });
});

app.post('/api/logout', auth, (req, res) => {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (token) sessions.delete(token);
  res.json({ message: 'ログアウトしました' });
});

app.get('/api/projects', auth, (_req, res) => {
  const store = loadStore();
  res.json(store.projects);
});

app.post('/api/projects', auth, (req, res) => {
  const { name, slug, domain, repoUrl, branch = 'main', port } = req.body || {};
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
    serviceName: `${slug}.service`,
    createdAt: new Date().toISOString()
  };

  store.projects.push(project);
  saveStore(store);
  res.status(201).json(project);
});

app.post('/api/projects/:id/deploy', auth, (req, res) => {
  const store = loadStore();
  const project = store.projects.find((p) => p.id === Number(req.params.id));
  if (!project) {
    res.status(404).json({ error: 'プロジェクトが見つかりません' });
    return;
  }
  const job = runScriptJob(project, 'deploy');
  res.status(202).json(job);
});

app.post('/api/projects/:id/provision', auth, (req, res) => {
  const store = loadStore();
  const project = store.projects.find((p) => p.id === Number(req.params.id));
  if (!project) {
    res.status(404).json({ error: 'プロジェクトが見つかりません' });
    return;
  }
  const job = runScriptJob(project, 'provision');
  res.status(202).json(job);
});

app.get('/api/jobs', auth, (_req, res) => {
  const store = loadStore();
  const jobs = [...store.jobs].sort((a, b) => b.id - a.id).slice(0, 200);
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

app.get('/api/monitor', auth, (_req, res) => {
  const store = loadStore();
  const memTotal = os.totalmem();
  const memFree = os.freemem();

  const diskRoot = safeExec('df', ['-h', '/']);
  const uptime = safeExec('uptime', ['-p']) || '';

  const serviceStates = {
    nginx: serviceState('nginx'),
    cloudflared: serviceState('cloudflared'),
    adminPanel: serviceState('admin-panel.service')
  };

  res.json({
    now: new Date().toISOString(),
    host: {
      hostname: os.hostname(),
      platform: os.platform(),
      release: os.release(),
      uptimeSec: os.uptime(),
      uptimePretty: uptime
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
      dfRoot: diskRoot
    },
    services: serviceStates,
    counters: {
      projects: store.projects.length,
      jobs: store.jobs.length
    }
  });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(baseDir, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`admin-panel listening on http://localhost:${PORT}`);
});
