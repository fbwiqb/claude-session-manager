import os, json, unittest, tempfile
from csm.indexer import parse_session

def write_jsonl(path, lines):
    with open(path, "w", encoding="utf-8") as f:
        for o in lines:
            f.write(json.dumps(o, ensure_ascii=False) + "\n")

class TestParse(unittest.TestCase):
    def test_extracts_title_first_prompt_count(self):
        with tempfile.TemporaryDirectory() as d:
            sid = "11111111-2222-3333-4444-555555555555"
            p = os.path.join(d, sid + ".jsonl")
            write_jsonl(p, [
                {"type": "user", "sessionId": sid,
                 "message": {"role": "user", "content": "안녕 첫 질문이야"},
                 "timestamp": "2026-06-20T10:00:00.000Z"},
                {"type": "assistant", "sessionId": sid,
                 "message": {"role": "assistant", "model": "claude-opus-4-8",
                             "content": [{"type": "text", "text": "답변"}]},
                 "timestamp": "2026-06-20T10:00:05.000Z"},
                {"type": "custom-title", "customTitle": "내 세션", "sessionId": sid},
            ])
            r = parse_session(p)
            self.assertEqual(r["session_id"], sid)
            self.assertEqual(r["title"], "내 세션")
            self.assertEqual(r["first_prompt"], "안녕 첫 질문이야")
            self.assertEqual(r["msg_count"], 2)
            self.assertEqual(r["model"], "claude-opus-4-8")
            self.assertTrue(r["size_bytes"] > 0)

    def test_no_title_returns_empty(self):
        with tempfile.TemporaryDirectory() as d:
            sid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
            p = os.path.join(d, sid + ".jsonl")
            write_jsonl(p, [
                {"type": "user", "sessionId": sid,
                 "message": {"role": "user",
                             "content": [{"type": "text", "text": "리스트형 내용"}]}},
            ])
            r = parse_session(p)
            self.assertEqual(r["title"], "")
            self.assertEqual(r["first_prompt"], "리스트형 내용")

if __name__ == "__main__":
    unittest.main()
