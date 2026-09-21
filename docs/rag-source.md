# RAG + product catalog — single source dump

How outreach RAG is built and retrieved in this repo.

- Knowledge files live in `knowledge/*.md` (not `rag/data/`).
- `retrieveForProfile` loads those via `src/rag/documents.js`, embeds with hashed bag-of-words (`src/rag/embed.js`), and returns top-K cosine chunks as `rag.contextBlock`.
- `RAG_MIN_SCORE` is **not** used inside RAG retrieval. Cosine scores are ~0–1. `RAG_MIN_SCORE` (default **60**) is applied in `src/ai-message.js` against the **model’s** `relevanceScore` (0–100).
- Catalog IDs/URLs/names for pitching come from `src/products.js`.

---

## 1. Knowledge sources (`knowledge/`)

`loadKnowledgeDocuments()` reads **every `*.md` in `knowledge/`**. Filename stem (lowercased) becomes `productId` (`racko.md` → `racko`, `geography-proof.md` → `geography-proof`).

Chunking: paragraphs joined until ~700 chars, overlap 80 on long paragraphs; chunks shorter than 40 chars dropped.

### `knowledge/racko.md`

```md
# Racko — Product Knowledge

URL: https://racko.ai/
Product ID: racko
Company: Gisul Software Services (Founder & CEO: Sahil Goyal)

## What Racko is

Racko is Gisul’s managed private cloud & IaaS platform. Bare metal infrastructure, VM provisioning, dedicated compute, remote infrastructure management. Gisul owns the hardware — not reselling AWS or Azure. Works standalone or integrated with KanonKode and Aaptor.

## Scale and proof

- 30,000+ CPUs provisioned across EdTech and AI clients
- 286TB storage
- 193 active services
- Serves clients globally from Bengaluru-based Gisul (100+ active clients across India, USA, UAE, Malaysia, Singapore, South Africa)

## Confirmed clients

Edforce, Unext, TeamLease, Pragati, StratiformAI. Expanding to NBFCs, hospitals, logistics.

## Geography proof points (use closest to recipient)

- India EdTech / Training: Manipal Global Education, upGrad, TeamLease, Unext, Edforce, Jigsaw Academy, Intellipaat, CloudThat
- India Enterprise tech: Dassault Systèmes, Sigmoid, Graymatter, StratiformAI
- UAE / Singapore / Asia-ME: reference global footprint — 30K+ CPUs across EdTech and enterprise clients across Asia and the Middle East (do not lead with India-only names for non-India contacts)

## Ideal buyers

CTOs, IT heads, DevOps leads, infrastructure managers, EdTech and AI companies needing dedicated compute.

## Pitch matrix (Racko)

- IT Head / CTO / DevOps Lead → Racko only
- CTO at EdTech or training platform → Racko + KanonKode
- CTO at growth-stage startup → Racko + Aaptor
- Head of Digital Transformation / VP Technology → Racko + KanonKode
- CEO / Founder / COO → full ecosystem when they own all decisions

## Not a fit

Junior roles with no budget/authority; pure L&D or TA buyers with no infra ownership.
```

### `knowledge/kanonkode.md`

