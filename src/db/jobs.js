const { getDb } = require('./mongo');

async function createScrapeJob(job) {
  const doc = {
    jobId: job.id || job.jobId,
    ownerId: job.userId || job.ownerId,
    status: job.status || 'running',
    filters: job.filters || {},
    startedAt: job.startedAt ? new Date(job.startedAt) : new Date(),
    finishedAt: null,
    processed: 0,
    total: 0,
    current: null,
    errors: [],
    logs: [],
    resultCount: 0,
    error: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await getDb().collection('scrape_jobs').insertOne(doc);
  return doc;
}

async function updateScrapeJob(jobId, patch) {
  const $set = { ...patch, updatedAt: new Date() };
  if (patch.finishedAt && typeof patch.finishedAt === 'string') {
    $set.finishedAt = new Date(patch.finishedAt);
  }
  await getDb().collection('scrape_jobs').updateOne({ jobId }, { $set });
  return getScrapeJob(jobId);
}

async function appendJobLog(jobId, msg) {
  await getDb().collection('scrape_jobs').updateOne(
    { jobId },
    {
      $push: {
        logs: {
          $each: [{ at: new Date().toISOString(), msg }],
          $slice: -100,
        },
      },
      $set: { updatedAt: new Date() },
    }
  );
}

async function getScrapeJob(jobId) {
  return getDb().collection('scrape_jobs').findOne({ jobId });
}

async function listScrapeJobs(ownerId, { limit = 50 } = {}) {
  return getDb()
    .collection('scrape_jobs')
    .find({ ownerId })
    .sort({ startedAt: -1 })
    .limit(limit)
    .toArray();
}

module.exports = {
  createScrapeJob,
  updateScrapeJob,
  appendJobLog,
  getScrapeJob,
  listScrapeJobs,
};
