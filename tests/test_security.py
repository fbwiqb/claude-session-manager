import os, json, unittest, tempfile, threading, socket
from csm import server, indexer, store


class TestSidValidation(unittest.TestCase):
    def test_valid_and_invalid(self):
        self.assertTrue(store.is_valid_sid("79119aeb-7747-4e1c-a195-73d9abcf5824"))
        self.assertTrue(store.is_valid_sid("s1"))
        self.assertFalse(store.is_valid_sid(""))
        self.assertFalse(store.is_valid_sid('x" & echo PWNED & rem '))
        self.assertFalse(store.is_valid_sid("../../etc/passwd"))
        self.assertFalse(store.is_valid_sid("a/b"))

    def test_store_rejects_bad_sid(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertFalse(store.delete_session(
                os.path.join(d, "x.jsonl"), "../evil",
                os.path.join(d, "_trash"), os.path.join(d, "m.json")))
            self.assertFalse(store.restore_session(
                "../evil", os.path.join(d, "_trash"), os.path.join(d, "m.json")))

    def test_restore_confines_to_projects(self):
        with tempfile.TemporaryDirectory() as d:
            proj = os.path.join(d, "projects", "projA")
            os.makedirs(proj)
            trash = os.path.join(d, "projects", "_trash")
            meta = os.path.join(d, "m.json")
            f = os.path.join(proj, "s1.jsonl")
            with open(f, "w", encoding="utf-8") as fp:
                fp.write("{}\n")
            store.delete_session(f, "s1", trash, meta)
            data = json.load(open(meta, encoding="utf-8"))
            data["s1"]["origin"] = os.path.join(d, "OUTSIDE", "pwned.jsonl")
            json.dump(data, open(meta, "w", encoding="utf-8"))
            self.assertFalse(store.restore_session("s1", trash, meta))
            self.assertFalse(os.path.exists(os.path.join(d, "OUTSIDE", "pwned.jsonl")))


class TestServerSecurity(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        proj = os.path.join(self.tmp.name, "projects", "projA")
        os.makedirs(proj)
        with open(os.path.join(proj, "s1.jsonl"), "w", encoding="utf-8") as f:
            f.write(json.dumps({"type": "user", "sessionId": "s1",
                "message": {"role": "user", "content": "x"}}) + "\n")
        self.cfg = {
            "projects_dir": os.path.join(self.tmp.name, "projects"),
            "db": os.path.join(self.tmp.name, "idx.db"),
            "fav": os.path.join(self.tmp.name, "fav.json"),
            "trash_dir": os.path.join(self.tmp.name, "projects", "_trash"),
            "trash_meta": os.path.join(self.tmp.name, "trash.json"),
            "web_dir": os.path.join(os.path.dirname(__file__), "..", "web"),
        }
        indexer.build_index(self.cfg["projects_dir"], self.cfg["db"])
        self.httpd = server.make_server(self.cfg, port=0)
        self.port = self.httpd.server_address[1]
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def tearDown(self):
        self.httpd.shutdown()
        self.tmp.cleanup()

    def _raw(self, request_line, host="127.0.0.1"):
        s = socket.create_connection(("127.0.0.1", self.port))
        s.sendall((request_line + "\r\nHost: " + host + "\r\nConnection: close\r\n\r\n").encode())
        data = b""
        while True:
            chunk = s.recv(4096)
            if not chunk:
                break
            data += chunk
        s.close()
        return data.decode("utf-8", "replace")

    def test_path_traversal_blocked(self):
        resp = self._raw("GET /../csm/server.py HTTP/1.1")
        self.assertNotIn("200", resp.split("\r\n")[0])
        self.assertNotIn("make_server", resp)

    def test_bad_host_rejected(self):
        resp = self._raw("GET /api/trash HTTP/1.1", host="evil.example.com")
        self.assertIn("403", resp.split("\r\n")[0])

    def test_open_not_reachable_via_get(self):
        resp = self._raw("GET /api/open?sid=s1 HTTP/1.1")
        self.assertIn("404", resp.split("\r\n")[0])


if __name__ == "__main__":
    unittest.main()
