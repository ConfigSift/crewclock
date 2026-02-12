# CrewClock — Construction Time Management

GPS-verified clock-in/out for construction crews with a real-time manager dashboard.

## Tech Stack

- **Frontend:** Next.js 16, TypeScript, Tailwind CSS v4
- **Backend:** Supabase (PostgreSQL, Auth, Realtime, Edge Functions)
- **State:** Zustand
- **Hosting:** Vercel (recommended)

---

## Quick Start

### 1. Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Note your **Project URL** and **anon public key** from Settings → API

### 2. Run the Database Migration

1. Open the **SQL Editor** in your Supabase dashboard
2. Copy the entire contents of `supabase/migrations/001_initial_schema.sql`
3. Paste it into the SQL Editor and click **Run**

This creates all tables, functions, RLS policies, indexes, and triggers.

> **Important:** The migration enables the `earthdistance` extension for geolocation. If you see an error, go to Database → Extensions and enable both `cube` and `earthdistance` manually, then re-run.

### 3. Configure Auth

In your Supabase Dashboard:

1. Go to **Authentication → Settings**
2. Under **Email Auth**, make sure it's enabled
3. (Optional) Disable email confirmation for development:
   - Authentication → Settings → toggle off "Enable email confirmations"
4. The `handle_new_user` trigger will automatically create profiles and companies when users sign up

### 4. Set Up Environment Variables

```bash
cp .env.local.example .env.local
```

Fill in your Supabase credentials:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### 5. Install and Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## Project Structure

```
crewclock/
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql    # Complete database schema
├── src/
│   ├── app/
│   │   ├── layout.tsx                # Root layout with fonts
│   │   ├── page.tsx                  # Auth redirect
│   │   ├── globals.css               # Tailwind v4 theme
│   │   ├── login/page.tsx            # Sign in / Sign up
│   │   ├── clock/page.tsx            # Worker: Clock in/out + geolocation
│   │   ├── hours/page.tsx            # Worker: Hour history
│   │   └── dashboard/
│   │       ├── layout.tsx            # Manager: Responsive sidebar/bottom nav
│   │       ├── page.tsx              # Manager: Dashboard overview
│   │       ├── jobs/page.tsx         # Manager: Job CRUD + geofencing
│   │       ├── employees/page.tsx    # Manager: Employee list + status
│   │       └── reports/page.tsx      # Manager: Project hours breakdown
│   ├── components/
│   │   └── WorkerLayout.tsx          # Worker shell (top bar + bottom nav)
│   ├── hooks/
│   │   └── use-data.ts              # Data fetching + realtime subscriptions
│   ├── lib/
│   │   ├── actions.ts               # Client actions (clock-in, CRUD, auth)
│   │   ├── geo.ts                   # Geolocation utilities
│   │   ├── store.ts                 # Zustand state management
│   │   ├── utils.ts                 # Formatting & helpers
│   │   └── supabase/
│   │       ├── client.ts            # Browser Supabase client
│   │       ├── server.ts            # Server Supabase client
│   │       └── middleware.ts         # Auth session refresh
│   ├── middleware.ts                 # Route protection
│   └── types/
│       └── database.ts              # TypeScript types
├── package.json
├── tsconfig.json
├── next.config.ts
├── postcss.config.mjs
└── .env.local.example
```

---

## Features

### Worker (Mobile)
- **GPS-verified clock-in** — Must be within 300m (configurable) of the job site
- **Live timer** — Real-time elapsed time display while clocked in
- **Hour tracking** — Weekly, monthly, yearly totals with per-project breakdown

### Manager (Desktop + Mobile)
- **Live dashboard** — See who's on site right now with real-time updates
- **Job management** — Create, edit, archive, and delete jobs with GPS coordinates
- **Employee overview** — Hours per period, active status, and location
- **Project reports** — Per-worker hour breakdowns by project
- **Geofence configuration** — Set custom radius per job site

### Security
- **Server-side geo-validation** — PostGIS distance check prevents GPS spoofing
- **Row Level Security** — Workers see only their data; managers see their company
- **Persistent sessions** — Workers stay logged in until they sign out

---

## Deployment

### Vercel (Recommended)

1. Push your code to GitHub
2. Import the repository in [vercel.com](https://vercel.com)
3. Add environment variables in the Vercel dashboard
4. Deploy

### Environment Variables for Production

| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your Supabase anon key |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | (Optional) For address geocoding |

---

## Database Functions

The SQL migration includes these callable functions:

| Function | Description |
|----------|-------------|
| `clock_in(project_id, lat, lng)` | Validates geolocation + inserts time entry |
| `clock_out(lat?, lng?)` | Closes active session + optional location capture |
| `get_hours_summary(employee_id?, project_id?, period?)` | Aggregated hour totals |

These are called via `supabase.rpc()` from the client.

---

## Customization

### Geofence Radius
- **Company default:** Edit `settings.geo_radius_meters` in the `companies` table
- **Per-job override:** Set `geo_radius_m` on individual projects via the Job Management board

### Theme
All colors are defined as CSS variables in `src/app/globals.css` under `@theme`. Update the accent color, background, etc. to match your brand.
