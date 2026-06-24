const os = require("os");
const path = require("path");

function configDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
}
function projectsDir() {
  return path.join(configDir(), "projects");
}
function indexCache() {
  return path.join(configDir(), "csm-index.json");
}
function favPath() {
  return path.join(configDir(), "csm-fav.json");
}
function trashMeta() {
  return path.join(configDir(), "csm-trash.json");
}
function trashDir() {
  return path.join(projectsDir(), "_trash");
}
function sessionsDir() {
  return path.join(configDir(), "sessions");
}
function codexIndexCache() {
  return path.join(configDir(), "csm-codex-index.json");
}

module.exports = { configDir, projectsDir, indexCache, favPath, trashMeta, trashDir, sessionsDir, codexIndexCache };
