const {
  ANTHROPIC_API_KEY,
  CLAUDE_MODEL,
  OPENAI_API_KEY,
  OPENAI_MODEL,
  RAG_MIN_SCORE,
} = require('./config');
const { getProduct, listProducts, parseProductIds } = require('./products');
const { firstName } = require('./utils');
const { retrieveForProfile } = require('./rag/index');
const { sanitizeHeadline, shortRolePhrase } = require('./profile');

const BANNED_PHRASE_RE =
  /i hope you(?:'re| are) doing (?:great|well)|i(?:'m| am) reaching out because|reaching out to explore|i came across|noticed your profile|i noticed|would love to|i wanted to|we are a leading provider|exciting opportunity|synergies|potential alignment|your work stands out|caught my attention|customised upskilling programs|customized upskilling programs/i;

function isCSuite(profile) {
  const text = profileBlob(profile).toLowerCase();
  return /\b(ceo|cto|cio|coo|cfo|chro|clo|founder|co-founder|owner|managing director|\bmd\b|president|vp\b|vice president|chief )\b/i.test(
    text
  );
}

function signOff(profile) {
  return isCSuite(profile) ? '— Sahil Goyal | CEO, Gisul' : '— Sahil, Gisul';
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

function proofFor(productId, geo) {
  const g = geo || 'india';
  if (productId === 'racko') {
    if (g === 'india') return 'Manipal Global and StratiformAI';
    return 'EdTech and enterprise clients across Asia and the Middle East';
  }
  if (productId === 'kanonkode') {
    if (g === 'malaysia') return 'RHB Bank, PTPTN Malaysia, and Virtual Calibre';
    if (g === 'singapore') return 'Aventis Learning Group, Changi Group, and National Insurance Singapore';
    if (g === 'uae') return 'TechMantra Gulf and SIG Combibloc Obeikan FZCO';
    if (g === 'usa') return 'Y&L Consulting and enterprise teams across the US';
    if (g === 'south_africa') return 'Praxis Computing';
    return 'Dassault Systèmes, Sigmoid, and FinCare Small Finance Bank';
  }
  if (productId === 'aaptor') {
    return 'Sutherland and Graymatter';
  }
  return 'Sutherland and Dassault Systèmes';
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
  const company = (profile.company || '').trim() || 'your organisation';
  const role = shortRolePhrase(profile);
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
    body = `Hi ${name}, scaling ${company} — at some point infra, team capability, and hiring pipeline all become constraints simultaneously.

Gisul runs an integrated stack: Racko for private cloud infrastructure, KanonKode for enterprise upskilling, Aaptor for AI-driven assessments and hiring. Each works standalone — or as one system. ${proof} run across the stack.

Worth a conversation?

${signOff(profile)}`;
  } else if (ids.length === 2) {
    const [a, b] = ids.map((id) => getProduct(id)?.name || id);
    body = `Hi ${name}, at ${company}'s scale — ${role} usually means more than one system that should reinforce each other.

${a} and ${b} work standalone or integrated. ${proof} are already running this combination.

Happy to share how it's structured. Interested?

${urlLine}

${signOff(profile)}`;
  } else if (primary === 'racko') {
    body = `Hi ${name}, running compute infrastructure for ${company} at scale — dedicated resource control and uptime probably matter more than hyperscaler flexibility at this point.

Racko (racko.ai) is Gisul's managed private cloud — we own the hardware, 30K+ CPUs provisioned across EdTech and AI clients including ${proof}. Not reselling AWS or Azure.

Happy to show you what the setup looks like. Worth a quick exchange?

${signOff(profile)}`;
  } else if (primary === 'kanonkode') {
    body = `Hi ${name}, building capability at ${company} — AI literacy and applied tech upskilling are usually the hardest programmes to find the right delivery partner for.

KanonKode (kanonkode.com) is Gisul's enterprise upskilling platform — delivered virtually and in-person. Running programmes for ${proof} teams.

If this is on your roadmap, happy to share what's worked.

${signOff(profile)}`;
  } else {
    body = `Hi ${name}, at ${company}'s hiring volumes, first-round screening likely takes far more bandwidth than the signal it generates.

Aaptor (aaptor.com) is Gisul's AI interview and assessment platform — voice AI interviews, live proctoring, competency evaluation. Running for ${proof}'s hiring programmes right now.

Worth a quick exchange to see if it fits your current setup?

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
  const jobTitle =
    sanitizeHeadline(profile.jobTitle || '', profile.name) || headline.split('|')[0].trim();
  return {
    ...profile,
    headline,
    jobTitle,
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
  "reason": "1-2 sentences (same as fitReason ok)",
  "message": "LinkedIn DM or empty if proceed=false"
}

If proceed=false / NO FIT: relevant=false, message="", productId=null.

## MESSAGE RULES (proceed=true only)
- Under 120 words. Cut context before cutting CTA.
- Already 1st connections — do NOT re-introduce or mention the connection.
- Open with something specific from profile (sector, company scale, role, initiative). Sparse profile → industry + role + company size.
- Single brand: one product, one geo/sector proof point, one pain.
- Combined: one shared problem, two tools — not two pitches back-to-back.
- Ecosystem: one integrated system — not three products listed separately.
- NEVER ask for a call in the first message. End with low-friction question or "happy to share more."
- C-suite / VP+: sign off "— Sahil Goyal | CEO, Gisul"
- Others: "— Sahil, Gisul"
- Include product URL(s) naturally (racko.ai / kanonkode.com / aaptor.com).
- Peer-to-peer, informed, direct. Not salesy.

## NEVER WRITE
"I hope you are doing great/well", "I'm reaching out because/from", "I came across/noticed your profile", "Would love to/I wanted to", "We are a leading provider of", "Exciting opportunity/synergies/potential alignment", "Your work stands out/caught my attention", "Customised upskilling programs", "Reaching out to explore", "I noticed".`;
}

function userPrompt(profile, rag) {
  const p = cleanProfileForAi(profile);
  const geo = detectGeography(p);
  return `## Product knowledge (RAG — facts/URLs only)
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
Step 1: Fit assessment (brands, fitReason, confidence, proceed).
Step 2: Apply pitch matrix → productId / productIds.
Step 3: If proceed, write the LinkedIn first-message per FINAL rules and sample tone. If No — empty message.`;
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

function sanitizeOutboundMessage(message, profile, product) {
  let msg = String(message || '').trim();
  if (!msg) return '';

  msg = msg
    .replace(/\bContact info\b[\s\S]*?(?=\n\n|$)/gi, '')
    .replace(/\bBook an appointment\b/gi, '')
    .replace(/\b\d+\+?\s*connections\b/gi, '')
    .replace(/\bmutual connections\b/gi, '')
    .replace(/\bHiring:[\s\S]*?(?=\n\n|$)/gi, '')
    .replace(/\bShow job\b/gi, '')
    .replace(/\bHighlights\b/gi, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (BANNED_PHRASE_RE.test(msg) || /Contact info|Book an appointment|mutual connections|Hiring:/i.test(msg)) {
    return buildFallbackMessage(profile, product?.id || 'kanonkode').message;
  }

  // Soft trim if wildly over ~120 words
  if (wordCount(msg) > 140) {
    return buildFallbackMessage(profile, product?.id || 'kanonkode').message;
  }

  if (!/Sahil/i.test(msg)) {
    msg = `${msg}\n\n${signOff(profile)}`;
  }

  return msg.slice(0, 1200);
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

async function generateOutreachMessage(profile) {
  const cleaned = cleanProfileForAi(profile);
  const rag = retrieveForProfile(cleaned);
  const system = systemPrompt();
  const user = userPrompt(cleaned, rag);
  logAiInput(cleaned);

  const hasClaude = Boolean(ANTHROPIC_API_KEY);
  const hasOpenAI = Boolean(OPENAI_API_KEY);
  const heuristicFirst = heuristicProductId(cleaned);

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

    if ((!proceed || !product) && heuristicFirst && looksLikeEmptyProfileComplaint(parsed.reason || parsed.fitReason)) {
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

    if (!proceed || score < RAG_MIN_SCORE || !product) {
      formatDecision({ ...parsed, proceed: false }, null, score);
      console.log(
        `[ai] decision: relevant=false score=${score} reason=${String(parsed.reason || parsed.fitReason || '').slice(0, 140)}`
      );
      return {
        relevant: false,
        productId: null,
        productName: null,
        productUrl: null,
        productIds: [],
        brands: parsed.brands || 'NO FIT',
        confidence: parsed.confidence || 'Low',
        relevanceScore: score,
        reason: String(parsed.reason || parsed.fitReason || 'Below relevance threshold or no product fit').slice(
          0,
          400
        ),
        matchSignals: Array.isArray(parsed.matchSignals) ? parsed.matchSignals.slice(0, 8) : [],
        message: '',
        rag: {
          builtAt: rag.builtAt,
          topChunks: rag.chunks.map((c) => ({ id: c.id, productId: c.productId, score: c.score })),
        },
      };
    }

    const message = sanitizeOutboundMessage(parsed.message, cleaned, product);
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
      message,
      rag: {
        builtAt: rag.builtAt,
        topChunks: rag.chunks.map((c) => ({ id: c.id, productId: c.productId, score: c.score })),
      },
    };
  } catch (err) {
    console.warn(`[ai] error: ${err.message}`);
    const heuristic = heuristicProductId(cleaned);
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
