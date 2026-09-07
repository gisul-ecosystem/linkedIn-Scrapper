const $ = (id) => document.getElementById(id);

let pollTimer = null;
let queueItems = [];
let activityItems = [];

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

function autoSendOn() {
  return Boolean($('autoSend')?.checked);
}

function syncAutoSendUi() {
  const on = autoSendOn();
  const row = document.querySelector('.toggle-row');
  if (row) row.classList.toggle('on', on);
  $('flowHint').textContent = on
    ? 'Scrape → AI draft → send one-by-one'
    : 'Scrape → AI draft → queue for review';
  $('activityModeHint').textContent = on
    ? 'Auto-send is on — matches are messaged immediately during the scrape.'
    : 'Auto-send is off — drafts wait in Manual queue until you send.';
}

function getFilters() {
  return {
    profileUrl: $('profileUrl').value.trim(),
    connectionType: $('connectionType').value,
    keywords: '',
    title: '',
    company: '',
    location: '',
    maxResults: Number($('maxResults').value) || 60,
    startIndex: Number($('startIndex').value) || 0,
    rescrape: $('rescrape').checked,
    aiMessages: $('aiMessages').checked,
    sendMessages: autoSendOn(),
  };
}

async function initApp() {
  syncAutoSendUi();
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
  loadActivity().catch(() => {});
  startPolling();
}

