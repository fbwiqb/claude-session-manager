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

    def test_agent_files_excluded(self):
        p = os.path.join(self.proj, "projA")
        write_session(p, "agent-abc123")
        write_session(p, "realone")
        indexer.build_index(self.proj, self.db)
        rows = indexer.query_sessions(self.db)
        self.assertEqual([r["session_id"] for r in rows], ["realone"])

    def test_prunes_deleted_files(self):
        p = os.path.join(self.proj, "projA")
        f1 = write_session(p, "s1")
        write_session(p, "s2")
        indexer.build_index(self.proj, self.db)
        self.assertEqual(len(indexer.query_sessions(self.db)), 2)
        os.remove(f1)
        indexer.build_index(self.proj, self.db)
        ids = [r["session_id"] for r in indexer.query_sessions(self.db)]
        self.assertEqual(ids, ["s2"])

if __name__ == "__main__":
    unittest.main()
