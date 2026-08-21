-- Custom branding assets (logo, login background) stored as blobs
CREATE TABLE IF NOT EXISTS assets (
  name TEXT PRIMARY KEY,
  content_type TEXT NOT NULL,
  data BLOB NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
