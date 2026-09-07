const fs = require('fs');
const { chromium } = require('playwright');
const { HEADLESS, AUTH_DIR } = require('./config');
const { ensureDirs } = require('./utils');

async function launchBrowser({ storageStatePath, headless } = {}) {
  ensureDirs(AUTH_DIR);

  const useHeadless = headless ?? HEADLESS;
  const inDocker = String(process.env.IN_DOCKER || '').toLowerCase() === 'true';
  const display = process.env.DISPLAY || ':99';

  const args = [
    '--disable-blink-features=AutomationControlled',
    '--disable-dev-shm-usage',
    '--window-position=0,0',
    '--window-size=1440,900',
    '--start-maximized',
  ];

  if (inDocker) {
    // Headed Chromium on Xvfb — avoid black/empty windows + flaky Docker DNS
    args.push(
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--use-gl=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ozone-platform=x11',
      '--disable-features=VizDisplayCompositor,AsyncDns',
      '--font-render-hinting=none'
    );
  } else {
    args.push('--disable-gpu');
  }

  const launchOptions = {
    headless: useHeadless,
    args,
    env: {
      ...process.env,
      DISPLAY: display,
      LIBGL_ALWAYS_SOFTWARE: inDocker ? '1' : process.env.LIBGL_ALWAYS_SOFTWARE,
    },
  };

  let browser;
  try {
    browser = await chromium.launch(launchOptions);
  } catch {
    console.log('[browser] bundled Chromium missing, using Edge');
    browser = await chromium.launch({
      ...launchOptions,
      channel: 'msedge',
    });
  }

  const contextOptions = {
    viewport: inDocker && !useHeadless ? null : { width: 1440, height: 900 },
    screen: { width: 1440, height: 900 },
    locale: 'en-US',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  };

  if (storageStatePath && fs.existsSync(storageStatePath)) {
    contextOptions.storageState = storageStatePath;
    console.log(`[auth] Reusing LinkedIn session → ${storageStatePath}`);
  }

  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  page.setDefaultTimeout(60000);

  if (inDocker && !useHeadless) {
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
    } catch {
      /* ignore */
    }
  }

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  console.log(`[browser] launched headless=${useHeadless} display=${display}`);
  return { browser, context, page };
}

module.exports = { launchBrowser };
