import { sqliteTable, text, integer, index, primaryKey, uniqueIndex } from 'drizzle-orm/sqlite-core';
export const shoots = sqliteTable('shoots', {
 id: text('id').primaryKey(), title: text('title').notNull(), date: text('date').notNull(),
 time: text('time').notNull(), duration: integer('duration').notNull(), format: text('format').notNull(),
 status: text('status').notNull(), project: text('project').notNull(), location: text('location').notNull(),
 participants: text('participants', {mode:'json'}).$type<string[]>().notNull(), notes: text('notes').notNull(),
 preparation: text('preparation').notNull().default(''),
 revision: integer('revision').notNull().default(1)
});

// ---- Platform v2 (additive; the legacy `shoots` table above is unchanged) ----

/** One row per Reels or YouTube episode. Every section reads this same record. */
export const contentItems = sqliteTable('content_items', {
 id: text('id').primaryKey(),
 type: text('type').notNull(), // 'reel' | 'youtube'
 title: text('title').notNull(),
 description: text('description').notNull().default(''),
 primaryMember: text('primary_member').notNull(),
 shootId: text('shoot_id').references(() => shoots.id, { onDelete: 'set null' }),
 places: text('places').notNull().default(''),
 plannedPublishDate: text('planned_publish_date'),
 publishedAt: text('published_at'),
 productionStatus: text('production_status').notNull(),
 driveUrl: text('drive_url').notNull().default(''),
 responsible: text('responsible'), // who drives production (team name or 'Данил'); assignment only
 createdAt: text('created_at').notNull(),
 createdBy: text('created_by').notNull(),
 updatedAt: text('updated_at').notNull(),
 updatedBy: text('updated_by').notNull(),
 revision: integer('revision').notNull().default(1),
}, t => [
 index('content_items_planned_idx').on(t.plannedPublishDate),
 index('content_items_status_idx').on(t.productionStatus),
 index('content_items_shoot_idx').on(t.shootId),
]);

/** Additional on-screen participants. The plan share counts only `primary_member`. */
export const contentParticipants = sqliteTable('content_participants', {
 contentId: text('content_id').notNull().references(() => contentItems.id, { onDelete: 'cascade' }),
 member: text('member').notNull(),
}, t => [primaryKey({ columns: [t.contentId, t.member] })]);

/** Every production status change, including the comment that came with it. */
export const statusEvents = sqliteTable('status_events', {
 id: text('id').primaryKey(),
 contentId: text('content_id').notNull().references(() => contentItems.id, { onDelete: 'cascade' }),
 fromStatus: text('from_status'),
 toStatus: text('to_status').notNull(),
 versionId: text('version_id'),
 comment: text('comment').notNull().default(''),
 actor: text('actor').notNull(),
 at: text('at').notNull(),
}, t => [index('status_events_content_idx').on(t.contentId, t.at)]);

/** Append-only journal of key actions. */
export const auditEvents = sqliteTable('audit_events', {
 id: text('id').primaryKey(),
 entity: text('entity').notNull(),
 entityId: text('entity_id').notNull(),
 action: text('action').notNull(),
 actor: text('actor').notNull(),
 at: text('at').notNull(),
 before: text('before'),
 after: text('after'),
}, t => [index('audit_events_entity_idx').on(t.entity, t.entityId, t.at)]);

/** Editable settings such as monthly targets. Values are JSON. */
export const appSettings = sqliteTable('app_settings', {
 key: text('key').primaryKey(),
 value: text('value').notNull(),
 updatedAt: text('updated_at').notNull(),
 updatedBy: text('updated_by').notNull(),
 revision: integer('revision').notNull().default(1),
});

// ---- Platform v3 (additive): versions, feedback, finance, AI studio, Instagram, integrations ----

