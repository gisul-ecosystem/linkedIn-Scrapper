const { getDb } = require('./mongo');

async function upsertUser(user) {
  const now = new Date();
  const doc = {
    userId: user.userId,
    name: user.name || user.userId,
    email: user.email || '',
    linkedInConnected: Boolean(user.linkedInConnected),
    linkedInConnectedAt: user.linkedInConnectedAt || null,
    lastActiveAt: now,
    updatedAt: now,
  };
  await getDb().collection('users').updateOne(
    { userId: user.userId },
    {
      $set: doc,
      $setOnInsert: { createdAt: now },
    },
    { upsert: true }
  );
  return getUser(user.userId);
}

async function getUser(userId) {
  return getDb().collection('users').findOne({ userId });
}

async function listUsers() {
  return getDb().collection('users').find({}).sort({ updatedAt: -1 }).toArray();
}

async function markLinkedInConnected(userId, connected = true) {
  return upsertUser({
    userId,
    linkedInConnected: connected,
    linkedInConnectedAt: connected ? new Date().toISOString() : null,
  });
}

module.exports = { upsertUser, getUser, listUsers, markLinkedInConnected };
