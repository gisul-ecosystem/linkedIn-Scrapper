const $ = (id) => document.getElementById(id);

let pollTimer = null;
let queueItems = [];

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function getFilters() {
  return {
    profileUrl: $('profileUrl').value.trim(),
    connectionType: $('connectionType').value,
    keywords: $('keywords').value.trim(),
    title: $('title').value.trim(),
    company: $('company').value.trim(),
    location: $('location').value.trim(),
    maxResults: Number($('maxResults').value) || 50,
    startIndex: Number($('startIndex').value) || 0,
    rescrape: $('rescrape').checked,
    aiMessages: $('aiMessages').checked,
    sendMessages: false,
  };
}

async function initApp() {
  const status = await api('/api/status');
  updateLinkedInUI(status);
  $('startBtn').disabled = !status.linkedInConnected || status.scrapeJob?.status === 'running';
  if (status.linkedInConnected) {
    $('linkedInPanel').classList.add('connected');
  }
  await loadConnectionTypes();
  renderJob(status.scrapeJob);
  renderSendJob(status.sendJob);
  loadResults().catch(() => {});
  loadQueue().catch(() => {});
  loadJobs().catch(() => {});
  startPolling();
}

function updateLinkedInUI(status) {
  const badge = $('linkedInStatus');
  if (status.linkedInConnected) {
    badge.textContent = 'LinkedIn: connected';
    badge.className = 'status-badge ok';
    $('connectLinkedInBtn').textContent = 'Reconnect LinkedIn';
    $('startBtn').disabled = status.scrapeJob?.status === 'running';
  } else {
    badge.textContent = 'LinkedIn: not connected';
    badge.className = 'status-badge warn';
    $('startBtn').disabled = true;
  }
  const lj = status.linkedInJob || {};
  $('linkedInJobStatus').textContent =
    lj.status === 'running'
      ? status.inDocker
        ? 'Sign in inside the Chromium viewer below…'
        : 'Sign in inside the Chromium window…'
      : lj.status === 'failed'
        ? lj.error || 'Failed'
        : '';

  if (status.mongo) {
    $('mongoHint').textContent = status.mongo.ok
      ? `MongoDB OK — ${status.mongo.db} @ ${status.mongo.uri} | queue: ${status.queueCount || 0}`
      : 'MongoDB not connected. Run: npm run mongo:up';
  }
  $('queueCount').textContent = status.queueCount ? `(${status.queueCount})` : '';

  const dockerHint = $('dockerLoginHint');
  const viewerBtn = $('openViewerBtn');
  const reloadViewerBtn = $('reloadViewerBtn');
  const viewerWrap = $('browserViewerWrap');
  const viewer = $('browserViewer');
  const viewerUrl = status.browserViewerUrl || '/vnc/vnc_lite.html?autoconnect=1&resize=scale';
  if (status.inDocker) {
    dockerHint.hidden = false;
    viewerBtn.hidden = false;
    reloadViewerBtn.hidden = false;
    viewerBtn.href = viewerUrl;
    viewerWrap.hidden = false;
    if (viewer && !viewer.dataset.loaded) {
      viewer.src = viewerUrl;
      viewer.dataset.loaded = '1';
    }
  } else {
    dockerHint.hidden = true;
    viewerBtn.hidden = true;
    reloadViewerBtn.hidden = true;
    viewerWrap.hidden = true;
  }
}

function reloadBrowserViewer() {
  const viewer = $('browserViewer');
  const viewerBtn = $('openViewerBtn');
  const url = (viewerBtn && viewerBtn.href) || '/vnc/vnc_lite.html?autoconnect=1&resize=scale';
  if (!viewer) return;
  viewer.dataset.loaded = '1';
  viewer.src = 'about:blank';
  setTimeout(() => {
    viewer.src = url;
  }, 50);
}

async function loadConnectionTypes() {
  const types = await api('/api/connection-types');
  const select = $('connectionType');
  select.innerHTML = '';
  for (const [key, meta] of Object.entries(types)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = meta.label;
    opt.dataset.description = meta.description;
    select.appendChild(opt);
  }
  select.value = 'all_connections';
  updateTypeDescription();

  try {
    const products = await api('/api/products');
    const names = (products.products || []).map((p) => p.name).join(' + ');
    $('aiHint').textContent = products.aiConfigured
      ? `AI (${products.provider}) + RAG — drafts go to queue. Products: ${names}`
      : `Add ANTHROPIC_API_KEY or OPENAI_API_KEY. Matching ${names}.`;
  } catch {
    $('aiHint').textContent = '';
  }
}

