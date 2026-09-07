const fs = require('fs');
const { ACTION_DELAY_MS, HEADLESS } = require('./config');
const { launchBrowser } = require('./browser');
const { ensureLinkedInLoggedIn } = require('./linkedin-auth');
const { sendMessageToProfile } = require('./messaging');
const { getSendBudget, recordSuccessfulSend, maybeBatchPause } = require('./send-limits');
const { userPaths } = require('./paths');
const { sleep } = require('./utils');
const db = require('./db');

const sendJobs = new Map();

function getSendJobStatus(userId) {
  return sendJobs.get(userId) || { status: 'idle' };
}

async function runSendQueueJob(userId, { slugs = [] } = {}) {
  const existing = sendJobs.get(userId);
  if (existing?.status === 'running') {
    throw new Error('A send job is already running');
  }

  const paths = userPaths(userId);
  if (!fs.existsSync(paths.linkedinSession)) {
    throw new Error('Connect LinkedIn first');
  }

  await db.connectMongo();

  let targets;
  if (slugs.length) {
    targets = [];
    for (const slug of slugs) {
      const p = await db.profiles.getProfile(userId, slug);
      if (p) targets.push(p);
    }
  } else {
    targets = await db.profiles.listQueue(userId, { status: 'queued', limit: 500 });
  }

  targets = targets.filter((p) => p.aiMessage && !p.messageSent && p.relevant !== false);

  const budget = await getSendBudget(userId);
  if (budget.remaining <= 0) {
    const job = {
      id: `send-${Date.now()}`,
      userId,
      status: 'completed',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      processed: 0,
      total: 0,
      sent: 0,
      failed: 0,
      logs: [
        {
          at: new Date().toISOString(),
          msg: `Daily send limit reached (${budget.sent}/${budget.limit}). Try again tomorrow.`,
        },
      ],
    };
    sendJobs.set(userId, job);
    return job;
  }

  // Never exceed remaining daily budget
  targets = targets.slice(0, budget.remaining);

  const job = {
    id: `send-${Date.now()}`,
    userId,
    status: 'running',
    startedAt: new Date().toISOString(),
    processed: 0,
    total: targets.length,
    current: null,
    sent: 0,
    failed: 0,
    logs: [],
  };
  sendJobs.set(userId, job);

  const log = (msg) => {
    job.logs.push({ at: new Date().toISOString(), msg });
    if (job.logs.length > 80) job.logs.shift();
    console.log(`[send:${userId}] ${msg}`);
  };

  if (!targets.length) {
    job.status = 'completed';
    job.finishedAt = new Date().toISOString();
    log('No queued messages to send');
    return job;
  }

  const { browser, context, page } = await launchBrowser({
    storageStatePath: paths.linkedinSession,
    headless: HEADLESS,
  });
  page.setDefaultTimeout(90000);

  try {
    await ensureLinkedInLoggedIn(page, context, paths.linkedinSession);
    log(
      `Sending up to ${targets.length} message(s) · daily ${budget.sent}/${budget.limit} used · pause every ${budget.batchSize} for ${budget.batchPauseMinutes}m`
    );

    for (let i = 0; i < targets.length; i += 1) {
      const liveBudget = await getSendBudget(userId);
      if (liveBudget.remaining <= 0) {
        log('Daily send limit reached mid-run — stopping');
        break;
      }

      const profile = targets[i];
      job.current = profile.name || profile.slug;
      job.processed = i;
      log(`[${i + 1}/${targets.length}] ${job.current}`);

      const result = await sendMessageToProfile(page, profile.profileUrl, profile.aiMessage, {
        forceSend: true,
      });

      if (result.ok && result.sent) {
        await db.profiles.markMessageSent(userId, profile.slug, { sentAt: result.sentAt });
        await recordSuccessfulSend(userId);
        job.sent += 1;
        log(`[${i + 1}] sent`);
        await maybeBatchPause(job.sent, log);
      } else if (result.dryRun) {
        await db.profiles.markMessageSent(userId, profile.slug, {
          error: 'Dry run — message not sent',
        });
        job.failed += 1;
      } else {
        await db.profiles.markMessageSent(userId, profile.slug, {
          error: result.error || 'send failed',
        });
        job.failed += 1;
        log(`[${i + 1}] failed: ${result.error}`);
      }

      job.processed = i + 1;
      await sleep(ACTION_DELAY_MS);
    }

    job.status = 'completed';
    job.finishedAt = new Date().toISOString();
    log(`Done — sent ${job.sent}, failed ${job.failed}`);
    return job;
  } catch (err) {
    job.status = 'failed';
    job.error = err.message;
    job.finishedAt = new Date().toISOString();
    throw err;
  } finally {
    await browser.close();
  }
}

module.exports = { runSendQueueJob, getSendJobStatus };
