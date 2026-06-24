# 클로드 세션 매니저 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `~/.claude/projects/`의 클로드 세션을 조회·검색·분석하고 즐겨찾기·리네임·휴지통 삭제·본문 미리보기·cmd에서 바로 열기를 제공하는 로컬 웹앱을 만들고, 단일 exe로 패키징한다.

**Architecture:** Python 표준 라이브러리만 사용. `csm/` 패키지에 paths/indexer/transcript/store/cleanup/server 모듈, 진입점 `session_manager.py`, UI는 `web/index.html` 단일 파일. 메타는 SQLite 캐시(mtime 증분), 즐겨찾기/휴지통은 JSON. 완성 후 PyInstaller로 exe 빌드.

**Tech Stack:** Python 3.11+ stdlib (`http.server`, `sqlite3`, `json`, `subprocess`, `unittest`), PyInstaller(빌드 전용).

---

## 파일 구조

- `session_manager.py` — 진입점: 서버 기동 + 브라우저 자동 오픈
- `csm/__init__.py`
- `csm/paths.py` — config_dir / projects_dir / claude 명령 / 데이터파일 경로 해석
- `csm/indexer.py` — jsonl 파싱(`parse_session`) + SQLite 증분 인덱싱(`build_index`, `query_sessions`)
- `csm/transcript.py` — 세션 jsonl → 메시지 배열(`load_transcript`)
- `csm/store.py` — 즐겨찾기 / 휴지통(이동·복원) / 리네임(append)
- `csm/cleanup.py` — 정리 추천 판정(`is_cleanup_candidate`)
- `csm/server.py` — HTTP 핸들러 + API 라우팅 + 정적파일 서빙
- `web/index.html` — UI(HTML/CSS/JS 인라인)
- `tests/test_*.py` — unittest
- `build_exe.bat` — PyInstaller 빌드 스크립트

데이터 파일(런타임 생성, gitignore됨): `<config_dir>/csm-index.db`, `<config_dir>/csm-fav.json`, `<config_dir>/csm-trash.json`, `<projects_dir>/_trash/`.

---

### Task 1: 프로젝트 스캐폴드 + paths 모듈

**Files:**
- Create: `csm/__init__.py`
- Create: `csm/paths.py`
- Test: `tests/test_paths.py`

- [ ] **Step 1: 실패 테스트 작성**

`tests/test_paths.py`:
```python
import os, unittest, tempfile
from csm import paths

class TestPaths(unittest.TestCase):
    def test_config_dir_uses_env_override(self):
        with tempfile.TemporaryDirectory() as d:
            os.environ["CLAUDE_CONFIG_DIR"] = d
            try:
                self.assertEqual(paths.config_dir(), d)
            finally:
                del os.environ["CLAUDE_CONFIG_DIR"]

    def test_config_dir_defaults_to_home_claude(self):
        os.environ.pop("CLAUDE_CONFIG_DIR", None)
        expected = os.path.join(os.path.expanduser("~"), ".claude")
        self.assertEqual(paths.config_dir(), expected)

    def test_projects_dir_is_under_config(self):
        os.environ.pop("CLAUDE_CONFIG_DIR", None)
        self.assertTrue(paths.projects_dir().endswith(os.path.join(".claude", "projects")))

    def test_claude_command_is_name_only(self):
        self.assertEqual(paths.claude_command(), "claude")

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: 실패 확인**

Run: `python -m unittest tests.test_paths -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'csm'`

- [ ] **Step 3: 최소 구현**

`csm/__init__.py`: (빈 파일)

`csm/paths.py`:
```python
import os

def config_dir():
    env = os.environ.get("CLAUDE_CONFIG_DIR")
    if env:
        return env
    return os.path.join(os.path.expanduser("~"), ".claude")

def projects_dir():
    return os.path.join(config_dir(), "projects")

def claude_command():
    return "claude"

def index_db_path():
    return os.path.join(config_dir(), "csm-index.db")

def favorites_path():
    return os.path.join(config_dir(), "csm-fav.json")

def trash_meta_path():
    return os.path.join(config_dir(), "csm-trash.json")

def trash_dir():
    return os.path.join(projects_dir(), "_trash")
```

- [ ] **Step 4: 통과 확인**

Run: `python -m unittest tests.test_paths -v`
Expected: PASS (4 tests)

- [ ] **Step 5: 커밋**

```bash
git add csm/__init__.py csm/paths.py tests/test_paths.py
git commit -m "feat: paths 모듈 (경로 자동 탐색)"
```

---

### Task 2: 세션 jsonl 파싱 (parse_session)

**Files:**
- Create: `csm/indexer.py`
- Test: `tests/test_parse.py`

- [ ] **Step 1: 실패 테스트 작성**

`tests/test_parse.py`:
```python
import os, json, unittest, tempfile
from csm.indexer import parse_session

def write_jsonl(path, lines):
    with open(path, "w", encoding="utf-8") as f:
        for o in lines:
            f.write(json.dumps(o, ensure_ascii=False) + "\n")

