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
