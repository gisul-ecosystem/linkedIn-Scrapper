const { runScrapeJob } = require('./scrape-job');

const LOCAL_USER = 'local';

async function main() {
  const filters = {
    connectionType: process.env.CONNECTION_TYPE || 'connections_search',
    keywords: process.env.SEARCH_KEYWORDS || '',
    title: process.env.SEARCH_TITLE || '',
    company: process.env.SEARCH_COMPANY || '',
    location: process.env.SEARCH_LOCATION || '',
    maxResults: Number(process.env.MAX_CONNECTIONS || 0) || 50,
    startIndex: Number(process.env.START_INDEX || 0),
    sendMessages: String(process.env.SEND_MESSAGES || 'false').toLowerCase() === 'true',
  };
  await runScrapeJob(LOCAL_USER, filters);
}

main().catch((err) => {
  console.error('[error]', err.message);
  process.exit(1);
});