class TestParse(unittest.TestCase):
    def test_extracts_title_first_prompt_count(self):
        with tempfile.TemporaryDirectory() as d:
            sid = "11111111-2222-3333-4444-555555555555"
            p = os.path.join(d, sid + ".jsonl")
            write_jsonl(p, [
                {"type": "user", "sessionId": sid,
                 "message": {"role": "user", "content": "안녕 첫 질문이야"},
                 "timestamp": "2026-06-20T10:00:00.000Z"},
                {"type": "assistant", "sessionId": sid,
                 "message": {"role": "assistant", "model": "claude-opus-4-8",
                             "content": [{"type": "text", "text": "답변"}]},
                 "timestamp": "2026-06-20T10:00:05.000Z"},
                {"type": "custom-title", "customTitle": "내 세션", "sessionId": sid},
            ])
            r = parse_session(p)
            self.assertEqual(r["session_id"], sid)
            self.assertEqual(r["title"], "내 세션")
            self.assertEqual(r["first_prompt"], "안녕 첫 질문이야")
            self.assertEqual(r["msg_count"], 2)
            self.assertEqual(r["model"], "claude-opus-4-8")
            self.assertTrue(r["size_bytes"] > 0)

    def test_no_title_returns_empty(self):
        with tempfile.TemporaryDirectory() as d:
            sid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
            p = os.path.join(d, sid + ".jsonl")
            write_jsonl(p, [
                {"type": "user", "sessionId": sid,
                 "message": {"role": "user",
                             "content": [{"type": "text", "text": "리스트형 내용"}]}},
            ])
            r = parse_session(p)
            self.assertEqual(r["title"], "")
            self.assertEqual(r["first_prompt"], "리스트형 내용")

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: 실패 확인**

Run: `python -m unittest tests.test_parse -v`
Expected: FAIL — `ImportError: cannot import name 'parse_session'`

- [ ] **Step 3: 최소 구현**

`csm/indexer.py`:
```python
import os, json
from datetime import datetime

def _content_to_text(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for b in content:
            if isinstance(b, dict) and b.get("type") == "text" and b.get("text"):
                parts.append(b["text"])
        return " ".join(parts)
    return ""

def _parse_ts(s):
    if not isinstance(s, str):
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except Exception:
        return None

def parse_session(file_path):
    sid = os.path.splitext(os.path.basename(file_path))[0]
    title = ""
    first_prompt = ""
    msg_count = 0
    model = ""
    last_ts = None
    with open(file_path, encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                o = json.loads(line)
            except Exception:
                continue
            t = o.get("type")
            if t == "custom-title" and o.get("customTitle"):
                title = o["customTitle"]
            elif t in ("user", "assistant"):
                msg_count += 1
                ts = _parse_ts(o.get("timestamp"))
                if ts and (last_ts is None or ts > last_ts):
                    last_ts = ts
                msg = o.get("message", {})
                if t == "user" and not first_prompt:
                    txt = _content_to_text(msg.get("content"))
                    if txt:
                        first_prompt = txt[:300]
                if t == "assistant" and not model:
                    model = msg.get("model", "") or ""
    try:
        size = os.path.getsize(file_path)
        mtime = os.path.getmtime(file_path)
    except OSError:
        size, mtime = 0, 0.0
    return {
        "session_id": sid,
        "file_path": file_path,
        "mtime": mtime,
        "title": title,
        "first_prompt": first_prompt,
        "msg_count": msg_count,
        "size_bytes": size,
        "model": model,
        "last_activity": last_ts if last_ts else mtime,
    }
```

- [ ] **Step 4: 통과 확인**

Run: `python -m unittest tests.test_parse -v`
Expected: PASS (2 tests)

- [ ] **Step 5: 커밋**

```bash
git add csm/indexer.py tests/test_parse.py
git commit -m "feat: parse_session jsonl 파싱"
```

---

### Task 3: SQLite 증분 인덱싱 (build_index / query_sessions)

**Files:**
- Modify: `csm/indexer.py`
- Test: `tests/test_index.py`

- [ ] **Step 1: 실패 테스트 작성**

`tests/test_index.py`:
```python
import os, json, unittest, tempfile
from csm import indexer

def write_session(d, sid, title="", prompt="hi"):
    p = os.path.join(d, sid + ".jsonl")
    with open(p, "w", encoding="utf-8") as f:
        f.write(json.dumps({"type": "user", "sessionId": sid,
                            "message": {"role": "user", "content": prompt}}) + "\n")
        if title:
            f.write(json.dumps({"type": "custom-title", "customTitle": title,
                                "sessionId": sid}) + "\n")
    return p

class TestIndex(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.proj = os.path.join(self.tmp.name, "projects")
        os.makedirs(os.path.join(self.proj, "projA"))
        self.db = os.path.join(self.tmp.name, "idx.db")

    def tearDown(self):
        self.tmp.cleanup()

    def test_build_and_query(self):
        write_session(os.path.join(self.proj, "projA"), "s1", title="첫번째")
        write_session(os.path.join(self.proj, "projA"), "s2", prompt="검색대상키워드")
        n = indexer.build_index(self.proj, self.db)
        self.assertEqual(n, 2)
        rows = indexer.query_sessions(self.db)
        self.assertEqual(len(rows), 2)

    def test_search_filters_by_keyword(self):
        write_session(os.path.join(self.proj, "projA"), "s1", title="가계부정리")
        write_session(os.path.join(self.proj, "projA"), "s2", prompt="다른내용")
        indexer.build_index(self.proj, self.db)
        rows = indexer.query_sessions(self.db, search="가계부")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["title"], "가계부정리")

    def test_incremental_skips_unchanged(self):
        write_session(os.path.join(self.proj, "projA"), "s1")
        indexer.build_index(self.proj, self.db)
        n2 = indexer.build_index(self.proj, self.db)
        self.assertEqual(n2, 0)

    def test_trash_dir_excluded(self):
        os.makedirs(os.path.join(self.proj, "_trash"))
        write_session(os.path.join(self.proj, "_trash"), "dead")
        write_session(os.path.join(self.proj, "projA"), "live")
        indexer.build_index(self.proj, self.db)
        rows = indexer.query_sessions(self.db)
        self.assertEqual([r["session_id"] for r in rows], ["live"])

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: 실패 확인**

Run: `python -m unittest tests.test_index -v`
Expected: FAIL — `AttributeError: module 'csm.indexer' has no attribute 'build_index'`

- [ ] **Step 3: 최소 구현** — `csm/indexer.py` 끝에 추가

```python
import sqlite3, glob

_SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  project TEXT, file_path TEXT, mtime REAL,
  title TEXT, first_prompt TEXT,
  msg_count INTEGER, size_bytes INTEGER,
  model TEXT, last_activity REAL
);
"""

def _connect(db_path):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.executescript(_SCHEMA)
    return conn

def _project_of(projects_dir, file_path):
    rel = os.path.relpath(file_path, projects_dir)
    return rel.split(os.sep)[0]

def build_index(projects_dir, db_path, progress=None):
    conn = _connect(db_path)
    cur = conn.cursor()
    known = {r["session_id"]: r["mtime"] for r in cur.execute(
        "SELECT session_id, mtime FROM sessions")}
    files = [f for f in glob.glob(os.path.join(projects_dir, "**", "*.jsonl"),
                                  recursive=True)
             if os.sep + "_trash" + os.sep not in f]
    updated = 0
    for i, fp in enumerate(files):
        sid = os.path.splitext(os.path.basename(fp))[0]
        try:
            mt = os.path.getmtime(fp)
        except OSError:
            continue
        if known.get(sid) == mt:
            continue
        r = parse_session(fp)
        r["project"] = _project_of(projects_dir, fp)
        cur.execute("""INSERT OR REPLACE INTO sessions
            (session_id, project, file_path, mtime, title, first_prompt,
             msg_count, size_bytes, model, last_activity)
            VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (r["session_id"], r["project"], r["file_path"], r["mtime"],
             r["title"], r["first_prompt"], r["msg_count"], r["size_bytes"],
             r["model"], r["last_activity"]))
        updated += 1
        if progress and i % 200 == 0:
            progress(i + 1, len(files))
    conn.commit()
    conn.close()
    return updated

def query_sessions(db_path, search="", project="", sort="recent"):
    conn = _connect(db_path)
    sql = "SELECT * FROM sessions WHERE 1=1"
    args = []
    if search:
        sql += " AND (title LIKE ? OR first_prompt LIKE ?)"
        args += ["%" + search + "%", "%" + search + "%"]
    if project:
        sql += " AND project = ?"
        args.append(project)
    order = {"recent": "last_activity DESC",
             "name": "title COLLATE NOCASE ASC",
             "activity": "msg_count DESC"}.get(sort, "last_activity DESC")
    sql += " ORDER BY " + order
    rows = [dict(r) for r in conn.execute(sql, args)]
    conn.close()
    return rows
```

- [ ] **Step 4: 통과 확인**

Run: `python -m unittest tests.test_index -v`
Expected: PASS (4 tests)

- [ ] **Step 5: 커밋**

```bash
git add csm/indexer.py tests/test_index.py
git commit -m "feat: SQLite 증분 인덱싱 + 검색/정렬 쿼리"
```

---

### Task 4: 본문 로더 (load_transcript)

**Files:**
- Create: `csm/transcript.py`
- Test: `tests/test_transcript.py`

- [ ] **Step 1: 실패 테스트 작성**

`tests/test_transcript.py`:
```python
import os, json, unittest, tempfile
from csm.transcript import load_transcript

class TestTranscript(unittest.TestCase):
    def test_returns_messages_in_order(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "s.jsonl")
            with open(p, "w", encoding="utf-8") as f:
                f.write(json.dumps({"type": "user",
                    "message": {"role": "user", "content": "질문1"}}) + "\n")
                f.write(json.dumps({"type": "assistant",
                    "message": {"role": "assistant",
                                "content": [{"type": "text", "text": "답변1"}]}}) + "\n")
                f.write(json.dumps({"type": "system", "content": "무시됨"}) + "\n")
            msgs = load_transcript(p)
            self.assertEqual([m["role"] for m in msgs], ["user", "assistant"])
            self.assertEqual(msgs[0]["text"], "질문1")
            self.assertEqual(msgs[1]["text"], "답변1")

    def test_tool_blocks_flagged(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "s.jsonl")
            with open(p, "w", encoding="utf-8") as f:
                f.write(json.dumps({"type": "assistant",
                    "message": {"role": "assistant", "content": [
                        {"type": "tool_use", "name": "Bash", "input": {"command": "ls"}}]}}) + "\n")
            msgs = load_transcript(p)
            self.assertEqual(msgs[0]["role"], "assistant")
            self.assertTrue(msgs[0]["has_tool"])

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: 실패 확인**

Run: `python -m unittest tests.test_transcript -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'csm.transcript'`

- [ ] **Step 3: 최소 구현**

`csm/transcript.py`:
```python
import json

def _render(content):
    text_parts, tool_parts = [], []
    if isinstance(content, str):
        return content, []
    if isinstance(content, list):
        for b in content:
            if not isinstance(b, dict):
                continue
            bt = b.get("type")
            if bt == "text" and b.get("text"):
                text_parts.append(b["text"])
            elif bt == "tool_use":
                tool_parts.append({"name": b.get("name", "tool"),
                                   "input": b.get("input", {})})
            elif bt == "tool_result":
                tool_parts.append({"name": "result", "input": b.get("content", "")})
    return " ".join(text_parts), tool_parts

def load_transcript(file_path, limit=None):
    msgs = []
    with open(file_path, encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                o = json.loads(line)
            except Exception:
                continue
            if o.get("type") not in ("user", "assistant"):
                continue
            msg = o.get("message", {})
            text, tools = _render(msg.get("content"))
            msgs.append({
                "role": o.get("type"),
                "text": text,
                "tools": tools,
                "has_tool": bool(tools),
                "timestamp": o.get("timestamp", ""),
            })
    if limit:
        msgs = msgs[-limit:]
    return msgs
```

