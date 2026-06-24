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
