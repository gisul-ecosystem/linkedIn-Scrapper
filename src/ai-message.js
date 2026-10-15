const {
  ANTHROPIC_API_KEY,
  CLAUDE_MODEL,
  OPENAI_API_KEY,
  OPENAI_MODEL,
  AI_CONFIDENCE_MIN_SCORE,
} = require('./config');
const { getProduct, listProducts, parseProductIds } = require('./products');
const { firstName } = require('./utils');
const { retrieveForProfile } = require('./rag/index');
const {
  sanitizeHeadline,
  cleanCompanyName,
  cleanRoleTitle,
  companyFromAtPhrase,
} = require('./profile');

const BANNED_PHRASE_RE =
  /i(?:'m| am) reaching out because|reaching out to explore|i came across|noticed your profile|i noticed|would love to|i wanted to|we are a leading provider|exciting opportunity|synergies|potential alignment|your work stands out|caught my attention|customised upskilling programs|customized upskilling programs|looking forward to connecting|let me know your thoughts|i(?:'d| would) be happy to|\bcertainly\b|\babsolutely\b|\bleverag(?:e|es|ing)\b|\bsynergi[sz]e\b|\bholistic\b|\bseamless(?:ly)?\b/i;

function isCSuite(profile) {
  const text = profileBlob(profile).toLowerCase();
  return /\b(ceo|cto|cio|coo|cfo|chro|clo|founder|co-founder|owner|managing director|\bmd\b|president|vp\b|vice president|chief )\b/i.test(
    text
  );
}

function signOff(profile) {
  return isCSuite(profile) ? 'Cheers,\nSahil Goyal\nFounder & CEO, Gisul' : 'Cheers,\nSahil';
}

function detectGeography(profile) {
  const text = profileBlob(profile).toLowerCase();
  if (/\b(malaysia|kuala lumpur|selangor|penang)\b/.test(text)) return 'malaysia';
  if (/\b(singapore)\b/.test(text)) return 'singapore';
  if (/\b(uae|dubai|abu dhabi|sharjah|middle east)\b/.test(text)) return 'uae';
  if (/\b(south africa|johannesburg|cape town)\b/.test(text)) return 'south_africa';
  if (/\b(united states|usa|u\.s\.|new york|california|texas|seattle|boston)\b/.test(text)) {
    return 'usa';
  }
  if (/\b(india|bengaluru|bangalore|mumbai|hyderabad|chennai|delhi|pune|noida)\b/.test(text)) {
    return 'india';
  }
  return 'unknown';
}

function gisulComboLine(ids) {
  const set = new Set(ids);
  if (set.has('kanonkode') && set.has('aaptor')) {
    return 'At Gisul we run KanonKode for team upskilling and Aaptor for AI assessments, and they work well together.';
  }
  if (set.has('racko') && set.has('kanonkode')) {
    return 'At Gisul we run Racko, our own private cloud, and KanonKode for team upskilling. You can use either one or both.';
  }
  if (set.has('racko') && set.has('aaptor')) {
    return 'At Gisul we run Racko, our own private cloud, and Aaptor for AI hiring assessments. You can use either one or both.';
  }
  const names = ids.map((id) => getProduct(id)?.name || id);
  return `At Gisul we run ${names.join(' and ')}. You can use either one or both.`;
}

/**
 * Named-client proof from geography-proof.md anchors.
 * Returns a short noun phrase of client names when possible.
 * Regional fallbacks are full noun phrases that already contain "across" —
 * never prepend "including" to those (see proofIncluding / fallback templates).
 */
function proofFor(productId, geo) {
  const g = geo || 'india';
  if (productId === 'racko') {
    if (g === 'india') return 'Manipal Global and StratiformAI';
    // No named Racko clients outside India in knowledge — regional NP only
    return 'EdTech and enterprise clients across Asia and the Middle East';
  }
  if (productId === 'kanonkode') {
    if (g === 'malaysia') return 'RHB Bank, PTPTN Malaysia, and Virtual Calibre';
    if (g === 'singapore') return 'Aventis Learning Group, Changi Group, and National Insurance Singapore';
    if (g === 'uae') return 'TechMantra Gulf and SIG Combibloc Obeikan FZCO';
    if (g === 'usa') return 'Y&L Consulting, Kalopsee, and Meridian Technology';
    if (g === 'south_africa') return 'Praxis Computing';
    return 'Dassault Systèmes, Sigmoid, and FinCare Small Finance Bank';
  }
  if (productId === 'aaptor') {
    return 'Sutherland and Graymatter';
  }
  return 'Sutherland and Dassault Systèmes';
}

/** True when proof is already a regional clause (do not glue "including" in front). */
function isRegionalProof(proof) {
  return /\bacross\b/i.test(String(proof || ''));
}

/** "including X" only when X is a named-client list. */
function proofIncluding(proof) {
  const p = String(proof || '').trim();
  if (!p) return '';
  if (isRegionalProof(p)) return p;
  return `including ${p}`;
}

function resolveProductFromParsed(parsed) {
  let ids = parseProductIds(parsed.productIds);
  if (!ids.length) ids = parseProductIds(parsed.productId);
  if (!ids.length) ids = parseProductIds(String(parsed.brands || '').replace(/NO FIT/i, ''));
  if (!ids.length) return null;
  return getProduct(ids.join('+'));
}