```md
# KanonKode — Product Knowledge

URL: https://kanonkode.com/
Product ID: kanonkode
Company: Gisul Software Services (Founder & CEO: Sahil Goyal)

## What KanonKode is

KanonKode is Gisul’s enterprise tech upskilling platform — AI literacy, GCC leadership development, embedded systems, behavioural workshops, applied L&D. Delivered virtually and in-person globally. Works standalone or integrated with Aaptor (evaluate/certify) and Racko (infra).

## Scale

100+ active clients across India, Malaysia, Singapore, UAE, USA, South Africa.

## Ideal buyers

L&D heads, CHROs, training managers, GCC heads, MNC learning leads. Sectors: BFSI, FMCG, BPO, EdTech, automotive, defence, enterprise tech.

## Geography proof points (ALWAYS lead with closest geography — never open with India clients for non-India connections)

### India
- Enterprise tech: Dassault Systèmes, Sigmoid, Graymatter, StratiformAI
- BFSI: FinCare Small Finance Bank
- BPO / Services: Sutherland, Straive
- EdTech / Training: Manipal Global, upGrad, TeamLease, Unext, Edforce

### Malaysia
RHB Bank, PTPTN Malaysia, DB Solve, Virtual Calibre Sdn Bhd (anchor sector match: Malaysian banker → RHB Bank)

### Singapore
Aventis Learning Group (anchor), Changi Group, National Insurance Singapore (insurance → National Insurance via Aventis)

### UAE
TechMantra Gulf (anchor), SIG Combibloc Obeikan FZCO (manufacturing → SIG Combibloc via TechMantra)

### USA
Y&L Consulting, Kalopsee Services, Meridian Technology Solutions, PBI Lab

### South Africa
Praxis Computing

## Pitch matrix (KanonKode)

- L&D Head / Training Manager → KanonKode only
- L&D Head at BPO or AI company → KanonKode + Aaptor
- CHRO / CLO at large enterprise or GCC → KanonKode + Aaptor
- CTO at EdTech → Racko + KanonKode
- Head of Digital Transformation / VP Technology → Racko + KanonKode

## Not a fit

Junior HR/sales/ops with no learning budget; pure infra-only buyers.
```

### `knowledge/aaptor.md`

```md
# Aaptor — Product Knowledge

URL: https://aaptor.com/
Product ID: aaptor
Company: Gisul Software Services (Founder & CEO: Sahil Goyal)

## What Aaptor is

Aaptor is Gisul’s AI-powered candidate assessment and interview automation platform — voice AI interviews, live proctoring, skill assessments, AI competency evaluation. Commercial models: per-assessment, SaaS, or custom enterprise. Works standalone or integrated with KanonKode (upskill) and Racko (infra).

## Ideal buyers

TA heads, HR tech buyers, recruiters, staffing and RPO firms, L&D teams running AI competency programmes.

## Proof points / clients (pick by geography + sector)

- India BPO / Services: Sutherland, Straive
- India Enterprise tech: Graymatter, Sigmoid, Dassault Systèmes
- Combined with KanonKode: Sutherland and Sigmoid run training + assessment combinations
- Combined with ecosystem: Sutherland and Dassault Systèmes run across the stack

## Pitch matrix (Aaptor)

- TA Head / Recruiter / Staffing firm → Aaptor only
- L&D Head at BPO or AI company → KanonKode + Aaptor
- CHRO / CLO at large enterprise or GCC → KanonKode + Aaptor
- CTO at growth-stage startup → Racko + Aaptor
- CEO / Founder / COO → full ecosystem when they own hiring + capability + infra decisions

## Problems Aaptor solves

- First-round screening bandwidth vs signal quality at high hiring volumes
- Gap between training completion and measured competency
- Need for voice AI interviews, live proctoring, and competency evaluation

## Not a fit

Junior roles with no hiring/assessment authority; pure infra buyers with no TA/L&D ownership; early-career HR associates without budget influence.
```

### `knowledge/geography-proof.md`

```md
# Geography & sector proof selection rules

Gisul Software Services — Bengaluru. 100+ active clients across India, USA, UAE, Malaysia, Singapore, South Africa. Always lead with the closest geographic reference. Never open with India clients for non-India connections.

## India
- EdTech / Training: Manipal Global Education, upGrad, TeamLease, Unext, Edforce, Jigsaw Academy, Intellipaat, CloudThat
- Enterprise tech: Dassault Systèmes, Sigmoid, Graymatter, StratiformAI
- BFSI: FinCare Small Finance Bank
- BPO / Services: Sutherland, Straive

## Malaysia
RHB Bank, PTPTN Malaysia, DB Solve, Virtual Calibre Sdn Bhd

## Singapore
Aventis Learning Group (anchor), Changi Group, National Insurance Singapore

## UAE
TechMantra Gulf (anchor), SIG Combibloc Obeikan FZCO

## USA
Y&L Consulting, Kalopsee Services, Meridian Technology Solutions, PBI Lab

## South Africa
Praxis Computing

## Selection rule

Pick the client closest to the recipient’s industry AND geography.
- Malaysian banker → RHB Bank
- Singapore insurance → National Insurance Singapore (via Aventis)
- UAE manufacturing → SIG Combibloc via TechMantra
- Indian BFSI → FinCare
- Indian EdTech CTO → Manipal Global or upGrad
- If no exact sector match → use the anchor client for that geography
```

