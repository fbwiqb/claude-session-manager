const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const indexer = require("../lib/indexer");
const transcript = require("../lib/transcript");
const store = require("../lib/store");
const cleanup = require("../lib/cleanup");

let pass = 0;
function test(name, fn) {
  try { fn(); pass++; console.log("ok  -", name); }
  catch (e) { console.error("FAIL-", name, "\n   ", e.message); process.exitCode = 1; }
}
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "csm-")); }
function writeSession(dir, sid, opts = {}) {
  const p = path.join(dir, sid + ".jsonl");
  const lines = [];
  const u = { type: "user", sessionId: sid, message: { role: "user", content: opts.prompt || "hi" } };
  if (opts.ts) u.timestamp = opts.ts;
  if (opts.cwd) u.cwd = opts.cwd;
  lines.push(JSON.stringify(u));
  if (opts.assistant) lines.push(JSON.stringify({ type: "assistant",
    message: { role: "assistant", model: "claude-opus-4-8", content: [{ type: "text", text: "답변" }] } }));
  if (opts.title) lines.push(JSON.stringify({ type: "custom-title", customTitle: opts.title, sessionId: sid }));
  fs.writeFileSync(p, lines.join("\n") + "\n", "utf-8");
  return p;
}

test("parseSession extracts metadata", () => {
  const d = tmp();
  const p = writeSession(d, "s1", { title: "내 세션", prompt: "안녕 첫 질문", assistant: true, cwd: "C:\\proj\\x" });
  const r = indexer.parseSession(p);
  assert.equal(r.session_id, "s1");
  assert.equal(r.title, "내 세션");
  assert.equal(r.first_prompt, "안녕 첫 질문");
  assert.equal(r.msg_count, 2);
  assert.equal(r.model, "claude-opus-4-8");
  assert.equal(r.cwd, "C:\\proj\\x");
});

test("buildIndex excludes agent-* and _trash, prunes deleted", () => {
  const root = tmp();
  const proj = path.join(root, "projects", "projA");
  fs.mkdirSync(proj, { recursive: true });
  fs.mkdirSync(path.join(root, "projects", "_trash"), { recursive: true });
  writeSession(proj, "real1");
  writeSession(proj, "agent-xyz");
  writeSession(path.join(root, "projects", "_trash"), "dead");
  const f2 = writeSession(proj, "real2");
  const cache = path.join(root, "idx.json");
  let rows = indexer.buildIndex(path.join(root, "projects"), cache);
  assert.deepEqual(rows.map(r => r.session_id).sort(), ["real1", "real2"]);
  fs.unlinkSync(f2);
  rows = indexer.buildIndex(path.join(root, "projects"), cache);
  assert.deepEqual(rows.map(r => r.session_id), ["real1"]);
});

test("loadTranscript flags human vs tool/system", () => {
  const d = tmp();
  const p = path.join(d, "s.jsonl");
  fs.writeFileSync(p, [
    JSON.stringify({ type: "user", message: { role: "user", content: "진짜 내 질문" } }),
    JSON.stringify({ type: "user", message: { role: "user", content: "<task-notification> 무시" } }),
    JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", content: "결과" }] } }),
    JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "답변" }] } }),
  ].join("\n"), "utf-8");
  const m = transcript.loadTranscript(p);
  assert.equal(m.length, 4);
  assert.equal(m[0].human, true);
  assert.equal(m[1].human, false);
  assert.equal(m[2].human, false);
  assert.equal(m[3].human, false);
  assert.equal(m.filter(x => x.human).length, 1);
});

test("favorites toggle", () => {
  const d = tmp();
  const fp = path.join(d, "fav.json");
  assert.equal(store.toggleFavorite(fp, "s1"), true);
  assert.ok(store.loadFavorites(fp).has("s1"));
  assert.equal(store.toggleFavorite(fp, "s1"), false);
  assert.ok(!store.loadFavorites(fp).has("s1"));
});

test("trash delete/restore roundtrip", () => {
  const root = tmp();
  const proj = path.join(root, "projects", "projA");
  fs.mkdirSync(proj, { recursive: true });
  const trash = path.join(root, "projects", "_trash");
  const meta = path.join(root, "m.json");
  const f = writeSession(proj, "s1");
  assert.ok(store.deleteSession(f, "s1", trash, meta));
  assert.ok(!fs.existsSync(f));
  assert.ok(fs.existsSync(path.join(trash, "s1.jsonl")));
  assert.ok(store.restoreSession("s1", trash, meta));
  assert.ok(fs.existsSync(f));
});

test("sid validation + bad sid rejected", () => {
  assert.ok(store.isValidSid("79119aeb-7747-4e1c-a195-73d9abcf5824"));
  assert.ok(!store.isValidSid('x" & echo PWNED'));
  assert.ok(!store.isValidSid("../../etc/passwd"));
  const d = tmp();
  assert.equal(store.deleteSession(path.join(d, "x"), "../evil", path.join(d, "t"), path.join(d, "m")), false);
});

test("restore confined to projects dir", () => {
  const root = tmp();
  const proj = path.join(root, "projects", "projA");
  fs.mkdirSync(proj, { recursive: true });
  const trash = path.join(root, "projects", "_trash");
  const meta = path.join(root, "m.json");
  const f = writeSession(proj, "s1");
  store.deleteSession(f, "s1", trash, meta);
  const data = JSON.parse(fs.readFileSync(meta, "utf-8"));
  data.s1.origin = path.join(root, "OUTSIDE", "pwned.jsonl");
  fs.writeFileSync(meta, JSON.stringify(data));
  assert.equal(store.restoreSession("s1", trash, meta), false);
  assert.ok(!fs.existsSync(path.join(root, "OUTSIDE", "pwned.jsonl")));
});

test("rename appends custom-title", () => {
  const d = tmp();
  const p = writeSession(d, "s1");
  store.renameSession(p, "s1", "새이름");
  const last = fs.readFileSync(p, "utf-8").trim().split("\n").pop();
  const o = JSON.parse(last);
  assert.equal(o.type, "custom-title");
  assert.equal(o.customTitle, "새이름");
});

test("cleanup candidate logic", () => {
  const NOW = 1800000000, DAY = 86400;
  const base = (o) => Object.assign({ last_activity: NOW - 40 * DAY, title: "", session_id: "x" }, o);
  assert.equal(cleanup.isCleanupCandidate(base(), new Set(), NOW), true);
  assert.equal(cleanup.isCleanupCandidate(base({ last_activity: NOW - 5 * DAY }), new Set(), NOW), false);
  assert.equal(cleanup.isCleanupCandidate(base({ title: "중요" }), new Set(), NOW), false);
  assert.equal(cleanup.isCleanupCandidate(base(), new Set(["x"]), NOW), false);
});

console.log(`\n${pass} passed`);
