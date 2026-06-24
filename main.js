const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
let autoUpdater;
try { ({ autoUpdater } = require("electron-updater")); } catch (e) {}
const paths = require("./lib/paths");
const indexer = require("./lib/indexer");
const transcript = require("./lib/transcript");
const store = require("./lib/store");
const cleanup = require("./lib/cleanup");

let INDEX = [];

function reindex() {
  INDEX = indexer.buildIndex(paths.projectsDir(), paths.indexCache());
  return INDEX;
}

function bySid(sid) {
  return INDEX.find((r) => r.session_id === sid);
}

function listSessions(o) {
  o = o || {};
  const favs = store.loadFavorites(paths.favPath());
  const running = indexer.runningSessions(paths.sessionsDir());
  const now = Date.now() / 1000;
  let rows = INDEX.map((r) => {
    const rn = running[r.session_id];
    return {
      ...r,
      favorite: favs.has(r.session_id),
      cleanup: cleanup.isCleanupCandidate(r, favs, now),
      running: !!rn,
      title: rn && rn.name ? rn.name : r.title,
    };
  });
  const search = (o.search || "").toLowerCase();
  if (search) {
    rows = rows.filter((r) =>
      (r.title || "").toLowerCase().includes(search) ||
      (r.first_prompt || "").toLowerCase().includes(search));
  }
  if (o.project) rows = rows.filter((r) => r.project === o.project);
  if (o.favorites) rows = rows.filter((r) => r.favorite);
  if (o.cleanup) rows = rows.filter((r) => r.cleanup);
  const sort = o.sort || "recent";
  rows.sort((a, b) => {
    if (sort === "name") return (a.title || "").localeCompare(b.title || "");
    if (sort === "msg_desc") return b.msg_count - a.msg_count;
    if (sort === "msg_asc") return a.msg_count - b.msg_count;
    return (b.last_activity || 0) - (a.last_activity || 0);
  });
  const total = rows.length;
  rows = rows.slice(0, 200);
  const projects = [...new Set(INDEX.map((r) => r.project))].sort();
  return { sessions: rows, total, shown: rows.length, projects };
}

function spawnNewCmd(sid, opts) {
  spawn("cmd.exe", ["/c", "start", "", "cmd", "/k", "claude", "-r", sid],
    Object.assign({ detached: true, stdio: "ignore" }, opts)).unref();
}

