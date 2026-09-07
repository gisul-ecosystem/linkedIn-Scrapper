/**
 * Build LinkedIn search URLs and collect profile links from search results.
 */

const CONNECTION_TYPES = {
  all_connections: {
    label: 'All my connections',
    description: 'Every 1st-degree connection on your account',
  },
  connections_search: {
    label: 'Search within my connections',
    description: 'Filter your existing connections by keyword',
  },
  first_degree: {
    label: '1st-degree connections (People search)',
    description: 'LinkedIn people search — only people you are connected with',
  },
  second_degree: {
    label: '2nd-degree connections',
    description: 'Friends of friends — not yet connected',
  },
  third_degree: {
    label: '3rd+ degree',
    description: 'Extended network beyond 2nd degree',
  },
  all_linkedin: {
    label: 'All of LinkedIn',
    description: 'Broad people search (any connection level)',
  },
};

const NETWORK_MAP = {
  all_connections: ['F'],
  connections_search: ['F'],
  first_degree: ['F'],
  second_degree: ['S'],
  third_degree: ['O'],
  all_linkedin: [],
};

function hasSearchFilters(filters) {
  return !!(filters.keywords || filters.title || filters.company || filters.location);
}

/** When keywords are set, never use the unfiltered connections list. */
function resolveConnectionType(filters) {
  const type = filters.connectionType || 'all_connections';
  if (type === 'all_connections' && hasSearchFilters(filters)) {
    return 'connections_search';
  }
  return type;
}

function buildSearchUrl(filters) {
  const type = resolveConnectionType(filters);
  if (type === 'all_connections') {
    return 'https://www.linkedin.com/mynetwork/invite-connect/connections/';
  }

  const params = new URLSearchParams();
  const keywords = [filters.keywords, filters.title, filters.company, filters.location]
    .filter(Boolean)
    .join(' ')
    .trim();
  if (keywords) params.set('keywords', keywords);

  const network = NETWORK_MAP[type];
  if (network && network.length) {
    params.set('network', JSON.stringify(network));
  }
  params.set('origin', type === 'connections_search' ? 'MEMBER_PROFILE_CANNED_SEARCH' : 'GLOBAL_SEARCH_HEADER');

  return `https://www.linkedin.com/search/results/people/?${params.toString()}`;
}

function matchesFilters(item, filters, { trustLinkedInKeywords = false } = {}) {
  const haystack = `${item.listName || ''} ${item.headline || ''} ${item.subtitle || ''} ${item.cardText || ''}`.toLowerCase();

  const matchTerm = (needle) => {
    if (!needle) return true;
    const term = String(needle).toLowerCase().trim();
    if (haystack.includes(term)) return true;
    // match each word: "Cloud Trainer" matches if both words appear
    const words = term.split(/\s+/).filter(Boolean);
    if (words.length > 1 && words.every((w) => haystack.includes(w))) return true;
    if (term.endsWith('s') && haystack.includes(term.slice(0, -1))) return true;
    if (haystack.includes(`${term}s`)) return true;
    return false;
  };

  const keywordOk = trustLinkedInKeywords ? true : matchTerm(filters.keywords);

  return (
    keywordOk &&
    matchTerm(filters.title) &&
    matchTerm(filters.company) &&
    matchTerm(filters.location)
  );
}

module.exports = {
  CONNECTION_TYPES,
  buildSearchUrl,
  matchesFilters,
  NETWORK_MAP,
  hasSearchFilters,
  resolveConnectionType,
};
