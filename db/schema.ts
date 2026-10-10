import { sqliteTable, text, integer, index, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core';
export const settings = sqliteTable('crm_settings', { id: text('id').primaryKey(), ownerId: text('owner_id').notNull() });
export const members = sqliteTable('crm_members', {
 id: text('id').primaryKey(), userId: text('user_id'), email: text('email').notNull(), name: text('name').notNull(), role: text('role').notNull(), branch: text('branch').notNull(), supervisorId: text('supervisor_id'), regionScope: text('region_scope').notNull().default('all'), active: integer('active').notNull().default(1), target: integer('target').notNull().default(0), authVersion: integer('auth_version').notNull().default(1), createdAt: text('created_at').notNull()
}, t=>[uniqueIndex('crm_members_email').on(t.email), uniqueIndex('crm_members_user').on(t.userId)]);
export const records = sqliteTable('crm_records', {
 id: text('id').primaryKey(), kind: text('kind').notNull(), parentId: text('parent_id'), assignedTo: text('assigned_to').notNull(), branch: text('branch').notNull(), data: text('data').notNull(), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(), version: integer('version').notNull().default(1), mutationId: text('mutation_id').notNull().default('')
}, t=>[index('crm_records_kind').on(t.kind),index('crm_records_parent').on(t.parentId),index('crm_records_assigned').on(t.assignedTo)]);
export const audits = sqliteTable('crm_audit', {id:text('id').primaryKey(),recordId:text('record_id').notNull(),actor:text('actor').notNull(),action:text('action').notNull(),detail:text('detail').notNull(),createdAt:text('created_at').notNull()},t=>[index('crm_audit_record').on(t.recordId)]);

export const visitNumbers = sqliteTable('crm_visit_numbers', {
 number: integer('number').primaryKey({ autoIncrement: true }),
 recordId: text('record_id').notNull().unique()
});

export const visitFiles=sqliteTable('crm_visit_files',{
 id:text('id').primaryKey(),objectKey:text('object_key').notNull(),customerId:text('customer_id').notNull(),name:text('name').notNull(),contentType:text('content_type').notNull(),size:integer('size').notNull(),uploadedBy:text('uploaded_by').notNull(),createdAt:text('created_at').notNull()
},t=>[index('crm_visit_files_customer').on(t.customerId)]);

export const sales = sqliteTable('crm_sales', {
 id: text('id').primaryKey(), customerId: text('customer_id').notNull().references(()=>records.id,{onDelete:'restrict'}), repId: text('rep_id').notNull().references(()=>members.id,{onDelete:'restrict'}),
 branch: text('branch').notNull(), date: text('date').notNull(), reference: text('reference').notNull(), referenceKey: text('reference_key').notNull(),
 data: text('data').notNull(), totalCents: integer('total_cents').notNull(), status: text('status').notNull().default('confirmed'), voidReason: text('void_reason').notNull().default(''),
 version: integer('version').notNull().default(1), mutationId: text('mutation_id').notNull(), createFingerprint: text('create_fingerprint').notNull(), createdBy: text('created_by').notNull(), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull()
},t=>[uniqueIndex('crm_sales_customer_reference').on(t.customerId,t.referenceKey),index('crm_sales_rep_date').on(t.repId,t.date),index('crm_sales_date').on(t.date)]);
export const performanceTargets = sqliteTable('crm_performance_targets', {
 memberId: text('member_id').notNull().references(()=>members.id,{onDelete:'restrict'}), month: text('month').notNull(), data: text('data').notNull(), version: integer('version').notNull().default(1), updatedBy: text('updated_by').notNull(), updatedAt: text('updated_at').notNull(), mutationId: text('mutation_id').notNull()
},t=>[uniqueIndex('crm_targets_member_month').on(t.memberId,t.month)]);

export const targetSets = sqliteTable('crm_target_sets', {
 kind:text('kind').notNull(),scopeId:text('scope_id').notNull(),month:text('month').notNull(),data:text('data').notNull(),
 version:integer('version').notNull().default(1),mutationId:text('mutation_id').notNull(),updatedBy:text('updated_by').notNull(),updatedAt:text('updated_at').notNull()
},t=>[uniqueIndex('crm_target_sets_scope_month').on(t.kind,t.scopeId,t.month),index('crm_target_sets_month').on(t.month)]);

export const kpiAssessments=sqliteTable('crm_kpi_assessments',{
 memberId:text('member_id').notNull().references(()=>members.id,{onDelete:'restrict'}),month:text('month').notNull(),input:text('input').notNull(),
 version:integer('version').notNull().default(1),mutationId:text('mutation_id').notNull(),updatedBy:text('updated_by').notNull(),updatedAt:text('updated_at').notNull()
},t=>[uniqueIndex('crm_kpi_member_month').on(t.memberId,t.month),index('crm_kpi_month').on(t.month)]);

export const kpiEvidence=sqliteTable('crm_kpi_evidence',{
 memberId:text('member_id').notNull().references(()=>members.id,{onDelete:'restrict'}),month:text('month').notNull(),input:text('input').notNull(),
 version:integer('version').notNull().default(1),mutationId:text('mutation_id').notNull(),updatedBy:text('updated_by').notNull(),updatedAt:text('updated_at').notNull(),
 salesRevision:integer('sales_revision').notNull(),scopeKey:text('scope_key').notNull(),cutoff:text('cutoff').notNull()
},t=>[primaryKey({columns:[t.memberId,t.month]}),index('crm_kpi_evidence_month').on(t.month)]);
export const kpiEvidenceState=sqliteTable('crm_kpi_evidence_state',{id:text('id').primaryKey(),revision:integer('revision').notNull().default(0)});

export const serviceCases=sqliteTable('crm_service_cases',{
 id:text('id').primaryKey(),customerId:text('customer_id').notNull().references(()=>records.id,{onDelete:'restrict'}),
 status:text('status').notNull(),creatorId:text('creator_id').notNull().references(()=>members.id,{onDelete:'restrict'}),
 serviceManagerId:text('service_manager_id').references(()=>members.id,{onDelete:'restrict'}),salesManagerId:text('sales_manager_id').references(()=>members.id,{onDelete:'restrict'}),
 assignedTo:text('assigned_to').references(()=>members.id,{onDelete:'restrict'}),supervisorId:text('supervisor_id').references(()=>members.id,{onDelete:'restrict'}),
 data:text('data').notNull(),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),version:integer('version').notNull().default(1),mutationId:text('mutation_id').notNull()
},t=>[index('crm_service_customer').on(t.customerId),index('crm_service_creator').on(t.creatorId),index('crm_service_status').on(t.status)]);

