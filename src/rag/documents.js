const fs = require('fs');
const path = require('path');
const { ROOT } = require('../config');

const KNOWLEDGE_DIR = path.join(ROOT, 'knowledge');

/** Soft ceiling only when a ## section is huge; prefer keeping sections atomic. */
const ATOMIC_SOFT_MAX = 2000;

function chunkByParagraphs(text, { maxChars = 700, overlap = 80 } = {}) {
  const clean = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!clean) return [];

  const paragraphs = clean.split(/\n\n+/);
  const chunks = [];
  let buf = '';

  const push = (content) => {
    const c = content.trim();
    if (c.length >= 40) chunks.push(c);
  };

  for (const para of paragraphs) {
    if ((buf + '\n\n' + para).length <= maxChars) {
      buf = buf ? `${buf}\n\n${para}` : para;
      continue;
    }
    if (buf) push(buf);
    if (para.length <= maxChars) {
      buf = para;
    } else {
      for (let i = 0; i < para.length; i += maxChars - overlap) {
        push(para.slice(i, i + maxChars));
      }
      buf = '';
    }
  }
  if (buf) push(buf);
  return chunks;
}

/**
 * Prefer ##-delimited sections as atomic chunks (keeps geography→client maps intact).
 * Falls back to paragraph packing only when a section exceeds ATOMIC_SOFT_MAX.
 */
function chunkText(text, { maxChars = 700, overlap = 80 } = {}) {
  const clean = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!clean) return [];

  const sections = clean.split(/(?=^##\s)/m).map((s) => s.trim()).filter(Boolean);
  if (sections.length <= 1) {
    return chunkByParagraphs(clean, { maxChars, overlap });
  }

  const chunks = [];
  for (const section of sections) {
    if (section.length <= ATOMIC_SOFT_MAX) {
      if (section.length >= 40) chunks.push(section);
      else chunks.push(...chunkByParagraphs(section, { maxChars, overlap }));
    } else {
      chunks.push(...chunkByParagraphs(section, { maxChars, overlap }));
    }
  }
  return chunks;
}

function loadKnowledgeDocuments() {
  if (!fs.existsSync(KNOWLEDGE_DIR)) return [];

  const files = fs.readdirSync(KNOWLEDGE_DIR).filter((f) => f.endsWith('.md'));
  const docs = [];

  for (const file of files) {
    const productId = path.basename(file, '.md').toLowerCase();
    const full = path.join(KNOWLEDGE_DIR, file);
    const text = fs.readFileSync(full, 'utf8');
    const parts = chunkText(text);
    parts.forEach((content, i) => {
      docs.push({
        id: `${productId}-${i}`,
        productId,
        source: file,
        content,
      });
    });
  }
  return docs;
}

module.exports = { loadKnowledgeDocuments, chunkText, chunkByParagraphs, KNOWLEDGE_DIR };
