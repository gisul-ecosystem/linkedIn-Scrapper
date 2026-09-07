/** @deprecated Use linkedin-auth.js — kept for CLI message scripts */
const { STORAGE_STATE_PATH } = require('./config');
const linkedin = require('./linkedin-auth');

async function ensureLoggedIn(page, context, opts = {}) {
  return linkedin.ensureLinkedInLoggedIn(page, context, STORAGE_STATE_PATH, opts);
}

module.exports = {
  ensureLoggedIn,
  isLoggedIn: linkedin.isLoggedIn,
  waitForManualLogin: linkedin.waitForManualLogin,
};
