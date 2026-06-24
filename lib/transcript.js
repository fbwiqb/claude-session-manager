const fs = require("fs");

const SYS = ["<task-notification>", "Base directory for this skill", "Caveat:",
  "<system-reminder>", "<command-", "<local-command", "<user-",
  "[Request interrupted", "Result of calling", "<bash-", "API Error"];

function isHuman(t) {
  t = (t || "").trim();
  if (!t) return false;
  return !SYS.some((s) => t.startsWith(s));
}

function render(content) {
  const text = [];
  const tools = [];
  let isToolResult = false;
  if (typeof content === "string") return { text: content, tools, isToolResult };
  if (Array.isArray(content)) {
    for (const b of content) {
      if (!b || typeof b !== "object") continue;
      if (b.type === "text" && b.text) text.push(b.text);
      else if (b.type === "tool_use") tools.push({ name: b.name || "tool" });
      else if (b.type === "tool_result") { tools.push({ name: "result" }); isToolResult = true; }
    }
  }
  return { text: text.join(" "), tools, isToolResult };
}

function loadTranscript(file) {
  const msgs = [];
  let data;
  try { data = fs.readFileSync(file, "utf-8"); } catch (e) { return msgs; }
  for (const line of data.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    let o;
    try { o = JSON.parse(s); } catch (e) { continue; }
    if (o.type !== "user" && o.type !== "assistant") continue;
    const r = render((o.message || {}).content);
    const human = o.type === "user" && !r.isToolResult && isHuman(r.text);
    msgs.push({ role: o.type, text: r.text, has_tool: r.tools.length > 0,
      human, timestamp: o.timestamp || "" });
  }
  return msgs;
}

module.exports = { loadTranscript, isHuman };