---

## 2. How chunks are selected (`src/rag/`)

### Config (`src/config.js`)

```js
RAG_TTL_MS   // default 86400000 (1 day) — cache TTL for the on-disk index
RAG_TOP_K    // default 4 — how many chunks go into contextBlock
RAG_MIN_SCORE // default 60 — NOT used in retrieveForProfile (see ai-message.js)
```

### `src/rag/documents.js`

```js
const fs = require('fs');
const path = require('path');
const { ROOT } = require('../config');

const KNOWLEDGE_DIR = path.join(ROOT, 'knowledge');

function chunkText(text, { maxChars = 700, overlap = 80 } = {}) {
  const clean = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!clean) return [];

  const paragraphs = clean.split(/\n\n+/);
  const chunks = [];
  let buf = '';

  const push = (content) => {
    const c = content.trim();
    if (c.length >= 40) chunks.push(c);
  };

  for (const para of paragraphs) {
    if ((buf + '\n\n' + para).length <= maxChars) {
      buf = buf ? `${buf}\n\n${para}` : para;
      continue;
    }
    if (buf) push(buf);
    if (para.length <= maxChars) {
      buf = para;
    } else {
      for (let i = 0; i < para.length; i += maxChars - overlap) {
        push(para.slice(i, i + maxChars));
      }
      buf = '';
    }
  }
  if (buf) push(buf);
  return chunks;
}

function loadKnowledgeDocuments() {
  if (!fs.existsSync(KNOWLEDGE_DIR)) return [];

  const files = fs.readdirSync(KNOWLEDGE_DIR).filter((f) => f.endsWith('.md'));
  const docs = [];

  for (const file of files) {
    const productId = path.basename(file, '.md').toLowerCase();
    const full = path.join(KNOWLEDGE_DIR, file);
    const text = fs.readFileSync(full, 'utf8');
    const parts = chunkText(text);
    parts.forEach((content, i) => {
      docs.push({
        id: `${productId}-${i}`,
        productId,
        source: file,
        content,
      });
    });
  }
  return docs;
}

module.exports = { loadKnowledgeDocuments, chunkText, KNOWLEDGE_DIR };
```

### `src/rag/embed.js`

Hashed bag-of-words, dim 384, L2-normalized, cosine = dot product.

```js
const DIM = 384;

function tokenize(text) { /* lowercase, keep a-z0-9+#.- , tokens length > 1 */ }
function hashToken(token) { /* FNV-ish → DIM */ }

function embedText(text) {
  // unigram + 0.5 * bigram hashed into vec, then L2 normalize
}

function cosine(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += a[i] * b[i];
  return s;
}
```

### `src/rag/index.js` — `retrieveForProfile`

```js
function profileToQuery(profile) {
  return [
    profile.name,
    profile.headline,
    profile.jobTitle,
    profile.company,
    profile.location,
    profile.about,
    profile.education,
    profile.experience,
    ...(Array.isArray(profile.experienceList)
      ? profile.experienceList.map((e) => `${e.title || ''} ${e.company || ''} ${e.description || ''}`)
      : []),
  ]
    .filter(Boolean)
    .join(' ')
    .slice(0, 4000);
}

function retrieveForProfile(profile, { topK = RAG_TOP_K, forceRebuild = false } = {}) {
  const index = loadIndex({ forceRebuild });
  const query = profileToQuery(profile);
  const qVec = embedText(query);

  const scored = index.chunks.map((chunk) => ({
    id: chunk.id,
    productId: chunk.productId,
    source: chunk.source,
    content: chunk.content,
    score: cosine(qVec, chunk.embedding),
  }));

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, topK);

  const productScores = {};
  for (const item of top) {
    productScores[item.productId] = (productScores[item.productId] || 0) + item.score;
  }

  return {
    queryPreview: query.slice(0, 200),
    builtAt: index.builtAt,
    fromCache: isFresh(index),
    chunks: top,
    productScores,
    contextBlock: top
      .map(
        (c, i) =>
          `[Chunk ${i + 1} | product=${c.productId} | score=${c.score.toFixed(3)} | ${c.source}]\n${c.content}`
      )
      .join('\n\n---\n\n'),
  };
}
```

