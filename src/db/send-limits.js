const { getDb } = require('./mongo');
const { SEND_DAY_TZ } = require('../config');

function todayKey(timeZone = SEND_DAY_TZ) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

async function getDailySendStats(ownerId, date = todayKey()) {
  const row = await getDb().collection('daily_send_stats').findOne({ ownerId, date });
  return {
    ownerId,
    date,
    sentCount: Number(row?.sentCount || 0),
    updatedAt: row?.updatedAt || null,
  };
}

async function incrementDailySent(ownerId, by = 1, date = todayKey()) {
  await getDb().collection('daily_send_stats').updateOne(
    { ownerId, date },
    {
      $inc: { sentCount: by },
      $set: { updatedAt: new Date() },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true }
  );
  return getDailySendStats(ownerId, date);
}

module.exports = {
  todayKey,
  getDailySendStats,
  incrementDailySent,
};
