const fs = require("fs");
const path = require("path");

const SID = /^[A-Za-z0-9_-]{1,64}$/;

function isValidSid(sid) {
  return !!sid && SID.test(sid);
}

function loadFavoriteOrder(p) {
  try { const a = JSON.parse(fs.readFileSync(p, "utf-8")); return Array.isArray(a) ? a : []; }
  catch (e) { return []; }
}
function loadFavorites(p) {
  return new Set(loadFavoriteOrder(p));
}
function saveFavoriteOrder(p, arr) {
  fs.writeFileSync(p, JSON.stringify(arr));
}
function toggleFavorite(p, sid) {
  const a = loadFavoriteOrder(p);
  const i = a.indexOf(sid);
  let added;
  if (i >= 0) { a.splice(i, 1); added = false; } else { a.push(sid); added = true; }
  saveFavoriteOrder(p, a);
  return added;
}
function moveFavorite(p, sid, dir) {
  const a = loadFavoriteOrder(p);
  const i = a.indexOf(sid);
  if (i < 0) return false;
  const j = i + (dir < 0 ? -1 : 1);
  if (j < 0 || j >= a.length) return false;
  const t = a[i]; a[i] = a[j]; a[j] = t;
  saveFavoriteOrder(p, a);
  return true;
}

function loadTrashMeta(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch (e) { return {}; }
}
function saveTrashMeta(p, d) {
  fs.writeFileSync(p, JSON.stringify(d));
}

function deleteSession(file, sid, trashDir, metaPath) {
  if (!isValidSid(sid)) return false;
  try { fs.mkdirSync(trashDir, { recursive: true }); } catch (e) {}
  const dest = path.join(trashDir, path.basename(sid) + ".jsonl");
  try {
    fs.renameSync(file, dest);
  } catch (e) {
    try { fs.copyFileSync(file, dest); fs.unlinkSync(file); } catch (e2) { return false; }
  }
  const meta = loadTrashMeta(metaPath);
  meta[sid] = { session_id: sid, origin: file, deleted_at: Date.now() / 1000 };
  saveTrashMeta(metaPath, meta);
  return true;
}

function restoreSession(sid, trashDir, metaPath) {
  if (!isValidSid(sid)) return false;
  const meta = loadTrashMeta(metaPath);
  const info = meta[sid];
  if (!info) return false;
  const projRoot = path.resolve(path.dirname(trashDir));
  const dest = path.resolve(info.origin);
  if (!(dest === projRoot || dest.startsWith(projRoot + path.sep))) return false;
  const src = path.join(trashDir, path.basename(sid) + ".jsonl");
  if (fs.existsSync(dest)) return false;
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(src, dest);
  } catch (e) { return false; }
  delete meta[sid];
  saveTrashMeta(metaPath, meta);
  return dest;
}

function listTrash(metaPath) {
  return Object.values(loadTrashMeta(metaPath)).sort(
    (a, b) => (b.deleted_at || 0) - (a.deleted_at || 0));
}

function renameSession(file, sid, title) {
  fs.appendFileSync(file,
    JSON.stringify({ type: "custom-title", customTitle: title, sessionId: sid }) + "\n", "utf-8");
  return true;
}

module.exports = { isValidSid, loadFavorites, loadFavoriteOrder, toggleFavorite, moveFavorite,
  deleteSession, restoreSession, listTrash, renameSession };
