# CrewClock - Construction Time Management

GPS-verified clock-in/out for construction crews with a real-time manager dashboard.

## Tech Stack

- Frontend: Next.js 16, TypeScript, Tailwind CSS v4
- Backend: Supabase (PostgreSQL, Auth, Realtime)
- State: Zustand

## Quick Start

### 1. Create a Supabase Project

1. Create a project at https://supabase.com
2. Copy your project URL and anon key from Settings -> API

### 2. Run Database Migrations

Run these SQL files in order inside the Supabase SQL Editor:

1. `supabase/migrations/001_initial_schema.sql`
2. `supabase/migrations/002_handle_new_user_company_upsert.sql`
3. `supabase/migrations/003_staff_credentials_internal_auth.sql`
4. `supabase/migrations/004_staff_auth_hardening.sql`

### 3. Configure Auth

1. Enable Email Auth (for admin/manager email login)
2. Optional for local development: disable email confirmation
3. Public self-signup is not used; accounts are created internally by admin/manager users
4. Configure Supabase Auth Redirect URLs for password reset:
   - Site URL: `NEXT_PUBLIC_APP_URL` (example: `http://localhost:3000`)
   - Additional Redirect URL: `${NEXT_PUBLIC_APP_URL}/reset-password`

### 4. Configure Environment Variables

Copy `.env.local.example` to `.env.local` and set:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_SITE_URL=http://localhost:3000
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_MONTHLY=price_monthly_id_here
STRIPE_PRICE_ANNUAL=price_annual_id_here
```

`SUPABASE_SERVICE_ROLE_KEY` must only be used on server routes/actions.

### 5. Install and Run

```bash
npm install
npm run dev
```

Open http://localhost:3000

## Auth Model

- Admin/manager login: email + password
- Employee/staff login: phone + 6-digit passcode
- Public signup: removed
- Staff creation/reset: internal only, server-side via `supabase.auth.admin.createUser()` and `updateUserById()`

## Key Features

### Worker

- GPS-validated clock in/out
- Live timer while clocked in
- Weekly/monthly/yearly hour summaries

### Manager

- Real-time dashboard and active sessions
- Job management (create/edit/archive/delete)
- Staff management (add worker/manager, generate/manual passcode, reset passcode)
- Project hour reporting

### Security

- RLS across company-scoped data
- Server-side user creation only (service role key never in browser)
- Staff passcodes hashed in `public.staff_credentials` via `pgcrypto`

## Environment Variables

| Variable | Description |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `NEXT_PUBLIC_APP_URL` | Public app URL used for auth redirects (password reset) |
| `NEXT_PUBLIC_SITE_URL` | Public app URL used for Stripe return URLs |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only service role key |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe publishable key for embedded checkout |
| `STRIPE_SECRET_KEY` | Stripe secret key for billing API routes |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `STRIPE_PRICE_MONTHLY` | Stripe Price ID for monthly subscription |
| `STRIPE_PRICE_ANNUAL` | Stripe Price ID for annual subscription |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Optional maps/geocoding key |

## Database RPCs Used by App

| Function | Purpose |
| --- | --- |
| `clock_in(project_id, lat, lng)` | Validate location and insert time entry |
| `clock_out(lat?, lng?)` | Close active time entry |
| `get_hours_summary(...)` | Aggregate hours |
| `set_staff_passcode(user_id, phone, passcode)` | Set/reset hashed passcode |
| `verify_staff_passcode(phone, passcode)` | Verify phone + passcode and return user id |