// The auth revocation trigger is defined explicitly in append-only migration 0009.
export const authChallenges=sqliteTable('auth_challenges',{
 id:text('id').primaryKey(),subjectHash:text('subject_hash').notNull(),codeHash:text('code_hash').notNull(),
 userId:text('user_id').references(()=>members.id,{onUpdate:'no action',onDelete:'no action'}),userVersion:integer('user_version'),email:text('email').notNull(),
 createdAt:integer('created_at').notNull(),expiresAt:integer('expires_at').notNull(),ready:integer('ready').notNull().default(0),
 attempts:integer('attempts').notNull().default(0),attemptId:text('attempt_id'),consumed:integer('consumed').notNull().default(0)
},t=>[uniqueIndex('auth_challenges_subject_idx').on(t.subjectHash),index('auth_challenges_expiry_idx').on(t.expiresAt)]);
export const authEvents=sqliteTable('auth_events',{
 id:text('id').primaryKey(),userId:text('user_id').references(()=>members.id,{onUpdate:'no action',onDelete:'no action'}),
 event:text('event').notNull(),createdAt:integer('created_at').notNull()
},t=>[index('auth_events_date_idx').on(t.createdAt)]);
export const authLimits=sqliteTable('auth_limits',{
 key:text('key').primaryKey(),windowStart:integer('window_start').notNull(),count:integer('count').notNull()
});
export const authSessions=sqliteTable('auth_sessions',{
 tokenHash:text('token_hash').primaryKey(),userId:text('user_id').notNull().references(()=>members.id,{onUpdate:'no action',onDelete:'no action'}),
 userVersion:integer('user_version').notNull(),email:text('email').notNull(),challengeId:text('challenge_id').notNull(),
 createdAt:integer('created_at').notNull(),expiresAt:integer('expires_at').notNull(),revokedAt:integer('revoked_at')
},t=>[uniqueIndex('auth_sessions_challenge_idx').on(t.challengeId),index('auth_sessions_user_idx').on(t.userId),index('auth_sessions_expiry_idx').on(t.expiresAt)]);

