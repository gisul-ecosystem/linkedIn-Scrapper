const fs = require('fs');
const path = require('path');
const { ROOT, RAG_TTL_MS, RAG_TOP_K } = require('../config');
const { ensureDirs, loadJson, saveJson } = require('../utils');
const { loadKnowledgeDocuments } = require('./documents');
const { embedText, cosine } = require('./embed');

const CACHE_DIR = path.join(ROOT, 'data', 'rag-cache');
const INDEX_PATH = path.join(CACHE_DIR, 'index.json');
/** Bump when chunking / retrieval contract changes so stale cache is discarded. */
const INDEX_VERSION = 2;

const GEO_PRODUCT_ID = 'geography-proof';
const PRODUCT_BIAS = 0.12;
const GEO_BIAS = 0.05;

let memoryIndex = null;

function isFresh(index) {
  if (!index?.builtAt || !Array.isArray(index.chunks)) return false;
  if (index.version !== INDEX_VERSION) return false;
  const age = Date.now() - new Date(index.builtAt).getTime();
  return age >= 0 && age < RAG_TTL_MS;
}

function buildIndex() {
  const docs = loadKnowledgeDocuments();
  const chunks = docs.map((doc) => ({
    ...doc,
    embedding: embedText(doc.content),
  }));

  const index = {
    version: INDEX_VERSION,
    builtAt: new Date().toISOString(),
    ttlMs: RAG_TTL_MS,
    ttlDays: RAG_TTL_MS / (24 * 60 * 60 * 1000),
    chunkCount: chunks.length,
    products: [...new Set(chunks.map((c) => c.productId))],
    chunks,
  };

  ensureDirs(CACHE_DIR);
  saveJson(INDEX_PATH, index);
  memoryIndex = index;
  console.log(
    `[rag] Index built — ${chunks.length} chunks, products=[${index.products.join(', ')}], TTL=${index.ttlDays}d`
  );
  return index;
}

function loadIndex({ forceRebuild = false } = {}) {
  if (!forceRebuild && memoryIndex && isFresh(memoryIndex)) return memoryIndex;

  if (!forceRebuild && fs.existsSync(INDEX_PATH)) {
    const cached = loadJson(INDEX_PATH, null);
    if (isFresh(cached)) {
      memoryIndex = cached;
      console.log(`[rag] Using cached index (built ${cached.builtAt})`);
      return cached;
    }
    console.log('[rag] Cache expired or version mismatch — rebuilding…');
  }

  return buildIndex();
}

function profileToQuery(profile) {
  return [
    profile.name,
    profile.headline,
    profile.jobTitle,
    profile.company,
    profile.location,
    profile.about,
    profile.education,
    profile.experience,
    ...(Array.isArray(profile.experienceList)
      ? profile.experienceList.map((e) => `${e.title || ''} ${e.company || ''} ${e.description || ''}`)
      : []),
  ]
    .filter(Boolean)
    .join(' ')
    .slice(0, 4000);
}

