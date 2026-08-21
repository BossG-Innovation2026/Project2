INSERT INTO settings (key, value) VALUES ('subject_list', '[]') ON CONFLICT(key) DO NOTHING;
