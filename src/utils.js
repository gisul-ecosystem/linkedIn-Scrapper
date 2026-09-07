const fs = require('fs');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Navigate with retries for transient Docker DNS / network errors. */
async function gotoWithRetry(page, url, options = {}, { retries = 4, delayMs = 2000 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000, ...options });
      return;
    } catch (err) {
      lastErr = err;
      const msg = String(err.message || err);
      const retryable = /ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|ERR_NETWORK|ERR_INTERNET|ERR_TIMED_OUT|Timeout/i.test(
        msg
      );
      console.warn(`[nav] goto failed (${attempt}/${retries}): ${msg.slice(0, 120)}`);
      if (!retryable || attempt === retries) break;
      await sleep(delayMs * attempt);
    }
  }
  throw lastErr;
}

function ensureDirs(...dirs) {
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function saveJson(filePath, data) {
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

function firstName(fullName) {
  const parts = String(fullName || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return parts[0] || '';
}

function slugFromProfileUrl(url) {
  const m = String(url || '').match(/linkedin\.com\/in\/([^/?#]+)/i);
  return m ? decodeURIComponent(m[1]).replace(/\/$/, '') : '';
}

/** Turn a LinkedIn slug into a readable name when the page scrape misses the h1. */
function nameFromSlug(slug) {
  const raw = String(slug || '').trim();
  if (!raw) return '';
  const parts = raw
    .split('-')
    .filter(Boolean)
    // drop trailing LinkedIn id chunks like 71851227 or 45b2a8279
    .filter((p, i, arr) => {
      if (i === arr.length - 1 && /^[a-z0-9]{6,}$/i.test(p) && /\d/.test(p)) return false;
      return true;
    });
  return parts.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

/** Normalize a pasted LinkedIn profile URL to https://www.linkedin.com/in/slug */
function normalizeProfileUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  let href = raw;
  if (!/^https?:\/\//i.test(href)) {
    href = href.startsWith('linkedin.com') || href.startsWith('www.')
      ? `https://${href}`
      : `https://www.linkedin.com/in/${href.replace(/^\/?in\//i, '')}`;
  }
  try {
    const u = new URL(href);
    const m = u.pathname.match(/\/in\/([^/?#]+)/i);
    if (!m) return '';
    const slug = decodeURIComponent(m[1]).replace(/\/$/, '');
    return `https://www.linkedin.com/in/${slug}`;
  } catch {
    return '';
  }
}

module.exports = {
  sleep,
  gotoWithRetry,
  ensureDirs,
  loadJson,
  saveJson,
  firstName,
  slugFromProfileUrl,
  nameFromSlug,
  normalizeProfileUrl,
};