- [ ] **Step 4: 통과 확인**

Run: `python -m unittest tests.test_transcript -v`
Expected: PASS (2 tests)

- [ ] **Step 5: 커밋**

```bash
git add csm/transcript.py tests/test_transcript.py
git commit -m "feat: 본문 로더 (load_transcript)"
```

---

### Task 5: 즐겨찾기 (store.favorites)

**Files:**
- Create: `csm/store.py`
- Test: `tests/test_favorites.py`

- [ ] **Step 1: 실패 테스트 작성**

`tests/test_favorites.py`:
```python
import os, unittest, tempfile
from csm import store

class TestFavorites(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.fav = os.path.join(self.tmp.name, "fav.json")

    def tearDown(self):
        self.tmp.cleanup()

    def test_toggle_adds_then_removes(self):
        self.assertEqual(store.load_favorites(self.fav), set())
        self.assertTrue(store.toggle_favorite(self.fav, "s1"))
        self.assertIn("s1", store.load_favorites(self.fav))
        self.assertFalse(store.toggle_favorite(self.fav, "s1"))
        self.assertNotIn("s1", store.load_favorites(self.fav))

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: 실패 확인**

Run: `python -m unittest tests.test_favorites -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'csm.store'`

- [ ] **Step 3: 최소 구현**

`csm/store.py`:
```python
import os, json, shutil, time

def load_favorites(path):
    if not os.path.exists(path):
        return set()
    try:
        with open(path, encoding="utf-8") as f:
            return set(json.load(f))
    except Exception:
        return set()

def _save_favorites(path, favs):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(sorted(favs), f, ensure_ascii=False)

def toggle_favorite(path, sid):
    favs = load_favorites(path)
    if sid in favs:
        favs.discard(sid)
        added = False
    else:
        favs.add(sid)
        added = True
    _save_favorites(path, favs)
    return added
```

- [ ] **Step 4: 통과 확인**

Run: `python -m unittest tests.test_favorites -v`
Expected: PASS (1 test)

- [ ] **Step 5: 커밋**

```bash
git add csm/store.py tests/test_favorites.py
git commit -m "feat: 즐겨찾기 토글"
```

---

### Task 6: 휴지통 삭제/복원 (store.delete/restore)

**Files:**
- Modify: `csm/store.py`
- Test: `tests/test_trash.py`

- [ ] **Step 1: 실패 테스트 작성**

`tests/test_trash.py`:
```python
import os, json, unittest, tempfile
from csm import store

