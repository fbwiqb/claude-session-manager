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
