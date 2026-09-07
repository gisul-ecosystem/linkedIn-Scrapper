const fs = require('fs');
const path = require('path');
const { ACTION_DELAY_MS, AI_MESSAGES, HEADLESS } = require('./config');
const { launchBrowser } = require('./browser');
const { ensureLinkedInLoggedIn } = require('./linkedin-auth');
const { collectConnectionLinks } = require('./connections');
const { scrapeProfile } = require('./profile');
const { writeConnectionsExcel } = require('./export');
const { resolveConnectionType, buildSearchUrl } = require('./search');
const { generateOutreachMessage } = require('./ai-message');
const { sendMessageToProfile } = require('./messaging');
const { getSendBudget, recordSuccessfulSend, maybeBatchPause } = require('./send-limits');
const { userPaths } = require('./paths');
const {
  ensureDirs,
  sleep,
  slugFromProfileUrl,
  nameFromSlug,
} = require('./utils');
const db = require('./db');

const activeJobs = new Map();

function getJobStatus(userId) {
  return activeJobs.get(userId) || { status: 'idle' };
}

async function runScrapeJob(userId, filters, onProgress) {
  const existing = activeJobs.get(userId);
  if (existing?.status === 'running') {
    throw new Error('A scrape job is already running for this user');
  }

  const paths = userPaths(userId);
  if (!fs.existsSync(paths.linkedinSession)) {
    throw new Error('Connect LinkedIn first before scraping');
  }

  await db.connectMongo();
  await db.users.upsertUser({ userId, linkedInConnected: true });

  const jobId = `job-${Date.now()}`;
  const job = {
    id: jobId,
    userId,
    status: 'running',
    filters,
    startedAt: new Date().toISOString(),
    processed: 0,
    total: 0,
    current: null,
    errors: [],
    logs: [],
    sent: 0,
    sendFailed: 0,
    skipped: 0,
  };
  activeJobs.set(userId, job);
  await db.jobs.createScrapeJob(job);

  const log = async (msg) => {
    job.logs.push({ at: new Date().toISOString(), msg });
    if (job.logs.length > 100) job.logs.shift();
    if (onProgress) onProgress(job);
    console.log(`[${userId}] ${msg}`);
    try {
      await db.jobs.appendJobLog(jobId, msg);
    } catch {
      /* ignore log persist errors */
    }
  };

  ensureDirs(paths.outDir);
  const { normalizeProfileUrl } = require('./utils');
  const directProfileUrl = normalizeProfileUrl(filters.profileUrl || '');
  filters = {
    ...filters,
    profileUrl: directProfileUrl,
    connectionType: directProfileUrl ? 'single_profile' : resolveConnectionType(filters),
  };

  const useAi = filters.aiMessages ?? AI_MESSAGES;
  const autoSend = Boolean(filters.sendMessages);

  const startIndex = Math.max(0, Number(filters.startIndex || 0));
  const maxConnections = Number(filters.maxResults || 0);

  const existingMap = await db.profiles.profilesMapBySlug(userId);

  const { browser, context, page } = await launchBrowser({
    storageStatePath: paths.linkedinSession,
    headless: HEADLESS,
  });
  page.setDefaultTimeout(90000);

  try {
    await ensureLinkedInLoggedIn(page, context, paths.linkedinSession);

    if (directProfileUrl) {
      await log(`Mode: single profile | ${directProfileUrl}`);
    } else {
      await log(`Mode: ${filters.connectionType} | ${buildSearchUrl(filters)}`);
    }
    if (useAi) await log('AI product matching: Racko + KanonKode + Aaptor (RAG)');
    if (autoSend) {
      await log('Auto-send ON — matched profiles will be messaged one-by-one after AI draft');
    } else {
      await log('Auto-send OFF — drafts go to queue for manual send');
    }
    await log(`MongoDB tracking enabled for owner=${userId}`);

    let connections;
    if (directProfileUrl) {
      const slug = slugFromProfileUrl(directProfileUrl);
      connections = [
        {
          profileUrl: directProfileUrl,
          listName: nameFromSlug(slug),
          subtitle: '',
          headline: '',
        },
      ];
      await log(`Single profile target: ${slug}`);
    } else {
      connections = await collectConnectionLinks(page, filters);
      await log(`Found ${connections.length} matching profiles`);
    }

    // Fast resume: drop already-scraped before visiting pages (no delay)
    let skippedKnown = 0;
    if (!directProfileUrl && !filters.rescrape) {
      const pending = [];
      for (const conn of connections) {
        const slug = slugFromProfileUrl(conn.profileUrl);
        if (existingMap[slug]?.scrapedAt) {
          skippedKnown += 1;
          continue;
        }
        pending.push(conn);
      }
      await log(
        `Fast resume: skipped ${skippedKnown} already scraped · ${pending.length} new left to process`
      );
      connections = pending;
    }

    const offset = directProfileUrl ? 0 : startIndex;
    const sliced =
      !directProfileUrl && maxConnections > 0
        ? connections.slice(offset, offset + maxConnections)
        : connections.slice(offset);

    job.total = sliced.length;
    job.skippedKnown = skippedKnown;
    await db.jobs.updateScrapeJob(jobId, { total: job.total, filters });
    await log(`This run will process ${sliced.length} profile(s)`);

    let sendBudget = await getSendBudget(userId);
    await log(
      `Daily send budget: ${sendBudget.sent}/${sendBudget.limit} used · ${sendBudget.remaining} left (${sendBudget.date})`
    );
    if (autoSend && sendBudget.remaining <= 0) {
      await log('Daily send limit already reached — stopping. Try again tomorrow for the next profiles.');
      job.status = 'completed';
      job.finishedAt = new Date().toISOString();
      await db.jobs.updateScrapeJob(jobId, {
        status: 'completed',
        finishedAt: job.finishedAt,
        processed: 0,
        resultCount: 0,
      });
      return job;
    }

    for (let i = 0; i < sliced.length; i += 1) {
      const conn = sliced[i];
      const slug = slugFromProfileUrl(conn.profileUrl);
      const existingProfile = existingMap[slug] || {};

      job.current = conn.listName || slug;
      job.processed = i;
      await db.jobs.updateScrapeJob(jobId, {
        current: job.current,
        processed: job.processed,
      });

      await log(`[${i + 1}/${sliced.length}] ${conn.listName || slug}`);
      let profile;
      try {
        profile = await scrapeProfile(page, conn.profileUrl);
        if (!profile.name && conn.listName) profile.name = conn.listName;
        if (conn.headline && !profile.headline) profile.headline = conn.headline;
        if (conn.subtitle && !profile.company) profile.company = conn.subtitle;
      } catch (err) {
        profile = {
          profileUrl: conn.profileUrl,
          name: conn.listName || '',
          headline: conn.headline || conn.subtitle || '',
          company: conn.subtitle || '',
          location: '',
          about: '',
          scrapedAt: new Date().toISOString(),
          scrapeError: err.message,
        };
        job.errors.push({ profile: conn.profileUrl, error: err.message });
      }

      const record = {
        ...existingProfile,
        ...profile,
        listIndex: offset + i,
        connectionType: filters.connectionType,
        searchKeywords: filters.keywords || '',
      };

      // Always keep a display name — list card / page / slug fallback
      if (!record.name) {
        record.name = conn.listName || nameFromSlug(slug);
      }
      if (!record.headline) {
        record.headline = conn.headline || conn.subtitle || '';
      }
      if (!record.company && conn.subtitle) {
        record.company = conn.subtitle;
      }

      if (useAi && !record.scrapeError) {
        try {
          await log(`[${i + 1}] scraped → name="${record.name}" | headline="${String(record.headline || '').slice(0, 100)}"`);
          await log(
            `[${i + 1}] fields → about=${(record.about || '').length}ch exp=${(record.experience || '').length}ch title="${record.jobTitle || ''}"`
          );
          await log(`[${i + 1}] RAG + AI matching…`);
          const outreach = await generateOutreachMessage(record);
          record.relevant = outreach.relevant;
          record.relevanceScore = outreach.relevanceScore;
          record.matchSignals = outreach.matchSignals || [];
          record.recommendedProduct = outreach.productId;
          record.productName = outreach.productName;
          record.productUrl = outreach.productUrl;
          record.aiMessage = outreach.message || '';
          record.ragMeta = outreach.rag || null;
          if (outreach.message) record.lastMessage = outreach.message.slice(0, 1200);
          if (outreach.brands) record.aiReason = `[${outreach.brands}] ${outreach.reason || ''}`;
          else record.aiReason = outreach.reason;

          if (!outreach.relevant) {
            record.queueStatus = 'skipped';
            job.skipped = (job.skipped || 0) + 1;
            await log(
              `[${i + 1}] AI SKIP score=${outreach.relevanceScore || 0} — ${String(outreach.reason).slice(0, 120)}`
            );
          } else if (autoSend && outreach.message) {
            sendBudget = await getSendBudget(userId);
            if (sendBudget.remaining <= 0) {
              record.queueStatus = 'queued';
              await log(
                `[${i + 1}] Daily limit reached — draft saved to queue. Stopping run so tomorrow picks the next new profiles.`
              );
              try {
                const saved = await db.profiles.upsertProfile(userId, slug, record, jobId);
                existingMap[slug] = saved;
              } catch (err) {
                job.errors.push({ slug, error: err.message });
              }
              job.processed = i + 1;
              break;
            }

            record.queueStatus = 'sending';
            await log(
              `[${i + 1}] AI MATCH → ${outreach.productName} score=${outreach.relevanceScore} — sending now (${sendBudget.remaining} left today)…`
            );
            try {
              const savedBeforeSend = await db.profiles.upsertProfile(userId, slug, record, jobId);
              existingMap[slug] = savedBeforeSend;

              const result = await sendMessageToProfile(page, record.profileUrl, outreach.message, {
                forceSend: true,
              });
              if (result.ok && result.sent) {
                await db.profiles.markMessageSent(userId, slug, { sentAt: result.sentAt });
                await recordSuccessfulSend(userId);
                record.messageSent = true;
                record.messageSentAt = result.sentAt || new Date().toISOString();
                record.queueStatus = 'sent';
                job.sent = (job.sent || 0) + 1;
                await log(`[${i + 1}] SENT → ${record.name || slug}`);
                await maybeBatchPause(job.sent, log);
              } else {
                await db.profiles.markMessageSent(userId, slug, {
                  error: result.error || 'send failed',
                });
                record.queueStatus = 'failed';
                record.messageError = result.error || 'send failed';
                job.sendFailed = (job.sendFailed || 0) + 1;
                await log(`[${i + 1}] SEND FAILED → ${result.error || 'unknown'}`);
              }
            } catch (sendErr) {
              await db.profiles.markMessageSent(userId, slug, { error: sendErr.message }).catch(() => {});
              record.queueStatus = 'failed';
              record.messageError = sendErr.message;
              job.sendFailed = (job.sendFailed || 0) + 1;
              await log(`[${i + 1}] SEND ERROR → ${sendErr.message}`);
            }
          } else {
            record.queueStatus = 'queued';
            await log(
              `[${i + 1}] AI QUEUE → ${outreach.productName} score=${outreach.relevanceScore} — ${String(outreach.reason).slice(0, 120)}`
            );
          }
        } catch (err) {
          record.aiError = err.message;
          await log(`[${i + 1}] AI error: ${err.message}`);
        }
      }

      // Persist after AI (+ optional auto-send)

      try {
        const saved = await db.profiles.upsertProfile(userId, slug, record, jobId);
        existingMap[slug] = saved;
      } catch (err) {
        job.errors.push({ slug, error: err.message });
        await log(`[${i + 1}] Mongo save error: ${err.message}`);
      }

      job.processed = i + 1;
      await db.jobs.updateScrapeJob(jobId, {
        processed: job.processed,
        errors: job.errors.slice(-50),
      });
      if (onProgress) onProgress(job);
      await sleep(ACTION_DELAY_MS);
    }

    const allProfiles = await db.profiles.listProfiles(userId, { limit: 5000 });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const xlsxPath = path.join(paths.outDir, `connections-${stamp}.xlsx`);
    await writeConnectionsExcel(allProfiles, xlsxPath, {
      scrapedAt: new Date().toISOString(),
      searchFilters: JSON.stringify(filters),
      processedThisRun: job.processed,
      aiMessages: useAi,
      sendMessages: autoSend,
      storage: 'mongodb',
      queueOnly: !autoSend,
    });
    try {
      fs.copyFileSync(xlsxPath, paths.excel);
    } catch {
      /* ignore */
    }

    job.status = 'completed';
    job.finishedAt = new Date().toISOString();
    job.resultCount = allProfiles.length;
    await db.jobs.updateScrapeJob(jobId, {
      status: 'completed',
      finishedAt: job.finishedAt,
      resultCount: job.resultCount,
      processed: job.processed,
    });
    const sendSummary = autoSend
      ? ` | sent ${job.sent || 0}, failed ${job.sendFailed || 0}, skipped ${job.skipped || 0}`
      : '';
    await log(`Done — ${job.processed} profiles scraped${sendSummary}`);
    return job;
  } catch (err) {
    job.status = 'failed';
    job.error = err.message;
    job.finishedAt = new Date().toISOString();
    await db.jobs.updateScrapeJob(jobId, {
      status: 'failed',
      error: err.message,
      finishedAt: job.finishedAt,
    });
    throw err;
  } finally {
    await browser.close();
  }
}

module.exports = { runScrapeJob, getJobStatus };
