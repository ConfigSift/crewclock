import "server-only";

import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { haversineDistanceMeters } from "@/lib/geo";
import type { BusinessMembershipRole, UserRole } from "@/types/database";

export type RawSearchParams = Record<string, string | string[] | undefined>;
export type ReportRangePreset = "last7" | "last30" | "thisWeek" | "custom";
export type ReportTabKey =
  | "overview"
  | "projects"
  | "crew"
  | "activity"
  | "attendance"
  | "geofence";

type ActorProfileRow = {
  id: string;
  role: UserRole;
  company_id: string;
  account_id: string | null;
  is_active: boolean;
};

type BusinessRow = {
  id: string;
  name: string;
  account_id: string;
};

type ProjectRow = {
  id: string;
  business_id: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  geo_radius_m: number | null;
  status: "active" | "archived" | "completed";
};

type TimeEntryRow = {
  id: string;
  business_id: string | null;
  project_id: string;
  employee_id: string;
  clock_in: string;
  clock_out: string | null;
  clock_in_lat: number | null;
  clock_in_lng: number | null;
  clock_out_lat: number | null;
  clock_out_lng: number | null;
  duration_seconds: number | null;
};

type MembershipRow = {
  business_id: string;
  profile_id: string;
  role: BusinessMembershipRole;
  is_active: boolean;
};

type WorkerProfileRow = {
  id: string;
  first_name: string;
  last_name: string;
  phone: string;
  role: UserRole;
};

export type ReportProjectOption = {
  id: string;
  name: string;
  status: "active" | "archived" | "completed";
};

export type ReportWorkerOption = {
  id: string;
  name: string;
  phone: string;
  role: UserRole;
  membership_role: BusinessMembershipRole | null;
};

export type ReportFilters = {
  range: ReportRangePreset;
  project_id: string;
  worker_id: string;
  start: string;
  end: string;
  from_iso: string;
  to_iso: string;
};

export type TopHoursItem = {
  id: string;
  name: string;
  seconds: number;
};

export type AttendanceRowView = {
  id: string;
  clock_in: string;
  clock_out: string | null;
  project_id: string;
  project_name: string;
  worker_id: string;
  worker_name: string;
  duration_seconds: number;
  clock_in_outside_geofence: boolean;
  clock_out_outside_geofence: boolean;
};

export type ProjectWorkerBreakdown = {
  worker_id: string;
  worker_name: string;
  seconds: number;
};

export type ProjectReportRow = {
  project_id: string;
  project_name: string;
  project_address: string | null;
  seconds: number;
  worker_breakdown: ProjectWorkerBreakdown[];
};

export type CrewReportRow = {
  worker_id: string;
  worker_name: string;
  phone: string;
  role: UserRole | "unknown";
  seconds: number;
  project_ids: string[];
  projects_worked: number;
};

export type GeofenceReportRow = {
  project_id: string;
  project_name: string;
  project_address: string | null;
  punches_inside: number;
  punches_total: number;
  percent_inside: number | null;
  exits: number;
  minutes_outside: number | null;
};

export type ReportsData = {
  business: { id: string; name: string };
  actor: { id: string; role: UserRole };
  generated_at: string;
  filters: ReportFilters;
  options: {
    projects: ReportProjectOption[];
    workers: ReportWorkerOption[];
  };
  overview: {
    total_hours_this_week_seconds: number;
    total_hours_selected_range_seconds: number;
    total_crew_count: number;
    active_sites_count: number;
    top_projects: TopHoursItem[];
    top_workers: TopHoursItem[];
  };
  attendance: AttendanceRowView[];
  projects: ProjectReportRow[];
  crew: CrewReportRow[];
  geofence: GeofenceReportRow[];
};

export type ReportsQueryResult =
  | { ok: true; data: ReportsData }
  | { ok: false; error: string };

function asSingleValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0]?.trim() ?? "";
  return value?.trim() ?? "";
}

