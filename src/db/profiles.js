const { getDb } = require('./mongo');

function toProfileDoc(ownerId, slug, record, jobId) {
  const hasDraft = Boolean(record.aiMessage || record.lastMessage);
  const alreadySent = Boolean(record.messageSent);
  let queueStatus = record.queueStatus;
  if (!queueStatus) {
    if (alreadySent) queueStatus = 'sent';
    else if (record.relevant === false) queueStatus = 'skipped';
    else if (hasDraft) queueStatus = 'queued';
    else queueStatus = 'scraped';
  }

  return {
    ownerId,
    slug,
    profileUrl: record.profileUrl || '',
    name: record.name || '',
    headline: record.headline || '',
    company: record.company || '',
    jobTitle: record.jobTitle || '',
    location: record.location || '',
    about: record.about || '',
    education: record.education || '',
    experience: record.experience || '',
    connectionType: record.connectionType || '',
    searchKeywords: record.searchKeywords || '',
    listIndex: record.listIndex ?? null,
    relevant: record.relevant,
    relevanceScore: record.relevanceScore ?? null,
    matchSignals: record.matchSignals || [],
    recommendedProduct: record.recommendedProduct || null,
    productName: record.productName || null,
    productUrl: record.productUrl || null,
    aiReason: record.aiReason || '',
    aiMessage: record.aiMessage || '',
    lastMessage: record.lastMessage || '',
    queueStatus,
    messageSent: alreadySent,
    messageSentAt: record.messageSentAt || null,
    messageError: record.messageError || null,
    scrapeError: record.scrapeError || null,
    ragMeta: record.ragMeta || null,
    scrapedAt: record.scrapedAt || new Date().toISOString(),
    lastJobId: jobId || null,
    updatedAt: new Date(),
  };
}

async function upsertProfile(ownerId, slug, record, jobId) {
  const doc = toProfileDoc(ownerId, slug, record, jobId);
  // Do not set jobIds in both $setOnInsert and $addToSet — Mongo rejects that conflict.
  const update = {
    $set: doc,
    $setOnInsert: { createdAt: new Date() },
  };
  if (jobId) {
    update.$addToSet = { jobIds: jobId };
  }

  await getDb().collection('profiles').updateOne({ ownerId, slug }, update, { upsert: true });
  return getProfile(ownerId, slug);
}

async function getProfile(ownerId, slug) {
  return getDb().collection('profiles').findOne({ ownerId, slug });
}

async function findProfileBySlug(ownerId, slug) {
  return getProfile(ownerId, slug);
}

async function listProfiles(ownerId, { limit = 500, skip = 0 } = {}) {
  return getDb()
    .collection('profiles')
    .find({ ownerId })
    .sort({ scrapedAt: -1 })
    .skip(skip)
    .limit(limit)
    .toArray();
}

async function listQueue(ownerId, { status = 'queued', limit = 500 } = {}) {
  const filter = { ownerId };
  if (status === 'queued') {
    filter.$or = [
      { queueStatus: 'queued' },
      {
        queueStatus: { $exists: false },
        messageSent: { $ne: true },
        relevant: { $ne: false },
        aiMessage: { $exists: true, $ne: '' },
      },
    ];
  } else if (status) {
    filter.queueStatus = status;
  }
  return getDb()
    .collection('profiles')
    .find(filter)
    .sort({ scrapedAt: -1 })
    .limit(limit)
    .toArray();
}

async function countQueue(ownerId) {
  return getDb().collection('profiles').countDocuments({
    ownerId,
    $or: [
      { queueStatus: 'queued' },
      {
        queueStatus: { $exists: false },
        messageSent: { $ne: true },
        relevant: { $ne: false },
        aiMessage: { $exists: true, $ne: '' },
      },
    ],
  });
}

async function updateQueuedMessage(ownerId, slug, message) {
  await getDb().collection('profiles').updateOne(
    { ownerId, slug },
    {
      $set: {
        aiMessage: message,
        lastMessage: message,
        queueStatus: 'queued',
        updatedAt: new Date(),
      },
    }
  );
  return getProfile(ownerId, slug);
}

async function markMessageSent(ownerId, slug, { sentAt, error } = {}) {
  const $set = {
    updatedAt: new Date(),
  };
  if (error) {
    $set.queueStatus = 'failed';
    $set.messageError = error;
  } else {
    $set.queueStatus = 'sent';
    $set.messageSent = true;
    $set.messageSentAt = sentAt || new Date().toISOString();
    $set.messageError = null;
  }
  await getDb().collection('profiles').updateOne({ ownerId, slug }, { $set });
  return getProfile(ownerId, slug);
}

async function markQueueSkipped(ownerId, slug) {
  await getDb().collection('profiles').updateOne(
    { ownerId, slug },
    { $set: { queueStatus: 'skipped', updatedAt: new Date() } }
  );
  return getProfile(ownerId, slug);
}

async function countProfiles(ownerId) {
  return getDb().collection('profiles').countDocuments({ ownerId });
}

async function profilesMapBySlug(ownerId) {
  const rows = await listProfiles(ownerId, { limit: 5000 });
  const map = {};
  for (const row of rows) map[row.slug] = row;
  return map;
}

module.exports = {
  upsertProfile,
  getProfile,
  findProfileBySlug,
  listProfiles,
  listQueue,
  countQueue,
  updateQueuedMessage,
  markMessageSent,
  markQueueSkipped,
  countProfiles,
  profilesMapBySlug,
  toProfileDoc,
};
