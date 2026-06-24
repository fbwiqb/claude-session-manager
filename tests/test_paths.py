import os, unittest, tempfile
from csm import paths

class TestPaths(unittest.TestCase):
    def test_config_dir_uses_env_override(self):
        with tempfile.TemporaryDirectory() as d:
            os.environ["CLAUDE_CONFIG_DIR"] = d
            try:
                self.assertEqual(paths.config_dir(), d)
            finally:
                del os.environ["CLAUDE_CONFIG_DIR"]

    def test_config_dir_defaults_to_home_claude(self):
        os.environ.pop("CLAUDE_CONFIG_DIR", None)
        expected = os.path.join(os.path.expanduser("~"), ".claude")
        self.assertEqual(paths.config_dir(), expected)

    def test_projects_dir_is_under_config(self):
        os.environ.pop("CLAUDE_CONFIG_DIR", None)
        self.assertTrue(paths.projects_dir().endswith(os.path.join(".claude", "projects")))

    def test_claude_command_is_name_only(self):
        self.assertEqual(paths.claude_command(), "claude")

if __name__ == "__main__":
    unittest.main()
