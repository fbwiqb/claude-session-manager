import os, json, shutil, time, re

_SID_RE = re.compile(r"\A[A-Za-z0-9_-]{1,64}\Z")

def is_valid_sid(sid):
    return bool(sid) and bool(_SID_RE.match(sid))

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
    if not is_valid_sid(sid):
        return False
    os.makedirs(trash_dir, exist_ok=True)
    dest = os.path.join(trash_dir, os.path.basename(sid) + ".jsonl")
    try:
        shutil.move(file_path, dest)
    except (OSError, PermissionError):
        return False
    meta = _load_trash_meta(meta_path)
    meta[sid] = {"session_id": sid, "origin": file_path, "deleted_at": time.time()}
    _save_trash_meta(meta_path, meta)
    return dest

def restore_session(sid, trash_dir, meta_path):
    if not is_valid_sid(sid):
        return False
    meta = _load_trash_meta(meta_path)
    info = meta.get(sid)
    if not info:
        return False
    proj_root = os.path.realpath(os.path.dirname(trash_dir))
    dest = os.path.realpath(info["origin"])
    try:
        if os.path.commonpath([proj_root, dest]) != proj_root:
            return False
    except ValueError:
        return False
    src = os.path.join(trash_dir, os.path.basename(sid) + ".jsonl")
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    shutil.move(src, dest)
    del meta[sid]
    _save_trash_meta(meta_path, meta)
    return True

def list_trash(meta_path):
    return sorted(_load_trash_meta(meta_path).values(),
                  key=lambda x: x.get("deleted_at", 0), reverse=True)

def rename_session(file_path, sid, new_title):
    record = {"type": "custom-title", "customTitle": new_title, "sessionId": sid}
    with open(file_path, "a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")
    return True
