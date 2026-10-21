PRAGMA foreign_keys = ON;
CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, password_hash TEXT, role TEXT NOT NULL CHECK(role IN ('admin','teacher')), active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL);
CREATE TABLE settings (id TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE sessions (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE invitations (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL, used_at INTEGER, claim TEXT);
CREATE TABLE limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE members (
 seq INTEGER PRIMARY KEY AUTOINCREMENT CHECK(seq BETWEEN 1 AND 999999), id TEXT NOT NULL UNIQUE, owner_id TEXT NOT NULL REFERENCES users(id), request_key TEXT NOT NULL,
 gender TEXT NOT NULL CHECK(gender IN ('男','女')), name TEXT NOT NULL DEFAULT '', birth TEXT NOT NULL DEFAULT '', profile TEXT NOT NULL DEFAULT '{}', editor TEXT NOT NULL DEFAULT '{}', photo_id TEXT,
 version INTEGER NOT NULL DEFAULT 0, confirmed_id TEXT, status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','pending','confirmed')), archived INTEGER NOT NULL DEFAULT 0,
 last_operation TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(owner_id,request_key)
);
CREATE INDEX members_recent ON members(archived,updated_at DESC,seq DESC);
CREATE INDEX members_filter ON members(gender,status,owner_id);
CREATE TABLE media (id TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id), kind TEXT NOT NULL CHECK(kind IN ('photo','card','thumb')), object_key TEXT NOT NULL UNIQUE, digest TEXT NOT NULL, content_type TEXT NOT NULL, size INTEGER NOT NULL, width INTEGER NOT NULL,height INTEGER NOT NULL,state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','ready','deleting')),created_at INTEGER NOT NULL);
CREATE INDEX media_member ON media(member_id);
CREATE TABLE snapshots (id TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id), profile TEXT NOT NULL, editor TEXT NOT NULL, photo_id TEXT NOT NULL REFERENCES media(id), card_id TEXT NOT NULL REFERENCES media(id), thumb_id TEXT NOT NULL REFERENCES media(id), created_at INTEGER NOT NULL);
CREATE INDEX snapshots_member ON snapshots(member_id);
CREATE TABLE operations (id TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id), actor_id TEXT NOT NULL REFERENCES users(id), digest TEXT NOT NULL, result TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE audit (id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, action TEXT NOT NULL, target_id TEXT NOT NULL, created_at INTEGER NOT NULL);