// ERP facts are immutable and kept separate from manually entered invoices.
export const erpImportState=sqliteTable('crm_erp_import_state',{id:text('id').primaryKey(),revision:integer('revision').notNull().default(0)});
export const erpEmployeeMappings=sqliteTable('crm_erp_employee_mappings',{employeeId:text('employee_id').primaryKey(),repId:text('rep_id').notNull().references(()=>members.id,{onDelete:'restrict'}),updatedBy:text('updated_by').notNull(),updatedAt:text('updated_at').notNull()});
export const erpCategoryMappings=sqliteTable('crm_erp_category_mappings',{category:text('category').primaryKey(),product:text('product').notNull(),updatedBy:text('updated_by').notNull(),updatedAt:text('updated_at').notNull()});
export const erpImports=sqliteTable('crm_erp_imports',{id:text('id').primaryKey(),actorId:text('actor_id').notNull().references(()=>members.id,{onDelete:'restrict'}),fingerprint:text('fingerprint').notNull(),fileName:text('file_name').notNull(),result:text('result').notNull(),createdAt:text('created_at').notNull()});
export const erpSales=sqliteTable('crm_erp_sales',{
 id:text('id').primaryKey(),documentKey:text('document_key').notNull(),contentHash:text('content_hash').notNull(),mappedHash:text('mapped_hash').notNull(),reference:text('reference').notNull(),documentType:text('document_type').notNull(),date:text('date').notNull(),employeeId:text('employee_id').notNull(),repId:text('rep_id').notNull().references(()=>members.id,{onDelete:'restrict'}),branch:text('branch').notNull(),regionScope:text('region_scope').notNull(),customerCode:text('customer_code').notNull(),customerName:text('customer_name').notNull(),data:text('data').notNull(),totalCents:integer('total_cents').notNull(),importId:text('import_id').notNull().references(()=>erpImports.id,{onDelete:'restrict'}),createdBy:text('created_by').notNull(),createdAt:text('created_at').notNull()
},t=>[uniqueIndex('crm_erp_sales_document').on(t.documentKey),index('crm_erp_sales_rep_date').on(t.repId,t.date),index('crm_erp_sales_date').on(t.date)]);

export const customerNumbers=sqliteTable('crm_customer_numbers',{
 number:integer('number').primaryKey({autoIncrement:true}),customerId:text('customer_id').notNull().unique().references(()=>records.id,{onDelete:'cascade'})
});
export const customerCodeAliases=sqliteTable('crm_customer_code_aliases',{
 customerId:text('customer_id').notNull().references(()=>records.id,{onDelete:'cascade'}),sourceCode:text('source_code').notNull()
},t=>[primaryKey({columns:[t.customerId,t.sourceCode]})]);
export const customerIdentityState=sqliteTable('crm_customer_identity_state',{id:text('id').primaryKey(),revision:integer('revision').notNull().default(0)});
export const customerCodeMappings=sqliteTable('crm_customer_code_mappings',{
 codeKey:text('code_key').primaryKey(),customerId:text('customer_id').notNull().references(()=>records.id,{onDelete:'restrict'}),version:integer('version').notNull().default(1),updatedBy:text('updated_by').notNull(),updatedAt:text('updated_at').notNull()
});
