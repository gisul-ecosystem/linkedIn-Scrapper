const { MongoClient } = require('mongodb');
const { MONGODB_URI, MONGODB_DB } = require('../config');

let client = null;
let db = null;

async function connectMongo() {
  if (db) return db;
  client = new MongoClient(MONGODB_URI);
  await client.connect();
  db = client.db(MONGODB_DB);
  await ensureIndexes(db);
  console.log(`[mongo] Connected → ${MONGODB_URI} / ${MONGODB_DB}`);
  return db;
}

async function ensureIndexes(database) {
  await database.collection('users').createIndex({ userId: 1 }, { unique: true });
  await database.collection('profiles').createIndex({ ownerId: 1, slug: 1 }, { unique: true });
  await database.collection('profiles').createIndex({ ownerId: 1, scrapedAt: -1 });
  await database.collection('profiles').createIndex({ ownerId: 1, recommendedProduct: 1 });
  await database.collection('profiles').createIndex({ ownerId: 1, queueStatus: 1 });
  await database.collection('scrape_jobs').createIndex({ jobId: 1 }, { unique: true });
  await database.collection('scrape_jobs').createIndex({ ownerId: 1, startedAt: -1 });
}

function getDb() {
  if (!db) throw new Error('MongoDB not connected. Start Mongo and restart the app.');
  return db;
}

async function closeMongo() {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}

module.exports = { connectMongo, getDb, closeMongo };