function normalizePreferProducts(preferProducts) {
  if (!preferProducts) return [];
  if (Array.isArray(preferProducts)) {
    return preferProducts.map((p) => String(p || '').toLowerCase().trim()).filter(Boolean);
  }
  return String(preferProducts)
    .toLowerCase()
    .split(/[+,|/]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function pickTopPerProduct(scored, prefer, topK) {
  const geo = scored.find((c) => c.productId === GEO_PRODUCT_ID);
  const productBudget = geo ? Math.max(1, topK - 1) : topK;
  const picked = new Set();
  const top = [];

  const take = (item) => {
    if (!item || picked.has(item.id) || top.length >= topK) return false;
    picked.add(item.id);
    top.push(item);
    return true;
  };

  // Round-robin across preferred products so one brand cannot fill the budget
  let productTaken = 0;
  let round = 0;
  let progressed = true;
  while (productTaken < productBudget && progressed) {
    progressed = false;
    for (const pid of prefer) {
      if (productTaken >= productBudget) break;
      const pool = scored.filter((c) => c.productId === pid);
      const c = pool[round];
      if (c && take(c)) {
        productTaken += 1;
        progressed = true;
      }
    }
    round += 1;
  }

  take(geo);

  for (const c of scored) {
    if (top.length >= topK) break;
    if (prefer.includes(c.productId) || c.productId === GEO_PRODUCT_ID) take(c);
  }
  for (const c of scored) {
    if (top.length >= topK) break;
    take(c);
  }

  top.sort((a, b) => b.score - a.score);
  return top;
}

function pickBiasedSingle(scored, preferId, topK) {
  const productChunks = scored.filter((c) => c.productId === preferId);
  const geoChunks = scored.filter((c) => c.productId === GEO_PRODUCT_ID);
  const other = scored.filter(
    (c) => c.productId !== preferId && c.productId !== GEO_PRODUCT_ID
  );
  const picked = new Set();
  const top = [];
  const take = (item) => {
    if (!item || picked.has(item.id) || top.length >= topK) return;
    picked.add(item.id);
    top.push(item);
  };

  const productSlots = geoChunks.length ? Math.max(1, topK - 1) : topK;
  for (const c of productChunks.slice(0, productSlots)) take(c);
  take(geoChunks[0]);
  for (const c of productChunks) take(c);
  for (const c of other) take(c);

  top.sort((a, b) => b.score - a.score);
  return top.slice(0, topK);
}

/**
 * @param {object} profile
 * @param {{ topK?: number, forceRebuild?: boolean, preferProducts?: string[]|string }} [opts]
 * preferProducts — heuristic / matrix product ids; biases retrieval and for
 * combined pitches pulls top chunks per product instead of one global top-K.
 */
function retrieveForProfile(profile, { topK = RAG_TOP_K, forceRebuild = false, preferProducts } = {}) {
  const index = loadIndex({ forceRebuild });
  const query = profileToQuery(profile);
  const qVec = embedText(query);
  const prefer = normalizePreferProducts(preferProducts);

  const scored = index.chunks.map((chunk) => {
    const rawScore = cosine(qVec, chunk.embedding);
    let score = rawScore;
    if (prefer.length && prefer.includes(chunk.productId)) score += PRODUCT_BIAS;
    if (chunk.productId === GEO_PRODUCT_ID) score += GEO_BIAS;
    return {
      id: chunk.id,
      productId: chunk.productId,
      source: chunk.source,
      content: chunk.content,
      score,
      rawScore,
    };
  });

  scored.sort((a, b) => b.score - a.score);

  let top;
  if (prefer.length >= 2) {
    top = pickTopPerProduct(scored, prefer, topK);
  } else if (prefer.length === 1) {
    top = pickBiasedSingle(scored, prefer[0], topK);
  } else {
    top = scored.slice(0, topK);
  }

  const productScores = {};
  for (const item of top) {
    productScores[item.productId] = (productScores[item.productId] || 0) + item.score;
  }

  return {
    queryPreview: query.slice(0, 200),
    builtAt: index.builtAt,
    fromCache: isFresh(index),
    preferProducts: prefer,
    chunks: top,
    productScores,
    contextBlock: top
      .map(
        (c, i) =>
          `[Chunk ${i + 1} | product=${c.productId} | score=${c.score.toFixed(3)} | ${c.source}]\n${c.content}`
      )
      .join('\n\n---\n\n'),
  };
}

function getRagStatus() {
  const exists = fs.existsSync(INDEX_PATH);
  const cached = exists ? loadJson(INDEX_PATH, null) : null;
  return {
    cachePath: INDEX_PATH,
    exists,
    fresh: cached ? isFresh(cached) : false,
    builtAt: cached?.builtAt || null,
    ttlMs: RAG_TTL_MS,
    ttlDays: 1,
    chunkCount: cached?.chunkCount || 0,
    products: cached?.products || [],
    version: cached?.version || null,
  };
}

module.exports = {
  loadIndex,
  buildIndex,
  retrieveForProfile,
  getRagStatus,
  CACHE_DIR,
  INDEX_PATH,
  INDEX_VERSION,
};