/** Edit versions of one item. The newest one is mirrored into content_items.drive_url. Never deleted. */
export const editVersions = sqliteTable('edit_versions', {
 id: text('id').primaryKey(),
 contentId: text('content_id').notNull().references(() => contentItems.id, { onDelete: 'cascade' }),
 number: integer('number').notNull(),
 driveUrl: text('drive_url').notNull(),
 note: text('note').notNull().default(''),
 createdAt: text('created_at').notNull(),
 createdBy: text('created_by').notNull(),
}, t => [uniqueIndex('edit_versions_number_uq').on(t.contentId, t.number)]);

/** Comments and decisions. kind: comment | approved | changes_requested. */
export const feedbackComments = sqliteTable('feedback_comments', {
 id: text('id').primaryKey(),
 contentId: text('content_id').notNull().references(() => contentItems.id, { onDelete: 'cascade' }),
 versionId: text('version_id').references(() => editVersions.id, { onDelete: 'set null' }),
 kind: text('kind').notNull(),
 body: text('body').notNull(),
 actor: text('actor').notNull(),
 at: text('at').notNull(),
}, t => [index('feedback_content_idx').on(t.contentId, t.at)]);

/** Pay terms per member. Amounts are entered by the user, in minor units (satang for THB). */
export const rateRules = sqliteTable('rate_rules', {
 id: text('id').primaryKey(),
 member: text('member').notNull(),
 model: text('model').notNull(), // per_reel | per_shoot_day | fixed_monthly | one_off
 amountMinor: integer('amount_minor').notNull(),
 currency: text('currency').notNull().default('THB'),
 validFrom: text('valid_from').notNull(),
 validTo: text('valid_to'),
 note: text('note').notNull().default(''),
 active: integer('active').notNull().default(1),
 createdAt: text('created_at').notNull(),
 createdBy: text('created_by').notNull(),
 revision: integer('revision').notNull().default(1),
}, t => [index('rate_rules_member_idx').on(t.member)]);

/** Accrued units. `basis_key` makes double accrual impossible: one per (member, basis, reel / shoot day / month). */
export const payableUnits = sqliteTable('payable_units', {
 id: text('id').primaryKey(),
 member: text('member').notNull(),
 basis: text('basis').notNull(), // reel | shoot_day | fixed_monthly | one_off
 basisKey: text('basis_key').notNull(),
 contentId: text('content_id').references(() => contentItems.id, { onDelete: 'set null' }),
 shootDate: text('shoot_date'),
 period: text('period').notNull(), // YYYY-MM
 rateRuleId: text('rate_rule_id').references(() => rateRules.id),
 amountMinor: integer('amount_minor').notNull(),
 currency: text('currency').notNull().default('THB'),
 description: text('description').notNull().default(''),
 voidedAt: text('voided_at'),
 voidReason: text('void_reason'),
 createdAt: text('created_at').notNull(),
 createdBy: text('created_by').notNull(),
}, t => [uniqueIndex('payable_units_basis_uq').on(t.member, t.basis, t.basisKey), index('payable_units_period_idx').on(t.period)]);

/** Actual payments (partial allowed). Corrections void a row with a reason; nothing is deleted. */
export const payments = sqliteTable('payments', {
 id: text('id').primaryKey(),
 member: text('member').notNull(),
 amountMinor: integer('amount_minor').notNull(),
 currency: text('currency').notNull().default('THB'),
 paidAt: text('paid_at').notNull(),
 note: text('note').notNull().default(''),
 voidedAt: text('voided_at'),
 voidReason: text('void_reason'),
 createdAt: text('created_at').notNull(),
 createdBy: text('created_by').notNull(),
}, t => [index('payments_member_idx').on(t.member, t.paidAt)]);

/** Higgsfield AI studio: one project per insert, linked to a content item. */
export const aiProjects = sqliteTable('ai_projects', {
 id: text('id').primaryKey(),
 contentId: text('content_id').references(() => contentItems.id, { onDelete: 'set null' }),
 title: text('title').notNull(),
 brief: text('brief').notNull().default(''),
 prompt: text('prompt').notNull().default(''),
 motionPrompt: text('motion_prompt').notNull().default(''),
 approvedAssetId: text('approved_asset_id'),
 createdAt: text('created_at').notNull(),
 createdBy: text('created_by').notNull(),
 updatedAt: text('updated_at').notNull(),
 revision: integer('revision').notNull().default(1),
});

