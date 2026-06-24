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
