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
  $('autoSendHint').textContent = on
    ? 'On: matched profiles are messaged during the run (max 60/day, 10 min pause every 20).'
    : 'Off: drafts go to the Queue for review.';
  $('flowHint').textContent = on
    ? 'Scrape → AI draft → send one-by-one'
    : 'Scrape → AI draft → queue for review';
  $('activityModeHint').textContent = on
    ? 'Auto-send is on — matches are messaged immediately during the scrape.'
    : 'Auto-send is off — drafts wait in Queue until you send.';
  updateRunSummary();
}

// ---- Source mode (search | file | profile) ----
let sourceMode = 'search';
let lastStatus = null;

function setSourceMode(mode) {
  sourceMode = mode;
  document.querySelectorAll('.seg').forEach((b) => {
    const on = b.dataset.source === mode;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
  });
  document.querySelectorAll('.source-pane').forEach((p) => {
    p.hidden = p.dataset.pane !== mode;
  });
  $('volumeRow').hidden = mode === 'profile';
  // File imports never auto-send
  const auto = $('autoSend');
  auto.disabled = mode === 'file';
  if (mode === 'file' && auto.checked) auto.checked = false;
  document.querySelector('.toggle-row')?.classList.toggle('disabled', mode === 'file');
  syncAutoSendUi();
  updatePreviewUrl();
}

function syncAiUi() {
  $('productChips').classList.toggle('disabled', !$('aiMessages').checked);
  updateRunSummary();
}

function productLabel(ids) {
  const names = { racko: 'Racko', kanonkode: 'KanonKode', aaptor: 'Aaptor' };
  return ids.map((id) => names[id] || id).join(', ');
}

/** Returns why Start can't run, or '' if it can. */
function startBlockReason() {
  if (!lastStatus?.linkedInConnected) return 'Connect LinkedIn in Session first.';
  if (lastStatus?.scrapeJob?.status === 'running') return 'A run is in progress.';
  if (sourceMode === 'file' && !$('connectionsFile').files?.[0]) return 'Choose a file to import.';
  if (sourceMode === 'profile' && !$('profileUrl').value.trim()) return 'Paste a profile URL.';
  if ($('aiMessages').checked && !selectedProducts().length) return 'Pick at least one product.';
  if (autoSendOn() && !$('aiMessages').checked) return 'Auto-send needs AI drafting on.';
  return '';
}

function updateRunSummary() {
  const max = Number($('maxResults').value) || 60;
  const ai = $('aiMessages').checked;
  const products = selectedProducts();
  const who =
    sourceMode === 'profile'
      ? 'Scrape 1 profile'
      : sourceMode === 'file'
        ? `Scrape up to ${max} from file`
        : `Scrape up to ${max} connections`;
  let what = ' · no AI drafts';
  if (ai) {
    const target = products.length === 3 ? 'any product' : productLabel(products) || '—';
    what = autoSendOn() ? ` · auto-send for ${target}` : ` · queue drafts for ${target}`;
  }
  $('runSummary').textContent = who + what;
  const reason = startBlockReason();
  $('runBlock').textContent = reason;
  $('startBtn').disabled = Boolean(reason);
}

function getFilters() {
  return {
    profileUrl: sourceMode === 'profile' ? $('profileUrl').value.trim() : '',
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
    products: selectedProducts(),
  };
}

function selectedProducts() {
  return [...document.querySelectorAll('.product-check:checked')].map((el) => el.value);
}

async function initApp() {
  syncAutoSendUi();
  const status = await api('/api/status');
  updateLinkedInUI(status);
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
  showView((location.hash || '#run').replace('#', '') || 'run');
  startPolling();
}

