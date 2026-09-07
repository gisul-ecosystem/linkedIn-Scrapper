/**
 * Lightweight local embeddings (hashed bag-of-words) for RAG.
 * No external embedding API required — index rebuild is cheap and TTL-cached.
 */

const DIM = 384;

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9+#.\-\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function hashToken(token) {
  let h = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % DIM;
}

function embedText(text) {
  const vec = new Array(DIM).fill(0);
  const tokens = tokenize(text);
  if (!tokens.length) return vec;

  for (const token of tokens) {
    vec[hashToken(token)] += 1;
    // simple bigram boost
    // (handled by consecutive tokens via hash of pair)
  }
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const pair = `${tokens[i]}_${tokens[i + 1]}`;
    vec[hashToken(pair)] += 0.5;
  }

  // L2 normalize
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return vec.map((v) => v / norm);
}

function cosine(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += a[i] * b[i];
  return s;
}

module.exports = { embedText, cosine, tokenize, DIM };
