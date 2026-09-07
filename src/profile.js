const { sleep, slugFromProfileUrl, nameFromSlug, gotoWithRetry } = require('./utils');

async function dismissOverlays(page) {
  const dismissSelectors = [
    'button[aria-label="Dismiss"]',
    'button.artdeco-modal__dismiss',
    'button:has-text("Not now")',
    'button:has-text("Skip")',
    'button:has-text("Got it")',
    'button:has-text("Accept")',
    'button:has-text("Allow all")',
  ];
  for (const sel of dismissSelectors) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible({ timeout: 800 }).catch(() => false)) {
      await btn.click().catch(() => {});
      await sleep(300);
    }
  }
}

async function clickAllSeeMore(page) {
  const buttons = page.locator(
    'button.inline-show-more-text__button, button:has-text("see more"), button:has-text("Show more"), button:has-text("…see more")'
  );
  const count = await buttons.count().catch(() => 0);
  for (let i = 0; i < Math.min(count, 12); i += 1) {
    const btn = buttons.nth(i);
    if (await btn.isVisible().catch(() => false)) {
      await btn.click({ force: true }).catch(() => {});
      await sleep(250);
    }
  }
}

function parseNameFromTitle(title) {
  const raw = String(title || '').trim();
  if (!raw) return { name: '', headline: '' };
  const cleaned = raw.replace(/\s*\|\s*LinkedIn.*$/i, '').trim();
  const parts = cleaned.split(/\s+[-–—]\s+/);
  const name = (parts[0] || '').trim();
  const headline = parts.slice(1).join(' - ').trim();
  if (!name || /^linkedin$/i.test(name)) return { name: '', headline: '' };
  return { name, headline };
}

function cleanLine(s) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .replace(/·/g, '|')
    .trim();
}

function isNoiseLine(line) {
  return (
    !line ||
    line.length < 2 ||
    /^(contact info|message|connect|follow|more|pending|1st|2nd|3rd|·|followers|connections)$/i.test(
      line
    ) ||
    /^\d+(\+)?$/.test(line) ||
    /^linkedin$/i.test(line)
  );
}

/**
 * LinkedIn often concatenates top-card text without newlines, e.g.
 * "Sumathy D.· 1st· 2ndChief Learning Officer-L&D| Ed-Tech |..."
 */