Index cache: `data/rag-cache/index.json`, TTL 1 day.

**Selection rule:** embed the profile blob, cosine vs every chunk, take **top 4** (default). No minimum cosine cutoff. Geography-proof chunks compete in the same pool because they are just another `.md`.

### Where `RAG_MIN_SCORE` actually applies (`src/ai-message.js`)

```js
const rag = retrieveForProfile(cleaned);   // always runs; fills user prompt contextBlock
// ... model returns parsed.relevanceScore 0–100 ...
let score = Number(parsed.relevanceScore || 0);
if (!proceed || score < RAG_MIN_SCORE || !product) {
  // relevant=false, empty message
}
```

So: RAG cosine picks **facts for the prompt**. The 0–100 `relevanceScore` from Claude/OpenAI (plus pitch-matrix `productId`) decides whether to send/queue.

---

## 3. `src/products.js` — catalog

Guaranteed on a **single** product (`racko` | `kanonkode` | `aaptor`):

| Field | Required | Notes |
|---|---|---|
| `id` | yes | lowercase key |
| `name` | yes | display name |
| `url` | yes | product site |
| `tagline` | yes | short line |
| `summary` | yes | long blurb |
| `idealFor` | yes | string[] |
| `notIdealFor` | yes | string[] |

`getProduct` also accepts combined keys: `kanonkode+aaptor`, `racko|kanonkode`, `ecosystem` / `full` / `combined` → all three.

Combined object (synthesized, not in `PRODUCTS`):

| Field | Value |
|---|---|
| `id` | ids joined with `+` |
| `name` | `"Racko + KanonKode"` |
| `url` | URLs joined with `\n` |
| `tagline` | taglines joined with `; ` |
| `summary` | summaries concatenated |
| `idealFor` / `notIdealFor` | flattened arrays |
| `combined` | `true` |
| `productIds` | `['racko','kanonkode']` etc. |

`parseProductIds` **drops unknown tokens** (must exist on `PRODUCTS`). Empty / null `getProduct` → `null`.

