import os, json, time, subprocess, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs
from csm import indexer, transcript, store, cleanup

def make_server(cfg, port=8765):
    def _open_in_cmd(sid):
        if not store.is_valid_sid(sid):
            return False, "invalid session id"
        try:
            if sys.platform == "win32":
                subprocess.Popen(["cmd", "/k", "claude", "-r", sid],
                                 creationflags=0x00000010)
            else:
                subprocess.Popen(["claude", "-r", sid])
            return True, "opened"
        except FileNotFoundError:
            return False, "claude 명령을 찾을 수 없습니다 (설치/PATH 확인)"
        except Exception as e:
            return False, str(e)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _same_site(self):
            host = self.headers.get("Host", "").split(":")[0]
            if host not in ("127.0.0.1", "localhost"):
                return False
            sfs = self.headers.get("Sec-Fetch-Site")
            if sfs is not None and sfs not in ("same-origin", "none"):
                return False
            origin = self.headers.get("Origin")
            if origin:
                try:
                    oh = urlparse(origin).hostname
                except Exception:
                    return False
                if oh not in ("127.0.0.1", "localhost"):
                    return False
            return True

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
            if not self._same_site():
                return self._json({"error": "forbidden"}, 403)
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
            return self._serve_static(u.path)

        def do_POST(self):
            if not self._same_site():
                return self._json({"error": "forbidden"}, 403)
            u = urlparse(self.path)
            data = self._body_json()
            sid = data.get("sid", "")
            if u.path == "/api/open":
                ok, msg = _open_in_cmd(sid)
                return self._json({"ok": ok, "message": msg})
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
            web_root = os.path.realpath(cfg["web_dir"])
            rel = path.lstrip("/").replace("/", os.sep)
            fp = os.path.realpath(os.path.join(web_root, rel))
            try:
                inside = os.path.commonpath([web_root, fp]) == web_root
            except ValueError:
                inside = False
            if not inside or not os.path.isfile(fp):
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

    return ThreadingHTTPServer(("127.0.0.1", port), Handler)
