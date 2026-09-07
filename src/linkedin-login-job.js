const { launchBrowser } = require('./browser');
const { ensureLinkedInLoggedIn, hasLinkedInSession } = require('./linkedin-auth');
const { userPaths } = require('./paths');

const linkedinJobs = new Map();

function getLinkedInJob(userId) {
  return linkedinJobs.get(userId) || { status: 'idle' };
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
      const launched = await launchBrowser({
        storageStatePath: paths.linkedinSession,
        headless: false,
      });
      browser = launched.browser;
      const { context, page } = launched;
      page.setDefaultTimeout(90000);

      job.logs.push('Chromium opened. In Docker, sign in via the viewer (or /vnc/vnc_lite.html).');
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
      // Keep window visible briefly so the VNC viewer is not instantly blank again
      job.logs.push('Keeping browser open 8s so you can confirm in the viewer…');
      await new Promise((r) => setTimeout(r, 8000));
    } catch (err) {
      job.status = 'failed';
      job.error = err.message;
      job.finishedAt = new Date().toISOString();
      job.logs.push(`Failed: ${err.message}`);
    } finally {
      if (browser) await browser.close().catch(() => {});
    }
  })();

  return job;
}

module.exports = { startLinkedInConnect, getLinkedInJob, hasLinkedInSession };
