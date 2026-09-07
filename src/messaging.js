const { ACTION_DELAY_MS, SEND_MESSAGES } = require('./config');
const { sleep } = require('./utils');
const { dismissOverlays } = require('./profile');

async function dismissMessageBlockers(page) {
  await dismissOverlays(page);
  // Sticky msg overlays / premium prompts often sit on top of the Message CTA
  const blockers = [
    'button.msg-overlay-bubble-header__control[aria-label*="Close"]',
    'button[data-test-modal-close-btn]',
    'button.artdeco-modal__dismiss',
    'button[aria-label="Dismiss"]',
    'button[aria-label="Close"]',
    'button:has-text("Not now")',
    'button:has-text("No thanks")',
    'button:has-text("Skip")',
    'button:has-text("Got it")',
  ];
  for (const sel of blockers) {
    const btns = page.locator(sel);
    const n = await btns.count().catch(() => 0);
    for (let i = 0; i < Math.min(n, 4); i += 1) {
      const btn = btns.nth(i);
      if (await btn.isVisible({ timeout: 400 }).catch(() => false)) {
        await btn.click({ force: true }).catch(() => {});
        await sleep(200);
      }
    }
  }
  // Press Escape to clear leftover popovers
  await page.keyboard.press('Escape').catch(() => {});
  await sleep(300);
}

async function waitForComposer(page) {
  const editor = page
    .locator('div.msg-form__contenteditable[contenteditable="true"]')
    .or(page.locator('div[role="textbox"][contenteditable="true"]'))
    .first();
  await editor.waitFor({ state: 'visible', timeout: 20000 });
  return true;
}

async function openMessageComposer(page, profileUrl) {
  await page.goto(profileUrl, { waitUntil: 'domcontentloaded' });
  await sleep(ACTION_DELAY_MS);
  await dismissMessageBlockers(page);

  // Prefer direct compose URL — avoids overlays intercepting the Message click
  const composeLink = page.locator('a[href*="/messaging/compose"]').first();
  if (await composeLink.count().catch(() => 0)) {
    const href = await composeLink.getAttribute('href').catch(() => null);
    if (href) {
      const url = href.startsWith('http') ? href : `https://www.linkedin.com${href}`;
      console.log('[message] opening compose via href');
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await sleep(1500);
      await dismissMessageBlockers(page);
      try {
        await waitForComposer(page);
        return true;
      } catch {
        console.warn('[message] compose href loaded but editor missing — falling back to click');
      }
    }
  }

  const messageBtn = page
    .locator('main a[href*="/messaging/compose"]')
    .or(page.locator('main button').filter({ hasText: /^Message$/i }))
    .or(page.locator('button').filter({ hasText: /^Message$/i }))
    .or(page.locator('a[href*="/messaging/compose"]'))
    .first();

  if (await messageBtn.isVisible().catch(() => false)) {
    await messageBtn.scrollIntoViewIfNeeded().catch(() => {});
    await sleep(200);
    // force: overlays often intercept normal clicks on LinkedIn profiles
    await messageBtn.click({ force: true, timeout: 15000 });
    await sleep(1500);
    await dismissMessageBlockers(page);
    try {
      await waitForComposer(page);
      return true;
    } catch {
      /* try More menu next */
    }
  }

  const moreBtn = page
    .locator('button[aria-label="More actions"], button[aria-label*="More"], button:has-text("More")')
    .first();
  if (await moreBtn.isVisible().catch(() => false)) {
    await moreBtn.click({ force: true });
    await sleep(600);
    const menuMessage = page
      .locator('div[role="menu"] span, div.artdeco-dropdown__content span, div[role="menuitem"]')
      .filter({ hasText: /^Message$/i });
    if (await menuMessage.first().isVisible().catch(() => false)) {
      await menuMessage.first().click({ force: true });
      await sleep(1500);
      try {
        await waitForComposer(page);
        return true;
      } catch {
        return false;
      }
    }
  }

  return false;
}

async function fillMessage(page, text) {
  const editor = page
    .locator('div.msg-form__contenteditable[contenteditable="true"]')
    .or(page.locator('div[role="textbox"][contenteditable="true"]'))
    .first();

  await editor.waitFor({ state: 'visible', timeout: 30000 });
  await editor.click();
  await sleep(300);
  await editor.fill('');
  await page.keyboard.type(text, { delay: 15 });
  await sleep(500);
}

async function clickSend(page, { forceSend } = {}) {
  const sendBtn = page
    .locator('button.msg-form__send-button')
    .or(page.locator('button[type="submit"]').filter({ hasText: /^Send$/i }))
    .first();
  await sendBtn.waitFor({ state: 'visible', timeout: 15000 });
  const shouldSend = forceSend ?? SEND_MESSAGES;
  if (!shouldSend) {
    console.log('[message] DRY RUN — message typed but not sent (enable Send messages)');
    return { sent: false, dryRun: true };
  }
  await sendBtn.click();
  await sleep(1200);
  return { sent: true, dryRun: false };
}

async function sendMessageToProfile(page, profileUrl, messageText, options = {}) {
  const opened = await openMessageComposer(page, profileUrl);
  if (!opened) {
    return { ok: false, error: 'Could not open Message button on profile' };
  }

  try {
    await fillMessage(page, messageText);
    const result = await clickSend(page, options);
    return { ok: true, ...result, sentAt: result.sent ? new Date().toISOString() : null };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function getLastConversationSnippet(page, profileUrl) {
  await page.goto(profileUrl, { waitUntil: 'domcontentloaded' });
  await sleep(1000);

  const opened = await openMessageComposer(page, profileUrl);
  if (!opened) return '';

  return page.evaluate(() => {
    const bubbles = document.querySelectorAll('.msg-s-message-list__event, .msg-s-event-listitem');
    if (!bubbles.length) return '';
    const last = bubbles[bubbles.length - 1];
    return last.textContent?.replace(/\s+/g, ' ').trim().slice(0, 500) || '';
  });
}

module.exports = { sendMessageToProfile, openMessageComposer, getLastConversationSnippet };
