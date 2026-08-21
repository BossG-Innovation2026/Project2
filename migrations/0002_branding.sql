INSERT INTO settings (key, value) VALUES ('system_name', 'CSHS TRACE') ON CONFLICT(key) DO NOTHING;
INSERT INTO settings (key, value) VALUES ('system_tagline', 'Teacher Relief Coordination') ON CONFLICT(key) DO NOTHING;
