-- Additive V2 tables; existing member identifiers and snapshots are untouched.
CREATE TABLE service_records (
 id TEXT PRIMARY KEY, owner_member_id TEXT NOT NULL REFERENCES members(id),
 counterpart_member_id TEXT NOT NULL REFERENCES members(id),
 counterpart_name_snapshot TEXT NOT NULL, counterpart_number_snapshot TEXT NOT NULL,
 appointment_at INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','completed','cancelled','no_show')),
 note TEXT NOT NULL DEFAULT '' CHECK(length(note)<=300),
 created_by TEXT NOT NULL REFERENCES users(id), recorder_name_snapshot TEXT NOT NULL,
 updated_by TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 version INTEGER NOT NULL DEFAULT 1, request_key TEXT NOT NULL UNIQUE, last_operation TEXT NOT NULL,
 CHECK(owner_member_id<>counterpart_member_id)
);
CREATE INDEX service_member_time ON service_records(owner_member_id,appointment_at DESC,id DESC);
CREATE INDEX service_member_status ON service_records(owner_member_id,status,appointment_at DESC,id DESC);
CREATE TABLE service_record_revisions (
 id TEXT PRIMARY KEY, record_id TEXT NOT NULL REFERENCES service_records(id),
 actor_id TEXT NOT NULL REFERENCES users(id), digest TEXT NOT NULL,
 before_data TEXT, after_data TEXT NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX service_revisions_record ON service_record_revisions(record_id,created_at);
CREATE TABLE photo_sources (
 media_id TEXT PRIMARY KEY REFERENCES media(id), member_id TEXT NOT NULL REFERENCES members(id),
 object_key TEXT NOT NULL UNIQUE, digest TEXT NOT NULL, content_type TEXT NOT NULL,
 size INTEGER NOT NULL, state TEXT NOT NULL CHECK(state IN ('pending','ready','deleting')),
 created_by TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL
);
CREATE INDEX photo_sources_member ON photo_sources(member_id);
