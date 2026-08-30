-- Add UNIQUE(teacher_id, date, period) to absences to prevent duplicate leave
-- requests from concurrent submissions.
--
-- SQLite cannot add a UNIQUE constraint via ALTER TABLE, so we rebuild the
-- table, deduplicating any existing rows (keeping the most recently reviewed
-- / created row per teacher+date+period), then swap it in.

CREATE TABLE absences_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  period INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined')),
  requested_by INTEGER NOT NULL REFERENCES users(id),
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (teacher_id, date, period)
);

-- Copy rows, keeping the row with the highest id for each (teacher,date,period).
INSERT OR IGNORE INTO absences_new (id, teacher_id, date, period, reason, status, requested_by, reviewed_by, reviewed_at, created_at)
SELECT id, teacher_id, date, period, reason, status, requested_by, reviewed_by, reviewed_at, created_at
FROM absences
ORDER BY id DESC;

DROP TABLE absences;

ALTER TABLE absences_new RENAME TO absences;

CREATE INDEX IF NOT EXISTS idx_absences_lookup ON absences (date, period, status);
