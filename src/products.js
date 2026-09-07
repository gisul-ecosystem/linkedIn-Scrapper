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