class TestTrash(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.proj = os.path.join(self.tmp.name, "projects", "projA")
        os.makedirs(self.proj)
        self.trash = os.path.join(self.tmp.name, "projects", "_trash")
        self.meta = os.path.join(self.tmp.name, "trash.json")
        self.f = os.path.join(self.proj, "s1.jsonl")
        with open(self.f, "w", encoding="utf-8") as fp:
            fp.write("{}\n")

    def tearDown(self):
        self.tmp.cleanup()

    def test_delete_moves_to_trash(self):
        store.delete_session(self.f, "s1", self.trash, self.meta)
        self.assertFalse(os.path.exists(self.f))
        self.assertTrue(os.path.exists(os.path.join(self.trash, "s1.jsonl")))

    def test_restore_returns_to_origin(self):
        store.delete_session(self.f, "s1", self.trash, self.meta)
        store.restore_session("s1", self.trash, self.meta)
        self.assertTrue(os.path.exists(self.f))
        self.assertFalse(os.path.exists(os.path.join(self.trash, "s1.jsonl")))

    def test_list_trash(self):
        store.delete_session(self.f, "s1", self.trash, self.meta)
        items = store.list_trash(self.meta)
        self.assertEqual(items[0]["session_id"], "s1")

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: 실패 확인**

Run: `python -m unittest tests.test_trash -v`
Expected: FAIL — `AttributeError: module 'csm.store' has no attribute 'delete_session'`

- [ ] **Step 3: 최소 구현** — `csm/store.py` 끝에 추가

```python
def _load_trash_meta(path):
    if not os.path.exists(path):
        return {}
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}

def _save_trash_meta(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)

def delete_session(file_path, sid, trash_dir, meta_path):
    os.makedirs(trash_dir, exist_ok=True)
    dest = os.path.join(trash_dir, sid + ".jsonl")
    shutil.move(file_path, dest)
    meta = _load_trash_meta(meta_path)
    meta[sid] = {"session_id": sid, "origin": file_path, "deleted_at": time.time()}
    _save_trash_meta(meta_path, meta)
    return dest

def restore_session(sid, trash_dir, meta_path):
    meta = _load_trash_meta(meta_path)
    info = meta.get(sid)
    if not info:
        return False
    src = os.path.join(trash_dir, sid + ".jsonl")
    os.makedirs(os.path.dirname(info["origin"]), exist_ok=True)
    shutil.move(src, info["origin"])
    del meta[sid]
    _save_trash_meta(meta_path, meta)
    return True

def list_trash(meta_path):
    return sorted(_load_trash_meta(meta_path).values(),
                  key=lambda x: x.get("deleted_at", 0), reverse=True)
```

- [ ] **Step 4: 통과 확인**

Run: `python -m unittest tests.test_trash -v`
Expected: PASS (3 tests)

- [ ] **Step 5: 커밋**

```bash
git add csm/store.py tests/test_trash.py
git commit -m "feat: 휴지통 이동/복원/목록"
```

---

### Task 7: 리네임 (store.rename + native 저장위치 검증)

**Files:**
- Modify: `csm/store.py`
- Test: `tests/test_rename.py`

- [ ] **Step 1: native 저장 위치 확인 (수동 검증)**

리네임이 `claude -r` 피커와 동기화되려면 native가 custom-title을 어디에 쓰는지 알아야 한다. 이미 이름붙인 세션의 **자기 파일** 안에 custom-title이 있는지 확인:

Run:
```bash
python -c "import json,glob,os; \
sid='SID_확인용'; \
[print('FOUND in', os.path.basename(f)) for f in glob.glob(os.path.expanduser('~/.claude/projects/**/'+sid+'.jsonl'),recursive=True) \
 for l in open(f,encoding='utf-8') if '\"custom-title\"' in l and sid in l]"
```
(SID는 `cs.bat` 결과의 이름붙은 세션 ID 하나로 치환)
Expected: 해당 세션 자기 파일에서 FOUND이면 → 자기 파일 append 채택. 안 나오면 bridge 파일 경로를 추가 조사해 append 대상 결정. **결론을 plan 주석에 기록하고 Step 3 구현 반영.**

- [ ] **Step 2: 실패 테스트 작성**

`tests/test_rename.py`:
```python
import os, json, unittest, tempfile
from csm import store, indexer

class TestRename(unittest.TestCase):
    def test_rename_appends_and_reindexes(self):
        with tempfile.TemporaryDirectory() as d:
            sid = "r1"
            p = os.path.join(d, sid + ".jsonl")
            with open(p, "w", encoding="utf-8") as f:
                f.write(json.dumps({"type": "user", "sessionId": sid,
                    "message": {"role": "user", "content": "hi"}}) + "\n")
            store.rename_session(p, sid, "새이름")
            r = indexer.parse_session(p)
            self.assertEqual(r["title"], "새이름")
            with open(p, encoding="utf-8") as f:
                last = [json.loads(x) for x in f if x.strip()][-1]
            self.assertEqual(last["type"], "custom-title")
            self.assertEqual(last["customTitle"], "새이름")
            self.assertEqual(last["sessionId"], sid)

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 3: 실패 확인**

Run: `python -m unittest tests.test_rename -v`
Expected: FAIL — `AttributeError: ... 'rename_session'`

- [ ] **Step 4: 최소 구현** — `csm/store.py` 끝에 추가

```python
def rename_session(file_path, sid, new_title):
    record = {"type": "custom-title", "customTitle": new_title, "sessionId": sid}
    with open(file_path, "a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")
    return True
```

- [ ] **Step 5: 통과 확인**

Run: `python -m unittest tests.test_rename -v`
Expected: PASS (1 test)

- [ ] **Step 6: 커밋**

```bash
git add csm/store.py tests/test_rename.py
git commit -m "feat: 리네임 (custom-title append)"
```

---

### Task 8: 정리 추천 (cleanup.is_cleanup_candidate)

**Files:**
- Create: `csm/cleanup.py`
- Test: `tests/test_cleanup.py`

- [ ] **Step 1: 실패 테스트 작성**

`tests/test_cleanup.py`:
```python
import unittest
from csm.cleanup import is_cleanup_candidate

NOW = 1_800_000_000.0
DAY = 86400

class TestCleanup(unittest.TestCase):
    def base(self, **kw):
        r = {"last_activity": NOW - 40 * DAY, "msg_count": 1, "title": ""}
        r.update(kw)
        return r

    def test_old_short_unnamed_is_candidate(self):
        self.assertTrue(is_cleanup_candidate(self.base(), set(), NOW))

    def test_recent_not_candidate(self):
        self.assertFalse(is_cleanup_candidate(
            self.base(last_activity=NOW - 5 * DAY), set(), NOW))

    def test_long_not_candidate(self):
        self.assertFalse(is_cleanup_candidate(self.base(msg_count=20), set(), NOW))

    def test_named_not_candidate(self):
        self.assertFalse(is_cleanup_candidate(self.base(title="중요"), set(), NOW))

    def test_favorite_not_candidate(self):
        r = self.base()
        r["session_id"] = "s1"
        self.assertFalse(is_cleanup_candidate(r, {"s1"}, NOW))

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: 실패 확인**

Run: `python -m unittest tests.test_cleanup -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'csm.cleanup'`

- [ ] **Step 3: 최소 구현**

`csm/cleanup.py`:
```python
def is_cleanup_candidate(row, favorites, now, days=30, max_msgs=2):
    if row.get("session_id") in favorites:
        return False
    if (row.get("title") or "").strip():
        return False
    if row.get("msg_count", 0) > max_msgs:
        return False
    age_days = (now - row.get("last_activity", now)) / 86400
    return age_days >= days
```

- [ ] **Step 4: 통과 확인**

Run: `python -m unittest tests.test_cleanup -v`
Expected: PASS (5 tests)

- [ ] **Step 5: 커밋**

```bash
git add csm/cleanup.py tests/test_cleanup.py
git commit -m "feat: 정리 추천 판정"
```

---

### Task 9: HTTP 서버 + API 라우팅

**Files:**
- Create: `csm/server.py`
- Test: `tests/test_server.py`

- [ ] **Step 1: 실패 테스트 작성**

`tests/test_server.py`:
```python
import os, json, unittest, tempfile, threading
from http.client import HTTPConnection
from csm import server, indexer

class TestServer(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        proj = os.path.join(self.tmp.name, "projects", "projA")
        os.makedirs(proj)
        p = os.path.join(proj, "s1.jsonl")
        with open(p, "w", encoding="utf-8") as f:
            f.write(json.dumps({"type": "user", "sessionId": "s1",
                "message": {"role": "user", "content": "테스트질문"}}) + "\n")
        cfg = {
            "projects_dir": os.path.join(self.tmp.name, "projects"),
            "db": os.path.join(self.tmp.name, "idx.db"),
            "fav": os.path.join(self.tmp.name, "fav.json"),
            "trash_dir": os.path.join(self.tmp.name, "projects", "_trash"),
            "trash_meta": os.path.join(self.tmp.name, "trash.json"),
            "web_dir": os.path.join(os.path.dirname(__file__), "..", "web"),
        }
        indexer.build_index(cfg["projects_dir"], cfg["db"])
        self.httpd = server.make_server(cfg, port=0)
        self.port = self.httpd.server_address[1]
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def tearDown(self):
        self.httpd.shutdown()
        self.tmp.cleanup()

    def _get(self, path):
        c = HTTPConnection("127.0.0.1", self.port)
        c.request("GET", path)
        r = c.getresponse()
        return r.status, r.read().decode("utf-8")

    def test_list_returns_sessions(self):
        st, body = self._get("/api/list")
        self.assertEqual(st, 200)
        data = json.loads(body)
        self.assertEqual(len(data["sessions"]), 1)
        self.assertEqual(data["sessions"][0]["session_id"], "s1")

    def test_transcript_returns_messages(self):
        st, body = self._get("/api/transcript?sid=s1")
        self.assertEqual(st, 200)
        data = json.loads(body)
        self.assertEqual(data["messages"][0]["text"], "테스트질문")

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: 실패 확인**

Run: `python -m unittest tests.test_server -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'csm.server'`

- [ ] **Step 3: 최소 구현**

`csm/server.py`:
```python
import os, json, time, subprocess, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs
from csm import indexer, transcript, store, cleanup

def make_server(cfg, port=8765):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _json(self, obj, status=200):
            body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _body_json(self):
            n = int(self.headers.get("Content-Length", 0))
            if not n:
                return {}
            try:
                return json.loads(self.rfile.read(n).decode("utf-8"))
            except Exception:
                return {}

        def do_GET(self):
            u = urlparse(self.path)
            q = parse_qs(u.query)
            if u.path == "/api/list":
                rows = indexer.query_sessions(
                    cfg["db"],
                    search=q.get("search", [""])[0],
                    project=q.get("project", [""])[0],
                    sort=q.get("sort", ["recent"])[0])
                favs = store.load_favorites(cfg["fav"])
                now = time.time()
                for r in rows:
                    r["favorite"] = r["session_id"] in favs
                    r["cleanup"] = cleanup.is_cleanup_candidate(r, favs, now)
                if q.get("favorites", ["0"])[0] == "1":
                    rows = [r for r in rows if r["favorite"]]
                if q.get("cleanup", ["0"])[0] == "1":
                    rows = [r for r in rows if r["cleanup"]]
                projects = sorted({r["project"] for r in
                                   indexer.query_sessions(cfg["db"])})
                return self._json({"sessions": rows, "projects": projects})
            if u.path == "/api/transcript":
                sid = q.get("sid", [""])[0]
                rows = indexer.query_sessions(cfg["db"])
                fp = next((r["file_path"] for r in rows
                           if r["session_id"] == sid), None)
                if not fp or not os.path.exists(fp):
                    return self._json({"messages": []}, 404)
                return self._json({"messages": transcript.load_transcript(fp)})
            if u.path == "/api/trash":
                return self._json({"items": store.list_trash(cfg["trash_meta"])})
            if u.path == "/api/open":
                sid = q.get("sid", [""])[0]
                ok, msg = _open_in_cmd(sid)
                return self._json({"ok": ok, "message": msg})
            return self._serve_static(u.path)

        def do_POST(self):
            u = urlparse(self.path)
            data = self._body_json()
            sid = data.get("sid", "")
            rows = indexer.query_sessions(cfg["db"])
            fp = next((r["file_path"] for r in rows if r["session_id"] == sid), None)
            if u.path == "/api/favorite":
                added = store.toggle_favorite(cfg["fav"], sid)
                return self._json({"favorite": added})
            if u.path == "/api/rename":
                if fp:
                    store.rename_session(fp, sid, data.get("title", ""))
                    indexer.build_index(cfg["projects_dir"], cfg["db"])
                return self._json({"ok": bool(fp)})
            if u.path == "/api/delete":
                if fp:
                    store.delete_session(fp, sid, cfg["trash_dir"], cfg["trash_meta"])
                    indexer.build_index(cfg["projects_dir"], cfg["db"])
                return self._json({"ok": bool(fp)})
            if u.path == "/api/restore":
                ok = store.restore_session(sid, cfg["trash_dir"], cfg["trash_meta"])
                indexer.build_index(cfg["projects_dir"], cfg["db"])
                return self._json({"ok": ok})
            return self._json({"error": "unknown"}, 404)

        def _serve_static(self, path):
            if path == "/" or path == "":
                path = "/index.html"
            fp = os.path.join(cfg["web_dir"], path.lstrip("/"))
            if not os.path.isfile(fp):
                self.send_response(404)
                self.end_headers()
                return
            ctype = "text/html; charset=utf-8" if fp.endswith(".html") else "text/plain"
            with open(fp, "rb") as f:
                body = f.read()
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    def _open_in_cmd(sid):
        if not sid:
            return False, "no sid"
        try:
            if sys.platform == "win32":
                subprocess.Popen(["cmd", "/k", "claude", "-r", sid],
                                 creationflags=0x00000010)  # CREATE_NEW_CONSOLE
            else:
                subprocess.Popen(["claude", "-r", sid])
            return True, "opened"
        except FileNotFoundError:
            return False, "claude 명령을 찾을 수 없습니다 (설치/PATH 확인)"
        except Exception as e:
            return False, str(e)

    return ThreadingHTTPServer(("127.0.0.1", port), Handler)
```

- [ ] **Step 4: 통과 확인**

Run: `python -m unittest tests.test_server -v`
Expected: PASS (2 tests)

- [ ] **Step 5: 커밋**

```bash
git add csm/server.py tests/test_server.py
git commit -m "feat: HTTP 서버 + API 라우팅"
```

---

### Task 10: 웹 UI (index.html)

**Files:**
- Create: `web/index.html`

- [ ] **Step 1: UI 작성**

`web/index.html` (단일 파일, 다크 테마):
```html
<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8">
<title>클로드 세션 매니저</title>
<style>
:root{--bg:#0f1115;--panel:#1a1d24;--line:#2a2e38;--fg:#e6e8ee;--mut:#8b91a0;--acc:#7c5cff;--warn:#e0a030}
*{box-sizing:border-box}body{margin:0;font:14px/1.5 "Malgun Gothic",sans-serif;background:var(--bg);color:var(--fg);display:flex;height:100vh}
#left{width:42%;border-right:1px solid var(--line);display:flex;flex-direction:column}
#right{flex:1;display:flex;flex-direction:column;padding:16px;overflow:hidden}
#bar{padding:10px;border-bottom:1px solid var(--line);display:flex;gap:6px;flex-wrap:wrap}
input,select,button{background:var(--panel);color:var(--fg);border:1px solid var(--line);border-radius:6px;padding:6px 8px}
button{cursor:pointer}button:hover{border-color:var(--acc)}
#search{flex:1;min-width:120px}
#list{overflow:auto;flex:1}
.item{padding:10px 12px;border-bottom:1px solid var(--line);cursor:pointer}
.item:hover{background:#161922}.item.sel{background:#20243030;border-left:3px solid var(--acc)}
.item .t{font-weight:600}.item .m{color:var(--mut);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.badge{font-size:11px;padding:1px 6px;border-radius:10px;margin-left:6px}
.b-clean{background:var(--warn);color:#000}.b-fav{color:var(--warn)}
#meta{color:var(--mut);font-size:12px;margin-bottom:8px}
#acts{display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap}
#body{flex:1;overflow:auto;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:12px}
.msg{margin-bottom:10px}.msg .r{font-size:11px;color:var(--mut)}
.msg.user .x{border-left:3px solid #4a90d9;padding-left:8px}
.msg.assistant .x{border-left:3px solid var(--acc);padding-left:8px}
.tool{color:var(--mut);font-size:12px;font-style:italic}
.title{font-size:16px;font-weight:700;margin-bottom:4px}
</style></head>
<body>
<div id="left">
  <div id="bar">
    <input id="search" placeholder="검색 (이름·첫 질문)">
    <select id="sort"><option value="recent">최근순</option><option value="name">이름순</option><option value="activity">활동량순</option></select>
    <select id="project"><option value="">전체 프로젝트</option></select>
    <button id="favBtn">⭐</button>
    <button id="cleanBtn">🧹정리추천</button>
    <button id="trashBtn">🗑️휴지통</button>
  </div>
  <div id="list"></div>
</div>
<div id="right">
  <div class="title" id="title">세션을 선택하세요</div>
  <div id="meta"></div>
  <div id="acts"></div>
  <div id="body"></div>
</div>
<script>
let state={sid:null,fav:false,clean:false,trash:false};
const $=s=>document.querySelector(s);
function esc(t){return (t||"").replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]))}
async function load(){
  if(state.trash){return loadTrash();}
  const p=new URLSearchParams({search:$("#search").value,sort:$("#sort").value,
    project:$("#project").value,favorites:state.fav?1:0,cleanup:state.clean?1:0});
  const d=await(await fetch("/api/list?"+p)).json();
  const sel=$("#project");
  if(sel.options.length<=1)d.projects.forEach(p=>sel.add(new Option(p,p)));
  $("#list").innerHTML=d.sessions.map(s=>`<div class="item" data-sid="${s.session_id}">
    <div class="t">${s.favorite?'<span class="b-fav">⭐</span>':''}${esc(s.title)||'<span style="color:#666">(이름없음)</span>'}
      ${s.cleanup?'<span class="badge b-clean">정리</span>':''}</div>
    <div class="m">${(s.last_activity?new Date(s.last_activity*1000).toLocaleString('ko'):'')} · ${esc(s.project)} · ${s.msg_count}msg · ${esc(s.first_prompt).slice(0,60)}</div>
  </div>`).join("");
  document.querySelectorAll(".item").forEach(e=>e.onclick=()=>open(e.dataset.sid));
}
async function loadTrash(){
  const d=await(await fetch("/api/trash")).json();
  $("#list").innerHTML=d.items.map(i=>`<div class="item" data-sid="${i.session_id}">
    <div class="t">${esc(i.session_id)}</div><div class="m">삭제: ${new Date(i.deleted_at*1000).toLocaleString('ko')}</div>
    <button onclick="restore('${i.session_id}')">복원</button></div>`).join("")||"<div style='padding:16px;color:#666'>휴지통 비어있음</div>";
}
async function open(sid){
  state.sid=sid;
  document.querySelectorAll(".item").forEach(e=>e.classList.toggle("sel",e.dataset.sid===sid));
  const d=await(await fetch("/api/transcript?sid="+encodeURIComponent(sid))).json();
  $("#title").textContent=sid;
  $("#acts").innerHTML=`<button onclick="fav()">⭐즐겨찾기</button>
    <button onclick="rename()">✏️리네임</button>
    <button onclick="openCmd()">▶️cmd에서 열기</button>
    <button onclick="del()">🗑️삭제</button>`;
  $("#body").innerHTML=d.messages.map(m=>`<div class="msg ${m.role}">
    <div class="r">${m.role}</div><div class="x">${esc(m.text)||(m.has_tool?'<span class="tool">[도구 호출]</span>':'')}</div></div>`).join("");
  $("#body").scrollTop=$("#body").scrollHeight;
}
async function post(url,b){return (await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(b)})).json();}
async function fav(){await post("/api/favorite",{sid:state.sid});load();}
async function rename(){const t=prompt("새 이름:");if(t!=null){await post("/api/rename",{sid:state.sid,title:t});load();}}
async function del(){if(confirm("휴지통으로 이동할까요?")){await post("/api/delete",{sid:state.sid});load();$("#body").innerHTML="";}}
async function restore(sid){await post("/api/restore",{sid});loadTrash();}
async function openCmd(){const r=await(await fetch("/api/open?sid="+encodeURIComponent(state.sid))).json();if(!r.ok)alert(r.message);}
$("#search").oninput=load;$("#sort").onchange=load;$("#project").onchange=load;
$("#favBtn").onclick=()=>{state.fav=!state.fav;$("#favBtn").style.borderColor=state.fav?'#e0a030':'';load();};
$("#cleanBtn").onclick=()=>{state.clean=!state.clean;load();};
$("#trashBtn").onclick=()=>{state.trash=!state.trash;load();};
load();
</script></body></html>
```

- [ ] **Step 2: 커밋**

```bash
git add web/index.html
git commit -m "feat: 웹 UI (다크 테마, 본문 미리보기 자동 스크롤)"
```

---

### Task 11: 진입점 + 실연 검증

**Files:**
- Create: `session_manager.py`
- Create: `cs.bat`

- [ ] **Step 1: 진입점 작성**

`session_manager.py`:
```python
import os, sys, time, threading, webbrowser
from csm import paths, indexer, server

def _web_dir():
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, "web")

