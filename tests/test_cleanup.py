import unittest
from csm.cleanup import is_cleanup_candidate

NOW = 1_800_000_000.0
DAY = 86400

class TestCleanup(unittest.TestCase):
    def base(self, **kw):
        r = {"last_activity": NOW - 40 * DAY, "msg_count": 1, "title": ""}
        r.update(kw)
        return r

    def test_old_short_unnamed_is_candidate(self):
        self.assertTrue(is_cleanup_candidate(self.base(), set(), NOW))

    def test_recent_not_candidate(self):
        self.assertFalse(is_cleanup_candidate(
            self.base(last_activity=NOW - 5 * DAY), set(), NOW))

    def test_long_old_unnamed_is_candidate(self):
        self.assertTrue(is_cleanup_candidate(self.base(msg_count=20), set(), NOW))

    def test_named_not_candidate(self):
        self.assertFalse(is_cleanup_candidate(self.base(title="중요"), set(), NOW))

    def test_favorite_not_candidate(self):
        r = self.base()
        r["session_id"] = "s1"
        self.assertFalse(is_cleanup_candidate(r, {"s1"}, NOW))

if __name__ == "__main__":
    unittest.main()