function updateTypeDescription() {
  const opt = $('connectionType').selectedOptions[0];
  $('typeDescription').textContent = opt?.dataset.description || '';
  updatePreviewUrl();
}

async function updatePreviewUrl() {
  try {
    const filters = getFilters();
    if (filters.profileUrl) {
      $('previewUrl').textContent = `Single profile: ${filters.profileUrl}`;
      return;
    }
    const params = new URLSearchParams(filters);
    const { url } = await api(`/api/preview-url?${params}`);
    $('previewUrl').textContent = `LinkedIn URL: ${url}`;
  } catch {
    $('previewUrl').textContent = '';
  }
}

function renderJob(job) {
  const status = job?.status || 'idle';
  $('jobStatus').textContent = status;
  $('jobCurrent').textContent = job?.current || '—';
  const total = job?.total || 0;
  const done = job?.processed || 0;
  $('jobCounts').textContent = `${done} / ${total}`;
  $('progressBar').style.width = total > 0 ? `${Math.round((done / total) * 100)}%` : '0%';
  const logs = $('jobLogs');
  logs.innerHTML = '';
  (job?.logs || []).slice(-12).reverse().forEach((entry) => {
    const li = document.createElement('li');
    li.textContent = typeof entry === 'string' ? entry : entry.msg;
    logs.appendChild(li);
  });
}

function renderSendJob(job) {
  if (!job) {
    $('sendJobStatus').textContent = 'idle';
    return;
  }
  const parts = [job.status || 'idle'];
  if (job.total) parts.push(`${job.sent || 0} sent / ${job.failed || 0} failed / ${job.total} total`);
  if (job.current) parts.push(job.current);
  $('sendJobStatus').textContent = parts.join(' — ');
}

async function refreshStatus() {
  const status = await api('/api/status');
  updateLinkedInUI(status);
  renderJob(status.scrapeJob);
  renderSendJob(status.sendJob);
  $('resultCount').textContent = status.totalProfiles ? `(${status.totalProfiles})` : '';
  loadJobs().catch(() => {});
  loadQueue().catch(() => {});
}

async function connectLinkedIn() {
  $('connectLinkedInBtn').disabled = true;
  try {
    await api('/api/linkedin/connect', { method: 'POST' });
    $('linkedInJobStatus').textContent = 'Sign in in the Chromium viewer…';
    const wrap = $('browserViewerWrap');
    if (wrap && !wrap.hidden) wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (err) {
    alert(err.message);
  } finally {
    $('connectLinkedInBtn').disabled = false;
  }
}

async function startScrape() {
  $('startBtn').disabled = true;
  try {
    await api('/api/scrape/start', { method: 'POST', body: JSON.stringify(getFilters()) });
  } catch (err) {
    alert(err.message);
    $('startBtn').disabled = false;
  }
}

async function loadQueue() {
  const { items, count } = await api('/api/queue');
  queueItems = items || [];
  $('queueCount').textContent = count ? `(${count})` : '';
  const tbody = $('queueBody');
  tbody.innerHTML = '';
  if (!queueItems.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty">Queue is empty — run a scrape first</td></tr>';
    return;
  }

  queueItems.forEach((p) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="checkbox" class="queue-check" value="${esc(p.slug)}" /></td>
      <td>
        <div>${esc(p.name)}</div>
        <small class="hint">${esc(p.headline || '')}</small>
      </td>
      <td>${esc(p.productName || p.recommendedProduct || '—')}</td>
      <td>${p.relevanceScore ?? '—'}</td>
      <td>
        <textarea class="queue-msg" data-slug="${esc(p.slug)}" rows="3" style="width:100%;min-width:220px">${esc(p.aiMessage || '')}</textarea>
      </td>
      <td>${esc(p.queueStatus || 'queued')}</td>
      <td>
        <button class="btn send-one" data-slug="${esc(p.slug)}">Send</button>
      </td>`;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.send-one').forEach((btn) => {
    btn.addEventListener('click', () => sendSlugs([btn.dataset.slug]));
  });
}

function selectedQueueSlugs() {
  return [...document.querySelectorAll('.queue-check:checked')].map((el) => el.value);
}

async function saveEditedMessages(slugs) {
  for (const slug of slugs) {
    const ta = document.querySelector(`.queue-msg[data-slug="${CSS.escape(slug)}"]`);
    if (!ta) continue;
    const message = ta.value.trim();
    if (!message) continue;
    await api(`/api/queue/${encodeURIComponent(slug)}`, {
      method: 'PATCH',
      body: JSON.stringify({ message }),
    });
  }
}

async function sendSlugs(slugs) {
  if (!slugs.length) {
    alert('Select at least one queued message');
    return;
  }
  try {
    await saveEditedMessages(slugs);
    await api('/api/queue/send', {
      method: 'POST',
      body: JSON.stringify({ slugs }),
    });
    alert(`Sending ${slugs.length} message(s)… watch the browser window.`);
  } catch (err) {
    alert(err.message);
  }
}

async function sendAllQueued() {
  try {
    const all = queueItems.map((p) => p.slug);
    await saveEditedMessages(all);
    await api('/api/queue/send', { method: 'POST', body: JSON.stringify({ slugs: [] }) });
    alert('Sending all queued messages…');
  } catch (err) {
    alert(err.message);
  }
}

async function skipSelected() {
  const slugs = selectedQueueSlugs();
  if (!slugs.length) {
    alert('Select items to skip');
    return;
  }
  try {
    await api('/api/queue/skip', { method: 'POST', body: JSON.stringify({ slugs }) });
    await loadQueue();
  } catch (err) {
    alert(err.message);
  }
}

async function loadResults() {
  const { profiles } = await api('/api/results');
  const tbody = $('resultsBody');
  tbody.innerHTML = '';
  if (!profiles.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">No results yet</td></tr>';
    return;
  }
  profiles.slice(0, 200).forEach((p) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${esc(p.name)}</td>
      <td>${esc(p.headline)}</td>
      <td>${esc(p.productName || p.recommendedProduct || '—')}</td>
      <td>${esc(p.queueStatus || '—')}</td>
      <td>${p.messageSent ? 'Yes' : 'No'}</td>
      <td><a href="${esc(p.profileUrl)}" target="_blank" rel="noopener">Open</a></td>`;
    tbody.appendChild(tr);
  });
  $('resultCount').textContent = `(${profiles.length})`;
}

