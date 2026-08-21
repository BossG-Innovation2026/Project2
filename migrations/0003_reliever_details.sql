ALTER TABLE teacher_profiles ADD COLUMN cluster TEXT NOT NULL DEFAULT '';
ALTER TABLE teacher_profiles ADD COLUMN room TEXT NOT NULL DEFAULT '';
UPDATE settings SET value = 'Teacher Reliever Coordination' WHERE key = 'system_tagline' AND value = 'Teacher Relief Coordination';
