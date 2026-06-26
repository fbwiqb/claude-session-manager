const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
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
const codex = require("./lib/codex");

let INDEX = [];
let CODEX = [];

function reindex() {
  INDEX = indexer.buildIndex(paths.projectsDir(), paths.indexCache());
  try { CODEX = codex.buildCodexIndex(codex.codexHome(), paths.codexIndexCache()); } catch (e) { CODEX = []; }
  return INDEX;
}

function bySid(sid) {
  return INDEX.find((r) => r.session_id === sid) || CODEX.find((r) => r.session_id === sid);
}

function fileIncludes(fp, term) {
  try { return fs.readFileSync(fp, "utf-8").toLowerCase().includes(term); }
  catch (e) { return false; }
}

function flagRows(o) {
  const favOrder = store.loadFavoriteOrder(paths.favPath());
  const favs = new Set(favOrder);
  const running = indexer.runningSessions(paths.sessionsDir());
  const now = Date.now() / 1000;
  const src = o.source || "claude";
  const baseRows = src === "codex" ? CODEX : src === "all" ? INDEX.concat(CODEX) : INDEX;
  const rows = baseRows.map((r) => {
    const rn = running[r.session_id];
    return {
      ...r,
      favorite: favs.has(r.session_id),
      cleanup: cleanup.isCleanupCandidate(r, favs, now),
      running: !!rn,
      title: rn && rn.name ? rn.name : r.title,
    };
  });
  return { rows, favOrder, baseRows };
}

function quickMatch(r, search) {
  return (r.title || "").toLowerCase().includes(search) ||
    (r.first_prompt || "").toLowerCase().includes(search);
}

function finishRows(rows, o, favOrder, baseRows) {
  if (o.project) rows = rows.filter((r) => r.project === o.project);
  if (o.favorites) rows = rows.filter((r) => r.favorite);
  if (o.cleanup) rows = rows.filter((r) => r.cleanup);
  const sort = o.sort || "recent";
  rows.sort((a, b) => {
    if (!!a.favorite !== !!b.favorite) return a.favorite ? -1 : 1;
    if (a.favorite && b.favorite) return favOrder.indexOf(a.session_id) - favOrder.indexOf(b.session_id);
    if (sort === "name") return (a.title || "").localeCompare(b.title || "");
    if (sort === "msg_desc") return b.msg_count - a.msg_count;
    if (sort === "msg_asc") return a.msg_count - b.msg_count;
    return (b.last_activity || 0) - (a.last_activity || 0);
  });
  const total = rows.length;
  rows = rows.slice(0, 200);
  const projects = [...new Set(baseRows.map((r) => r.project))].sort();
  return { sessions: rows, total, shown: rows.length, projects };
}

function listSessions(o) {
  o = o || {};
  const { rows, favOrder, baseRows } = flagRows(o);
  const search = (o.search || "").toLowerCase();
  const filtered = search
    ? rows.filter((r) => quickMatch(r, search) || (o.deep && r.file_path && fileIncludes(r.file_path, search)))
    : rows;
  return finishRows(filtered, o, favOrder, baseRows);
}

async function deepListSessions(o, onProgress) {
  const { rows, favOrder, baseRows } = flagRows(o);
  const search = (o.search || "").toLowerCase();
  const matched = [];
  const rest = [];
  for (const r of rows) {
    if (quickMatch(r, search)) matched.push(r);
    else if (r.file_path) rest.push(r);
  }
  const total = rest.length;
  for (let i = 0; i < total; i++) {
    const r = rest[i];
    let txt = "";
    try { txt = (await fs.promises.readFile(r.file_path, "utf-8")).toLowerCase(); } catch (e) {}
    if (txt.includes(search)) matched.push(r);
    if (onProgress && (i % 2 === 0 || i === total - 1)) onProgress(i + 1, total);
  }
  if (onProgress) onProgress(total, total);
  return finishRows(matched, o, favOrder, baseRows);
}

function resumeArgs(sid, source) {
  return source === "codex" ? ["codex", "resume", sid] : ["claude", "-r", sid];
}