function openInCmd(sid, cwd) {
  if (!store.isValidSid(sid)) return { ok: false, message: "invalid session id" };
  const dir = cwd && fs.existsSync(cwd) ? cwd : undefined;
  const opts = dir ? { cwd: dir } : {};
  try {
    if (process.platform === "win32") {
      const wtArgs = ["-w", "0", "nt", "--title", sid];
      if (dir) wtArgs.push("-d", dir);
      wtArgs.push("cmd", "/k", "claude", "-r", sid);
      const wt = spawn("wt.exe", wtArgs, Object.assign({ detached: true, stdio: "ignore" }, opts));
      wt.on("error", () => { try { spawnNewCmd(sid, opts); } catch (e) {} });
      wt.unref();
    } else if (process.platform === "darwin") {
      const sh = (dir ? "cd '" + dir.replace(/'/g, "'\\''") + "' && " : "") + "claude -r " + sid;
      const osa = 'tell application "Terminal" to do script "' +
        sh.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
      spawn("osascript", ["-e", "tell application \"Terminal\" to activate", "-e", osa],
        { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("claude", ["-r", sid], Object.assign({ detached: true, stdio: "ignore" }, opts)).unref();
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, message: String(e) };
  }
}

function register() {
  ipcMain.handle("list", (e, o) => listSessions(o));
  ipcMain.handle("refresh", () => { reindex(); return listSessions({}); });
  ipcMain.handle("transcript", (e, sid) => {
    const r = bySid(sid);
    if (!r) return { messages: [] };
    return { messages: transcript.loadTranscript(r.file_path) };
  });
  ipcMain.handle("favorite", (e, sid) =>
    ({ favorite: store.toggleFavorite(paths.favPath(), sid) }));
  ipcMain.handle("rename", (e, { sid, title }) => {
    const running = indexer.runningSessions(paths.sessionsDir());
    if (running[sid]) {
      return { ok: false, message: "지금 실행 중인 세션이라 이름이 유지되지 않아요.\n그 세션 창에서 바꾸거나, 세션을 닫은 뒤 다시 시도하세요." };
    }
    const r = bySid(sid);
    if (r) {
      store.renameSession(r.file_path, sid, title);
      const u = indexer.parseSession(r.file_path);
      u.project = r.project;
      Object.assign(r, u);
    }
    return { ok: !!r };
  });
  ipcMain.handle("delete", (e, sid) => {
    const r = bySid(sid);
    const ok = r && store.deleteSession(r.file_path, sid, paths.trashDir(), paths.trashMeta());
    if (ok) INDEX = INDEX.filter((x) => x.session_id !== sid);
    return { ok: !!ok, message: ok ? "" : "삭제 실패 (세션이 실행 중이거나 잠겨 있을 수 있어요)" };
  });
  ipcMain.handle("restore", (e, sid) => {
    const dest = store.restoreSession(sid, paths.trashDir(), paths.trashMeta());
    if (dest) {
      const u = indexer.parseSession(dest);
      u.project = indexer.projectOf(paths.projectsDir(), dest);
      INDEX.push(u);
    }
    return { ok: !!dest };
  });
  ipcMain.handle("cleanup-delete", () => {
    const favs = store.loadFavorites(paths.favPath());
    const now = Date.now() / 1000;
    const cands = INDEX.filter((r) => cleanup.isCleanupCandidate(r, favs, now));
    const delIds = new Set();
    for (const r of cands) {
      if (store.deleteSession(r.file_path, r.session_id, paths.trashDir(), paths.trashMeta())) {
        delIds.add(r.session_id);
      }
    }
    INDEX = INDEX.filter((r) => !delIds.has(r.session_id));
    return { deleted: delIds.size, candidates: cands.length };
  });
  ipcMain.handle("delete-many", (e, sids) => {
    const running = indexer.runningSessions(paths.sessionsDir());
    const del = new Set();
    let skipped = 0;
    for (const sid of sids || []) {
      if (running[sid]) { skipped++; continue; }
      const r = bySid(sid);
      if (r && store.deleteSession(r.file_path, sid, paths.trashDir(), paths.trashMeta())) {
        del.add(sid);
      } else skipped++;
    }
    INDEX = INDEX.filter((r) => !del.has(r.session_id));
    return { deleted: del.size, skipped };
  });
  ipcMain.handle("trash", () => ({ items: store.listTrash(paths.trashMeta()) }));
  ipcMain.handle("open", (e, sid) => {
    const r = bySid(sid);
    return openInCmd(sid, r && r.cwd);
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200, height: 800, title: "세션매니저", backgroundColor: "#0f1115",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true, nodeIntegration: false,
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  setupAutoUpdate(win);
}

function setupAutoUpdate(win) {
  if (!app.isPackaged || !autoUpdater) return;
  autoUpdater.autoDownload = false;
  autoUpdater.on("update-available", (info) => {
    dialog.showMessageBox(win, {
      type: "info", title: "업데이트 있음",
      message: "새 버전 " + info.version + "이 있어요.",
      detail: (info.releaseNotes || "").toString().replace(/<[^>]+>/g, "").slice(0, 600),
      buttons: ["지금 받기", "나중에"], defaultId: 0,
    }).then((r) => { if (r.response === 0) autoUpdater.downloadUpdate(); });
  });
  autoUpdater.on("update-downloaded", () => {
    dialog.showMessageBox(win, {
      type: "info", title: "업데이트 준비됨",
      message: "다운로드 완료. 지금 재시작해서 적용할까요?",
      buttons: ["재시작", "나중에"], defaultId: 0,
    }).then((r) => { if (r.response === 0) autoUpdater.quitAndInstall(); });
  });
  autoUpdater.on("error", () => {});
  try { autoUpdater.checkForUpdates(); } catch (e) {}
}

app.whenReady().then(() => {
  reindex();
  register();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => app.quit());