function updateLinkedInUI(status) {
  const badge = $('linkedInStatus');
  const logoutBtn = $('logoutLinkedInBtn');
  const backBtn = $('backToLinkedInBtn');
  if (status.linkedInConnected) {
    badge.textContent = 'LinkedIn connected';
    badge.className = 'pill ok';
    $('connectLinkedInBtn').textContent = 'Reconnect';
    $('startBtn').disabled = status.scrapeJob?.status === 'running';
    if (logoutBtn) logoutBtn.hidden = false;
    if (backBtn) backBtn.hidden = true;
    $('linkedInPanel').classList.add('connected');
  } else {
    badge.textContent = 'LinkedIn offline';
    badge.className = 'pill warn';
    $('connectLinkedInBtn').textContent = 'Connect';
    $('startBtn').disabled = true;
    if (logoutBtn) logoutBtn.hidden = true;
    if (backBtn) backBtn.hidden = status.linkedInJob?.status !== 'running';
    $('linkedInPanel').classList.remove('connected');
  }

  const lj = status.linkedInJob || {};
  if (backBtn && lj.status === 'running') backBtn.hidden = false;
  $('linkedInJobStatus').textContent =
    lj.status === 'running'
      ? status.inDocker
        ? 'Sign in in full viewer — if stuck on Google, click Back to LinkedIn'
        : 'Sign in inside the Chromium window…'
      : lj.status === 'failed'
        ? lj.error || 'Failed'
        : '';

  if (status.mongo) {
    $('mongoPill').textContent = status.mongo.ok
      ? `Mongo · ${status.queueCount || 0} queued`
      : 'Mongo offline';
    $('mongoPill').className = status.mongo.ok ? 'pill muted' : 'pill warn';
    $('mongoHint').textContent = status.mongo.ok
      ? `MongoDB OK — ${status.mongo.db} @ ${status.mongo.uri}`
      : 'MongoDB not connected. Run docker compose up -d.';
  }
  $('queueCount').textContent = status.queueCount ? `(${status.queueCount})` : '';

  const budget = status.sendBudget;
  const budgetPill = $('sendBudgetPill');
  if (budgetPill && budget) {
    budgetPill.textContent = `Sends today · ${budget.sent}/${budget.limit} (${budget.remaining} left)`;
    budgetPill.className = budget.remaining > 0 ? 'pill muted' : 'pill warn';
    budgetPill.title = `${budget.date} · ${budget.timeZone} · pause ${budget.batchPauseMinutes}m every ${budget.batchSize}`;
  }

  const reportDate = $('reportDate');
  if (reportDate && budget?.date && !reportDate.value) {
    reportDate.value = budget.date;
  }

  const dockerHint = $('dockerLoginHint');
  const viewerBtn = $('openViewerBtn');
  const reloadViewerBtn = $('reloadViewerBtn');
  const viewerWrap = $('browserViewerWrap');
  const viewer = $('browserViewer');
  const viewerUrl = '/viewer.html';
  const panelVncUrl = status.browserViewerUrl || '/vnc/vnc_lite.html?autoconnect=1&scale=true';
  if (status.inDocker) {
    dockerHint.hidden = false;
    viewerBtn.hidden = false;
    reloadViewerBtn.hidden = false;
    viewerBtn.href = viewerUrl;
    viewerWrap.hidden = false;
    if (viewer && !viewer.dataset.loaded) {
      viewer.src = panelVncUrl;
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
  const url = '/vnc/vnc_lite.html?autoconnect=1&scale=true';
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
    const names = (products.products || []).map((p) => p.name).join(' · ');
    $('aiHint').textContent = products.aiConfigured
      ? `AI ready (${products.provider}) · ${names}`
      : `Add ANTHROPIC_API_KEY or OPENAI_API_KEY · ${names}`;
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
      $('previewUrl').textContent = `Single profile · ${filters.profileUrl}`;
      return;
    }
    const params = new URLSearchParams(filters);
    const { url } = await api(`/api/preview-url?${params}`);
    $('previewUrl').textContent = `LinkedIn target · ${url}`;
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
  $('jobSent').textContent = String(job?.sent || 0);
  $('progressBar').style.width = total > 0 ? `${Math.round((done / total) * 100)}%` : '0%';
  const logs = $('jobLogs');
  logs.innerHTML = '';
  (job?.logs || [])
    .slice(-16)
    .reverse()
    .forEach((entry) => {
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
  if (job.total) parts.push(`${job.sent || 0}/${job.total}`);
  $('sendJobStatus').textContent = parts.join(' · ');
}

async function refreshStatus() {
  const status = await api('/api/status');
  updateLinkedInUI(status);
  renderJob(status.scrapeJob);
  renderSendJob(status.sendJob);
  $('resultCount').textContent = status.totalProfiles ? `(${status.totalProfiles})` : '';
  loadJobs().catch(() => {});
  loadQueue().catch(() => {});
  loadActivity().catch(() => {});
}

async function connectLinkedIn() {
  $('connectLinkedInBtn').disabled = true;
  try {
    await api('/api/linkedin/connect', { method: 'POST' });
    $('linkedInJobStatus').textContent = 'Sign in via Open full viewer (new tab)…';
    // Auto-open fullscreen viewer — clicks work reliably there
    window.open('/viewer.html', '_blank', 'noopener');
    const wrap = $('browserViewerWrap');
    if (wrap && !wrap.hidden) wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
    reloadBrowserViewer();
  } catch (err) {
    alert(err.message);
  } finally {
    $('connectLinkedInBtn').disabled = false;
  }
}

async function backToLinkedIn() {
  const btn = $('backToLinkedInBtn');
  if (btn) btn.disabled = true;
  try {
    const result = await api('/api/linkedin/back', { method: 'POST' });
    $('linkedInJobStatus').textContent = result.message || 'Navigated to LinkedIn';
  } catch (err) {
    alert(
      `${err.message}\n\nOr in the viewer address bar paste:\nhttps://www.linkedin.com/feed/\nand press Enter.`
    );
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function logoutLinkedIn() {
  if (!confirm('Log out of LinkedIn? Saved session will be deleted.')) return;
  const btn = $('logoutLinkedInBtn');
  if (btn) btn.disabled = true;
  try {
    const result = await api('/api/linkedin/logout', { method: 'POST' });
    $('linkedInJobStatus').textContent = result.message || 'Logged out';
    await refreshStatus();
  } catch (err) {
    alert(err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function startScrape() {
  const filters = getFilters();
  if (filters.sendMessages && !filters.aiMessages) {
    alert('Turn on AI match + draft to auto-send messages.');
    return;
  }
  if (
    filters.sendMessages &&
    !confirm('Auto-send is ON. Matched profiles will be messaged one-by-one during this scrape. Continue?')
  ) {
    return;
  }

  $('startBtn').disabled = true;
  try {
    await api('/api/scrape/start', { method: 'POST', body: JSON.stringify(filters) });
    document.querySelector('.tab[data-tab="activity"]')?.click();
  } catch (err) {
    alert(err.message);
    $('startBtn').disabled = false;
  }
}

function statusBadgeClass(status) {
  if (status === 'sent') return 'sent';
  if (status === 'failed') return 'failed';
  if (status === 'skipped') return 'skipped';
  return 'queued';
}

async function loadActivity() {
  const { profiles } = await api('/api/results');
  activityItems = (profiles || [])
    .filter((p) => p.aiMessage || p.queueStatus === 'skipped' || p.messageSent)
    .slice(0, 80);

  const feed = $('activityFeed');
  if (!activityItems.length) {
    feed.innerHTML = '<div class="empty-state">Run a scrape to see sent / skipped profiles here.</div>';
    return;
  }

  feed.innerHTML = '';
  activityItems.forEach((p) => {
    const status = p.messageSent ? 'sent' : p.queueStatus || 'queued';
    const reason = p.aiReason || p.messageError || '';
    const card = document.createElement('article');
    card.className = 'feed-card';
    card.innerHTML = `
      <span class="feed-badge ${statusBadgeClass(status)}">${esc(status)}</span>
      <div>
        <div class="feed-title">${esc(p.name || p.slug)}</div>
        <div class="feed-meta">${esc(p.productName || p.recommendedProduct || '—')} · score ${p.relevanceScore ?? '—'}</div>
        ${
          status === 'skipped' && reason
            ? `<div class="feed-reason"><strong>Skip reason:</strong> ${esc(reason)}</div>`
            : ''
        }
        ${status === 'failed' && reason ? `<div class="feed-reason"><strong>Error:</strong> ${esc(reason)}</div>` : ''}
        ${p.aiMessage ? `<div class="feed-msg">${esc(p.aiMessage)}</div>` : ''}
      </div>
      <a href="${esc(p.profileUrl)}" target="_blank" rel="noopener">Open</a>`;
    feed.appendChild(card);
  });
}

async function loadQueue() {
  const { items, count } = await api('/api/queue');
  queueItems = items || [];
  $('queueCount').textContent = count ? `(${count})` : '';
  const tbody = $('queueBody');
  tbody.innerHTML = '';
  if (!queueItems.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty">Queue is empty</td></tr>';
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
        <textarea class="queue-msg" data-slug="${esc(p.slug)}" rows="3">${esc(p.aiMessage || '')}</textarea>
      </td>
      <td>${esc(p.queueStatus || 'queued')}</td>
      <td>
        <button class="btn primary send-one" data-slug="${esc(p.slug)}" type="button">Send</button>
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
  } catch (err) {
    alert(err.message);
  }
}

async function sendAllQueued() {
  try {
    const all = queueItems.map((p) => p.slug);
    await saveEditedMessages(all);
    await api('/api/queue/send', { method: 'POST', body: JSON.stringify({ slugs: [] }) });
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
    await loadActivity();
  } catch (err) {
    alert(err.message);
  }
}

async function clearQueue() {
  if (
    !confirm(
      'Clear all queued drafts? Sent messages stay in history. Scraped profiles stay in Mongo — only unsent queue drafts are removed.'
    )
  ) {
    return;
  }
  try {
    const result = await api('/api/queue/clear', { method: 'POST' });
    await loadQueue();
    await refreshStatus();
    alert(result.message || `Cleared ${result.cleared || 0} draft(s)`);
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
      if (status.scrapeJob?.status === 'running') {
        loadActivity().catch(() => {});
      }
      if (status.scrapeJob?.status === 'completed') {
        loadResults();
        loadQueue();
        loadJobs();
        loadActivity();
        $('startBtn').disabled = !status.linkedInConnected;
      }
      if (status.sendJob?.status === 'completed' || status.sendJob?.status === 'failed') {
        loadQueue();
        loadResults();
        loadActivity();
      }
    } catch {
      /* ignore */
    }
  }, 2500);
}

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    $(`tab-${tab.dataset.tab}`)?.classList.add('active');
  });
});

$('autoSend')?.addEventListener('change', syncAutoSendUi);

['connectionType', 'maxResults', 'startIndex', 'profileUrl'].forEach((id) => {
  $(id).addEventListener('input', updatePreviewUrl);
  $(id).addEventListener('change', updatePreviewUrl);
});

$('connectLinkedInBtn').addEventListener('click', connectLinkedIn);
$('backToLinkedInBtn')?.addEventListener('click', backToLinkedIn);
$('logoutLinkedInBtn')?.addEventListener('click', logoutLinkedIn);
$('reloadViewerBtn')?.addEventListener('click', reloadBrowserViewer);
$('startBtn').addEventListener('click', startScrape);
$('refreshBtn').addEventListener('click', refreshStatus);
$('loadResultsBtn').addEventListener('click', loadResults);
$('loadQueueBtn').addEventListener('click', loadQueue);
$('sendSelectedBtn').addEventListener('click', () => sendSlugs(selectedQueueSlugs()));
$('sendAllBtn').addEventListener('click', sendAllQueued);
$('skipSelectedBtn').addEventListener('click', skipSelected);
$('clearQueueBtn')?.addEventListener('click', clearQueue);
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

$('dailyReportBtn')?.addEventListener('click', async () => {
  const date = $('reportDate')?.value;
  if (!date) {
    alert('Pick a report date');
    return;
  }
  try {
    const res = await fetch(`/api/reports/daily-sends?date=${encodeURIComponent(date)}`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Daily report download failed');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `daily-sends-${date}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert(err.message);
  }
});

initApp().catch((err) => alert(err.message));
