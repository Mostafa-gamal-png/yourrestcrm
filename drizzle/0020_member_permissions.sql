-- «الصلاحيات» per member (the owner, 2026-11-09, from GSCO: «جدول صلاحيات بشكل ERP … «انسخ الصلاحيات من» … وإخفاء أي شاشة عن أي حساب …
-- مع مفتاح «عرض بيانات الفريق بالكامل»»). One row per member the administrator saved (lib/permissions.ts): `permissions` the cells of the
-- table as JSON {"<screen>:<action>":true|false,…,"viewAll":true}, `hidden` the screens hidden from the member as a JSON array, `version`
-- raised by every save (a stale save is refused), who saved and when. A member without a row keeps exactly the role's behaviour. A table
-- of its own, not columns of crm_members, so saving permissions never signs anyone out (crm_member_revoke_auth, migration 0009, watches
-- crm_members). No other table changes.
CREATE TABLE crm_member_permissions (
 member_id TEXT PRIMARY KEY NOT NULL REFERENCES crm_members(id) ON DELETE CASCADE,
 permissions TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(permissions) AND json_type(permissions)='object'),
 hidden TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(hidden) AND json_type(hidden)='array'),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
 updated_by TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