function extractHeadlineFromTopCard(topCardText, name) {
  let t = String(topCardText || '');
  if (!t.trim()) return '';

  if (name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    t = t.replace(new RegExp(escaped, 'i'), ' ');
  }

  t = t
    .replace(/[·•]/g, ' ')
    .replace(/\b(1st|2nd|3rd)\+?\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Cut off LinkedIn chrome / activity that often gets mashed after the real headline
  t = t.split(
    /\b(Contact info|Message|Connect|Follow|Pending|Book an appointment|Hiring:|Show job|Highlights|mutual connections|\d+\+?\s*connections|You both|About|Experience|Education)\b/i
  )[0];

  // Prefer from first role-like token if present
  const roleStart = t.search(
    /\b(Chief|Head|Director|Manager|Officer|Founder|CEO|CTO|CIO|CHRO|VP|Vice|Lead|Senior|Principal|Learning|HR|Talent|Engineer|Consultant|Specialist|Professional|Associate|Executive|Alumni)\b/i
  );
  if (roleStart > 0 && roleStart < 80) t = t.slice(roleStart).trim();

  t = t.replace(/\s+/g, ' ').trim();
  if (t.length < 8) return '';
  return t.slice(0, 220);
}

const EDU_LEAK_RE =
  /\b(Deemed(?:-to-be)?(?:\s+University)?|University|Univ\.?|College|Institute of|School of|Bachelor|Master(?:'?s)?|MBA|B\.Tech|B\.E\.|M\.Tech|Ph\.?D|Alumni)\b/i;

const JOB_TYPE_RE = /^(full-?time|part-?time|contract|internship|self-employed|freelance|permanent)$/i;

/** LinkedIn concatenates visible + aria-hidden text: SynechronSynechron, or "Synechron Synechron". */
function collapseStutter(s) {
  let t = String(s || '');
  t = t.replace(/([A-Z][A-Za-z0-9&'’.-]{2,})\1/g, '$1');
  t = t.replace(/\b([A-Za-z][A-Za-z0-9&'’.-]{2,})\s+\1\b/g, '$1');
  return t;
}

function stripEducationLeak(s) {
  let t = String(s || '');
  const cut = t.search(EDU_LEAK_RE);
  if (cut > 12) t = t.slice(0, cut);
  // leftover " Jain (" after cutting Deemed-to-be University
  t = t.replace(/\s+[A-Z][A-Za-z]{2,24}\s*\([^)]*$/g, '');
  t = t.replace(/\s*\([^)]*$/g, '');
  t = t.replace(/[(\[{,;:\-–—|·]+\s*$/g, '').trim();
  return t;
}

function looksLikeDirtyField(s) {
  const t = String(s || '');
  return (
    !t ||
    EDU_LEAK_RE.test(t) ||
    /([A-Z][A-Za-z0-9&'’.-]{2,})\1/.test(t) ||
    t.length > 72
  );
}

function isShortRoleAcronym(s) {
  return /^(CEO|CTO|CIO|COO|CFO|CHRO|CLO|CPO|CISO|CRO|CMO|VP|SVP|EVP|MD|HR|TA|L&D|CXO)$/i.test(
    String(s || '').trim()
  );
}

function cleanCompanyName(raw) {
  let t = collapseStutter(String(raw || '').replace(/\s+/g, ' ').trim());
  if (!t) return '';
  t = t.split(/\s*[·|•]\s*/).filter(Boolean)[0] || t;
  if (JOB_TYPE_RE.test(t)) return '';
  t = t.replace(/\b(full-?time|part-?time|contract|internship|self-employed)\b.*$/i, '').trim();
  t = stripEducationLeak(t);
  t = t.replace(/\s*\([^)]*$/g, '').replace(/[(\[{,;:\-–—|·]+\s*$/g, '').trim();
  if (!t || t.length < 2 || EDU_LEAK_RE.test(t)) return '';
  return t.slice(0, 60);
}

/** "Manager at Synechron…" → Synechron when the company field was empty or mashed. */
function companyFromAtPhrase(raw) {
  const t = stripEducationLeak(collapseStutter(String(raw || '').replace(/\s+/g, ' ').trim()));
  const m = t.match(/\sat\s+([A-Z][A-Za-z0-9&'’.\- ]{1,50})$/);
  if (!m) return '';
  return cleanCompanyName(m[1]);
}

function cleanRoleTitle(raw, { name = '', company = '' } = {}) {
  let t = sanitizeHeadline(raw, name);
  t = collapseStutter(t);
  t = stripEducationLeak(t);
  const at = t.match(/^(.*?)\s+at\s+(.+)$/i);
  if (at && at[1].trim().length >= 6) t = at[1].trim();
  if (company) {
    const escaped = company.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    t = t.replace(new RegExp(`\\s*(?:at\\s+)?${escaped}\\s*$`, 'i'), '').trim();
    t = t.replace(new RegExp(`\\b${escaped}\\b`, 'ig'), ' ').replace(/\s+/g, ' ').trim();
  }
  t = t.split('|')[0].trim();
  t = t.replace(/[(\[{,;:\-–—|·]+\s*$/g, '').trim();
  if (isShortRoleAcronym(t)) return t;
  if (t.length < 4 || looksLikeDirtyField(t)) {
    const first = t.split(/\s[-–—]\s/)[0].trim();
    if (isShortRoleAcronym(first)) return first;
    if (first.length >= 4 && first.length <= 50 && !looksLikeDirtyField(first)) return first;
    return '';
  }
  return t.slice(0, 70);
}

/** Keep only the professional headline — strip UI leftovers. */
function sanitizeHeadline(headline, name = '') {
  let t = String(headline || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  t = collapseStutter(t);
  if (name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    t = t.replace(new RegExp(`^${escaped}[\\s·•|-]*`, 'i'), '');
  }
  t = t.split(
    /\b(Contact info|Message|Connect|Follow|Pending|Book an appointment|Hiring:|Show job|Highlights|mutual connections|\d+\+?\s*connections|You both|Bengaluru|Bangalore|Hyderabad|Mumbai|Chennai|Delhi|India\b)/i
  )[0];
  // Drop trailing company mash like "ClubAcceleratorX Alliance University"
  t = t.replace(/(Club|AcceleratorX|Alliance University).*$/i, (m, _g, offset, whole) => {
    // only cut if this looks like UI mash after a normal headline pipe section
    const before = whole.slice(0, offset).trim();
    return before.length >= 20 ? '' : m;
  });
  t = stripEducationLeak(t);
  t = t.replace(/[|·•]\s*$/g, '').replace(/\s+/g, ' ').trim();
  return t.slice(0, 180);
}

/** Short role phrase for messages — title only, never company or education. */
function shortRolePhrase(profile) {
  const company = cleanCompanyName(profile.company || '');
  const role = cleanRoleTitle(profile.jobTitle || profile.headline || '', {
    name: profile.name,
    company,
  });
  return role || '';
}

/**
 * Deep scrape: name, headline, about, experience, education, company, jobTitle.
 * Uses Playwright locators + DOM evaluate so LinkedIn DOM churn is less fragile.
 */
async function scrapeProfile(page, profileUrl) {
  await gotoWithRetry(page, profileUrl);
  await sleep(2500);
  await page
    .waitForSelector('main h1, h1, meta[property="og:title"]', { timeout: 25000 })
    .catch(() => {});
  await dismissOverlays(page);
  await sleep(1000);
  // Wait for top-card headline / body content (LinkedIn often hydrates after h1)
  await page
    .waitForSelector(
      'div.text-body-medium.break-words, [data-anonymize="headline"], section.artdeco-card div.text-body-medium',
      { timeout: 15000 }
    )
    .catch(() => {});
  await sleep(800);

  // --- Playwright locator pass (top card) while still at top ---
  let locatorName = '';
  let locatorHeadline = '';
  try {
    const h1 = page.locator('main h1').first();
    if (await h1.isVisible({ timeout: 5000 }).catch(() => false)) {
      locatorName = cleanLine(await h1.innerText());
      const topCard = page.locator('main section, main .artdeco-card').first();
      const headlineCand = topCard.locator('div.text-body-medium, [data-anonymize="headline"]').first();
      if (await headlineCand.isVisible({ timeout: 3000 }).catch(() => false)) {
        locatorHeadline = cleanLine(await headlineCand.innerText());
      }
      if (!locatorHeadline) {
        const topText = cleanLine(await topCard.innerText().catch(() => ''));
        const lines = topText
          .split('\n')
          .map(cleanLine)
          .filter((l) => !isNoiseLine(l));
        const nameIdx = lines.findIndex((l) => l === locatorName || l.startsWith(locatorName));
        if (nameIdx >= 0 && lines[nameIdx + 1]) locatorHeadline = lines[nameIdx + 1];
      }
    }
  } catch {
    /* ignore locator failures */
  }

  // Scroll so About / Experience hydrate — do NOT jump back to top (LinkedIn virtualizes)
  for (let i = 0; i < 10; i += 1) {
    await page.mouse.wheel(0, 1000);
    await sleep(350);
  }
  await clickAllSeeMore(page);
  await sleep(400);

  // Bring About / Experience into view so their cards stay mounted
  for (const sel of ['#about', '#experience', '#education']) {
    const el = page.locator(sel).first();
    if (await el.count().catch(() => 0)) {
      await el.scrollIntoViewIfNeeded().catch(() => {});
      await sleep(300);
      await clickAllSeeMore(page);
    }
  }
  // Also try heading-based scroll if ids missing
  for (const label of ['About', 'Experience', 'Education']) {
    const heading = page.getByRole('heading', { name: label, exact: true }).first();
    if (await heading.isVisible({ timeout: 800 }).catch(() => false)) {
      await heading.scrollIntoViewIfNeeded().catch(() => {});
      await sleep(250);
    }
  }
  await sleep(400);

  const data = await page.evaluate(() => {
    const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
    const visibleText = (el) => {
      if (!el) return '';
      const hidden = el.querySelector('span[aria-hidden="true"]');
      return text(hidden || el);
    };

    const pick = (...selectors) => {
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        const t = visibleText(el) || text(el);
        if (t) return t;
      }
      return '';
    };

    /** LinkedIn often uses div#about / div.artdeco-card — not always <section>. */
    const sectionByHeading = (label) => {
      const key = String(label || '').toLowerCase();
      const byId = document.getElementById(key);
      if (byId) {
        return (
          byId.closest('section') ||
          byId.closest('.artdeco-card') ||
          byId.closest('[data-view-name]') ||
          byId
        );
      }

      const exact = new RegExp(`^\\s*${label}\\s*$`, 'i');
      const headingNodes = [
        ...document.querySelectorAll(
          'h2, h3, .pvs-header__title, .pvs-header__title-container, div[id] h2'
        ),
      ];
      for (const h of headingNodes) {
        const raw = (h.textContent || '').replace(/\s+/g, ' ').trim();
        // LinkedIn duplicates "AboutAbout" via aria-hidden + visually-hidden
        const normalized = raw.replace(new RegExp(`(${label})\\s*\\1`, 'i'), '$1').trim();
        if (!exact.test(normalized) && !exact.test(raw)) continue;
        return (
          h.closest('section') ||
          h.closest('.artdeco-card') ||
          h.closest('[data-view-name]') ||
          h.parentElement
        );
      }

      // Loose fallback: first card whose header contains the label
      const loose = new RegExp(`^\\s*${label}\\b`, 'i');
      return [...document.querySelectorAll('section, div.artdeco-card, div[data-view-name]')].find(
        (s) => {
          const header = s.querySelector('h2, h3, .pvs-header__title');
          const t = (header?.textContent || '').replace(/\s+/g, ' ').trim();
          return loose.test(t);
        }
      );
    };

    const cleanAboutText = (raw) =>
      String(raw || '')
        .replace(/^\s*About\s*/i, '')
        .replace(/\s*(see more|show more|…see more)\s*$/i, '')
        .replace(/\s+/g, ' ')
        .trim();

    const sectionText = (section, maxItems = 8) => {
      if (!section) return '';
      const items = [
        ...section.querySelectorAll(
          'li.artdeco-list__item, li.pvs-list__paged-list-item, div.pvs-entity, div[data-view-name="profile-component-entity"], li'
        ),
      ];
      const chunks = [];
      for (const li of items) {
        const lines = [...li.querySelectorAll('span[aria-hidden="true"]')]
          .map((el) => text(el))
          .filter((t) => t && t.length > 1 && !/^(see more|show more)$/i.test(t));
        const uniq = [];
        for (const line of lines) {
          if (uniq[uniq.length - 1] !== line) uniq.push(line);
        }
        if (uniq.length) chunks.push(uniq.join(' · '));
        if (chunks.length >= maxItems) break;
      }
      if (!chunks.length) {
        const body = (section.innerText || '')
          .split('\n')
          .map((l) => l.replace(/\s+/g, ' ').trim())
          .filter(
            (l) =>
              l &&
              !/^(Experience|Education|About|Show all|see more|Show more)$/i.test(l) &&
              l.length > 2
          );
        return body.slice(0, maxItems * 3).join('\n');
      }
      return chunks.join('\n');
    };

    let name = pick(
      'h1.text-heading-xlarge',
      'h1.inline.t-24',
      'main section h1',
      'main h1',
      '[data-anonymize="person-name"]',
      '.pv-text-details__left-panel h1',
      '.ph5 h1',
      'h1'
    );
    if (!name) {
      const h1 = document.querySelector('main h1, h1');
      name = visibleText(h1) || text(h1);
    }

    let headline = pick(
      '[data-anonymize="headline"]',
      'div.text-body-medium.break-words',
      '.pv-text-details__left-panel .text-body-medium',
      '.ph5 .text-body-medium',
      'div.mt2.relative div.text-body-medium'
    );

    if (!headline && name) {
      const top = document.querySelector('main section') || document.querySelector('main');
      if (top) {
        const lines = (top.innerText || '')
          .split('\n')
          .map((l) => l.replace(/\s+/g, ' ').trim())
          .filter(Boolean);
        const idx = lines.findIndex((l) => l === name || l.startsWith(name.split(' ')[0]));
        for (let i = idx + 1; i < lines.length && i < idx + 6; i += 1) {
          const line = lines[i];
          if (
            !line ||
            /^(contact info|message|connect|follow|more|pending|1st|2nd|3rd)/i.test(line) ||
            line.length < 8
          ) {
            continue;
          }
          headline = line;
          break;
        }
      }
    }

    const location = pick(
      '[data-anonymize="location"]',
      'span.text-body-small.inline.t-black--light.break-words',
      '.pv-text-details__left-panel .text-body-small',
      'span.text-body-small.inline'
    );

    const aboutSection = sectionByHeading('About');
    let about = '';
    if (aboutSection) {
      const candidates = [
        ...aboutSection.querySelectorAll(
          '.inline-show-more-text span[aria-hidden="true"], .inline-show-more-text, .pv-shared-text-with-see-more, .pv-about__summary-text'
        ),
      ]
        .map((el) => cleanAboutText(text(el)))
        .filter((t) => t.length > 40);
      about = candidates.sort((a, b) => b.length - a.length)[0] || '';

      if (!about) {
        const spans = [...aboutSection.querySelectorAll('span[aria-hidden="true"]')]
          .map((el) => cleanAboutText(text(el)))
          .filter((t) => t.length > 40 && !/^About$/i.test(t));
        about = spans.sort((a, b) => b.length - a.length)[0] || '';
      }

      if (!about) {
        // Last resort: card innerText minus the "About" heading
        about = cleanAboutText(
          (aboutSection.innerText || '')
            .split('\n')
            .map((l) => l.trim())
            .filter((l) => l && !/^About$/i.test(l) && !/^(see more|show more)$/i.test(l))
            .join(' ')
        );
      }
    }

    const expSection = sectionByHeading('Experience');
    const experience = sectionText(expSection, 10);
    let company = '';
    let jobTitle = '';
    if (experience) {
      const first = experience.split('\n')[0] || '';
      const parts = first.split(/\s*[·|]\s*/).map((p) => p.trim()).filter(Boolean);
      jobTitle = parts[0] || '';
      company =
        parts.find(
          (p, i) =>
            i > 0 &&
            !/^(full-?time|part-?time|contract|internship|self-employed|freelance|\d)/i.test(p)
        ) || '';
    }

    const education = sectionText(sectionByHeading('Education'), 4);

    const topCardText =
      text(document.querySelector('main section')) ||
      text(document.querySelector('main .artdeco-card')) ||
      '';

    return {
      name,
      headline,
      location,
      company,
      jobTitle,
      about,
      experience,
      education,
      aboutFound: Boolean(aboutSection),
      expFound: Boolean(expSection),
      ogTitle: document.querySelector('meta[property="og:title"]')?.getAttribute('content') || '',
      pageTitle: document.title || '',
      topCardText: topCardText.slice(0, 1200),
      bodySnippet: (document.body?.innerText || '').slice(0, 800),
    };
  });

  const fromOg = parseNameFromTitle(data.ogTitle);
  const fromTitle = parseNameFromTitle(data.pageTitle);
  const slug = slugFromProfileUrl(profileUrl);

  let name = locatorName || data.name || fromOg.name || fromTitle.name || nameFromSlug(slug);
  let headline = locatorHeadline || data.headline || fromOg.headline || fromTitle.headline || '';

  const fromTop = extractHeadlineFromTopCard(data.topCardText, name);
  if (!headline || headline.length < 8) {
    headline = fromTop || headline;
  } else if (fromTop && fromTop.length > headline.length + 20 && fromTop.length < 240) {
    headline = fromTop;
  }
  headline = sanitizeHeadline(headline, name);

  let about = data.about || '';
  let experience = data.experience || '';
  const education = data.education || '';
  let company =
    cleanCompanyName(data.company || '') ||
    companyFromAtPhrase(data.jobTitle || '') ||
    companyFromAtPhrase(headline);
  let jobTitle = cleanRoleTitle(data.jobTitle || '', { name, company });
  const location = data.location || '';

  if (!jobTitle && headline) {
    jobTitle = cleanRoleTitle(headline.split('|')[0], { name, company }) || headline.split('|')[0].trim().slice(0, 70);
  }

  console.log(`[profile] ——— ${slug} ———`);
  console.log(`[profile] name      : ${name || '(empty)'}`);
  console.log(`[profile] headline  : ${headline ? headline.slice(0, 160) : '(empty)'}`);
  console.log(`[profile] jobTitle  : ${jobTitle || '(empty)'}`);
  console.log(`[profile] company   : ${company || '(empty)'}`);
  console.log(`[profile] location  : ${location || '(empty)'}`);
  console.log(
    `[profile] about     : ${
      about
        ? `${about.length} chars — ${about.slice(0, 100)}…`
        : `(empty, section=${data.aboutFound ? 'found' : 'missing'})`
    }`
  );
  console.log(
    `[profile] experience: ${
      experience
        ? `${experience.length} chars — ${experience.slice(0, 100)}…`
        : `(empty, section=${data.expFound ? 'found' : 'missing'})`
    }`
  );
  console.log(`[profile] education : ${education ? education.slice(0, 80) : '(empty)'}`);
  if (!headline && data.topCardText) {
    console.warn(`[profile] WARN topCard raw: ${data.topCardText.slice(0, 220)}`);
  }
  if (!about && !experience && data.bodySnippet) {
    console.warn(`[profile] WARN body snippet: ${data.bodySnippet.slice(0, 280)}`);
  }

  return {
    profileUrl,
    name: name || '',
    headline: headline || '',
    location,
    company,
    jobTitle,
    about,
    experience,
    education,
    topCardText: data.topCardText || '',
    scrapedAt: new Date().toISOString(),
  };
}

module.exports = {
  scrapeProfile,
  dismissOverlays,
  parseNameFromTitle,
  sanitizeHeadline,
  shortRolePhrase,
  extractHeadlineFromTopCard,
  collapseStutter,
  cleanCompanyName,
  cleanRoleTitle,
  companyFromAtPhrase,
};
