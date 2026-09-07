/**
 * Manual LinkedIn login (CLI) — uses default local user folder.
 * Usage: npm run login
 */
const { launchBrowser } = require('./browser');
const { ensureLinkedInLoggedIn } = require('./linkedin-auth');
const { userPaths } = require('./paths');

const LOCAL_USER = 'local';

async function main() {
  const paths = userPaths(LOCAL_USER);
  const { browser, context, page } = await launchBrowser({
    storageStatePath: paths.linkedinSession,
    headless: false,
  });
  try {
    await ensureLinkedInLoggedIn(page, context, paths.linkedinSession, { preferManual: true });
    console.log('[done] LinkedIn session saved for local user');
    console.log('[done] Start app: npm start');
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('[error]', err.message);
  process.exit(1);
});
