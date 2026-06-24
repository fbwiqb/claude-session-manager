import os, json, unittest, tempfile
from csm.transcript import load_transcript

class TestTranscript(unittest.TestCase):
    def test_returns_messages_in_order(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "s.jsonl")
            with open(p, "w", encoding="utf-8") as f:
                f.write(json.dumps({"type": "user",
                    "message": {"role": "user", "content": "질문1"}}) + "\n")
                f.write(json.dumps({"type": "assistant",
                    "message": {"role": "assistant",
                                "content": [{"type": "text", "text": "답변1"}]}}) + "\n")
                f.write(json.dumps({"type": "system", "content": "무시됨"}) + "\n")
            msgs = load_transcript(p)
            self.assertEqual([m["role"] for m in msgs], ["user", "assistant"])
            self.assertEqual(msgs[0]["text"], "질문1")
            self.assertEqual(msgs[1]["text"], "답변1")

    def test_tool_blocks_flagged(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "s.jsonl")
            with open(p, "w", encoding="utf-8") as f:
                f.write(json.dumps({"type": "assistant",
                    "message": {"role": "assistant", "content": [
                        {"type": "tool_use", "name": "Bash", "input": {"command": "ls"}}]}}) + "\n")
            msgs = load_transcript(p)
            self.assertEqual(msgs[0]["role"], "assistant")
            self.assertTrue(msgs[0]["has_tool"])

if __name__ == "__main__":
    unittest.main()
