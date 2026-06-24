const fs = require("fs");
const path = require("path");
const { isHuman } = require("./transcript");

function contentText(c) {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c.filter((b) => b && b.type === "text" && b.text).map((b) => b.text).join(" ");
  }
  return "";
}

function parseTs(s) {
  if (typeof s !== "string") return null;
  const t = Date.parse(s);
  return isNaN(t) ? null : t / 1000;
}

function parseSession(file) {
  const sid = path.basename(file).replace(/\.jsonl$/, "");
  let title = "", firstPrompt = "", msgCount = 0, model = "", lastTs = null, cwd = "";
  let data;
  try { data = fs.readFileSync(file, "utf-8"); } catch (e) { data = ""; }
  for (const line of data.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    let o;
    try { o = JSON.parse(s); } catch (e) { continue; }
    if (o.cwd && !cwd) cwd = o.cwd;
    const t = o.type;
    if (t === "custom-title" && o.customTitle) {
      title = o.customTitle;
    } else if (t === "user" || t === "assistant") {
      msgCount++;
      const ts = parseTs(o.timestamp);
      if (ts && (lastTs === null || ts > lastTs)) lastTs = ts;
      const msg = o.message || {};
      if (t === "user" && !firstPrompt) {
        const txt = contentText(msg.content);
        if (txt && isHuman(txt)) firstPrompt = txt.slice(0, 300);
      }
      if (t === "assistant" && !model) model = msg.model || "";
    }
  }
  let size = 0, mtime = 0;
  try { const st = fs.statSync(file); size = st.size; mtime = st.mtimeMs / 1000; } catch (e) {}
  return { session_id: sid, file_path: file, mtime, title, first_prompt: firstPrompt,
    msg_count: msgCount, size_bytes: size, model, cwd, last_activity: lastTs || mtime };
}

function walk(dir) {
  let out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "_trash") continue;
      out = out.concat(walk(full));
    } else if (e.isFile() && e.name.endsWith(".jsonl") && !e.name.startsWith("agent-")) {
      out.push(full);
    }
  }
  return out;
}

function projectOf(projectsDir, file) {
  return path.relative(projectsDir, file).split(path.sep)[0];
}

const CACHE_V = 3;

function buildIndex(projectsDir, cachePath) {
  let cache = {};
  try {
    const c = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
    if (c && c.__v === CACHE_V) cache = c.sessions || {};
  } catch (e) {}
  const result = {};
  for (const f of walk(projectsDir)) {
    const sid = path.basename(f).replace(/\.jsonl$/, "");
    let mt;
    try { mt = fs.statSync(f).mtimeMs / 1000; } catch (e) { continue; }
    if (cache[sid] && cache[sid].mtime === mt && cache[sid].file_path === f) {
      result[sid] = cache[sid];
    } else {
      const r = parseSession(f);
      r.project = projectOf(projectsDir, f);
      result[sid] = r;
    }
  }
  try { fs.writeFileSync(cachePath, JSON.stringify({ __v: CACHE_V, sessions: result })); } catch (e) {}
  return Object.values(result);
}

function runningSessions(sessionsDir) {
  const map = {};
  let files;
  try { files = fs.readdirSync(sessionsDir); } catch (e) { return map; }
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try {
      const o = JSON.parse(fs.readFileSync(path.join(sessionsDir, f), "utf-8"));
      if (o.sessionId) map[o.sessionId] = { pid: o.pid, name: o.name || "" };
    } catch (e) {}
  }
  return map;
}

module.exports = { buildIndex, parseSession, projectOf, runningSessions };