/** Notes, references, imported texts, images and videos of an AI project (URLs; files live at the provider or Drive). */
export const aiAssets = sqliteTable('ai_assets', {
 id: text('id').primaryKey(),
 projectId: text('project_id').notNull().references(() => aiProjects.id, { onDelete: 'cascade' }),
 kind: text('kind').notNull(), // note | reference | image | video
 url: text('url').notNull().default(''),
 text: text('text').notNull().default(''),
 source: text('source').notNull(), // manual | higgsfield
 jobId: text('job_id'),
 expiresAt: text('expires_at'),
 /** Private R2 object (served only through /api/ai/files with server-side access checks). */
 storageKey: text('storage_key'),
 mime: text('mime'),
 size: integer('size'),
 fileName: text('file_name'),
 createdAt: text('created_at').notNull(),
 createdBy: text('created_by').notNull(),
}, t => [index('ai_assets_project_idx').on(t.projectId, t.createdAt)]);

/** Provider jobs. `idempotency_key` is unique, so a repeated paid launch cannot create a second job. */
export const aiGenerationJobs = sqliteTable('ai_generation_jobs', {
 id: text('id').primaryKey(),
 projectId: text('project_id').notNull().references(() => aiProjects.id, { onDelete: 'cascade' }),
 kind: text('kind').notNull(), // image | video
 endpoint: text('endpoint').notNull(),
 params: text('params').notNull(),
 idempotencyKey: text('idempotency_key').notNull(),
 status: text('status').notNull(), // submitting | queued | in_progress | completed | failed | nsfw | canceled | error
 requestId: text('request_id'),
 statusUrl: text('status_url'),
 resultUrl: text('result_url'),
 error: text('error'),
 cost: text('cost'),
 createdAt: text('created_at').notNull(),
 createdBy: text('created_by').notNull(),
 updatedAt: text('updated_at').notNull(),
}, t => [uniqueIndex('ai_jobs_idem_uq').on(t.idempotencyKey), index('ai_jobs_project_idx').on(t.projectId)]);

/** Instagram media read through the official API. Metrics stay NULL when the API did not return them. */
export const instagramMedia = sqliteTable('instagram_media', {
 mediaId: text('media_id').primaryKey(),
 permalink: text('permalink'),
 caption: text('caption'),
 mediaType: text('media_type'),
 mediaProductType: text('media_product_type'),
 timestamp: text('timestamp').notNull(),
 likeCount: integer('like_count'),
 commentsCount: integer('comments_count'),
 contentId: text('content_id').references(() => contentItems.id, { onDelete: 'set null' }),
 matchedAt: text('matched_at'),
 matchedBy: text('matched_by'),
 ignored: integer('ignored').notNull().default(0),
 syncedAt: text('synced_at').notNull(),
}, t => [uniqueIndex('instagram_media_content_uq').on(t.contentId)]);

/** Connection state per provider. Secrets are encrypted server-side; never sent to the browser. */
export const integrationConnections = sqliteTable('integration_connections', {
 provider: text('provider').primaryKey(),
 status: text('status').notNull(),
 accountId: text('account_id'),
 accountName: text('account_name'),
 tokenCipher: text('token_cipher'),
 tokenExpiresAt: text('token_expires_at'),
 lastSyncAt: text('last_sync_at'),
 lastError: text('last_error'),
 oauthState: text('oauth_state'),
 updatedAt: text('updated_at').notNull(),
});

