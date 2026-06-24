const fs = require("fs");
const path = require("path");
const os = require("os");

const CACHE_V = 1;
const UUID = /([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/;
const SYS = ["<permissions", "# AGENTS.md", "<environment", "<user_instructions",
  "# Instructions", "<system", "You are "];

function codexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

function isHumanText(t) {
  t = (t || "").trim();
  if (!t) return false;
  return !SYS.some((s) => t.startsWith(s));
}

function textOf(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b && (b.type === "input_text" || b.type === "output_text" || b.type === "text") && b.text)
      .map((b) => b.text).join(" ");
  }
  return "";
}

function parseTs(s) { const t = Date.parse(s || ""); return isNaN(t) ? 0 : t / 1000; }

function walkRollouts(dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkRollouts(full, out);
    else if (e.isFile() && e.name.startsWith("rollout-") && e.name.endsWith(".jsonl")) {
      const m = e.name.match(UUID);
      if (m && !out[m[1]]) out[m[1]] = full;
    }
  }
}

function rolloutFiles(home) {
  const out = {};
  walkRollouts(path.join(home, "sessions"), out);
  walkRollouts(path.join(home, "archived_sessions"), out);
  return out;
}

function parseRollout(file) {
  let cwd = "", firstPrompt = "", msgCount = 0, model = "";
  let data;
  try { data = fs.readFileSync(file, "utf-8"); } catch (e) { data = ""; }
  for (const line of data.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    let o;
    try { o = JSON.parse(s); } catch (e) { continue; }
    const p = o.payload || {};
    if (o.type === "session_meta") {
      if (p.cwd) cwd = p.cwd;
      if (p.model && !model) model = p.model;
    } else if (o.type === "response_item" && p.type === "message") {
      const role = p.role;
      if (role === "user" || role === "assistant") {
        msgCount++;
        if (role === "user" && !firstPrompt) {
          const t = textOf(p.content);
          if (t && isHumanText(t)) firstPrompt = t.slice(0, 300);
        }
      }
    }
  }
  return { cwd, first_prompt: firstPrompt, msg_count: msgCount, model };
}

function buildCodexIndex(home, cachePath) {
  const idxFile = path.join(home, "session_index.jsonl");
  const byId = {};
  let data;
  try { data = fs.readFileSync(idxFile, "utf-8"); } catch (e) { return []; }
  for (const l of data.split("\n")) {
    const s = l.trim();
    if (!s) continue;
    let o;
    try { o = JSON.parse(s); } catch (e) { continue; }
    if (!o.id) continue;
    if (!byId[o.id] || (o.updated_at || "") > (byId[o.id].updated_at || "")) byId[o.id] = o;
  }
  const files = rolloutFiles(home);
  let cache = {};
  try {
    const c = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
    if (c && c.__v === CACHE_V) cache = c.sessions || {};
  } catch (e) {}
  const result = {};
  for (const id in byId) {
    const m = byId[id];
    const fp = files[id] || "";
    let mt = 0;
    if (fp) { try { mt = fs.statSync(fp).mtimeMs / 1000; } catch (e) {} }
    let row;
    if (cache[id] && cache[id]._mt === mt && cache[id].file_path === fp) {
      row = cache[id];
    } else {
      const d = fp ? parseRollout(fp) : { cwd: "", first_prompt: "", msg_count: 0, model: "" };
      row = {
        session_id: id, source: "codex", file_path: fp, _mt: mt,
        first_prompt: d.first_prompt, msg_count: d.msg_count, size_bytes: 0,
        model: d.model, cwd: d.cwd, project: "Codex",
      };
    }
    row.title = m.thread_name || row.title || "";
    row.last_activity = parseTs(m.updated_at) || row.last_activity || 0;
    result[id] = row;
  }
  try { fs.writeFileSync(cachePath, JSON.stringify({ __v: CACHE_V, sessions: result })); } catch (e) {}
  return Object.values(result);
}

function loadCodexTranscript(file) {
  const msgs = [];
  let data;
  try { data = fs.readFileSync(file, "utf-8"); } catch (e) { return msgs; }
  for (const line of data.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    let o;
    try { o = JSON.parse(s); } catch (e) { continue; }
    if (o.type !== "response_item") continue;
    const p = o.payload || {};
    if (p.type !== "message") continue;
    const role = p.role;
    if (role !== "user" && role !== "assistant") continue;
    const text = textOf(p.content);
    msgs.push({ role, text, has_tool: false, human: role === "user" && isHumanText(text), timestamp: o.timestamp || "" });
  }
  return msgs;
}

module.exports = { codexHome, buildCodexIndex, loadCodexTranscript };
