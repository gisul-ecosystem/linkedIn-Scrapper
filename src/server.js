require('dotenv').config();

const fs = require('fs');
const http = require('http');
const path = require('path');
const express = require('express');
const { ROOT, PORT, MONGODB_URI, MONGODB_DB } = require('./config');
const { CONNECTION_TYPES, buildSearchUrl, resolveConnectionType } = require('./search');
const { runScrapeJob, getJobStatus } = require('./scrape-job');
const { runSendQueueJob, getSendJobStatus } = require('./send-queue-job');
const { startLinkedInConnect, getLinkedInJob, hasLinkedInSession } = require('./linkedin-login-job');
const { listProducts } = require('./products');
const { userPaths } = require('./paths');
const { OPENAI_API_KEY, ANTHROPIC_API_KEY } = require('./config');
const { getRagStatus, buildIndex } = require('./rag/index');
const db = require('./db');

const USER_ID = 'local';
const NOVNC_UPSTREAM = { hostname: '127.0.0.1', port: 6080 };
const BROWSER_VIEWER_PATH = '/vnc/vnc_lite.html?autoconnect=1&resize=scale';

const app = express();
app.use(express.json());
app.use(express.static(path.join(ROOT, 'public')));

/** Same-origin proxy so the VNC iframe works reliably (avoids broken cross-port embeds). */
app.use('/vnc', (req, res) => {
  const targetPath = !req.url || req.url === '/' ? '/vnc_lite.html?autoconnect=1&resize=scale' : req.url;
  const proxyReq = http.request(
    {
      ...NOVNC_UPSTREAM,
      path: targetPath,
      method: req.method,
      headers: {
        ...req.headers,
        host: `${NOVNC_UPSTREAM.hostname}:${NOVNC_UPSTREAM.port}`,
      },
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );
  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      res
        .status(502)
        .type('html')
        .send(
          `<h1>Browser viewer unavailable</h1><p>${err.message}</p>` +
            `<p><a href="http://localhost:6080/vnc_lite.html?autoconnect=1&resize=scale">Open direct VNC</a></p>`
        );
    } else {
      res.end();
    }
  });
  req.pipe(proxyReq);
});

function attachNovncWsProxy(server) {
  server.on('upgrade', (req, socket, head) => {
    if (!req.url || !req.url.startsWith('/websockify')) return;

    const proxyReq = http.request({
      ...NOVNC_UPSTREAM,
      path: req.url,
      method: 'GET',
      headers: {
        ...req.headers,
        host: `${NOVNC_UPSTREAM.hostname}:${NOVNC_UPSTREAM.port}`,
      },
    });

    proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
      const headerLines = ['HTTP/1.1 101 Switching Protocols'];
      for (const [key, value] of Object.entries(proxyRes.headers)) {
        if (Array.isArray(value)) value.forEach((v) => headerLines.push(`${key}: ${v}`));
        else headerLines.push(`${key}: ${value}`);
      }
      headerLines.push('', '');
      socket.write(headerLines.join('\r\n'));
      if (proxyHead?.length) socket.write(proxyHead);
      if (head?.length) proxySocket.write(head);
      proxySocket.pipe(socket);
      socket.pipe(proxySocket);
      proxySocket.on('error', () => socket.destroy());
      socket.on('error', () => proxySocket.destroy());
    });

    proxyReq.on('error', () => socket.destroy());
    proxyReq.end();
  });
}

app.get('/api/connection-types', (_req, res) => {
  res.json(CONNECTION_TYPES);
});

app.get('/api/products', (_req, res) => {
  res.json({
    products: listProducts(),
    aiConfigured: Boolean(ANTHROPIC_API_KEY || OPENAI_API_KEY),
    provider: ANTHROPIC_API_KEY ? 'claude' : OPENAI_API_KEY ? 'openai' : 'none',
    rag: getRagStatus(),
  });
});

app.post('/api/rag/rebuild', (_req, res) => {
  const index = buildIndex();
  res.json({
    ok: true,
    builtAt: index.builtAt,
    chunkCount: index.chunkCount,
    products: index.products,
    ttlDays: index.ttlDays,
  });
});

