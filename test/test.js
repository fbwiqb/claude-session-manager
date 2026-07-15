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

test("buildIndex: only UUID sessions, excludes agent/journal/subagents/_trash, prunes deleted", () => {
  const root = tmp();
  const proj = path.join(root, "projects", "projA");
  fs.mkdirSync(proj, { recursive: true });
  fs.mkdirSync(path.join(root, "projects", "_trash"), { recursive: true });
  const sub = path.join(proj, "11111111-1111-1111-1111-111111111111", "subagents", "workflows", "wf_1");
  fs.mkdirSync(sub, { recursive: true });
  const A = "11111111-1111-1111-1111-111111111111";
  const B = "22222222-2222-2222-2222-222222222222";
  writeSession(proj, A);
  writeSession(proj, "agent-aaaaaaaaaaaaaaaa");
  writeSession(sub, "journal");
  writeSession(path.join(root, "projects", "_trash"), "33333333-3333-3333-3333-333333333333");
  const f2 = writeSession(proj, B);
  const cache = path.join(root, "idx.json");
  let rows = indexer.buildIndex(path.join(root, "projects"), cache);
  assert.deepEqual(rows.map(r => r.session_id).sort(), [A, B]);
  fs.unlinkSync(f2);
  rows = indexer.buildIndex(path.join(root, "projects"), cache);
  assert.deepEqual(rows.map(r => r.session_id), [A]);
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

test("favorite order + move", () => {
  const d = tmp();
  const fp = path.join(d, "fav.json");
  store.toggleFavorite(fp, "a");
  store.toggleFavorite(fp, "b");
  store.toggleFavorite(fp, "c");
  assert.deepEqual(store.loadFavoriteOrder(fp), ["a", "b", "c"]);
  store.moveFavorite(fp, "c", -1);
  assert.deepEqual(store.loadFavoriteOrder(fp), ["a", "c", "b"]);
  store.moveFavorite(fp, "a", 1);
  assert.deepEqual(store.loadFavoriteOrder(fp), ["c", "a", "b"]);
  assert.equal(store.moveFavorite(fp, "c", -1), false);
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

test("runningSessions reads lock files", () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, "111.json"),
    JSON.stringify({ pid: 111, sessionId: "s1", name: "실행중세션" }));
  fs.writeFileSync(path.join(d, "bad.txt"), "ignore");
  const m = indexer.runningSessions(d);
  assert.equal(m["s1"].name, "실행중세션");
  assert.equal(m["s1"].pid, 111);
  assert.equal(indexer.runningSessions(path.join(d, "nope")) && Object.keys(indexer.runningSessions(path.join(d, "nope"))).length, 0);
});

const codex = require("../lib/codex");
test("codex buildIndex + transcript", () => {
  const home = tmp();
  const sdir = path.join(home, "sessions", "2026", "06");
  fs.mkdirSync(sdir, { recursive: true });
  const id = "019eee08-46a0-7c10-b75f-33fed3102801";
  fs.writeFileSync(path.join(home, "session_index.jsonl"),
    JSON.stringify({ id, thread_name: "초파리 세션", updated_at: "2026-06-22T06:33:00.000Z" }) + "\n");
  const roll = path.join(sdir, "rollout-2026-06-22T15-33-00-" + id + ".jsonl");
  fs.writeFileSync(roll, [
    JSON.stringify({ type: "session_meta", payload: { id, cwd: "C:\\proj\\codex" } }),
    JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "안녕 코덱스 질문" }] } }),
    JSON.stringify({ type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "코덱스 답변" }] } }),
  ].join("\n"));
  const rows = codex.buildCodexIndex(home, path.join(home, "cache.json"));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, "codex");
  assert.equal(rows[0].title, "초파리 세션");
  assert.equal(rows[0].cwd, "C:\\proj\\codex");
  assert.equal(rows[0].first_prompt, "안녕 코덱스 질문");
  assert.equal(rows[0].msg_count, 2);
  const m = codex.loadCodexTranscript(roll);
  assert.equal(m.length, 2);
  assert.equal(m[0].human, true);
  assert.equal(m[0].text, "안녕 코덱스 질문");
});

test("codex delete/restore + index exclusion", () => {
  const home = tmp();
  process.env.CODEX_HOME = home;
  const sdir = path.join(home, "sessions");
  fs.mkdirSync(sdir, { recursive: true });
  const A = "019eee08-46a0-7c10-b75f-33fed3102801";
  const B = "019eee08-46a0-7c10-b75f-33fed3102802";
  const idx = path.join(home, "session_index.jsonl");
  fs.writeFileSync(idx, [
    JSON.stringify({ id: A, thread_name: "가계부", updated_at: "2026-06-22T06:33:00.000Z" }),
    JSON.stringify({ id: B, thread_name: "덧그리다", updated_at: "2026-06-22T07:00:00.000Z" }),
  ].join("\n"));
  const rollA = path.join(sdir, "rollout-2026-06-22T15-33-00-" + A + ".jsonl");
  const rollB = path.join(sdir, "rollout-2026-06-22T16-00-00-" + B + ".jsonl");
  fs.writeFileSync(rollA, JSON.stringify({ type: "session_meta", payload: { id: A, cwd: "C:\\a" } }) + "\n");
  fs.writeFileSync(rollB, JSON.stringify({ type: "session_meta", payload: { id: B, cwd: "C:\\b" } }) + "\n");
  const cache = path.join(home, "cache.json");
  const trashDir = path.join(home, "_codextrash");
  const meta = path.join(home, "trash.json");

  let rows = codex.buildCodexIndex(home, cache);
  assert.equal(rows.length, 2);
  const rowA = rows.find((r) => r.session_id === A);

  assert.equal(codex.deleteCodexSession(rowA, trashDir, meta), true);
  assert.ok(!fs.existsSync(rollA));
  assert.ok(fs.existsSync(path.join(trashDir, path.basename(rollA))));
  assert.ok(codex.deletedCodexIds(meta).has(A));

  rows = codex.buildCodexIndex(home, cache, codex.deletedCodexIds(meta));
  assert.deepEqual(rows.map((r) => r.session_id), [B]);

  assert.equal(codex.restoreCodexSession(A, trashDir, meta), true);
  assert.ok(fs.existsSync(rollA));
  assert.ok(!codex.deletedCodexIds(meta).has(A));
  rows = codex.buildCodexIndex(home, cache, codex.deletedCodexIds(meta));
  assert.equal(rows.length, 2);

  // 휴지통 파일이 없으면 복원은 조용히 성공하지 말고 실패해야 함(유령 방지)
  codex.deleteCodexSession(rows.find((r) => r.session_id === B), trashDir, meta);
  fs.unlinkSync(path.join(trashDir, path.basename(rollB)));
  assert.equal(codex.restoreCodexSession(B, trashDir, meta), false);
  assert.ok(codex.deletedCodexIds(meta).has(B));
  delete process.env.CODEX_HOME;
});

console.log(`\n${pass} passed`);
