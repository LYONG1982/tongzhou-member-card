-- Additive only: preserve historical users, snapshots, media and member numbers.
ALTER TABLE members ADD COLUMN deleted_at INTEGER;
-- statement-breakpoint
ALTER TABLE members ADD COLUMN deleted_by TEXT REFERENCES users(id);
-- statement-breakpoint
CREATE INDEX members_admin_list ON members(archived,updated_at DESC,seq DESC);
-- statement-breakpoint
INSERT INTO settings(id,value) VALUES ('sync-version','0') ON CONFLICT(id) DO NOTHING;
-- statement-breakpoint
DELETE FROM access_sessions;
-- statement-breakpoint
CREATE TRIGGER member_sync_insert AFTER INSERT ON members BEGIN
 UPDATE settings SET value=CAST(value AS INTEGER)+1 WHERE id='sync-version';
 INSERT INTO audit(id,actor_id,action,target_id,created_at) VALUES(lower(hex(randomblob(16))),NEW.owner_id,'member.create',NEW.id,NEW.created_at);
END;
-- statement-breakpoint
CREATE TRIGGER member_sync_update AFTER UPDATE ON members BEGIN
 UPDATE settings SET value=CAST(value AS INTEGER)+1 WHERE id='sync-version';
END;
-- statement-breakpoint
CREATE TRIGGER operation_audit AFTER INSERT ON operations BEGIN
 INSERT INTO audit(id,actor_id,action,target_id,created_at) VALUES(NEW.id,NEW.actor_id,CASE WHEN json_extract(NEW.result,'$.deleted')=1 THEN 'member.delete' ELSE 'member.save' END,NEW.member_id,NEW.created_at);
END;
-- statement-breakpoint
CREATE TRIGGER user_sync_insert AFTER INSERT ON users BEGIN
 UPDATE settings SET value=CAST(value AS INTEGER)+1 WHERE id='sync-version';
END;
-- statement-breakpoint
CREATE TRIGGER user_sync_update AFTER UPDATE ON users BEGIN
 UPDATE settings SET value=CAST(value AS INTEGER)+1 WHERE id='sync-version';
END;
-- statement-breakpoint
CREATE TRIGGER service_sync_insert AFTER INSERT ON service_records BEGIN
 UPDATE settings SET value=CAST(value AS INTEGER)+1 WHERE id='sync-version';
END;
-- statement-breakpoint
CREATE TRIGGER service_sync_update AFTER UPDATE ON service_records BEGIN
 UPDATE settings SET value=CAST(value AS INTEGER)+1 WHERE id='sync-version';
END;
-- statement-breakpoint
CREATE TRIGGER service_active_insert BEFORE INSERT ON service_records WHEN NOT EXISTS(SELECT 1 FROM members WHERE id=NEW.owner_member_id AND archived=0) OR NOT EXISTS(SELECT 1 FROM members WHERE id=NEW.counterpart_member_id AND archived=0 AND confirmed_id IS NOT NULL) BEGIN
 SELECT RAISE(ABORT,'member_unavailable');
END;
-- statement-breakpoint
CREATE TRIGGER service_active_update BEFORE UPDATE ON service_records WHEN NOT EXISTS(SELECT 1 FROM members WHERE id=NEW.owner_member_id AND archived=0) OR (NEW.counterpart_member_id<>OLD.counterpart_member_id AND NOT EXISTS(SELECT 1 FROM members WHERE id=NEW.counterpart_member_id AND archived=0 AND confirmed_id IS NOT NULL)) BEGIN
 SELECT RAISE(ABORT,'member_unavailable');
END;
-- statement-breakpoint
CREATE TRIGGER media_active_insert BEFORE INSERT ON media WHEN NOT EXISTS(SELECT 1 FROM members WHERE id=NEW.member_id AND archived=0) BEGIN
 SELECT RAISE(ABORT,'member_unavailable');
END;
-- statement-breakpoint
CREATE TRIGGER media_active_update BEFORE UPDATE ON media WHEN NOT EXISTS(SELECT 1 FROM members WHERE id=NEW.member_id AND archived=0) BEGIN
 SELECT RAISE(ABORT,'member_unavailable');
END;
-- statement-breakpoint
CREATE TRIGGER original_active_insert BEFORE INSERT ON photo_sources WHEN NOT EXISTS(SELECT 1 FROM members WHERE id=NEW.member_id AND archived=0) BEGIN
 SELECT RAISE(ABORT,'member_unavailable');
END;
-- statement-breakpoint
CREATE TRIGGER original_active_update BEFORE UPDATE ON photo_sources WHEN NOT EXISTS(SELECT 1 FROM members WHERE id=NEW.member_id AND archived=0) BEGIN
 SELECT RAISE(ABORT,'member_unavailable');
END;