def main():
    pdir = paths.projects_dir()
    if not os.path.isdir(pdir):
        print("세션 폴더를 찾을 수 없습니다:", pdir)
        print("CLAUDE_CONFIG_DIR 환경변수를 확인하세요.")
        input("엔터로 종료...")
        return
    cfg = {
        "projects_dir": pdir, "db": paths.index_db_path(),
        "fav": paths.favorites_path(), "trash_dir": paths.trash_dir(),
        "trash_meta": paths.trash_meta_path(), "web_dir": _web_dir(),
    }
    print("인덱싱 중... (첫 실행은 수십 초 걸릴 수 있어요)")
    n = indexer.build_index(pdir, cfg["db"],
        progress=lambda i, t: print(f"  {i}/{t}", end="\r"))
    print(f"\n인덱싱 완료 (갱신 {n}개).")
    port = 8765
    httpd = server.make_server(cfg, port=port)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{port}/"
    print("열기:", url)
    webbrowser.open(url)
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        httpd.shutdown()

if __name__ == "__main__":
    main()
```

`cs.bat`:
```bat
@echo off
chcp 65001 >nul
cd /d "%~dp0"
python session_manager.py
```

- [ ] **Step 2: 전체 테스트 통과 확인**

Run: `python -m unittest discover -s tests -v`
Expected: 모든 테스트 PASS

- [ ] **Step 3: 실연 검증**

Run: `python session_manager.py` (별도 콘솔)
확인: 브라우저 열림 → 리스트 표시 → 검색 동작 → 세션 클릭 시 본문이 맨 아래(최신)로 스크롤 → ⭐/정리추천/휴지통 토글 동작 → ▶️cmd에서 열기 클릭 시 새 cmd 창에 `claude -r` 뜨는지.
문제 발견 시 systematic-debugging으로 수정.

- [ ] **Step 4: 커밋**

```bash
git add session_manager.py cs.bat
git commit -m "feat: 진입점 + bat 런처 + 실연 검증"
```

---

### Task 12: PyInstaller exe 빌드

**Files:**
- Create: `build_exe.bat`

- [ ] **Step 1: 빌드 스크립트 작성**

`build_exe.bat`:
```bat
@echo off
chcp 65001 >nul
cd /d "%~dp0"
pip install pyinstaller
pyinstaller --onefile --name 세션매니저 ^
  --add-data "web;web" ^
  --hidden-import csm.paths --hidden-import csm.indexer ^
  --hidden-import csm.transcript --hidden-import csm.store ^
  --hidden-import csm.cleanup --hidden-import csm.server ^
  session_manager.py
