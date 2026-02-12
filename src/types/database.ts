// ─── Database Types ──────────────────────────────────
// Auto-generate with: npx supabase gen types typescript --local > src/types/database.ts
// These are hand-written to match our schema until we generate them

export type UserRole = "worker" | "manager" | "admin";
export type ProjectStatus = "active" | "archived" | "completed";

export interface Company {
  id: string;
  name: string;
  slug: string;
  settings: {
    geo_radius_meters: number;
    timezone: string;
  };
  created_at: string;
}

export interface Profile {
  id: string;
  company_id: string;
  first_name: string;
  last_name: string;
  phone: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
}

export interface Project {
  id: string;
  company_id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  geo_radius_m: number;
  status: ProjectStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TimeEntry {
  id: string;
  company_id: string;
  employee_id: string;
  project_id: string;
  clock_in: string;
  clock_out: string | null;
  clock_in_lat: number | null;
  clock_in_lng: number | null;
  clock_out_lat: number | null;
  clock_out_lng: number | null;
  duration_seconds: number | null;
  notes: string | null;
  created_at: string;
}

// ─── View Types ──────────────────────────────────────
export interface ActiveSession {
  entry_id: string;
  company_id: string;
  employee_id: string;
  project_id: string;
  clock_in: string;
  clock_in_lat: number | null;
  clock_in_lng: number | null;
  first_name: string;
  last_name: string;
  phone: string;
  project_name: string;
  project_address: string;
  project_lat: number;
  project_lng: number;
  elapsed_seconds: number;
}

// ─── RPC Response Types ──────────────────────────────
export interface ClockInResponse {
  success?: boolean;
  error?: string;
  entry_id?: string;
  distance_m?: number;
  radius_m?: number;
}

export interface ClockOutResponse {
  success?: boolean;
  error?: string;
  entry_id?: string;
  duration_seconds?: number;
}

export interface HoursSummary {
  total_seconds: number;
  entry_count: number;
}

// ─── Joined Types (for UI) ───────────────────────────
export interface TimeEntryWithProject extends TimeEntry {
  projects: Pick<Project, "name" | "address">;
}

export interface TimeEntryWithEmployee extends TimeEntry {
  profiles: Pick<Profile, "first_name" | "last_name" | "phone">;
}

export interface TimeEntryFull extends TimeEntry {
  profiles: Pick<Profile, "first_name" | "last_name" | "phone">;
  projects: Pick<Project, "name" | "address">;
}
