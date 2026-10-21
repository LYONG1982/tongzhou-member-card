CREATE TABLE access_sessions (hash TEXT PRIMARY KEY, access_version TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX access_sessions_expiry ON access_sessions(expires_at);
-- Internal foreign-key principal only; there is no login account or public account API.
INSERT INTO users(id,username,display_name,password_hash,role,active,created_at) VALUES ('00000000-0000-4000-8000-000000000002','workspace.internal','共享工作台',NULL,'admin',1,0) ON CONFLICT(id) DO NOTHING;