function spawnNewCmd(args, opts) {
  spawn("cmd.exe", ["/c", "start", "", "cmd", "/k"].concat(args),
    Object.assign({ detached: true, stdio: "ignore" }, opts)).unref();
}

function openInCmd(sid, cwd, source) {
  if (!store.isValidSid(sid)) return { ok: false, message: "invalid session id" };
  const dir = cwd && fs.existsSync(cwd) ? cwd : undefined;
  const opts = dir ? { cwd: dir } : {};
  const args = resumeArgs(sid, source);
  try {
    if (process.platform === "win32") {
      const wtArgs = ["-w", "0", "nt", "--title", sid];
      if (dir) wtArgs.push("-d", dir);
      wtArgs.push("cmd", "/k");
      const wt = spawn("wt.exe", wtArgs.concat(args), Object.assign({ detached: true, stdio: "ignore" }, opts));
      wt.on("error", () => { try { spawnNewCmd(args, opts); } catch (e) {} });
      wt.unref();
    } else if (process.platform === "darwin") {
      const sh = (dir ? "cd '" + dir.replace(/'/g, "'\\''") + "' && " : "") + args.join(" ");
      const osa = 'tell application "Terminal" to do script "' +
        sh.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
      spawn("osascript", ["-e", "tell application \"Terminal\" to activate", "-e", osa],
        { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn(args[0], args.slice(1), Object.assign({ detached: true, stdio: "ignore" }, opts)).unref();
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, message: String(e) };
  }
}

function openInApp(sid, source) {
  if (source === "codex") {
    return { ok: false, message: "Codex 세션은 데스크톱앱 열기를 지원하지 않아요.\n(터미널에서 열기를 쓰세요)" };
  }
  if (!store.isValidSid(sid)) return { ok: false, message: "invalid session id" };
  try {
    shell.openExternal("claude://resume?session=" + encodeURIComponent(sid));
    return { ok: true };
  } catch (e) {
    return { ok: false, message: String(e) };
  }
}

function register() {
  ipcMain.handle("list", async (e, o) => {
    if (o && o.deep && o.search) {
      return await deepListSessions(o, (done, total) =>
        e.sender.send("search-progress", { done, total }));
    }
    return listSessions(o);
  });
  ipcMain.handle("refresh", () => { reindex(); return listSessions({}); });
  ipcMain.handle("transcript", (e, sid) => {
    const r = bySid(sid);
    if (!r || !r.file_path) return { messages: [] };
    const msgs = r.source === "codex"
      ? codex.loadCodexTranscript(r.file_path)
      : transcript.loadTranscript(r.file_path);
    return { messages: msgs };
  });
  ipcMain.handle("favorite", (e, sid) =>
    ({ favorite: store.toggleFavorite(paths.favPath(), sid) }));
  ipcMain.handle("favorite-move", (e, { sid, dir }) =>
    ({ ok: store.moveFavorite(paths.favPath(), sid, dir) }));
  ipcMain.handle("rename", (e, { sid, title }) => {
    const cur = bySid(sid);
    if (cur && cur.source === "codex") {
      return { ok: false, message: "Codex 세션은 이 앱에서 이름 변경을 지원하지 않아요." };
    }
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
    if (r && r.source === "codex") {
      return { ok: false, message: "Codex 세션은 이 앱에서 삭제를 지원하지 않아요." };
    }
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
      if (r && r.source === "codex") { skipped++; continue; }
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
    return openInCmd(sid, r && r.cwd, r && r.source);
  });
  ipcMain.handle("open-app", (e, sid) => {
    const r = bySid(sid);
    return openInApp(sid, r && r.source);
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200, height: 800, title: "세션매니저", backgroundColor: "#0f1115",
    icon: path.join(__dirname, "renderer", "icon.png"),
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
    let notes = info.releaseNotes;
    if (Array.isArray(notes)) notes = notes.map((n) => (n && n.note) || "").join("\n\n");
    notes = (notes || "").toString().replace(/<[^>]+>/g, "").trim();
    dialog.showMessageBox(win, {
      type: "info", title: "업데이트 있음",
      message: "새 버전 " + info.version + "이 있어요.",
      detail: notes ? "변경 사항:\n\n" + notes.slice(0, 1500) : "(릴리즈 노트 없음)",
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
