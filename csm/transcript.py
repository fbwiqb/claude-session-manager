import json

def _render(content):
    text_parts, tool_parts = [], []
    if isinstance(content, str):
        return content, []
    if isinstance(content, list):
        for b in content:
            if not isinstance(b, dict):
                continue
            bt = b.get("type")
            if bt == "text" and b.get("text"):
                text_parts.append(b["text"])
            elif bt == "tool_use":
                tool_parts.append({"name": b.get("name", "tool"),
                                   "input": b.get("input", {})})
            elif bt == "tool_result":
                tool_parts.append({"name": "result", "input": b.get("content", "")})
    return " ".join(text_parts), tool_parts

def load_transcript(file_path, limit=None):
    msgs = []
    with open(file_path, encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                o = json.loads(line)
            except Exception:
                continue
            if o.get("type") not in ("user", "assistant"):
                continue
            msg = o.get("message", {})
            text, tools = _render(msg.get("content"))
            msgs.append({
                "role": o.get("type"),
                "text": text,
                "tools": tools,
                "has_tool": bool(tools),
                "timestamp": o.get("timestamp", ""),
            })
    if limit:
        msgs = msgs[-limit:]
    return msgs