function updateLinkedInUI(status) {
  lastStatus = status;
  updateRunSummary();
  const badge = $('linkedInStatus');
  const logoutBtn = $('logoutLinkedInBtn');
  const backBtn = $('backToLinkedInBtn');
  if (status.linkedInConnected) {
    badge.textContent = 'LinkedIn connected';
    badge.className = 'pill ok';
    $('connectLinkedInBtn').textContent = 'Reconnect';
    if (logoutBtn) logoutBtn.hidden = false;
    if (backBtn) backBtn.hidden = true;
    $('linkedInPanel').classList.add('connected');
  } else {
    badge.textContent = 'LinkedIn offline';
    badge.className = 'pill warn';
    $('connectLinkedInBtn').textContent = 'Connect';
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
    updateRunSummary();
    const filters = getFilters();
    const file = $('connectionsFile')?.files?.[0];
    if (sourceMode === 'file') {
      $('previewUrl').textContent = file
        ? `File import · ${file.name} · queue only (no send)`
        : 'File import · no file chosen';
      return;
    }
    if (sourceMode === 'profile') {
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

/** Classify a scrape log line → { kind, tag, text } for colored rendering. */
function classifyLog(msg) {
  const m = String(msg || '');
  const strip = (re) => m.replace(re, '').trim();
  if (/^\[\d+\/\d+\]/.test(m)) return { kind: 'header', text: m };
  if (/AI QUEUE →/.test(m)) return { kind: 'item', tag: ['queue', 'QUEUED'], text: strip(/^\[\d+\]\s*AI QUEUE →\s*/) };
  if (/AI MATCH →/.test(m)) return { kind: 'item', tag: ['queue', 'MATCH'], text: strip(/^\[\d+\]\s*AI MATCH →\s*/) };
  if (/AI SKIP/.test(m)) return { kind: 'item', tag: ['skip', 'SKIP'], text: strip(/^\[\d+\]\s*AI SKIP\s*/) };
  if (/\bSENT →/.test(m)) return { kind: 'item', tag: ['sent', 'SENT'], text: strip(/^\[\d+\]\s*SENT →\s*/) };
  if (/^Done —/.test(m)) return { kind: 'item', tag: ['done', 'DONE'], text: strip(/^Done —\s*/) };
  if (/SEND FAILED|SEND ERROR|AI error|save error/i.test(m)) return { kind: 'item', tag: ['fail', 'ERROR'], text: strip(/^\[\d+\]\s*/) };
  if (/scraped →|fields →|RAG \+ AI matching/.test(m)) return { kind: 'detail', text: strip(/^\[\d+\]\s*/) };
  return { kind: 'item', text: m };
}

function fmtTime(at) {
  if (!at) return '';
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour12: false });
}

let lastLogKey = '';

function renderJob(job) {
  const status = job?.status || 'idle';
  const badge = $('jobStatus');
  badge.textContent = status;
  badge.className = `status-badge ${status}`;
  $('jobCurrent').textContent = status === 'running' ? job?.current || '—' : job?.current ? `Last: ${job.current}` : '—';
  const total = job?.total || 0;
  const done = job?.processed || 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  $('jobPct').textContent = `${pct}%`;
  $('jobCounts').textContent = `${done} / ${total} profiles`;
  $('progressBar').style.width = `${pct}%`;
  $('jobQueued').textContent = String(job?.queued || 0);
  $('jobSkipped').textContent = String(job?.skipped || 0);
  $('jobSent').textContent = String(job?.sent || 0);
  $('jobErrors').textContent = String((job?.errors?.length || 0) + (job?.sendFailed || 0));

  const verbose = $('verboseLogs').checked;
  const entries = (job?.logs || []).slice(-80);
  const key = `${verbose}|${entries.length}|${entries[entries.length - 1]?.at || ''}`;
  if (key === lastLogKey) return; // nothing new — keep scroll position
  lastLogKey = key;

  const logs = $('jobLogs');
  const nearBottom = logs.scrollHeight - logs.scrollTop - logs.clientHeight < 40;
  logs.innerHTML = '';
  if (!entries.length) {
    logs.innerHTML = '<li class="detail"><span></span><span>No run yet — configure and press Start.</span></li>';
    return;
  }
  for (const entry of entries) {
    const msg = typeof entry === 'string' ? entry : entry.msg;
    const { kind, tag, text } = classifyLog(msg);
    if (kind === 'detail' && !verbose) continue;
    const li = document.createElement('li');
    li.className = kind;
    const time = document.createElement('span');
    time.className = 'log-time';
    time.textContent = fmtTime(entry?.at);
    const body = document.createElement('span');
    if (tag) {
      const t = document.createElement('span');
      t.className = `log-tag ${tag[0]}`;
      t.textContent = tag[1];
      body.appendChild(t);
    }
    body.appendChild(document.createTextNode(text));
    li.append(time, body);
    logs.appendChild(li);
  }
  if (nearBottom || status === 'running') logs.scrollTop = logs.scrollHeight;
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

async function startFileImport(file) {
  const maxResults = Number($('maxResults').value) || 60;
  const startIndex = Number($('startIndex').value) || 0;
  if (
    !confirm(
      `Import "${file.name}" and scrape up to ${maxResults} profile(s) from the file URLs?\n\nMessages will stay in the queue. Nothing is sent until you click Send to all.`
    )
  ) {
    return;
  }

  $('startBtn').disabled = true;
  try {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('maxResults', String(maxResults));
    fd.append('startIndex', String(startIndex));
    fd.append('aiMessages', String($('aiMessages').checked));
    fd.append('rescrape', String($('rescrape').checked));
    fd.append('products', selectedProducts().join(','));
    const res = await fetch('/api/scrape/import', { method: 'POST', body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    if ($('fileHint') && data.found != null) {
      $('fileHint').textContent = `${file.name} · ${data.found} URL(s) found · scraping up to ${data.willProcess}`;
    }
    showView('run');
    await refreshStatus();
  } catch (err) {
    alert(err.message);
    updateRunSummary();
  }
}

async function startScrape() {
  const reason = startBlockReason();
  if (reason) {
    alert(reason);
    return;
  }
  if (sourceMode === 'file') {
    await startFileImport($('connectionsFile').files[0]);
    return;
  }

  const filters = getFilters();
  if (
    filters.sendMessages &&
    !confirm('Auto-send is ON. Matched profiles will be messaged one-by-one during this scrape. Continue?')
  ) {
    return;
  }

  $('startBtn').disabled = true;
  try {
    await api('/api/scrape/start', { method: 'POST', body: JSON.stringify(filters) });
    showView('run');
    await refreshStatus();
  } catch (err) {
    alert(err.message);
    updateRunSummary();
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
    const reason =
      status === 'failed'
        ? p.messageError || 'send failed'
        : p.aiReason || p.messageError || '';
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
  const count = queueItems.length;
  if (!count) {
    alert('Queue is empty');
    return;
  }
  if (
    !confirm(
      `Send to all ${count} queued message(s), one-by-one?\n\nUses the existing delay between sends and the daily send limit.`
    )
  ) {
    return;
  }
  try {
    const all = queueItems.map((p) => p.slug);
    await saveEditedMessages(all);
    await api('/api/queue/send', { method: 'POST', body: JSON.stringify({ slugs: [] }) });
    showView('run');
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
  const select = $('clearProduct');
  const product = select?.value || '';
  const label = product ? `${select.selectedOptions[0].textContent} drafts` : 'all queued drafts';
  if (
    !confirm(
      `Clear ${label}? Sent messages stay in history. Scraped profiles stay in Mongo — only unsent queue drafts are removed.`
    )
  ) {
    return;
  }
  await postClear({ product });
}

async function clearSelected() {
  const slugs = selectedQueueSlugs();
  if (!slugs.length) {
    alert('Select drafts to clear.');
    return;
  }
  if (!confirm(`Clear ${slugs.length} selected draft(s)?`)) return;
  await postClear({ slugs });
}

async function postClear(body) {
  try {
    const result = await api('/api/queue/clear', { method: 'POST', body: JSON.stringify(body) });
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

function showView(name) {
  const allowed = ['run', 'queue', 'activity', 'profiles', 'history', 'session'];
  if (!allowed.includes(name)) name = 'run';
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  document.querySelectorAll('.nav-link').forEach((a) => a.classList.toggle('active', a.dataset.view === name));
  $('navLinks')?.classList.remove('open');
  if (location.hash !== `#${name}`) {
    history.replaceState(null, '', `#${name}`);
  }
  if (name === 'queue') loadQueue().catch(() => {});
  if (name === 'profiles') loadResults().catch(() => {});
  if (name === 'history') loadJobs().catch(() => {});
  if (name === 'activity') loadActivity().catch(() => {});
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

$('navToggle')?.addEventListener('click', () => {
  $('navLinks')?.classList.toggle('open');
});

document.querySelectorAll('.nav-link').forEach((link) => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    showView(link.dataset.view);
  });
});

window.addEventListener('hashchange', () => {
  const name = (location.hash || '#run').replace('#', '') || 'run';
  showView(name);
});

$('autoSend')?.addEventListener('change', syncAutoSendUi);
$('aiMessages').addEventListener('change', syncAiUi);
document.querySelectorAll('.product-check').forEach((el) => el.addEventListener('change', updateRunSummary));
document.querySelectorAll('.seg').forEach((b) => b.addEventListener('click', () => setSourceMode(b.dataset.source)));
$('verboseLogs').addEventListener('change', () => renderJob(lastStatus?.scrapeJob));

// Drag & drop onto the file zone
const dropzone = $('dropzone');
['dragenter', 'dragover'].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.add('drag');
  })
);
['dragleave', 'drop'].forEach((ev) => dropzone.addEventListener(ev, () => dropzone.classList.remove('drag')));
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  if (!e.dataTransfer?.files?.length) return;
  $('connectionsFile').files = e.dataTransfer.files;
  $('connectionsFile').dispatchEvent(new Event('change'));
});

['connectionType', 'maxResults', 'startIndex', 'profileUrl'].forEach((id) => {
  $(id).addEventListener('input', updatePreviewUrl);
  $(id).addEventListener('change', updatePreviewUrl);
});

$('connectionsFile')?.addEventListener('change', async () => {
  const file = $('connectionsFile')?.files?.[0];
  const hint = $('fileHint');
  if (!hint) return;
  const zone = $('dropzone');
  zone.classList.toggle('has-file', Boolean(file));
  $('dropzoneTitle').textContent = file ? file.name : 'Drop a CSV or Excel file, or click to browse';
  if (!file) {
    hint.textContent = 'LinkedIn Connections export, or any sheet with linkedin.com/in/ links.';
    updatePreviewUrl();
    return;
  }
  hint.textContent = 'Reading…';
  const max = Number($('maxResults').value) || 60;
  if (/\.csv$/i.test(file.name) || /csv|plain/.test(file.type || '')) {
    try {
      const text = await file.text();
      const re = /https?:\/\/(?:www\.)?linkedin\.com\/in\/[^\s,"'<>]+/gi;
      const seen = new Set();
      for (const m of text.match(re) || []) {
        seen.add(m.toLowerCase().replace(/\/$/, ''));
      }
      hint.textContent = `${seen.size} LinkedIn URL(s) found · this run scrapes up to ${max} · click to change`;
    } catch {
      hint.textContent = 'Selected · click to change';
    }
  } else {
    hint.textContent = 'Excel — URLs are counted when you start · click to change';
  }
  updatePreviewUrl();
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
$('clearSelectedBtn')?.addEventListener('click', clearSelected);
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
