import os, json, unittest, tempfile, threading
from http.client import HTTPConnection
from csm import server, indexer


def write_session(d, sid, ts=None, title=None):
    p = os.path.join(d, sid + ".jsonl")
    with open(p, "w", encoding="utf-8") as f:
        rec = {"type": "user", "sessionId": sid,
               "message": {"role": "user", "content": "hi"}}
        if ts:
            rec["timestamp"] = ts
        f.write(json.dumps(rec) + "\n")
        if title:
            f.write(json.dumps({"type": "custom-title", "customTitle": title,
                                "sessionId": sid}) + "\n")
    return p


class TestCleanupApi(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        proj = os.path.join(self.tmp.name, "projects", "projA")
        os.makedirs(proj)
        write_session(proj, "old_unnamed", ts="2020-01-01T00:00:00.000Z")
        write_session(proj, "old_named", ts="2020-01-01T00:00:00.000Z", title="중요")
        write_session(proj, "recent")
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

    def _post(self, path):
        c = HTTPConnection("127.0.0.1", self.port)
        c.request("POST", path, body="{}",
                  headers={"Content-Type": "application/json"})
        r = c.getresponse()
        out = json.loads(r.read().decode("utf-8"))
        c.close()
        return out

    def test_cleanup_delete_only_old_unnamed(self):
        out = self._post("/api/cleanup-delete")
        self.assertEqual(out["deleted"], 1)
        remaining = {r["session_id"] for r in indexer.query_sessions(self.cfg["db"])}
        self.assertIn("old_named", remaining)
        self.assertIn("recent", remaining)
        self.assertNotIn("old_unnamed", remaining)
        self.assertTrue(os.path.exists(
            os.path.join(self.cfg["trash_dir"], "old_unnamed.jsonl")))


if __name__ == "__main__":
    unittest.main()
