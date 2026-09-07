require('dotenv').config();

const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'output');
const AUTH_DIR = path.join(ROOT, '.auth');
const STORAGE_STATE_PATH = path.join(AUTH_DIR, 'storage-state.json');
const PROGRESS_PATH = path.join(OUT_DIR, 'connections-progress.json');

const HEADLESS = String(process.env.HEADLESS || 'false').toLowerCase() === 'true';
const ACTION_DELAY_MS = Math.max(500, Number(process.env.ACTION_DELAY_MS || 2500));
const MAX_CONNECTIONS = Number(process.env.MAX_CONNECTIONS || 0);
const START_INDEX = Math.max(0, Number(process.env.START_INDEX || 0));
const SEND_MESSAGES = String(process.env.SEND_MESSAGES || 'false').toLowerCase() === 'true';
const SKIP_ALREADY_MESSAGED =
  String(process.env.SKIP_ALREADY_MESSAGED || 'true').toLowerCase() === 'true';
const FOLLOWUP_DAYS = Math.max(1, Number(process.env.FOLLOWUP_DAYS || 7));

const LINKEDIN_EMAIL = process.env.LINKEDIN_EMAIL || '';
const LINKEDIN_PASSWORD = process.env.LINKEDIN_PASSWORD || '';

const CONNECTIONS_URL =
  process.env.CONNECTIONS_URL ||
  'https://www.linkedin.com/mynetwork/invite-connect/connections/';

const PORT = Number(process.env.PORT || 6363);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929';
const AI_MESSAGES = String(process.env.AI_MESSAGES || 'true').toLowerCase() === 'true';
const RAG_TTL_MS = Math.max(60_000, Number(process.env.RAG_TTL_MS || 24 * 60 * 60 * 1000)); // 1 day
const RAG_TOP_K = Math.max(1, Number(process.env.RAG_TOP_K || 4));
const RAG_MIN_SCORE = Math.max(0, Number(process.env.RAG_MIN_SCORE || 60));
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
const MONGODB_DB = process.env.MONGODB_DB || 'linkedin_scrapper';

// LinkedIn outbound pacing
const DAILY_SEND_LIMIT = Math.max(1, Number(process.env.DAILY_SEND_LIMIT || 60));
const SEND_BATCH_SIZE = Math.max(1, Number(process.env.SEND_BATCH_SIZE || 20));
const SEND_BATCH_PAUSE_MS = Math.max(
  0,
  Number(process.env.SEND_BATCH_PAUSE_MS || 10 * 60 * 1000)
);
const SEND_DAY_TZ = process.env.SEND_DAY_TZ || 'Asia/Kolkata';

module.exports = {
  ROOT,
  OUT_DIR,
  AUTH_DIR,
  STORAGE_STATE_PATH,
  PROGRESS_PATH,
  HEADLESS,
  ACTION_DELAY_MS,
  MAX_CONNECTIONS,
  START_INDEX,
  SEND_MESSAGES,
  SKIP_ALREADY_MESSAGED,
  FOLLOWUP_DAYS,
  LINKEDIN_EMAIL,
  LINKEDIN_PASSWORD,
  CONNECTIONS_URL,
  LOGIN_URL: 'https://www.linkedin.com/login',
  FEED_URL: 'https://www.linkedin.com/feed/',
  PORT,
  OPENAI_API_KEY,
  OPENAI_MODEL,
  ANTHROPIC_API_KEY,
  CLAUDE_MODEL,
  AI_MESSAGES,
  RAG_TTL_MS,
  RAG_TOP_K,
  RAG_MIN_SCORE,
  MONGODB_URI,
  MONGODB_DB,
  DAILY_SEND_LIMIT,
  SEND_BATCH_SIZE,
  SEND_BATCH_PAUSE_MS,
  SEND_DAY_TZ,
};