app.get('/api/status', async (_req, res) => {
  try {
    const paths = userPaths(USER_ID);
    const linkedInConnected = hasLinkedInSession(paths.linkedinSession);
    let totalProfiles = 0;
    let queueCount = 0;
    let user = null;
    let mongoOk = true;
    try {
      await db.connectMongo();
      totalProfiles = await db.profiles.countProfiles(USER_ID);
      queueCount = await db.profiles.countQueue(USER_ID);
      user = await db.users.getUser(USER_ID);
      if (linkedInConnected) {
        await db.users.markLinkedInConnected(USER_ID, true);
      }
    } catch (err) {
      mongoOk = false;
      console.warn('[mongo]', err.message);
    }

    res.json({
      linkedInConnected,
      linkedInJob: getLinkedInJob(USER_ID),
      scrapeJob: getJobStatus(USER_ID),
      sendJob: getSendJobStatus(USER_ID),
      totalProfiles,
      queueCount,
      user,
      mongo: { ok: mongoOk, uri: MONGODB_URI, db: MONGODB_DB },
      inDocker: String(process.env.IN_DOCKER || '').toLowerCase() === 'true',
      browserViewerUrl: BROWSER_VIEWER_PATH,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/linkedin/connect', async (_req, res) => {
  try {
    await db.connectMongo();
    await db.users.upsertUser({ userId: USER_ID, name: 'Local operator' });
    const job = await startLinkedInConnect(USER_ID);
    res.json({ ok: true, job });
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

app.get('/api/linkedin/status', async (_req, res) => {
  const paths = userPaths(USER_ID);
  const connected = hasLinkedInSession(paths.linkedinSession);
  if (connected) {
    try {
      await db.connectMongo();
      await db.users.markLinkedInConnected(USER_ID, true);
    } catch {
      /* ignore */
    }
  }
  res.json({
    connected,
    job: getLinkedInJob(USER_ID),
  });
});

app.get('/api/preview-url', (req, res) => {
  try {
    const filters = normalizeFilters(req.query);
    if (filters.profileUrl) {
      return res.json({ url: filters.profileUrl, filters, mode: 'single_profile' });
    }
    res.json({ url: buildSearchUrl(filters), filters, mode: filters.connectionType });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/results', async (_req, res) => {
  try {
    await db.connectMongo();
    const { nameFromSlug } = require('./utils');
    const profiles = await db.profiles.listProfiles(USER_ID, { limit: 1000 });
    res.json({
      profiles: profiles.map((p) => ({
        ...p,
        name: p.name || nameFromSlug(p.slug) || '',
      })),
      storage: 'mongodb',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/jobs', async (_req, res) => {
  try {
    await db.connectMongo();
    const jobs = await db.jobs.listScrapeJobs(USER_ID, { limit: 50 });
    res.json({ jobs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/users', async (_req, res) => {
  try {
    await db.connectMongo();
    const users = await db.users.listUsers();
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/queue', async (_req, res) => {
  try {
    await db.connectMongo();
    const items = await db.profiles.listQueue(USER_ID, { status: 'queued', limit: 500 });
    res.json({ items, count: items.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/queue/:slug', async (req, res) => {
  try {
    await db.connectMongo();
    const message = String(req.body?.message || '').trim();
    if (!message) return res.status(400).json({ error: 'message is required' });
    const item = await db.profiles.updateQueuedMessage(USER_ID, req.params.slug, message);
    if (!item) return res.status(404).json({ error: 'Profile not found' });
    res.json({ item });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/queue/skip', async (req, res) => {
  try {
    await db.connectMongo();
    const slugs = Array.isArray(req.body?.slugs) ? req.body.slugs : [];
    for (const slug of slugs) {
      await db.profiles.markQueueSkipped(USER_ID, slug);
    }
    res.json({ ok: true, skipped: slugs.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/queue/send', async (req, res) => {
  if (getSendJobStatus(USER_ID).status === 'running') {
    return res.status(409).json({ error: 'Send job already running' });
  }
  if (getJobStatus(USER_ID).status === 'running') {
    return res.status(409).json({ error: 'Scrape is running — wait until it finishes' });
  }

  const paths = userPaths(USER_ID);
  if (!hasLinkedInSession(paths.linkedinSession)) {
    return res.status(401).json({ error: 'Connect LinkedIn first' });
  }

  try {
    await db.connectMongo();
  } catch (err) {
    return res.status(503).json({ error: `MongoDB not available: ${err.message}` });
  }

  const slugs = Array.isArray(req.body?.slugs) ? req.body.slugs.filter(Boolean) : [];
  res.json({ ok: true, message: 'Send started', slugs });

  runSendQueueJob(USER_ID, { slugs }).catch((err) => {
    console.error(`[send-queue:${USER_ID}]`, err.message);
  });
});

app.get('/api/queue/send-status', (_req, res) => {
  res.json(getSendJobStatus(USER_ID));
});

app.get('/api/results/download', async (_req, res) => {
  const paths = userPaths(USER_ID);
  if (!fs.existsSync(paths.excel)) {
    return res.status(404).json({ error: 'No export yet. Run a search first.' });
  }
  res.download(paths.excel, 'connections.xlsx');
});

app.post('/api/scrape/start', async (req, res) => {
  if (getJobStatus(USER_ID).status === 'running') {
    return res.status(409).json({ error: 'Scrape already running' });
  }

  const paths = userPaths(USER_ID);
  if (!hasLinkedInSession(paths.linkedinSession)) {
    return res.status(401).json({ error: 'Connect LinkedIn first' });
  }

  try {
    await db.connectMongo();
  } catch (err) {
    return res.status(503).json({
      error: `MongoDB not available: ${err.message}. Start local MongoDB first.`,
    });
  }

  let filters;
  try {
    filters = normalizeFilters(req.body || {});
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  res.json({
    ok: true,
    message: 'Scrape started',
    filters,
    previewUrl: filters.profileUrl || buildSearchUrl(filters),
  });

  runScrapeJob(USER_ID, filters).catch((err) => {
    console.error(`[scrape-job:${USER_ID}]`, err.message);
  });
});

app.get('/api/job', (_req, res) => {
  res.json(getJobStatus(USER_ID));
});

function normalizeFilters(raw) {
  const { normalizeProfileUrl } = require('./utils');
  const profileUrl = normalizeProfileUrl(raw.profileUrl || raw.profile_url || '');
  const base = {
    profileUrl,
    connectionType: raw.connectionType || 'all_connections',
    keywords: String(raw.keywords || '').trim(),
    title: String(raw.title || '').trim(),
    company: String(raw.company || '').trim(),
    location: String(raw.location || '').trim(),
    maxResults: Math.max(0, Number(raw.maxResults || 50)),
    startIndex: Math.max(0, Number(raw.startIndex || 0)),
    sendMessages: false,
    aiMessages: raw.aiMessages !== false && raw.aiMessages !== 'false',
    rescrape: Boolean(raw.rescrape),
  };
  if (raw.profileUrl && !profileUrl) {
    throw new Error('Invalid LinkedIn profile URL. Use https://www.linkedin.com/in/username');
  }
  base.connectionType = resolveConnectionType(base);
  return base;
}

async function main() {
  try {
    await db.connectMongo();
    await db.users.upsertUser({ userId: USER_ID, name: 'Local operator' });
  } catch (err) {
    console.warn(`[mongo] Could not connect on startup: ${err.message}`);
    console.warn('[mongo] Start MongoDB (docker compose up -d mongo) then restart npm start');
  }

  const server = app.listen(PORT, () => {
    console.log(`[app] LinkedIn Scraper → http://localhost:${PORT}`);
    console.log(`[app] MongoDB → ${MONGODB_URI} / ${MONGODB_DB}`);
    console.log(`[app] Browser viewer → http://localhost:${PORT}${BROWSER_VIEWER_PATH}`);
  });
  attachNovncWsProxy(server);
}

main();