function buildFallbackMessage(profile, productId, { relevant = true, reason } = {}) {
  if (!relevant) {
    return {
      relevant: false,
      productId: null,
      productName: null,
      productUrl: null,
      productIds: [],
      brands: 'NO FIT',
      confidence: 'Low',
      relevanceScore: 0,
      reason: reason || 'Not a clear product fit',
      matchSignals: [],
      message: '',
      rag: null,
    };
  }

  const product = getProduct(productId) || listProducts()[0];
  const name = firstName(profile.name) || 'there';
  const company =
    cleanCompanyName(profile.company || '') ||
    companyFromAtPhrase(profile.jobTitle || profile.headline || '') ||
    'your organisation';
  const geo = detectGeography(profile);
  const ids = product.productIds || parseProductIds(product.id);
  const primary = ids[0] || product.id;
  const proof = proofFor(primary, geo);
  const urlLine =
    ids.length > 1
      ? ids.map((id) => getProduct(id)?.url).filter(Boolean).join('\n')
      : product.url;

  let body;
  if (ids.length >= 3) {
    const stackProof = isRegionalProof(proof)
      ? `A lot of ${proof} already use them.`
      : `${proof} already use them.`;
    body = `Hi ${name}, hope you're doing well.

Quick one. At Gisul we run three things: Racko for private cloud, KanonKode for team upskilling and Aaptor for AI hiring assessments. You can use any one of them, or all together. ${stackProof}

Thought it might be relevant as ${company} grows. Free for a quick chat this week?

${signOff(profile)}`;
  } else if (ids.length === 2) {
    const comboProof = isRegionalProof(proof)
      ? `A lot of ${proof} already use them.`
      : `${proof} already use both.`;
    body = `Hi ${name}, hope you're doing well.

Quick one. ${gisulComboLine(ids)} ${comboProof}

Thought it might fit what you're building at ${company}. Free for a quick chat this week?

${urlLine}

${signOff(profile)}`;
  } else if (primary === 'racko') {
    const rackoProof = isRegionalProof(proof) ? `A lot of ${proof}` : `Teams like ${proof}`;
    body = `Hi ${name}, hope you're doing well.

Quick one. We run Racko (racko.ai) at Gisul, it's our own private cloud on our own hardware. ${rackoProof} moved onto it and now pay a fixed monthly cost instead of an AWS or Azure bill that keeps growing.

Thought it might be worth a look for ${company}. Free for a quick chat this week?

${signOff(profile)}`;
  } else if (primary === 'kanonkode') {
    body = `Hi ${name}, hope you're doing well.

Quick one. We run KanonKode (kanonkode.com) at Gisul, mostly AI and tech upskilling for enterprise teams, online and in person. Teams at ${proof} use us for it.

If upskilling is on the cards at ${company} this year, want me to send over how we run it?

${signOff(profile)}`;
  } else {
    const aaptorProof = isRegionalProof(proof) ? `A lot of ${proof} use it` : `${proof} use it`;
    body = `Hi ${name}, hope you're doing well.

Quick one. We built Aaptor (aaptor.com) at Gisul to take first-round screening off recruiters' plates. It runs the AI voice interview and skill test, so your team only talks to the shortlisted people. ${aaptorProof} for their hiring right now.

Could save ${company} a lot of hours. Open to a quick demo this week?

${signOff(profile)}`;
  }

  return {
    relevant: true,
    productId: product.id,
    productName: product.name,
    productUrl: product.url,
    productIds: ids,
    brands: product.name,
    confidence: 'Medium',
    relevanceScore: 70,
    reason: reason || 'Heuristic match from headline/about/experience keywords',
    matchSignals: ['heuristic'],
    message: body,
    rag: null,
  };
}

function cleanProfileForAi(profile) {
  const headline = sanitizeHeadline(profile.headline || '', profile.name);
  const company =
    cleanCompanyName(profile.company || '') ||
    companyFromAtPhrase(profile.jobTitle || headline) ||
    '';
  const jobTitle =
    cleanRoleTitle(profile.jobTitle || headline.split('|')[0] || '', {
      name: profile.name,
      company,
    }) || headline.split('|')[0].trim();
  return {
    ...profile,
    headline,
    jobTitle,
    company,
  };
}

