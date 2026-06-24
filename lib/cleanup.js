function isCleanupCandidate(row, favorites, now, days = 30) {
  if (favorites.has(row.session_id)) return false;
  if ((row.title || "").trim()) return false;
  const ageDays = (now - (row.last_activity || now)) / 86400;
  return ageDays >= days;
}

module.exports = { isCleanupCandidate };
