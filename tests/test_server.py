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
