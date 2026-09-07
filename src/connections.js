const { buildSearchUrl, matchesFilters, resolveConnectionType } = require('./search');
const { sleep, gotoWithRetry } = require('./utils');
const { dismissOverlays } = require('./profile');

const CONNECTIONS_URL = 'https://www.linkedin.com/mynetwork/invite-connect/connections/';

async function assertNotBlocked(page) {
  const url = page.url();
  if (url.includes('/login') || url.includes('/checkpoint')) {
    throw new Error('LinkedIn session expired — click Connect LinkedIn again');
  }
  const bodyText = await page.locator('body').innerText().catch(() => '');
  if (/sign in|join linkedin/i.test(bodyText) && !url.includes('/search/')) {
    throw new Error('LinkedIn is asking for sign-in — reconnect your account');
  }
}

async function scrollPage(page, rounds = 10) {
  for (let i = 0; i < rounds; i += 1) {
    await page.mouse.wheel(0, 1600);
    await sleep(700);
  }
}

async function gotoAndSettle(page, url) {
  await gotoWithRetry(page, url);
  await sleep(4000);
  await dismissOverlays(page);
  await assertNotBlocked(page);
}

async function searchOnConnectionsPage(page, filters) {
  await gotoAndSettle(page, CONNECTIONS_URL);

  if (filters.keywords) {
    const searchInput = page
      .locator(
        'input[placeholder*="Search" i], input[aria-label*="Search" i], input.search-global-typeahead__input'
      )
      .first();
    if (await searchInput.isVisible({ timeout: 8000 }).catch(() => false)) {
      await searchInput.click();
      await searchInput.fill('');
      await searchInput.fill(filters.keywords);
      await sleep(500);
      await page.keyboard.press('Enter');
      await sleep(4000);
      await dismissOverlays(page);
    }
  }

  await scrollPage(page, 12);
  return extractProfileLinks(page, filters, 'connections');
}

async function collectAllConnections(page) {
  await gotoAndSettle(page, CONNECTIONS_URL);
  await scrollPage(page, 15);
  return extractProfileLinks(page, { connectionType: 'all_connections' }, 'connections');
}

async function collectFromPeopleSearch(page, filters) {
  const url = buildSearchUrl(filters);
  console.log(`[search] Opening ${url}`);
  await gotoAndSettle(page, url);

  const resultSelectors = [
    'li.reusable-search__result-container',
    'div[data-view-name="search-entity-result-universal-template"]',
    'ul.reusable-search__entity-result-list li',
    'div.entity-result',
    'main a[href*="/in/"]',
  ];

  let found = false;
  for (const sel of resultSelectors) {
    if ((await page.locator(sel).count()) > 0) {
      found = true;
      break;
    }
  }
  if (!found) {
    console.warn('[search] No result cards — trying connections page search fallback');
    return searchOnConnectionsPage(page, filters);
  }

  const target = filters.maxResults > 0 ? filters.maxResults : 50;
  const collected = [];
  const seen = new Set();

  for (let pageNum = 0; pageNum < 8 && collected.length < target; pageNum += 1) {
    await scrollPage(page, 6);
    const batch = await extractProfileLinks(page, filters, 'search');
    console.log(`[search] Page ${pageNum + 1}: extracted ${batch.length} profiles`);
    for (const item of batch) {
      if (seen.has(item.profileUrl)) continue;
      seen.add(item.profileUrl);
      collected.push(item);
    }
    if (collected.length >= target) break;

    const nextBtn = page
      .locator('button[aria-label="Next"], button.artdeco-pagination__button--next')
      .first();
    if (!(await nextBtn.isEnabled().catch(() => false))) break;
    await nextBtn.click();
    await sleep(3000);
  }

  if (!collected.length) {
    console.warn('[search] People search empty — trying connections page search fallback');
    return searchOnConnectionsPage(page, filters);
  }

  return collected.slice(0, target);
}