echo.
echo 빌드 완료: dist\세션매니저.exe
```

- [ ] **Step 2: 빌드 실행 + 검증**

Run: `build_exe.bat`
확인: `dist\세션매니저.exe` 생성 → 더블클릭 → 콘솔에 인덱싱 → 브라우저 열림 → 리스트·본문·열기 동작.
(주의: `_web_dir()`가 `sys._MEIPASS`를 통해 번들된 web을 찾는지 — Task 11 Step 1에서 이미 반영됨)

- [ ] **Step 3: 커밋**

```bash
git add build_exe.bat
git commit -m "build: PyInstaller exe 빌드 스크립트"
```

---

## Self-Review 체크

- **스펙 커버리지**: 경로 자동탐색(T1) · 인덱싱/검색/정렬(T2,T3) · 본문 미리보기(T4,T10) · 즐겨찾기(T5) · 휴지통(T6) · 리네임(T7) · 정리추천(T8) · API(T9) · UI(T10) · cmd열기(T9 `_open_in_cmd`) · exe(T12) — 전부 매핑됨.
- **타입 일관성**: `query_sessions`/`parse_session` 반환 dict 키, `make_server(cfg, port)` cfg 키(`projects_dir/db/fav/trash_dir/trash_meta/web_dir`), `delete_session(file_path, sid, trash_dir, meta_path)` 시그니처가 T6·T9에서 일치.
- **검증 과제**: T7 Step 1의 native custom-title 저장위치 확인 — append 대상 결정 후 결과를 plan에 기록.
- **플레이스홀더**: 없음(모든 코드 스텝에 실제 코드 포함).
