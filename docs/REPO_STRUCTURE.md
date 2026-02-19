# CrewClock Repository Structure

Source: filesystem scan of `C:\Users\Server\Desktop\Projects\crewclock`.

Tree constraints used:
- Max depth: `6`
- Excluded: `node_modules`, `.next`, `dist`, `build`, `coverage`, `.git`

```text
.
+-- docs/
|   +-- ARCHITECTURE_INDEX.md
|   +-- REPO_STRUCTURE.md
|   \-- SUPABASE_INTEGRATION.md
+-- src/
|   +-- app/
|   |   +-- api/
|   |   |   +-- auth/
|   |   |   |   \-- employee-login/
|   |   |   |       \-- route.ts
|   |   |   \-- staff/
|   |   |       +-- [id]/
|   |   |       |   +-- auth/
|   |   |       |   +-- email/
|   |   |       |   \-- send-reset/
|   |   |       +-- delete/
|   |   |       |   \-- route.ts
|   |   |       +-- emails/
|   |   |       |   \-- route.ts
|   |   |       +-- reset-passcode/
|   |   |       |   \-- route.ts
|   |   |       +-- set-active/
|   |   |       |   \-- route.ts
|   |   |       +-- update-profile/
|   |   |       |   \-- route.ts
|   |   |       +-- update-role/
|   |   |       |   \-- route.ts
|   |   |       +-- _shared.ts
|   |   |       +-- route.ts
|   |   |       \-- route.ts.bak
|   |   +-- clock/
|   |   |   \-- page.tsx
|   |   +-- dashboard/
|   |   |   +-- employees/
|   |   |   |   \-- page.tsx
|   |   |   +-- jobs/
|   |   |   |   \-- page.tsx
|   |   |   +-- reports/
|   |   |   |   \-- page.tsx
|   |   |   +-- layout.tsx
|   |   |   \-- page.tsx
|   |   +-- hours/
|   |   |   \-- page.tsx
|   |   +-- login/
|   |   |   \-- page.tsx
|   |   +-- reset-password/
|   |   |   \-- page.tsx
|   |   +-- globals.css
|   |   +-- layout.tsx
|   |   \-- page.tsx
|   +-- components/
|   |   +-- ThemeToggle.tsx
|   |   \-- WorkerLayout.tsx
|   +-- hooks/
|   |   \-- use-data.ts
|   +-- lib/
|   |   +-- supabase/
|   |   |   +-- admin.ts
|   |   |   +-- client.ts
|   |   |   +-- middleware.ts
|   |   |   +-- rpc-errors.ts
|   |   |   \-- server.ts
|   |   +-- actions.ts
|   |   +-- auth-rate-limit.ts
|   |   +-- geo.ts
|   |   +-- google-places.ts
|   |   +-- staff-utils.ts
|   |   +-- store.ts
|   |   \-- utils.ts
|   +-- types/
|   |   \-- database.ts
|   \-- middleware.ts
+-- supabase/
|   \-- migrations/
|       +-- 001_initial_schema.sql
|       +-- 002_handle_new_user_company_upsert.sql
|       +-- 003_staff_credentials_internal_auth.sql
|       +-- 004_harden_handle_new_user_for_admin_create.sql
|       +-- 004_staff_auth_hardening.sql
|       +-- 005_staff_editing_and_admin_protection.sql
|       +-- 006_admin_owner_and_staff_deletion.sql
|       +-- 006_enable_role_changes.sql
|       \-- 007_fix_update_staff_role_and_active_rpc.sql
+-- .env.local
+-- .env.local.example
+-- .gitignore
+-- 001_initial_schema.sql
+-- next.config.ts
+-- next-env.d.ts
+-- package.json
+-- package-lock.json
+-- postcss.config.mjs
+-- README.md
+-- tsconfig.json
+-- tsconfig.tsbuildinfo
```

## Location Notes

- Next.js App Router pages live under `src/app/**/page.tsx` (for example: `src/app/clock/page.tsx`, `src/app/dashboard/employees/page.tsx`).
- Next.js layouts live under `src/app/**/layout.tsx` (for example: `src/app/layout.tsx`, `src/app/dashboard/layout.tsx`).
- API routes live under `src/app/api/**/route.ts` (for example: `src/app/api/staff/route.ts`, `src/app/api/auth/employee-login/route.ts`).
- Action-style client functions are centralized in `src/lib/actions.ts` (RPC and CRUD wrappers used by UI components).
- App/global state types live in `src/types/database.ts`; state store lives in `src/lib/store.ts`.
- Route middleware entry is `src/middleware.ts`, with Supabase session logic in `src/lib/supabase/middleware.ts`.