function profileBlob(profile) {
  return [
    profile.name,
    profile.headline,
    profile.about,
    profile.company,
    profile.jobTitle,
    profile.experience,
    profile.education,
    profile.location,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Pitch-matrix heuristic — returns product id or combined "a+b(+c)".
 */
function heuristicProductId(profile) {
  const text = profileBlob(profile).toLowerCase();

  const junior =
    /\b(intern|trainee|associate|assistant|executive|coordinator|student|alumni|admission officer)\b/.test(
      text
    ) && !/\b(head|chief|director|vp|vice|manager|lead|founder|ceo|cto|chro|clo)\b/.test(text);

  const ceo =
    /\b(ceo|founder|co-founder|coo|managing director|owner|president)\b/.test(text) &&
    !/\b(assistant to|ea to)\b/.test(text);
  const ctoInfra =
    /\b(cto|cio|devops|sre|infrastructure|cloud architect|platform eng|sysadmin|it head|head of it|vp technology|vp engineering|digital transformation)\b/.test(
      text
    );
  const ld =
    /\b(l&d|lnd|learning officer|chief learning|head of learning|training manager|training head|corporate training|people development|organizational development|\bod\b|upskilling|capability building)\b/.test(
      text
    );
  const chroClo = /\b(chro|clo|chief human|chief people|chief learning|head of hr|hr director)\b/.test(
    text
  );
  const ta =
    /\b(talent acquisition|ta head|recruiter|recruiting|staffing|rpo|hiring manager|talent partner)\b/.test(
      text
    );
  const edtech = /\b(ed-?tech|edtech|training platform|e-?learning|learning platform)\b/.test(text);
  const bpoAi = /\b(bpo|kpo|gcc|global capability|ai company|artificial intelligence)\b/.test(text);
  const startup = /\b(startup|start-up|growth.?stage|seed|series [abc])\b/.test(text);
  const rackoHard =
    /\b(bare metal|kubernetes|gpu|data center|hosting|vps|private cloud|iaas)\b/.test(text);

  if (junior && !chroClo && !ctoInfra && !ld && !ta && !ceo) return null;

  if (ceo) return 'racko+kanonkode+aaptor';
  if (ctoInfra && edtech) return 'racko+kanonkode';
  if (ctoInfra && startup) return 'racko+aaptor';
  if (/\b(digital transformation|vp technology|vice president.?technology)\b/.test(text)) {
    return 'racko+kanonkode';
  }
  if ((ld || chroClo) && bpoAi) return 'kanonkode+aaptor';
  if (chroClo) return 'kanonkode+aaptor';
  if (ta && !ld) return 'aaptor';
  if (ld) return 'kanonkode';
  if (ctoInfra || rackoHard) return 'racko';
  if (ta) return 'aaptor';

  return null;
}

function systemPrompt() {
  return `You write LinkedIn first-messages on behalf of Sahil Goyal, Founder & CEO of Gisul Software Services — global enterprise AI, upskilling, and cloud infrastructure (Bengaluru). Gisul has 100+ active clients across India, USA, UAE, Malaysia, Singapore, South Africa, and beyond. All three platforms are live, in production, and work standalone or integrated.

## THREE PLATFORMS
1) Racko (https://racko.ai/) — Managed private cloud & IaaS. Bare metal, VM provisioning, dedicated compute. Gisul owns the hardware — NOT reselling AWS/Azure. 30K+ CPUs, 286TB storage, 193 active services. Clients: Edforce, Unext, TeamLease, Pragati, StratiformAI. Fit: CTOs, IT heads, DevOps, infra managers, EdTech/AI needing dedicated compute.
2) KanonKode (https://kanonkode.com/) — Enterprise tech upskilling: AI literacy, GCC leadership, embedded systems, behavioural workshops, applied L&D. Virtual + in-person. Fit: L&D heads, CHROs, training managers, GCC heads, MNC learning leads.
3) Aaptor (https://aaptor.com/) — AI-powered candidate assessment & interview automation: voice AI interviews, live proctoring, skill assessments, AI competency evaluation. Fit: TA heads, HR tech buyers, recruiters, staffing/RPO, L&D running AI competency programmes.

Integration: KanonKode upskills, Aaptor evaluates/certifies, Racko runs infra. Pitch standalone by default. Combine only when role genuinely owns more than one problem. Never pitch all three unless CEO/Founder/COO with clear ownership of all decisions.

## GEOGRAPHY PROOF (always lead with closest reference; NEVER open with India clients for non-India connections)
India EdTech: Manipal Global, upGrad, TeamLease, Unext, Edforce, Jigsaw, Intellipaat, CloudThat
India Enterprise: Dassault Systèmes, Sigmoid, Graymatter, StratiformAI
India BFSI: FinCare Small Finance Bank | India BPO: Sutherland, Straive
Malaysia: RHB Bank, PTPTN Malaysia, DB Solve, Virtual Calibre
Singapore: Aventis Learning Group (anchor), Changi Group, National Insurance Singapore
UAE: TechMantra Gulf (anchor), SIG Combibloc Obeikan FZCO
USA: Y&L Consulting, Kalopsee, Meridian Technology, PBI Lab
South Africa: Praxis Computing
Pick client closest to recipient industry AND geography; else use geography anchor.

## PITCH MATRIX
- IT Head / CTO / DevOps Lead → racko
- L&D Head / Training Manager → kanonkode
- TA Head / Recruiter / Staffing → aaptor
- L&D Head at BPO or AI company → kanonkode+aaptor
- CHRO / CLO at large enterprise or GCC → kanonkode+aaptor
- CTO at EdTech or training platform → racko+kanonkode
- CTO at growth-stage startup → racko+aaptor
- Head of Digital Transformation / VP Technology → racko+kanonkode
- CEO / Founder / COO → racko+kanonkode+aaptor (ecosystem)
Do NOT proceed for junior roles with no budget/authority, or no genuine fit.

Ignore LinkedIn UI junk (Contact info, Message, Book an appointment, mutual connections, Hiring widgets).

## OUTPUT — JSON only
{
  "brands": "Racko | KanonKode | Aaptor | KanonKode + Aaptor | ... | NO FIT",
  "fitReason": "one sentence",
  "confidence": "High|Medium|Low",
  "proceed": true|false,
  "relevant": true|false,
  "productId": "racko"|"kanonkode"|"aaptor"|"kanonkode+aaptor"|"racko+kanonkode"|"racko+aaptor"|"racko+kanonkode+aaptor"|null,
  "productIds": ["..."],
  "relevanceScore": 0-100,
  "matchSignals": ["short evidence"],
  "briefMatch": true|false|null,
  "hook": "the concrete profile detail the message opens on",
  "reason": "1-2 sentences (same as fitReason ok)",
  "message": "LinkedIn DM or empty if proceed=false"
}

If proceed=false / NO FIT: relevant=false, message="", productId=null.

## VOICE — Sahil typing a quick LinkedIn note to a peer
It must read like Sahil wrote it himself on his phone in two minutes. Casual, warm, straight to the point. NOT copywriting, NOT an ad, NOT a polished email.
- Talk like a person: contractions (we've, it's, you're), plain everyday words, full normal sentences. Use "I" and "we".
- Start with a real greeting line, the way people actually message: "Hi Priya, hope you're doing well." / "Hey Priya, hope the week's treating you well." / "Hi Priya, hope things are good at Acme." Vary it. A short opener like "Quick one." after the greeting is fine.
- Then just tell them, simply, what we do and why you thought of them. One small, concrete reason. Like you'd say it out loud.
- At most ONE number or stat. No feature lists, no stacked fragments ("Our own hardware. 30K+ CPUs. Fixed cost."), no slogans or taglines ("Bills grow. Control doesn't."), no rhetorical contrasts.
- NEVER use em dashes (—) or en dashes (–). Use commas, full stops, or "and".
- No corporate jargon (leverage, synergy, holistic, robust, seamless, cutting-edge, empower, solutions). No AI phrases (certainly, absolutely, I'd be happy to, delighted, rest assured).
- Warm, confident, never pushy or salesy. Not every sentence needs to be clever.
- Close with one simple, specific ask in casual words: "Free for a quick chat this week?", "Want me to send over how we set it up for Unext?", "Open to a 15 min call sometime this week?". Never vague ("Looking forward to connecting", "Let me know your thoughts").
- Sign-off is relaxed: "Cheers,\nSahil" (see rules below).

## MAKE IT RELEVANT — why them
Before writing, pick ONE concrete hook from the profile and put it in "hook":
- what their company actually does or sells (from experience/about), e.g. "runs a live-class K-12 platform"
- a specific initiative, stack, programme, market or responsibility they mention, e.g. "moved the LMS to Kubernetes", "runs campus hiring for 2,000 freshers"
- a recent move: new role, new company, expansion into a region
Mention that hook casually, as the reason you thought of them ("Saw Acme's been scaling the live classes, so thought of you."). Connect it to ONE problem someone like them actually has. Then one simple line on how we help, with one client name from the closest industry/geography.
Test: if the message would still make sense sent to someone else with the same title, it is too generic. Rewrite it.
Never invent facts about them or their company. If the profile is thin, use their industry plus the operator's targeting brief as the reason.
Banned filler: "at {Company}'s scale", "at some point … become constraints", "probably matter(s) more than", "is usually the hardest", "systems should reinforce each other", "on your roadmap", "in today's fast-paced world".

Problems by industry (use the one that matches them):
- EdTech / online learning infra: admission- and exam-season traffic spikes, live-class/video streaming cost, cloud bills growing with every cohort, student-data residency
- AI / ML companies: GPU availability and cost, dedicated compute without hyperscaler markup
- BFSI / NBFC: data residency and RBI compliance, predictable infra cost; compliance and AI-literacy training at scale
- GCC / MNC: leadership bench for a growing centre, AI-upskilling mandates from HQ
- BPO / KPO: volume hiring, attrition, screening bandwidth, AI-readiness of the floor
- Staffing / RPO: screening throughput, proving candidate quality to clients, proctoring at scale

Example (Racko, CTO at an EdTech live-class platform):
"Hi Priya, hope you're doing well.

Saw Acme's been growing the live-class side a lot, so thought of you. Admission season must be rough on the cloud bill.

We run Racko (racko.ai) at Gisul, our own private cloud. Unext and Edforce moved onto it and now pay a fixed monthly cost instead of a surprise AWS bill every peak.

Free for a quick chat this week? Happy to walk you through how they set it up.

Cheers,
Sahil"

Example (Aaptor, TA head at a BPO):
"Hey Rahul, hope the week's going well.

Quick one. You must be screening a crazy number of people every month at Sutherland-size volumes. We built Aaptor (aaptor.com) at Gisul for exactly that, it runs the first-round voice interview and skill test so your recruiters only talk to the shortlisted ones.

Want me to send over a quick demo link?

Cheers,
Sahil"

## MESSAGE RULES (proceed=true only)
- Under 120 words. Shorter is better. Cut context before cutting the ask.
- Already 1st connections — do NOT re-introduce yourself or mention the connection.
- First line is the greeting: "Hi {FirstName}," or "Hey {FirstName}," plus an optional short pleasantry ("hope you're doing well."). Nothing else on that line.
- NEVER write "{Name}, {Title} at {Company}." or "Hi {Name}, VP at …" — they already know their job. Do not recap title/company as a greeting label.
- You may mention the company in a normal sentence, never as a role dump.
- Never paste raw headline, education, or duplicated employer text (SynechronSynechron, "Jain (Deemed-to-be Univ").
- Sparse profile → skip title recap; use industry or company only inside the pitch. If company is missing, say "your team".
- Single brand: one product, one client name, one problem. Say it simply, e.g. "We run KanonKode at Gisul, it's our tech upskilling platform."
- Combined (two products): one shared problem, said simply, e.g. "At Gisul we run KanonKode for upskilling and Aaptor for AI assessments, and they work well together." Never present them as unrelated brands.
- Ecosystem: "At Gisul we run three things…" said casually, not a list of three separate companies.
- End with ONE simple, specific ask (see VOICE). A short chat or call this week is fine.
- C-suite / VP+: sign off "Cheers,\nSahil Goyal\nFounder & CEO, Gisul"
- Others: "Cheers,\nSahil"
- Include product URL(s) once, naturally (racko.ai / kanonkode.com / aaptor.com).

## NEVER WRITE
"I'm reaching out because/from", "I came across/noticed your profile", "Would love to/I wanted to", "We are a leading provider of", "Exciting opportunity/synergies/potential alignment", "Your work stands out/caught my attention", "Customised upskilling programs", "Reaching out to explore", "I noticed", "Looking forward to connecting", "Let me know your thoughts", "I'd be happy to", "Certainly", "Absolutely", "leverage", "holistic", "seamless", em dashes (—), duplicated company names, university/education fragments in the opener, "{Name}, {Title} at {Company}."`;
}

function allowedProductsBlock(allowed) {
  if (!allowed?.length) return '';
  const names = allowed.map((id) => `${getProduct(id)?.name || id} (${id})`).join(', ');
  return `## Products selected for this run
Only these may be pitched: ${names}. Never mention or pitch any other Gisul platform.
Apply the pitch matrix restricted to these products (e.g. a CEO normally gets all three — pitch only the selected ones).
If the person is not a genuine fit for a selected product, set proceed=false.

`;
}

/** Operator's "who to target" brief per product — a hard filter plus the message angle. */
function targetingBriefBlock(briefs) {
  const entries = Object.entries(briefs || {}).filter(([, text]) => text);
  if (!entries.length) return '';
  const lines = entries
    .map(([id, text]) => `- ${getProduct(id)?.name || id} (${id}): ${text}`)
    .join('\n');
  return `## Operator's targeting brief (HARD FILTER)
${lines}
A product with a brief may only be pitched if this person matches that brief — check their company type, industry and role against it using the profile. Not a match → do not pitch that product (proceed=false if nothing else fits). Set "briefMatch" to true/false for the product you pitch (null if it has no brief).
When it matches, write the message from the brief's angle: the pain should be the one a person like the brief describes actually has.

`;
}

/** Operator's "message framing" per product — the point the message must lead with. */
function framingBlock(framing) {
  const entries = Object.entries(framing || {}).filter(([, text]) => text);
  if (!entries.length) return '';
  const lines = entries
    .map(([id, text]) => `- ${getProduct(id)?.name || id} (${id}): ${text}`)
    .join('\n');
  return `## Operator's message framing (THE MAIN POINT of the message)
${lines}
When you pitch a product listed here, build the message around this point. It goes right after the greeting, tied to why you thought of this person, then one client name, then the ask. Keep its meaning exactly, but say it in Sahil's casual voice and fix any spelling or grammar (the operator typed it quickly). Don't paste it word for word if it reads awkwardly. Never add claims it doesn't make (no dates, prices or offers that aren't in it).

`;
}

function userPrompt(profile, rag, allowed = null, briefs = {}, framing = {}) {
  const p = cleanProfileForAi(profile);
  const geo = detectGeography(p);
  return `${allowedProductsBlock(allowed)}${targetingBriefBlock(briefs)}${framingBlock(framing)}## Product knowledge (RAG — facts/URLs only)
${rag.contextBlock || '(none)'}

## Cleaned LinkedIn profile
Name: ${p.name || '(empty)'}
Headline: ${p.headline || '(empty)'}
Job title: ${p.jobTitle || '(empty)'}
Company: ${p.company || '(empty)'}
Location: ${p.location || '(empty)'}
Detected geography hint: ${geo}
About: ${(p.about || '(empty)').slice(0, 1400)}
Experience: ${(p.experience || '(empty)').slice(0, 1600)}
Education: ${p.education || '(empty)'}
Profile URL: ${p.profileUrl || ''}

## Task
Step 1: Fit assessment (brands, fitReason, confidence, proceed) — including the targeting brief, if any.
Step 2: Apply pitch matrix → productId / productIds.
Step 3: Pick the hook — the most specific detail in this profile.
Step 4: If proceed, write the LinkedIn first-message per MAKE IT SPECIFIC and MESSAGE RULES. If No — empty message.`;
}

function parseJsonContent(raw) {
  const text = String(raw || '').trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : text;
  return JSON.parse(body);
}

function wordCount(s) {
  return String(s || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

const TITLE_DUMP_RE =
  /\b(VP|SVP|EVP|AVP|CEO|CTO|CIO|COO|CFO|CHRO|CLO|CPO|CXO|Head|Director|Manager|Founder|President|Vice President|Lead|Specialist|Officer|Partner|Consultant|Training)\b/i;

/**
 * Kill role-dump openers:
 * - "Somashekar, VP at Bellfast Management."
 * - "Mitesh — Training Manager, HSBC"
 * - "Hi Sanjana, Head of TA, Acme"
 */
function stripRoleDumpOpener(message, profile) {
  const name = firstName(profile?.name);
  if (!name) return String(message || '').trim();
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const text = String(message || '').trim();
  const nl = text.search(/\r?\n/);
  const first = (nl === -1 ? text : text.slice(0, nl)).trim();
  const rest = nl === -1 ? '' : text.slice(nl).replace(/^\s+/, '\n\n');
  const addressesThem = new RegExp(`^(?:(?:Hi|Hey|Hello)\\s+)?${escaped}\\b`, 'i').test(first);
  // Name then title via "at", em/en dash, hyphen, or comma (not only "at")
  const nameThenTitleSep = new RegExp(
    `^(?:(?:Hi|Hey|Hello)\\s+)?${escaped}\\s*[,:—–-]\\s*.+`,
    'i'
  );
  const hasTitleSeparator =
    /\bat\b/i.test(first) ||
    /[—–]/.test(first) ||
    nameThenTitleSep.test(first);
  const looksLikeTitleDump =
    first.length <= 100 &&
    addressesThem &&
    TITLE_DUMP_RE.test(first) &&
    hasTitleSeparator &&
    !/\?/.test(first) &&
    !/\b(hope|quick one|scale|hiring|volumes|building|running|capability|infrastructure|worth|interested|happy to)\b/i.test(
      first
    );

  if (!looksLikeTitleDump) return text;
  return `Hi ${name},${rest || '\n\n'}`.replace(/\n{3,}/g, '\n\n').trim();
}

const GENERIC_FILLER_RE =
  /\bat [^.\n]{1,40}'s (?:scale|hiring volumes)\b|\bat some point\b[^.\n]*\bconstraints?\b|\bprobably matters? more than\b|\bis usually the hardest\b|\breinforce each other\b|\bon your roadmap\b|\bfast-paced\b/i;

/** Strip LinkedIn UI junk + role-dump opener, ensure sign-off. No fallbacks. */
function cleanOutbound(message, profile) {
  let msg = String(message || '').trim();
  if (!msg) return '';

  msg = msg
    .replace(/^```(?:\w+)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .replace(/^"([\s\S]*)"$/, '$1')
    .replace(/\bContact info\b[\s\S]*?(?=\n\n|$)/gi, '')
    .replace(/\bBook an appointment\b/gi, '')
    .replace(/\b\d+\+?\s*connections\b/gi, '')
    .replace(/\bmutual connections\b/gi, '')
    .replace(/\bHiring:[\s\S]*?(?=\n\n|$)/gi, '')
    .replace(/\bShow job\b/gi, '')
    .replace(/\bHighlights\b/gi, '')
    // Em/en dashes read as AI-written — drop them from sign-offs, commas elsewhere
    .replace(/^[—–-]\s*(?=Sahil)/gm, '')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  msg = stripRoleDumpOpener(msg, profile);
  if (msg && !/Sahil/i.test(msg)) msg = `${msg}\n\n${signOff(profile)}`;
  return msg.slice(0, 1200);
}

/** What's wrong with a draft, or '' if it's sendable. */
function messageIssue(msg, { forbiddenProducts = [], maxWords = 120 } = {}) {
  if (!msg) return 'The draft is empty — write the message.';
  const banned = msg.match(BANNED_PHRASE_RE);
  if (banned) return `It uses the banned phrase "${banned[0]}" — remove it.`;
  const filler = msg.match(GENERIC_FILLER_RE);
  if (filler) {
    return `It uses generic filler ("${filler[0]}") — replace it with something specific to this person's company or work.`;
  }
  const leaked = forbiddenProducts.filter((p) =>
    new RegExp(`\\b${p.name}\\b|${p.url.replace(/^https?:\/\//, '').replace(/\/$/, '').replace(/\./g, '\\.')}`, 'i').test(msg)
  );
  if (leaked.length) {
    return `It mentions ${leaked.map((p) => p.name).join(', ')}, which is not selected for this run — remove every mention and pitch only the selected product(s).`;
  }
  const wc = wordCount(msg);
  if (wc > maxWords) return `It is ${wc} words — cut it to under 120 (cut context before the CTA).`;
  return '';
}

/** One targeted AI fix of a draft (generic, too long, banned phrase, wrong product). */
async function rewriteMessage(draft, issue, { profile, product, brief, framing, hook, useClaude }) {
  const p = cleanProfileForAi(profile);
  const system =
    "You fix LinkedIn first-messages written for Sahil Goyal, CEO of Gisul. Return ONLY the corrected message text — no JSON, no quotes, no commentary.";
  const user = `Fix this LinkedIn DM. Problem: ${issue}

Keep: a casual greeting first line ("Hi ${firstName(p.name) || 'there'}, hope you're doing well."), one specific reason you thought of them, one problem, ${product.name} as something we run at Gisul (${product.url.replace(/\n/g, ', ')}), one client name, ONE simple specific ask (e.g. "Free for a quick chat this week?"), and the sign-off:
${signOff(p)}
Under 120 words. Never invent facts. No "I came across", "I noticed", "I wanted to", "would love to", "at X's scale".
Voice: Sahil typing a quick note to a peer on his phone. Casual, warm, plain words, contractions, normal full sentences. It must NOT read like copywriting or an AI: no slogans, no stacked fragments, no feature lists, at most one number, no em dashes. No jargon (leverage, holistic, seamless), no AI phrases (certainly, absolutely, I'd be happy to), no bullet points.

Person: ${p.name || ''} — ${p.jobTitle || p.headline || ''}${p.company ? ` at ${p.company}` : ''}${p.location ? ` (${p.location})` : ''}
${hook ? `Hook to use: ${hook}\n` : ''}${brief ? `Operator's targeting brief: ${brief}\n` : ''}${framing ? `Main point the message must lead with (keep its meaning, casual wording): ${framing}\n` : ''}
DRAFT:
${draft}`;

  const raw = useClaude ? await callClaude(system, user) : await callOpenAICompress(system, user);
  return String(raw || '').trim();
}

/** OpenAI without forcing JSON (compression returns plain text). */
async function callOpenAICompress(system, user) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.2,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI compress ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

async function callClaude(system, user) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1200,
      temperature: 0.35,
      system: [
        {
          type: 'text',
          text: system,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: user }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Claude ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  return data.content?.map((c) => c.text || '').join('\n') || '';
}

async function callOpenAI(system, user) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.35,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || '{}';
}

function logAiInput(profile) {
  const p = cleanProfileForAi(profile);
  console.log('[ai] ——— input to model ———');
  console.log(`[ai] name     : ${p.name || '(empty)'}`);
  console.log(`[ai] headline : ${(p.headline || '(empty)').slice(0, 160)}`);
  console.log(`[ai] location : ${p.location || '(empty)'} | geo=${detectGeography(p)}`);
  console.log(`[ai] about    : ${p.about ? `${p.about.length} chars` : '(empty)'}`);
  console.log(`[ai] experience: ${p.experience ? `${p.experience.length} chars` : '(empty)'}`);
  console.log(`[ai] heuristic guess: ${heuristicProductId(p) || 'none'}`);
}

function looksLikeEmptyProfileComplaint(reason) {
  return /no headline|no about|no experience|empty profile|lacks sufficient|no work experience|cannot determin|no professional/i.test(
    String(reason || '')
  );
}

function formatDecision(parsed, product, score) {
  const brands = parsed.brands || product?.name || 'NO FIT';
  const confidence = parsed.confidence || (score >= 80 ? 'High' : score >= 65 ? 'Medium' : 'Low');
  console.log(`[ai] brands=${brands} confidence=${confidence} proceed=${parsed.proceed !== false}`);
}

/**
 * @param {object} profile
 * @param {{ allowedProducts?: string[], productContext?: Record<string, string>, productFraming?: Record<string, string> }} [opts]
 * allowedProducts — product ids selected for this run; empty = all products.
 * productContext — operator's "who to target" brief per product id (hard filter + message angle).
 * productFraming — operator's main point per product id (e.g. "we're launching Racko").
 */
async function generateOutreachMessage(
  profile,
  { allowedProducts = [], productContext = {}, productFraming = {} } = {}
) {
  const cleaned = cleanProfileForAi(profile);
  const allowed = parseProductIds([].concat(allowedProducts || []).join(','));
  const restricted = allowed.length > 0 && allowed.length < listProducts().length;
  const restrictIds = (ids) => (restricted ? ids.filter((id) => allowed.includes(id)) : ids);
  const keepSelected = (texts) => {
    const out = {};
    for (const [id, text] of Object.entries(texts || {})) {
      if (text && (!restricted || allowed.includes(id))) out[id] = String(text).trim();
    }
    return out;
  };
  const briefs = keepSelected(productContext);
  const framings = keepSelected(productFraming);
  const briefFor = (ids) => ids.map((id) => briefs[id]).filter(Boolean).join(' / ');
  const framingFor = (ids) => ids.map((id) => framings[id]).filter(Boolean).join(' / ');

  const heuristicIds = restrictIds(parseProductIds(heuristicProductId(cleaned)));
  const heuristicFirst = heuristicIds.join('+') || null;
  const preferProducts = heuristicIds.length ? heuristicIds : restricted ? allowed : [];
  const rag = retrieveForProfile(cleaned, { preferProducts });
  const system = systemPrompt();
  const user = userPrompt(cleaned, rag, restricted ? allowed : null, briefs, framings);
  logAiInput(cleaned);

  const hasClaude = Boolean(ANTHROPIC_API_KEY);
  const hasOpenAI = Boolean(OPENAI_API_KEY);

  if (!hasClaude && !hasOpenAI) {
    if (!heuristicFirst) {
      return buildFallbackMessage(cleaned, null, {
        relevant: false,
        reason: 'No AI key and no heuristic product fit',
      });
    }
    console.log(`[ai] no API key — heuristic → ${heuristicFirst}`);
    const fallback = buildFallbackMessage(cleaned, heuristicFirst);
    fallback.rag = { builtAt: rag.builtAt, chunks: rag.chunks.map((c) => c.id) };
    return fallback;
  }

  try {
    console.log(`[ai] calling ${hasClaude ? 'claude' : 'openai'}…`);
    const raw = hasClaude ? await callClaude(system, user) : await callOpenAI(system, user);
    const parsed = parseJsonContent(raw);

    const proceed = parsed.proceed !== false && parsed.relevant !== false;
    let score = Number(parsed.relevanceScore || 0);
    let product = resolveProductFromParsed(parsed);

    // Enforce the run's product selection even if the model ignored it
    let outOfScope = null;
    let narrowed = false;
    if (product && restricted) {
      const ids = product.productIds || parseProductIds(product.id);
      const kept = restrictIds(ids);
      if (!kept.length) {
        outOfScope = product.name;
        product = null;
      } else if (kept.length < ids.length) {
        product = getProduct(kept.join('+'));
        narrowed = true;
      }
    }

    // A product with a targeting brief the person doesn't match is a skip
    let briefMiss = false;
    if (product && parsed.briefMatch === false && briefFor(product.productIds || parseProductIds(product.id))) {
      briefMiss = true;
      product = null;
    }

    // Heuristic can't check a targeting brief, so no override when one is set
    if (
      (!proceed || !product) &&
      heuristicFirst &&
      !briefMiss &&
      !briefFor(heuristicIds) &&
      looksLikeEmptyProfileComplaint(parsed.reason || parsed.fitReason)
    ) {
      console.warn(`[ai] empty-profile false negative — heuristic=${heuristicFirst}`);
      const fallback = buildFallbackMessage(cleaned, heuristicFirst, {
        reason: `Heuristic override (strong signals): ${String(parsed.reason || parsed.fitReason || '').slice(0, 120)}`,
      });
      fallback.relevanceScore = Math.max(score, 72);
      fallback.rag = {
        builtAt: rag.builtAt,
        topChunks: rag.chunks.map((c) => ({ id: c.id, productId: c.productId, score: c.score })),
      };
      console.log(`[ai] decision: relevant=true product=${heuristicFirst} score=${fallback.relevanceScore}`);
      return fallback;
    }

    if (!proceed || score < AI_CONFIDENCE_MIN_SCORE || !product) {
      formatDecision({ ...parsed, proceed: false }, null, score);
      const skipReason = briefMiss
        ? `Doesn't match targeting brief. ${parsed.reason || parsed.fitReason || ''}`
        : outOfScope
        ? `Fits ${outOfScope} — not a selected product. ${parsed.reason || parsed.fitReason || ''}`
        : String(parsed.reason || parsed.fitReason || 'Below relevance threshold or no product fit');
      console.log(`[ai] decision: relevant=false score=${score} reason=${skipReason.slice(0, 140)}`);
      return {
        relevant: false,
        productId: null,
        productName: null,
        productUrl: null,
        productIds: [],
        brands: parsed.brands || 'NO FIT',
        confidence: parsed.confidence || 'Low',
        relevanceScore: score,
        reason: skipReason.trim().slice(0, 400),
        matchSignals: Array.isArray(parsed.matchSignals) ? parsed.matchSignals.slice(0, 8) : [],
        message: '',
        rag: {
          builtAt: rag.builtAt,
          preferProducts,
          topChunks: rag.chunks.map((c) => ({ id: c.id, productId: c.productId, score: c.score })),
        },
      };
    }

    const productIds = product.productIds || parseProductIds(product.id);
    const forbiddenProducts = listProducts().filter((p) => !productIds.includes(p.id));
    const hook = String(parsed.hook || '').trim();
    if (hook) console.log(`[ai] hook: ${hook.slice(0, 160)}`);

    let message = cleanOutbound(parsed.message, cleaned);
    let issue = messageIssue(message, { forbiddenProducts });
    if (narrowed && !issue) {
      issue = `Pitch only ${product.name} — remove every other Gisul platform.`;
    }

    // Fix problems with a targeted rewrite instead of dropping to a generic template
    for (let attempt = 1; issue && attempt <= 2; attempt++) {
      console.warn(`[ai] draft issue (rewrite ${attempt}): ${issue}`);
      try {
        const rewritten = await rewriteMessage(message, issue, {
          profile: cleaned,
          product,
          brief: briefFor(productIds),
          framing: framingFor(productIds),
          hook,
          useClaude: hasClaude,
        });
        message = cleanOutbound(rewritten, cleaned);
        issue = messageIssue(message, { forbiddenProducts });
      } catch (rewriteErr) {
        console.warn(`[ai] rewrite failed: ${rewriteErr.message}`);
        break;
      }
    }

    // 120–140 words is tolerable; anything else still wrong → template
    if (issue && (messageIssue(message, { forbiddenProducts, maxWords: 140 }) || !message)) {
      console.warn(
        `[ai] still not sendable (${issue}) — template for ${product.id}${framingFor(productIds) ? ' (framing not in template)' : ''}`
      );
      message = buildFallbackMessage(cleaned, product.id).message;
    }

    formatDecision(parsed, product, score);
    console.log(
      `[ai] decision: relevant=true product=${product.id} score=${score} msgChars=${message.length} words≈${wordCount(message)}`
    );

    return {
      relevant: true,
      productId: product.id,
      productName: product.name,
      productUrl: product.url,
      productIds: product.productIds || parseProductIds(product.id),
      brands: parsed.brands || product.name,
      confidence: parsed.confidence || (score >= 80 ? 'High' : 'Medium'),
      relevanceScore: score,
      reason: String(parsed.reason || parsed.fitReason || '').slice(0, 400),
      matchSignals: Array.isArray(parsed.matchSignals) ? parsed.matchSignals.slice(0, 8) : [],
      hook: hook || null,
      message,
      rag: {
        builtAt: rag.builtAt,
        preferProducts,
        topChunks: rag.chunks.map((c) => ({ id: c.id, productId: c.productId, score: c.score })),
      },
    };
  } catch (err) {
    console.warn(`[ai] error: ${err.message}`);
    const heuristic = heuristicFirst;
    if (!heuristic) {
      return buildFallbackMessage(cleaned, null, {
        relevant: false,
        reason: `AI error: ${err.message}`,
      });
    }
    console.log(`[ai] decision: relevant=true product=${heuristic} (error fallback)`);
    const fallback = buildFallbackMessage(cleaned, heuristic, {
      reason: `AI error fallback: ${err.message}`,
    });
    fallback.rag = { builtAt: rag.builtAt, error: err.message };
    return fallback;
  }
}

module.exports = { generateOutreachMessage, heuristicProductId, buildFallbackMessage };