async function extractProfileLinks(page, filters, mode = 'search') {
  const trustLinkedIn = mode === 'search' && !!filters.keywords;

  const raw = await page.evaluate((extractMode) => {
    const seen = new Set();
    const out = [];

    const cardSelectors =
      extractMode === 'connections'
        ? ['li.mn-connection-card', 'div.mn-connection-card', 'div[data-view-name="connections-profile"]']
        : [
            'li.reusable-search__result-container',
            'div[data-view-name="search-entity-result-universal-template"]',
            'li.reusable-search__entity-result-list__item',
            'div.entity-result',
            'div[data-view-name="people-search-result"]',
          ];

    let cards = [];
    for (const sel of cardSelectors) {
      const found = document.querySelectorAll(sel);
      if (found.length) {
        cards = found;
        break;
      }
    }

    const pushLink = (a, card) => {
      let href = a.href || a.getAttribute('href') || '';
      if (!href.includes('/in/')) return;
      if (href.startsWith('/')) href = `https://www.linkedin.com${href}`;
      href = href.split('?')[0].replace(/\/$/, '');
      if (/linkedin\.com\/in\/(me|login|signup)/i.test(href)) return;
      if (seen.has(href)) return;
      seen.add(href);

      const cardText = card?.textContent?.replace(/\s+/g, ' ').trim() || '';
      const nameEl =
        card?.querySelector('.entity-result__title-text a span[aria-hidden="true"]') ||
        card?.querySelector('span.mn-connection-card__name') ||
        card?.querySelector('.mn-connection-card__details .t-16') ||
        card?.querySelector('span[dir="ltr"] span[aria-hidden="true"]') ||
        card?.querySelector('.entity-result__title-text span[aria-hidden="true"]') ||
        card?.querySelector('.entity-result__title-text');

      let listName =
        (nameEl?.textContent || '').replace(/\s+/g, ' ').trim() ||
        (a.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim() ||
        (a.textContent || '').replace(/\s+/g, ' ').trim();

      // aria-label is often "View Ajith B P's profile" / "Ajith B P"
      listName = listName
        .replace(/^view\s+/i, '')
        .replace(/'s profile$/i, '')
        .replace(/\s+profile$/i, '')
        .trim();

      const subtitleEl =
        card?.querySelector('.entity-result__primary-subtitle') ||
        card?.querySelector('.mn-connection-card__occupation') ||
        card?.querySelector('div.t-14.t-black.t-normal');
      const headlineEl =
        card?.querySelector('.entity-result__summary') ||
        card?.querySelector('.entity-result__secondary-subtitle');

      out.push({
        profileUrl: href,
        listName,
        subtitle: subtitleEl?.textContent?.replace(/\s+/g, ' ').trim() || '',
        headline: headlineEl?.textContent?.replace(/\s+/g, ' ').trim() || '',
        cardText: cardText.slice(0, 300),
      });
    };

    for (const card of cards) {
      const a = card.querySelector('a[href*="/in/"]');
      if (a) pushLink(a, card);
    }

    if (!out.length) {
      const main = document.querySelector('main, .scaffold-finite-scroll__content');
      const scope = main || document.body;
      for (const a of scope.querySelectorAll('a[href*="/in/"]')) {
        const card =
          a.closest('li') ||
          a.closest('div.entity-result') ||
          a.closest('div[data-view-name]') ||
          a.parentElement;
        pushLink(a, card);
      }
    }

    return out;
  }, mode);

  const deduped = [];
  const seen = new Set();
  for (const item of raw) {
    if (seen.has(item.profileUrl)) continue;
    if (!matchesFilters(item, filters, { trustLinkedInKeywords: trustLinkedIn })) continue;
    seen.add(item.profileUrl);
    deduped.push(item);
  }

  return deduped;
}

async function collectConnectionLinks(page, filters = {}) {
  const type = resolveConnectionType(filters);
  const resolved = { ...filters, connectionType: type };

  if (type === 'all_connections') {
    return collectAllConnections(page);
  }
  if (type === 'connections_search' && filters.keywords) {
    const fromPeople = await collectFromPeopleSearch(page, resolved);
    if (fromPeople.length) return fromPeople;
    return searchOnConnectionsPage(page, resolved);
  }
  return collectFromPeopleSearch(page, resolved);
}

module.exports = { collectConnectionLinks, collectAllConnections, collectFromPeopleSearch };