/** Internal task board (Задачник). Editors only; never part of public reads. Archive instead of delete. */
export const tasks = sqliteTable('tasks', {
 id: text('id').primaryKey(),
 title: text('title').notNull(),
 notes: text('notes').notNull().default(''),
 assignee: text('assignee'), // a team name or 'Данил'; assignment only, grants no site access
 dueDate: text('due_date'), // YYYY-MM-DD, Asia/Bangkok
 dueTime: text('due_time'), // HH:MM, Asia/Bangkok, optional
 priority: text('priority').notNull().default('normal'), // low | normal | high
 status: text('status').notNull().default('todo'), // todo | in_progress | done | cancelled
 shootId: text('shoot_id').references(() => shoots.id, { onDelete: 'set null' }),
 contentId: text('content_id').references(() => contentItems.id, { onDelete: 'set null' }),
 folderId: text('folder_id'), // task_folders.id; NULL = no folder
 completedAt: text('completed_at'),
 archivedAt: text('archived_at'),
 archivedBy: text('archived_by'),
 createdAt: text('created_at').notNull(),
 createdBy: text('created_by').notNull(),
 updatedAt: text('updated_at').notNull(),
 updatedBy: text('updated_by').notNull(),
 revision: integer('revision').notNull().default(1),
}, t => [index('tasks_status_idx').on(t.status, t.dueDate), index('tasks_shoot_idx').on(t.shootId), index('tasks_content_idx').on(t.contentId)]);

/** Folders of the planner (Задачник), like pages in Notes. Archiving a folder hides it; its tasks then show as «Без папки». Nothing is deleted. */
export const taskFolders = sqliteTable('task_folders', {
 id: text('id').primaryKey(),
 name: text('name').notNull(),
 sort: integer('sort').notNull().default(0),
 archivedAt: text('archived_at'),
 createdAt: text('created_at').notNull(),
 createdBy: text('created_by').notNull(),
 updatedAt: text('updated_at').notNull(),
 updatedBy: text('updated_by').notNull(),
 revision: integer('revision').notNull().default(1),
});

/** Site roles, by verified Sites identity (email). The owner in app/permissions.ts is always admin + finance and is not stored here.
 * status: invited (prepared, grants nothing) | active (grants the role) | disabled. Being a task assignee never creates a row. */
export const teamMembers = sqliteTable('team_members', {
 id: text('id').primaryKey(),
 email: text('email'), // lower-case; NULL = address not known yet (cannot sign in)
 displayName: text('display_name').notNull(),
 memberName: text('member_name'), // optional link to a team name (Юля, Андрей…) for "my tasks"
 role: text('role').notNull(), // admin | reviewer | viewer
 finance: integer('finance').notNull().default(0),
 status: text('status').notNull().default('invited'),
 note: text('note').notNull().default(''),
 firstSeenAt: text('first_seen_at'), // first request signed in by Sites with this email = identity confirmed
 lastSeenAt: text('last_seen_at'),
 createdAt: text('created_at').notNull(),
 createdBy: text('created_by').notNull(),
 updatedAt: text('updated_at').notNull(),
 updatedBy: text('updated_by').notNull(),
 revision: integer('revision').notNull().default(1),
}, t => [uniqueIndex('team_members_email_uq').on(t.email)]);

/** Read marks for in-app notifications, per signed-in email. Notifications themselves are computed from live data. */
export const notificationReads = sqliteTable('notification_reads', {
 userEmail: text('user_email').notNull(),
 key: text('key').notNull(),
 readAt: text('read_at').notNull(),
}, t => [primaryKey({ columns: [t.userEmail, t.key] })]);

/** Own sign-in outside ChatGPT Sites (AUTH_MODE=password). Not in backups: secrets never leave the database.
 * id 'owner': the owner's password as HMAC-SHA256(SESSION_SECRET, salt + password); id 'setup': hash of the last used setup link token. */
export const authCredentials = sqliteTable('auth_credentials', {
 id: text('id').primaryKey(),
 salt: text('salt').notNull(),
 hash: text('hash').notNull(),
 updatedAt: text('updated_at').notNull(),
});

/** Failed password attempts for the whole site (one owner), to slow down guessing. */
export const authAttempts = sqliteTable('auth_attempts', {
 id: text('id').primaryKey(),
 failures: integer('failures').notNull().default(0),
 windowStart: integer('window_start').notNull(),
 lockedUntil: integer('locked_until').notNull().default(0),
});
