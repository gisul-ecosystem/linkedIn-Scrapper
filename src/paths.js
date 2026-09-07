const path = require('path');
const { OUT_DIR, AUTH_DIR } = require('./config');
const { ensureDirs } = require('./utils');

function userPaths(userId = 'local') {
  const safeId = String(userId).replace(/[^a-zA-Z0-9-_]/g, '') || 'local';
  const userAuthDir = path.join(AUTH_DIR, safeId);
  const userOutDir = path.join(OUT_DIR, safeId);
  ensureDirs(userAuthDir, userOutDir);

  return {
    userId: safeId,
    linkedinSession: path.join(userAuthDir, 'linkedin-session.json'),
    progress: path.join(userOutDir, 'connections-progress.json'),
    excel: path.join(userOutDir, 'connections.xlsx'),
    outDir: userOutDir,
  };
}

module.exports = { userPaths };
