import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const users = sqliteTable('users',{
 id:text('id').primaryKey(), username:text('username').notNull().unique(), displayName:text('display_name').notNull(),
 passwordHash:text('password_hash'), role:text('role').notNull(), active:integer('active').notNull(), createdAt:integer('created_at').notNull()
});
export const members = sqliteTable('members',{
 seq:integer('seq').primaryKey({autoIncrement:true}), id:text('id').notNull().unique(), ownerId:text('owner_id').notNull(), requestKey:text('request_key').notNull(),
 gender:text('gender').notNull(), name:text('name').notNull(), birth:text('birth').notNull(), profile:text('profile').notNull(), editor:text('editor').notNull(), photoId:text('photo_id'),
 version:integer('version').notNull(), confirmedId:text('confirmed_id'), status:text('status').notNull(), archived:integer('archived').notNull(), lastOperation:text('last_operation'),
 createdAt:integer('created_at').notNull(), updatedAt:integer('updated_at').notNull()
});
export const accessSessions=sqliteTable('access_sessions',{
 hash:text('hash').primaryKey(),accessVersion:text('access_version').notNull(),expiresAt:integer('expires_at').notNull()
});