async function loadJobs() {
  try {
    const { jobs } = await api('/api/jobs');
    const tbody = $('jobsBody');
    tbody.innerHTML = '';
    if (!jobs.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty">No jobs yet</td></tr>';
      return;
    }
    jobs.forEach((j) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${esc(j.jobId)}</td>
        <td>${esc(j.status)}</td>
        <td>${j.processed || 0} / ${j.total || 0}</td>
        <td>${esc(j.startedAt ? new Date(j.startedAt).toLocaleString() : '')}</td>
        <td>${esc(j.finishedAt ? new Date(j.finishedAt).toLocaleString() : '—')}</td>`;
      tbody.appendChild(tr);
    });
  } catch {
    $('jobsBody').innerHTML =
      '<tr><td colspan="5" class="empty">Could not load jobs (is Mongo running?)</td></tr>';
  }
}

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    try {
      const status = await api('/api/status');
      updateLinkedInUI(status);
      renderJob(status.scrapeJob);
      renderSendJob(status.sendJob);
      if (status.scrapeJob?.status === 'completed') {
        loadResults();
        loadQueue();
        loadJobs();
        $('startBtn').disabled = !status.linkedInConnected;
      }
      if (status.sendJob?.status === 'completed' || status.sendJob?.status === 'failed') {
        loadQueue();
        loadResults();
      }
    } catch {
      /* ignore */
    }
  }, 2500);
}

['connectionType', 'keywords', 'title', 'company', 'location', 'maxResults', 'startIndex', 'profileUrl'].forEach((id) => {
  $(id).addEventListener('input', updatePreviewUrl);
  $(id).addEventListener('change', updatePreviewUrl);
});

$('connectLinkedInBtn').addEventListener('click', connectLinkedIn);
$('reloadViewerBtn')?.addEventListener('click', reloadBrowserViewer);
$('startBtn').addEventListener('click', startScrape);
$('refreshBtn').addEventListener('click', refreshStatus);
$('loadResultsBtn').addEventListener('click', loadResults);
$('loadQueueBtn').addEventListener('click', loadQueue);
$('sendSelectedBtn').addEventListener('click', () => sendSlugs(selectedQueueSlugs()));
$('sendAllBtn').addEventListener('click', sendAllQueued);
$('skipSelectedBtn').addEventListener('click', skipSelected);
$('selectAllQueue').addEventListener('change', (e) => {
  document.querySelectorAll('.queue-check').forEach((el) => {
    el.checked = e.target.checked;
  });
});
$('downloadBtn').addEventListener('click', async () => {
  try {
    const res = await fetch('/api/results/download');
    if (!res.ok) throw new Error('Download failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'connections.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert(err.message);
  }
});

initApp().catch((err) => alert(err.message));
