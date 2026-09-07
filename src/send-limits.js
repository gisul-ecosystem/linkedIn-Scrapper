const {
  DAILY_SEND_LIMIT,
  SEND_BATCH_SIZE,
  SEND_BATCH_PAUSE_MS,
  SEND_DAY_TZ,
} = require('./config');
const { sleep } = require('./utils');
const db = require('./db');

async function getSendBudget(ownerId) {
  await db.connectMongo();
  const stats = await db.sendLimits.getDailySendStats(ownerId);
  const limit = DAILY_SEND_LIMIT;
  const sent = stats.sentCount;
  const remaining = Math.max(0, limit - sent);
  return {
    date: stats.date,
    timeZone: SEND_DAY_TZ,
    limit,
    sent,
    remaining,
    batchSize: SEND_BATCH_SIZE,
    batchPauseMinutes: Math.round(SEND_BATCH_PAUSE_MS / 60000),
  };
}

async function recordSuccessfulSend(ownerId) {
  return db.sendLimits.incrementDailySent(ownerId, 1);
}

/**
 * After every SEND_BATCH_SIZE successful sends in this run, pause SEND_BATCH_PAUSE_MS.
 * sessionSentCount = how many sent so far in the current job (not daily total).
 */
async function maybeBatchPause(sessionSentCount, log = console.log) {
  if (!SEND_BATCH_SIZE || sessionSentCount <= 0) return false;
  if (sessionSentCount % SEND_BATCH_SIZE !== 0) return false;
  const mins = Math.round(SEND_BATCH_PAUSE_MS / 60000);
  await log(
    `Buffer: ${SEND_BATCH_SIZE} messages sent in this run — pausing ${mins} minute(s) before continuing…`
  );
  await sleep(SEND_BATCH_PAUSE_MS);
  await log('Buffer done — resuming sends');
  return true;
}

module.exports = {
  getSendBudget,
  recordSuccessfulSend,
  maybeBatchPause,
  DAILY_SEND_LIMIT,
  SEND_BATCH_SIZE,
  SEND_BATCH_PAUSE_MS,
};
