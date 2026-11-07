import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const shoots = sqliteTable('shoots', {
 id: text('id').primaryKey(), title: text('title').notNull(), date: text('date').notNull(),
 time: text('time').notNull(), duration: integer('duration').notNull(), format: text('format').notNull(),
 status: text('status').notNull(), project: text('project').notNull(), location: text('location').notNull(),
 participants: text('participants', {mode:'json'}).$type<string[]>().notNull(), notes: text('notes').notNull(),
 preparation: text('preparation').notNull().default(''),
 revision: integer('revision').notNull().default(1)
});
