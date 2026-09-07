const fs = require('fs');
const { LOGIN_URL, FEED_URL, LINKEDIN_EMAIL, LINKEDIN_PASSWORD } = require('./config');
const { sleep, gotoWithRetry } = require('./utils');

async function isLoggedIn(page) {
  const url = page.url();
  if (!url.includes('linkedin.com')) return false;
  if (url.includes('/login') || url.includes('/checkpoint') || url.includes('/uas/login')) {
    return false;
  }

  const loggedInPaths = ['/feed', '/mynetwork', '/messaging', '/notifications', '/jobs', '/in/'];
  if (loggedInPaths.some((p) => url.includes(p))) return true;

  const globalNav = page.locator(
    'nav.global-nav, .global-nav__me, [data-test-global-nav-link="feed"], header.global-nav'
  );
  const loginForm = page.locator('input#username, input[name="session_key"], form.login__form');
  const meMenu = page.locator('button[aria-label*="Me" i], img.global-nav__me-photo');

  const hasNav = (await globalNav.count()) > 0;
  const hasMe = (await meMenu.count()) > 0;
  const hasLogin = (await loginForm.count()) > 0;

  return (hasNav || hasMe) && !hasLogin;
}

function isGoogleAuthLimbo(url) {
  return /accounts\.google\.com\/(gsi|o\/oauth2|signin|v3\/signin)/i.test(String(url || ''));
}

/**
 * Google SSO often leaves Chromium on a blank accounts.google.com/gsi page.
 * Bounce back to LinkedIn feed (or login) so the user isn't stuck.
 */
async function rescueFromGoogleLimbo(page) {
  const url = page.url();
  if (!isGoogleAuthLimbo(url)) return false;

  console.log(`[linkedin] Stuck on Google auth page → returning to LinkedIn (${url.slice(0, 80)}…)`);
  try {
    await gotoWithRetry(page, FEED_URL);
    await sleep(1500);
    if (await isLoggedIn(page)) {
      console.log('[linkedin] Google SSO worked — now on LinkedIn feed');
      return true;
    }
    await gotoWithRetry(page, LOGIN_URL);
    await sleep(800);
    console.log('[linkedin] Back on LinkedIn login — use email/password (avoid Google if possible)');
    return true;
  } catch (err) {
    console.warn(`[linkedin] rescue failed: ${err.message}`);
    return false;
  }
}

async function waitForManualLogin(page, timeoutMs = 600000) {
  console.log('[linkedin] Complete sign-in in the browser.');
  console.log('[linkedin] Prefer LinkedIn email + password (Google SSO often gets stuck on a blank page).');
  console.log('[linkedin] If stuck on Google: click Back to LinkedIn in the app, or open https://www.linkedin.com/feed/');

  let lastRescueAt = 0;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isLoggedIn(page)) {
      console.log(`[linkedin] Authenticated → ${page.url()}`);
      return true;
    }

    // Aggressive rescue from blank Google GSI page
    if (Date.now() - lastRescueAt > 4000) {
      const rescued = await rescueFromGoogleLimbo(page);
      if (rescued) lastRescueAt = Date.now();
      if (await isLoggedIn(page)) {
        console.log(`[linkedin] Authenticated → ${page.url()}`);
        return true;
      }
    }

    await sleep(1200);
  }
  throw new Error('LinkedIn login timed out. Finish sign-in in the browser viewer within 10 minutes.');
}

async function saveLinkedInSession(context, sessionPath) {
  const dir = require('path').dirname(sessionPath);
  fs.mkdirSync(dir, { recursive: true });
  await context.storageState({ path: sessionPath });
}

async function ensureLinkedInLoggedIn(page, context, sessionPath, { preferManual = false } = {}) {
  await gotoWithRetry(page, FEED_URL);
  await sleep(1200);

  if (await isLoggedIn(page)) {
    await saveLinkedInSession(context, sessionPath);
    return;
  }

  if (preferManual || !LINKEDIN_EMAIL || !LINKEDIN_PASSWORD) {
    await gotoWithRetry(page, LOGIN_URL);
    await waitForManualLogin(page);
  } else {
    await gotoWithRetry(page, LOGIN_URL);
    await page.locator('input#username, input[name="session_key"]').first().fill(LINKEDIN_EMAIL);
    await page.locator('input#password, input[name="session_password"]').first().fill(LINKEDIN_PASSWORD);
    await page.locator('button[type="submit"]').first().click();
    await sleep(3000);
    if (page.url().includes('/checkpoint')) await waitForManualLogin(page);
    if (!(await isLoggedIn(page))) throw new Error('LinkedIn credential login failed');
  }

  await saveLinkedInSession(context, sessionPath);
}

async function clearLinkedInSession(sessionPath) {
  if (sessionPath && fs.existsSync(sessionPath)) {
    fs.unlinkSync(sessionPath);
    console.log(`[auth] LinkedIn session deleted → ${sessionPath}`);
    return true;
  }
  return false;
}

function hasLinkedInSession(sessionPath) {
  return fs.existsSync(sessionPath);
}

module.exports = {
  ensureLinkedInLoggedIn,
  isLoggedIn,
  waitForManualLogin,
  saveLinkedInSession,
  hasLinkedInSession,
  clearLinkedInSession,
};
