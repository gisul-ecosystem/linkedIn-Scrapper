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
    await log('Messages go to QUEUE only — send from the frontend when ready');
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

    job.total = connections.length;
    await db.jobs.updateScrapeJob(jobId, { total: job.total, filters });

    const limit = directProfileUrl
      ? connections.length
      : maxConnections > 0
        ? Math.min(connections.length, startIndex + maxConnections)
        : connections.length;

    const loopStart = directProfileUrl ? 0 : startIndex;

    for (let i = loopStart; i < limit; i += 1) {
      const conn = connections[i];
      const slug = slugFromProfileUrl(conn.profileUrl);
      const existingProfile = existingMap[slug] || {};

      job.current = conn.listName || slug;
      job.processed = i - startIndex;
      await db.jobs.updateScrapeJob(jobId, {
        current: job.current,
        processed: job.processed,
      });

      // Never reopen profiles already handled unless rescrape / single-profile paste
      if (!filters.rescrape && !directProfileUrl && existingProfile.scrapedAt) {
        const status = existingProfile.queueStatus || (existingProfile.relevant === false ? 'skipped' : 'scraped');
        if (!existingProfile.name) {
          const filled = nameFromSlug(slug) || conn.listName || '';
          if (filled) {
            try {
              await db.profiles.upsertProfile(
                userId,
                slug,
                { ...existingProfile, name: filled, headline: existingProfile.headline || conn.headline || conn.subtitle || '' },
                jobId
              );
              existingMap[slug] = { ...existingProfile, name: filled };
            } catch {
              /* ignore */
            }
          }
        }
        await log(
          `[${i + 1}/${limit}] skip existing (${status}) ${existingMap[slug]?.name || existingProfile.name || slug}`
        );
        job.processed = i - startIndex + 1;
        continue;
      }

      await log(`[${i + 1}/${limit}] ${conn.listName || slug}`);
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
        listIndex: i,
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
            await log(
              `[${i + 1}] AI SKIP score=${outreach.relevanceScore || 0} — ${String(outreach.reason).slice(0, 120)}`
            );
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

      // Never auto-send — drafts stay in queue until frontend Send

      try {
        const saved = await db.profiles.upsertProfile(userId, slug, record, jobId);
        existingMap[slug] = saved;
      } catch (err) {
        job.errors.push({ slug, error: err.message });
        await log(`[${i + 1}] Mongo save error: ${err.message}`);
      }

      job.processed = i - startIndex + 1;
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
      sendMessages: false,
      storage: 'mongodb',
      queueOnly: true,
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
    await log(`Done — ${job.processed} profiles scraped (stored in MongoDB)`);
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
