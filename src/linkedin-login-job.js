const { launchBrowser } = require('./browser');
const {
  ensureLinkedInLoggedIn,
  hasLinkedInSession,
  clearLinkedInSession,
  isLoggedIn,
} = require('./linkedin-auth');
const { userPaths } = require('./paths');
const { FEED_URL, LOGIN_URL } = require('./config');
const { gotoWithRetry, sleep } = require('./utils');
const { execSync } = require('child_process');

function clearDesktopOverlays() {
  if (String(process.env.IN_DOCKER || '').toLowerCase() !== 'true') return;
  try {
    execSync('pkill -x xmessage >/dev/null 2>&1 || true', { stdio: 'ignore' });
  } catch {
    /* ignore */
  }
}

const linkedinJobs = new Map();
/** Active Playwright page while Connect is running — used by "Back to LinkedIn" rescue */
const activeSessions = new Map();

function getLinkedInJob(userId) {
  return linkedinJobs.get(userId) || { status: 'idle' };
}

async function logoutLinkedIn(userId) {
  const existing = linkedinJobs.get(userId);
  if (existing?.status === 'running') {
    throw new Error('LinkedIn login is in progress — wait for it to finish before logging out');
  }

  const paths = userPaths(userId);
  const cleared = await clearLinkedInSession(paths.linkedinSession);

  try {
    const db = require('./db');
    await db.connectMongo();
    await db.users.markLinkedInConnected(userId, false);
  } catch {
    /* mongo optional for logout */
  }

  linkedinJobs.set(userId, {
    status: 'idle',
    logs: ['LinkedIn session cleared. Connect again to sign in.'],
  });

  return { ok: true, cleared };
}

/**
 * Force the live Chromium tab off Google blank SSO → LinkedIn feed/login.
 */
async function rescueLinkedInBrowser(userId) {
  const session = activeSessions.get(userId);
  if (!session?.page) {
    throw new Error(
      'No live browser session. Click Connect first, then use Back to LinkedIn while the Google page is open.'
    );
  }

  const { page } = session;
  const job = linkedinJobs.get(userId);
  const log = (msg) => {
    if (job?.logs) job.logs.push(msg);
    console.log(`[linkedin-rescue:${userId}] ${msg}`);
  };

  log(`Rescuing from ${page.url().slice(0, 100)}…`);
  await gotoWithRetry(page, FEED_URL);
  await sleep(1200);

  if (await isLoggedIn(page)) {
    log('LinkedIn feed opened — you are signed in.');
    return { ok: true, loggedIn: true, url: page.url() };
  }

  await gotoWithRetry(page, LOGIN_URL);
  await sleep(800);
  log('LinkedIn login page opened — use email + password (not Google).');
  return { ok: true, loggedIn: false, url: page.url() };
}

async function startLinkedInConnect(userId) {
  const existing = linkedinJobs.get(userId);
  if (existing?.status === 'running') {
    throw new Error('LinkedIn login already in progress');
  }

  const paths = userPaths(userId);
  const job = {
    status: 'running',
    startedAt: new Date().toISOString(),
    logs: ['Opening browser for LinkedIn sign-in…'],
  };
  linkedinJobs.set(userId, job);

  (async () => {
    let browser;
    try {
      clearDesktopOverlays();
      const launched = await launchBrowser({
        storageStatePath: paths.linkedinSession,
        headless: false,
      });
      browser = launched.browser;
      const { context, page } = launched;
      page.setDefaultTimeout(90000);
      clearDesktopOverlays();

      activeSessions.set(userId, { browser, context, page });

      job.logs.push('Chromium opened. Use "Open full viewer" for signing in.');
      job.logs.push('Prefer LinkedIn email + password — Google SSO often sticks on a blank page.');
      job.logs.push('If stuck on Google: click "Back to LinkedIn" in the app (or type linkedin.com/feed/ in the address bar).');
      job.logs.push('Waiting for you to sign in to LinkedIn…');
      await ensureLinkedInLoggedIn(page, context, paths.linkedinSession, { preferManual: true });
      try {
        const db = require('./db');
        await db.connectMongo();
        await db.users.markLinkedInConnected(userId, true);
      } catch (err) {
        job.logs.push(`Mongo note: ${err.message}`);
      }
      job.status = 'completed';
      job.finishedAt = new Date().toISOString();
      job.logs.push('LinkedIn session saved successfully.');
      job.logs.push('Keeping browser open 8s so you can confirm in the viewer…');
      await new Promise((r) => setTimeout(r, 8000));
    } catch (err) {
      job.status = 'failed';
      job.error = err.message;
      job.finishedAt = new Date().toISOString();
      job.logs.push(`Failed: ${err.message}`);
    } finally {
      activeSessions.delete(userId);
      if (browser) await browser.close().catch(() => {});
    }
  })();

  return job;
}

module.exports = {
  startLinkedInConnect,
  getLinkedInJob,
  hasLinkedInSession,
  logoutLinkedIn,
  rescueLinkedInBrowser,
};