function parseIsoDateInput(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function startOfThisWeek(date: Date): Date {
  const next = startOfDay(date);
  next.setDate(next.getDate() - next.getDay());
  return next;
}

function resolveRange(
  rawRange: string,
  rawStart: string,
  rawEnd: string,
  now: Date
): {
  range: ReportRangePreset;
  startDate: Date;
  endDate: Date;
  startInput: string;
  endInput: string;
} {
  const safeRange: ReportRangePreset =
    rawRange === "last30" || rawRange === "thisWeek" || rawRange === "custom"
      ? rawRange
      : "last7";

  if (safeRange === "thisWeek") {
    const start = startOfThisWeek(now);
    const end = endOfDay(now);
    return {
      range: safeRange,
      startDate: start,
      endDate: end,
      startInput: toDateInputValue(start),
      endInput: toDateInputValue(end),
    };
  }

  if (safeRange === "last30") {
    const start = startOfDay(new Date(now));
    start.setDate(start.getDate() - 29);
    const end = endOfDay(now);
    return {
      range: safeRange,
      startDate: start,
      endDate: end,
      startInput: toDateInputValue(start),
      endInput: toDateInputValue(end),
    };
  }

  if (safeRange === "custom") {
    const parsedStart = parseIsoDateInput(rawStart);
    const parsedEnd = parseIsoDateInput(rawEnd);
    if (parsedStart && parsedEnd) {
      const start = startOfDay(parsedStart);
      const end = endOfDay(parsedEnd);
      if (end >= start) {
        return {
          range: safeRange,
          startDate: start,
          endDate: end,
          startInput: rawStart,
          endInput: rawEnd,
        };
      }
    }
  }

  const start = startOfDay(new Date(now));
  start.setDate(start.getDate() - 6);
  const end = endOfDay(now);
  return {
    range: "last7",
    startDate: start,
    endDate: end,
    startInput: toDateInputValue(start),
    endInput: toDateInputValue(end),
  };
}

function resolveActiveBusinessId(rawCookie: string | undefined): string {
  if (!rawCookie) return "";
  try {
    return decodeURIComponent(rawCookie).trim();
  } catch {
    return rawCookie.trim();
  }
}

function isInsideGeofence(
  project: ProjectRow | undefined,
  lat: number | null,
  lng: number | null
): boolean | null {
  if (!project) return null;
  if (
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    typeof project.lat !== "number" ||
    typeof project.lng !== "number" ||
    typeof project.geo_radius_m !== "number"
  ) {
    return null;
  }

  const distance = haversineDistanceMeters(lat, lng, project.lat, project.lng);
  return distance <= project.geo_radius_m;
}

function resolveDurationSeconds(entry: TimeEntryRow, nowMs: number): number {
  if (typeof entry.duration_seconds === "number" && Number.isFinite(entry.duration_seconds)) {
    return Math.max(0, Math.round(entry.duration_seconds));
  }

  const startMs = Date.parse(entry.clock_in);
  if (!Number.isFinite(startMs)) return 0;
  const endMs = entry.clock_out ? Date.parse(entry.clock_out) : nowMs;
  if (!Number.isFinite(endMs)) return 0;
  return Math.max(0, Math.round((endMs - startMs) / 1000));
}

function between(ms: number, startMs: number, endMs: number): boolean {
  return ms >= startMs && ms <= endMs;
}

function nameForProfile(profile: WorkerProfileRow | undefined, fallbackId: string): string {
  if (!profile) return fallbackId;
  const first = profile.first_name?.trim() ?? "";
  const last = profile.last_name?.trim() ?? "";
  const full = `${first} ${last}`.trim();
  return full || profile.phone || fallbackId;
}

export async function resolveSearchParams(
  searchParams: RawSearchParams | Promise<RawSearchParams> | undefined
): Promise<RawSearchParams> {
  if (!searchParams) return {};
  if (typeof (searchParams as Promise<RawSearchParams>).then === "function") {
    return (await searchParams) ?? {};
  }
  return searchParams;
}

export async function getReportsData(rawSearchParams: RawSearchParams): Promise<ReportsQueryResult> {
  const sessionClient = await createClient();
  const {
    data: { user },
  } = await sessionClient.auth.getUser();

  if (!user) {
    return { ok: false, error: "You must be logged in to view reports." };
  }

  const { data: actorProfile, error: actorError } = await sessionClient
    .from("profiles")
    .select("id, role, company_id, account_id, is_active")
    .eq("id", user.id)
    .single();

  if (actorError || !actorProfile) {
    return { ok: false, error: "Unable to load your profile." };
  }

  const actor = actorProfile as ActorProfileRow;
  if (!actor.is_active) {
    return { ok: false, error: "Your account is inactive." };
  }

  if (actor.role === "worker") {
    return { ok: false, error: "Reports are available to managers and admins only." };
  }

  const cookieStore = await cookies();
  const businessId = resolveActiveBusinessId(
    cookieStore.get("crewclock.activeBusinessId")?.value
  );
  if (!businessId) {
    return { ok: false, error: "Select a business to view reports." };
  }

  const admin = createAdminClient();
  const { data: business, error: businessError } = await admin
    .from("businesses")
    .select("id, name, account_id")
    .eq("id", businessId)
    .single();

  if (businessError || !business) {
    return { ok: false, error: "Active business not found." };
  }

  const businessRow = business as BusinessRow;
  const actorAccountId = actor.account_id ?? actor.company_id;
  if (businessRow.account_id !== actorAccountId) {
    return { ok: false, error: "You do not have access to this business." };
  }

  const now = new Date();
  const rawRange = asSingleValue(rawSearchParams.range);
  const rawStart = asSingleValue(rawSearchParams.start);
  const rawEnd = asSingleValue(rawSearchParams.end);
  const range = resolveRange(rawRange, rawStart, rawEnd, now);
  const selectedStartMs = range.startDate.getTime();
  const selectedEndMs = range.endDate.getTime();

  const thisWeekStart = startOfThisWeek(now);
  const thisWeekEnd = endOfDay(now);
  const thisWeekStartMs = thisWeekStart.getTime();
  const thisWeekEndMs = thisWeekEnd.getTime();

  const queryStartMs = Math.min(selectedStartMs, thisWeekStartMs);
  const queryEndMs = Math.max(selectedEndMs, thisWeekEndMs);
  const queryStartIso = new Date(queryStartMs).toISOString();
  const queryEndIso = new Date(queryEndMs).toISOString();

  const projectFilterId = asSingleValue(rawSearchParams.project_id);
  const workerFilterId = asSingleValue(rawSearchParams.worker_id);

  const { data: projects, error: projectsError } = await admin
    .from("projects")
    .select("id, business_id, name, address, lat, lng, geo_radius_m, status")
    .eq("business_id", businessId)
    .order("name");

  if (projectsError) {
    return { ok: false, error: "Unable to load projects for reports." };
  }
  const projectRows = (projects ?? []) as ProjectRow[];
  const projectById = new Map(projectRows.map((row) => [row.id, row]));

  const { data: memberships, error: membershipsError } = await admin
    .from("business_memberships")
    .select("business_id, profile_id, role, is_active")
    .eq("business_id", businessId);

  if (membershipsError) {
    return { ok: false, error: "Unable to load crew memberships for reports." };
  }
  const membershipRows = (memberships ?? []) as MembershipRow[];

  let entriesQuery = admin
    .from("time_entries")
    .select(
      "id, business_id, project_id, employee_id, clock_in, clock_out, clock_in_lat, clock_in_lng, clock_out_lat, clock_out_lng, duration_seconds"
    )
    .eq("business_id", businessId)
    .gte("clock_in", queryStartIso)
    .lte("clock_in", queryEndIso);

  if (projectFilterId) {
    entriesQuery = entriesQuery.eq("project_id", projectFilterId);
  }
  if (workerFilterId) {
    entriesQuery = entriesQuery.eq("employee_id", workerFilterId);
  }

  const { data: entries, error: entriesError } = await entriesQuery.order("clock_in", {
    ascending: false,
  });

  if (entriesError) {
    return { ok: false, error: "Unable to load time entries for reports." };
  }
  const entryRows = (entries ?? []) as TimeEntryRow[];

  const allProfileIds = new Set<string>();
  membershipRows.forEach((membership) => allProfileIds.add(membership.profile_id));
  entryRows.forEach((entry) => allProfileIds.add(entry.employee_id));
  allProfileIds.add(actor.id);

  const profileIds = Array.from(allProfileIds);
  let workerProfiles: WorkerProfileRow[] = [];
  if (profileIds.length > 0) {
    const { data: profiles, error: profilesError } = await admin
      .from("profiles")
      .select("id, first_name, last_name, phone, role")
      .in("id", profileIds);

    if (profilesError) {
      return { ok: false, error: "Unable to load worker profiles for reports." };
    }

    workerProfiles = (profiles ?? []) as WorkerProfileRow[];
  }

  const profileById = new Map(workerProfiles.map((row) => [row.id, row]));
  const membershipRoleByProfile = new Map<string, BusinessMembershipRole>();
  membershipRows.forEach((membership) => {
    if (membership.is_active) membershipRoleByProfile.set(membership.profile_id, membership.role);
  });

  const nowMs = now.getTime();

  const selectedEntries: Array<{
    row: TimeEntryRow;
    seconds: number;
    project: ProjectRow | undefined;
    worker: WorkerProfileRow | undefined;
    clockInMs: number;
  }> = [];
  const weekEntries: Array<{ seconds: number }> = [];

  entryRows.forEach((entry) => {
    const clockInMs = Date.parse(entry.clock_in);
    if (!Number.isFinite(clockInMs)) return;

    const seconds = resolveDurationSeconds(entry, nowMs);
    if (between(clockInMs, selectedStartMs, selectedEndMs)) {
      selectedEntries.push({
        row: entry,
        seconds,
        project: projectById.get(entry.project_id),
        worker: profileById.get(entry.employee_id),
        clockInMs,
      });
    }
    if (between(clockInMs, thisWeekStartMs, thisWeekEndMs)) {
      weekEntries.push({ seconds });
    }
  });

  const totalSelectedSeconds = selectedEntries.reduce((sum, entry) => sum + entry.seconds, 0);
  const totalWeekSeconds = weekEntries.reduce((sum, entry) => sum + entry.seconds, 0);
  const activeCrewIds = new Set(
    membershipRows.filter((membership) => membership.is_active).map((membership) => membership.profile_id)
  );
  const activeSitesCount = projectRows.filter((project) => project.status === "active").length;

  const projectReportMap = new Map<
    string,
    {
      project: ProjectRow | undefined;
      seconds: number;
      workerMap: Map<string, { worker: WorkerProfileRow | undefined; seconds: number }>;
    }
  >();
  const crewReportMap = new Map<
    string,
    {
      worker: WorkerProfileRow | undefined;
      seconds: number;
      projectIds: Set<string>;
    }
  >();

  selectedEntries.forEach((entry) => {
    const projectKey = entry.row.project_id;
    const workerKey = entry.row.employee_id;

    if (!projectReportMap.has(projectKey)) {
      projectReportMap.set(projectKey, {
        project: entry.project,
        seconds: 0,
        workerMap: new Map(),
      });
    }
    const projectBucket = projectReportMap.get(projectKey);
    if (projectBucket) {
      projectBucket.seconds += entry.seconds;
      const existingWorker = projectBucket.workerMap.get(workerKey);
      if (existingWorker) {
        existingWorker.seconds += entry.seconds;
      } else {
        projectBucket.workerMap.set(workerKey, {
          worker: entry.worker,
          seconds: entry.seconds,
        });
      }
    }

    if (!crewReportMap.has(workerKey)) {
      crewReportMap.set(workerKey, {
        worker: entry.worker,
        seconds: 0,
        projectIds: new Set<string>(),
      });
    }
    const crewBucket = crewReportMap.get(workerKey);
    if (crewBucket) {
      crewBucket.seconds += entry.seconds;
      crewBucket.projectIds.add(projectKey);
    }
  });

  const projectsReport: ProjectReportRow[] = Array.from(projectReportMap.entries())
    .map(([projectId, bucket]) => {
      const workerBreakdown = Array.from(bucket.workerMap.entries())
        .map(([workerId, workerBucket]) => ({
          worker_id: workerId,
          worker_name: nameForProfile(workerBucket.worker, workerId),
          seconds: workerBucket.seconds,
        }))
        .sort((a, b) => b.seconds - a.seconds);

      return {
        project_id: projectId,
        project_name: bucket.project?.name ?? "Unknown project",
        project_address: bucket.project?.address ?? null,
        seconds: bucket.seconds,
        worker_breakdown: workerBreakdown,
      };
    })
    .sort((a, b) => b.seconds - a.seconds);

  const crewReport: CrewReportRow[] = Array.from(crewReportMap.entries())
    .map(([workerId, bucket]) => ({
      worker_id: workerId,
      worker_name: nameForProfile(bucket.worker, workerId),
      phone: bucket.worker?.phone ?? "",
      role: (bucket.worker?.role ?? "unknown") as UserRole | "unknown",
      seconds: bucket.seconds,
      project_ids: Array.from(bucket.projectIds),
      projects_worked: bucket.projectIds.size,
    }))
    .sort((a, b) => b.seconds - a.seconds);

  const topProjects: TopHoursItem[] = projectsReport.slice(0, 5).map((project) => ({
    id: project.project_id,
    name: project.project_name,
    seconds: project.seconds,
  }));
  const topWorkers: TopHoursItem[] = crewReport.slice(0, 5).map((worker) => ({
    id: worker.worker_id,
    name: worker.worker_name,
    seconds: worker.seconds,
  }));

  const attendance: AttendanceRowView[] = selectedEntries
    .sort((a, b) => b.clockInMs - a.clockInMs)
    .map((entry) => {
      const clockInInside = isInsideGeofence(
        entry.project,
        entry.row.clock_in_lat,
        entry.row.clock_in_lng
      );
      const clockOutInside = isInsideGeofence(
        entry.project,
        entry.row.clock_out_lat,
        entry.row.clock_out_lng
      );
      return {
        id: entry.row.id,
        clock_in: entry.row.clock_in,
        clock_out: entry.row.clock_out,
        project_id: entry.row.project_id,
        project_name: entry.project?.name ?? "Unknown project",
        worker_id: entry.row.employee_id,
        worker_name: nameForProfile(entry.worker, entry.row.employee_id),
        duration_seconds: entry.seconds,
        clock_in_outside_geofence: clockInInside === false,
        clock_out_outside_geofence: clockOutInside === false,
      };
    });

  const geofenceProjectMap = new Map<
    string,
    {
      project: ProjectRow;
      punchesInside: number;
      punchesTotal: number;
      exits: number;
    }
  >();

  projectRows.forEach((project) => {
    geofenceProjectMap.set(project.id, {
      project,
      punchesInside: 0,
      punchesTotal: 0,
      exits: 0,
    });
  });

  selectedEntries.forEach((entry) => {
    const bucket = geofenceProjectMap.get(entry.row.project_id);
    if (!bucket) return;

    const clockInInside = isInsideGeofence(
      entry.project,
      entry.row.clock_in_lat,
      entry.row.clock_in_lng
    );
    if (clockInInside !== null) {
      bucket.punchesTotal += 1;
      if (clockInInside) bucket.punchesInside += 1;
    }

    const clockOutInside = isInsideGeofence(
      entry.project,
      entry.row.clock_out_lat,
      entry.row.clock_out_lng
    );
    if (clockOutInside !== null) {
      bucket.punchesTotal += 1;
      if (clockOutInside) {
        bucket.punchesInside += 1;
      } else {
        bucket.exits += 1;
      }
    }
  });

  const geofence: GeofenceReportRow[] = Array.from(geofenceProjectMap.values())
    .map((bucket) => ({
      project_id: bucket.project.id,
      project_name: bucket.project.name,
      project_address: bucket.project.address ?? null,
      punches_inside: bucket.punchesInside,
      punches_total: bucket.punchesTotal,
      percent_inside:
        bucket.punchesTotal > 0
          ? Math.round((bucket.punchesInside / bucket.punchesTotal) * 100)
          : null,
      exits: bucket.exits,
      minutes_outside: null,
    }))
    .sort((a, b) => a.project_name.localeCompare(b.project_name));

  const optionsProjects: ReportProjectOption[] = projectRows
    .map((project) => ({ id: project.id, name: project.name, status: project.status }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const optionsWorkers: ReportWorkerOption[] = Array.from(activeCrewIds)
    .map((profileId) => {
      const profile = profileById.get(profileId);
      return {
        id: profileId,
        name: nameForProfile(profile, profileId),
        phone: profile?.phone ?? "",
        role: profile?.role ?? "worker",
        membership_role: membershipRoleByProfile.get(profileId) ?? null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    ok: true,
    data: {
      business: { id: businessRow.id, name: businessRow.name },
      actor: { id: actor.id, role: actor.role },
      generated_at: new Date().toISOString(),
      filters: {
        range: range.range,
        project_id: projectFilterId,
        worker_id: workerFilterId,
        start: range.startInput,
        end: range.endInput,
        from_iso: range.startDate.toISOString(),
        to_iso: range.endDate.toISOString(),
      },
      options: {
        projects: optionsProjects,
        workers: optionsWorkers,
      },
      overview: {
        total_hours_this_week_seconds: totalWeekSeconds,
        total_hours_selected_range_seconds: totalSelectedSeconds,
        total_crew_count: activeCrewIds.size,
        active_sites_count: activeSitesCount,
        top_projects: topProjects,
        top_workers: topWorkers,
      },
      attendance,
      projects: projectsReport,
      crew: crewReport,
      geofence,
    },
  };
}
