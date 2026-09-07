const fs = require('fs');
const path = require('path');
const { ROOT, RAG_TTL_MS, RAG_TOP_K } = require('../config');
const { ensureDirs, loadJson, saveJson } = require('../utils');
const { loadKnowledgeDocuments } = require('./documents');
const { embedText, cosine } = require('./embed');

const CACHE_DIR = path.join(ROOT, 'data', 'rag-cache');
const INDEX_PATH = path.join(CACHE_DIR, 'index.json');

let memoryIndex = null;

function isFresh(index) {
  if (!index?.builtAt || !Array.isArray(index.chunks)) return false;
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
    console.log('[rag] Cache expired (TTL 1 day) — rebuilding…');
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

function retrieveForProfile(profile, { topK = RAG_TOP_K, forceRebuild = false } = {}) {
  const index = loadIndex({ forceRebuild });
  const query = profileToQuery(profile);
  const qVec = embedText(query);

  const scored = index.chunks.map((chunk) => ({
    id: chunk.id,
    productId: chunk.productId,
    source: chunk.source,
    content: chunk.content,
    score: cosine(qVec, chunk.embedding),
  }));

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, topK);

  // Aggregate product scores from retrieved chunks
  const productScores = {};
  for (const item of top) {
    productScores[item.productId] = (productScores[item.productId] || 0) + item.score;
  }

  return {
    queryPreview: query.slice(0, 200),
    builtAt: index.builtAt,
    fromCache: isFresh(index),
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
  };
}

module.exports = {
  loadIndex,
  buildIndex,
  retrieveForProfile,
  getRagStatus,
  CACHE_DIR,
  INDEX_PATH,
};
