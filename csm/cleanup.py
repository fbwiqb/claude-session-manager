def is_cleanup_candidate(row, favorites, now, days=30):
    if row.get("session_id") in favorites:
        return False
    if (row.get("title") or "").strip():
        return False
    age_days = (now - row.get("last_activity", now)) / 86400
    return age_days >= days