```js
/**
 * Gisul product catalog — Racko, KanonKode, Aaptor.
 * Edit knowledge/*.md for RAG facts; this file drives matching IDs + UI.
 */

const PRODUCTS = {
  racko: {
    id: 'racko',
    name: 'Racko',
    url: 'https://racko.ai/',
    tagline: 'Managed private cloud & IaaS on owned hardware',
    summary:
      'Racko is Gisul’s managed private cloud & IaaS — bare metal, VM provisioning, dedicated compute, remote infrastructure management. Gisul owns the hardware (not reselling AWS/Azure). 30,000+ CPUs provisioned, 286TB storage, 193 active services. Clients: Edforce, Unext, TeamLease, Pragati, StratiformAI. Best for CTOs, IT heads, DevOps, infra managers, EdTech/AI companies needing dedicated compute.',
    idealFor: [
      'CTO / CIO / IT Head / DevOps Lead / Infrastructure Manager',
      'EdTech and AI companies needing dedicated compute',
      'NBFCs, hospitals, logistics expanding private cloud',
    ],
    notIdealFor: [
      'Pure L&D / TA buyers with no infra ownership',
      'Junior roles with no budget authority',
    ],
  },
  kanonkode: {
    id: 'kanonkode',
    name: 'KanonKode',
    url: 'https://kanonkode.com/',
    tagline: 'Enterprise tech upskilling — AI literacy, GCC leadership, applied L&D',
    summary:
      'KanonKode is Gisul’s enterprise tech upskilling platform — AI literacy, GCC leadership development, embedded systems, behavioural workshops, applied L&D. Virtual and in-person globally. 100+ active clients across India, Malaysia, Singapore, UAE, USA, South Africa. Best for L&D heads, CHROs, training managers, GCC heads, MNC learning leads.',
    idealFor: [
      'L&D Head / Training Manager / CHRO / CLO',
      'GCC heads / MNC learning leads',
      'BFSI, FMCG, BPO, EdTech, automotive, defence, enterprise tech',
    ],
    notIdealFor: [
      'Pure infra buyers with no learning ownership',
      'Junior HR/sales with no training budget',
    ],
  },
  aaptor: {
    id: 'aaptor',
    name: 'Aaptor',
    url: 'https://aaptor.com/',
    tagline: 'AI-powered candidate assessment and interview automation',
    summary:
      'Aaptor is Gisul’s AI-powered candidate assessment and interview automation — voice AI interviews, live proctoring, skill assessments, AI competency evaluation. Models: per-assessment, SaaS, or custom enterprise. Best for TA heads, HR tech buyers, recruiters, staffing/RPO firms, and L&D teams running AI competency programmes.',
    idealFor: [
      'TA Head / Recruiter / Staffing / RPO',
      'HR tech buyers',
      'L&D teams running AI competency programmes',
    ],
    notIdealFor: [
      'Pure infra buyers with no hiring/assessment ownership',
      'Junior roles with no hiring authority',
    ],
  },
};

function listProducts() {
  return Object.values(PRODUCTS);
}

function parseProductIds(idOrIds) {
  if (Array.isArray(idOrIds)) {
    return idOrIds.map((x) => String(x || '').toLowerCase().trim()).filter(Boolean);
  }
  const raw = String(idOrIds || '')
    .toLowerCase()
    .trim();
  if (!raw) return [];
  if (raw === 'ecosystem' || raw === 'full' || raw === 'combined') {
    return ['racko', 'kanonkode', 'aaptor'];
  }
  return raw
    .split(/[+,|/]/)
    .map((s) => s.trim())
    .filter((s) => PRODUCTS[s]);
}

function getProduct(id) {
  if (!id) return null;
  const key = String(id).toLowerCase().trim();
  if (PRODUCTS[key]) return PRODUCTS[key];

  const ids = parseProductIds(key);
  if (!ids.length) return null;
  if (ids.length === 1) return PRODUCTS[ids[0]];

  const products = ids.map((i) => PRODUCTS[i]).filter(Boolean);
  return {
    id: ids.join('+'),
    name: products.map((p) => p.name).join(' + '),
    url: products.map((p) => p.url).join('\n'),
    tagline: products.map((p) => p.tagline).join('; '),
    summary: products.map((p) => p.summary).join(' '),
    idealFor: products.flatMap((p) => p.idealFor),
    notIdealFor: products.flatMap((p) => p.notIdealFor),
    combined: true,
    productIds: ids,
  };
}

function productsPromptBlock() {
  return listProducts()
    .map(
      (p) =>
        `### ${p.name} (${p.id})\nURL: ${p.url}\n${p.tagline}\n${p.summary}\nIdeal for: ${p.idealFor.join('; ')}\nNot ideal for: ${p.notIdealFor.join('; ')}`
    )
    .join('\n\n');
}

module.exports = {
  PRODUCTS,
  listProducts,
  getProduct,
  parseProductIds,
  productsPromptBlock,
};
```

---

## File map

| Path | Role |
|---|---|
| `knowledge/racko.md` | RAG source |
| `knowledge/kanonkode.md` | RAG source |
| `knowledge/aaptor.md` | RAG source |
| `knowledge/geography-proof.md` | RAG source (`productId=geography-proof`) |
| `src/rag/documents.js` | load + chunk |
| `src/rag/embed.js` | local embeddings |
| `src/rag/index.js` | `retrieveForProfile` → `contextBlock` |
| `src/products.js` | IDs, names, URLs for pitch/UI |
| `src/ai-message.js` | uses RAG context; gates on `RAG_MIN_SCORE` vs model `relevanceScore` |
| `data/rag-cache/index.json` | generated cache (not a source) |
