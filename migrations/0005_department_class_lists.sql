INSERT INTO settings (key, value) VALUES ('department_list', '[]') ON CONFLICT(key) DO NOTHING;
INSERT INTO settings (key, value) VALUES ('class_list', '[]') ON CONFLICT(key) DO NOTHING;
