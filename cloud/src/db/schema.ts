import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const users = sqliteTable('users',{
 id:text('id').primaryKey(), username:text('username').notNull().unique(), displayName:text('display_name').notNull(),
 passwordHash:text('password_hash'), role:text('role').notNull(), active:integer('active').notNull(), createdAt:integer('created_at').notNull()
});
export const members = sqliteTable('members',{
 seq:integer('seq').primaryKey({autoIncrement:true}), id:text('id').notNull().unique(), ownerId:text('owner_id').notNull(), requestKey:text('request_key').notNull(),
 gender:text('gender').notNull(), name:text('name').notNull(), birth:text('birth').notNull(), profile:text('profile').notNull(), editor:text('editor').notNull(), photoId:text('photo_id'),
 version:integer('version').notNull(), confirmedId:text('confirmed_id'), status:text('status').notNull(), archived:integer('archived').notNull(), deletedAt:integer('deleted_at'), deletedBy:text('deleted_by'), lastOperation:text('last_operation'),
 createdAt:integer('created_at').notNull(), updatedAt:integer('updated_at').notNull()
});
export const accessSessions=sqliteTable('access_sessions',{
 hash:text('hash').primaryKey(),accessVersion:text('access_version').notNull(),expiresAt:integer('expires_at').notNull()
});
// V2 additive schema mirrors migration 0003; migrations remain the source of constraints/indexes.
export const serviceRecords=sqliteTable('service_records',{
 id:text('id').primaryKey(),ownerMemberId:text('owner_member_id').notNull(),counterpartMemberId:text('counterpart_member_id').notNull(),
 counterpartNameSnapshot:text('counterpart_name_snapshot').notNull(),counterpartNumberSnapshot:text('counterpart_number_snapshot').notNull(),
 appointmentAt:integer('appointment_at').notNull(),status:text('status').notNull(),note:text('note').notNull(),
 createdBy:text('created_by').notNull(),recorderNameSnapshot:text('recorder_name_snapshot').notNull(),updatedBy:text('updated_by').notNull(),
 createdAt:integer('created_at').notNull(),updatedAt:integer('updated_at').notNull(),version:integer('version').notNull(),requestKey:text('request_key').notNull().unique(),lastOperation:text('last_operation').notNull()
});
export const serviceRecordRevisions=sqliteTable('service_record_revisions',{
 id:text('id').primaryKey(),recordId:text('record_id').notNull(),actorId:text('actor_id').notNull(),digest:text('digest').notNull(),beforeData:text('before_data'),afterData:text('after_data').notNull(),reason:text('reason').notNull(),createdAt:integer('created_at').notNull()
});
export const photoSources=sqliteTable('photo_sources',{
 mediaId:text('media_id').primaryKey(),memberId:text('member_id').notNull(),objectKey:text('object_key').notNull().unique(),digest:text('digest').notNull(),contentType:text('content_type').notNull(),size:integer('size').notNull(),state:text('state').notNull(),createdBy:text('created_by').notNull(),createdAt:integer('created_at').notNull()
});
