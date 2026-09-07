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

async function waitForManualLogin(page, timeoutMs = 600000) {
  console.log('[linkedin] Complete sign-in in the browser (including 2FA if prompted).');
  console.log('[linkedin] After signing in, open https://www.linkedin.com/feed/ in that window.');

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isLoggedIn(page)) {
      console.log(`[linkedin] Authenticated → ${page.url()}`);
      return true;
    }
    await sleep(1500);
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

function hasLinkedInSession(sessionPath) {
  return fs.existsSync(sessionPath);
}

module.exports = {
  ensureLinkedInLoggedIn,
  isLoggedIn,
  waitForManualLogin,
  saveLinkedInSession,
  hasLinkedInSession,
};
