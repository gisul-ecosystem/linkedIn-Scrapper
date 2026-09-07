const { MongoClient } = require('mongodb');
const { MONGODB_ATLAS_URI, MONGODB_DB, ATLAS_BACKUP_MS } = require('../config');
const { getDb } = require('./mongo');

const BATCH = 500;
let running = false;
let timer = null;

function maskUri(uri) {
  return String(uri || '').replace(/\/\/([^:/@]+):([^@]+)@/, '//$1:***@');
}

async function flushBatch(destCol, batch) {
  if (!batch.length) return;
  await destCol.bulkWrite(
    batch.map((doc) => ({
      replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true },
    })),
    { ordered: false }
  );
}

async function backupToAtlas() {
  if (!MONGODB_ATLAS_URI) return;
  if (running) {
    console.warn('[atlas-backup] skipped — previous run still in progress');
    return;
  }
  running = true;
  const started = Date.now();
  const source = getDb();
  const client = new MongoClient(MONGODB_ATLAS_URI);
  try {
    await client.connect();
    const dest = client.db(MONGODB_DB);
    const collections = await source.listCollections({}, { nameOnly: true }).toArray();
    let total = 0;

    for (const { name } of collections) {
      if (!name || name.startsWith('system.')) continue;
      const destCol = dest.collection(name);
      const cursor = source.collection(name).find({});
      let batch = [];
      let n = 0;
      while (await cursor.hasNext()) {
        batch.push(await cursor.next());
        if (batch.length >= BATCH) {
          await flushBatch(destCol, batch);
          n += batch.length;
          batch = [];
        }
      }
      await flushBatch(destCol, batch);
      n += batch.length;
      if (n) console.log(`[atlas-backup] ${name}: ${n} docs`);
      total += n;
    }

    console.log(
      `[atlas-backup] done ${total} docs in ${Date.now() - started}ms → ${maskUri(MONGODB_ATLAS_URI)} / ${MONGODB_DB}`
    );
  } finally {
    running = false;
    await client.close().catch(() => {});
  }
}

function startAtlasBackup() {
  if (!MONGODB_ATLAS_URI) {
    console.warn('[atlas-backup] disabled — MONGODB_ATLAS_URI empty');
    return;
  }
  if (timer) return;

  const run = () =>
    backupToAtlas().catch((err) => console.warn(`[atlas-backup] failed: ${err.message}`));

  console.log(
    `[atlas-backup] every ${Math.round(ATLAS_BACKUP_MS / 60000)} min → ${maskUri(MONGODB_ATLAS_URI)} / ${MONGODB_DB}`
  );
  setTimeout(run, 15_000);
  timer = setInterval(run, ATLAS_BACKUP_MS);
  if (typeof timer.unref === 'function') timer.unref();
}

module.exports = { backupToAtlas, startAtlasBackup };
