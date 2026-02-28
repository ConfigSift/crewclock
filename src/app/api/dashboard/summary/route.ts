import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { haversineDistanceMeters } from "@/lib/geo";

type ActorProfile = {
  id: string;
  role: "admin" | "manager" | "worker";
  company_id: string;
  account_id: string | null;
  is_active: boolean;
};

type BusinessRow = {
  id: string;
  name: string;
  account_id: string;
};

type MembershipRow = {
  business_id: string;
  is_active: boolean;
};

type ProjectRow = {
  id: string;
  name: string;
  address: string | null;
  status: "active" | "archived" | "completed";
  lat: number | null;
  lng: number | null;
  geo_radius_m: number | null;
};

type TimeEntryRow = {
  id: string;
  employee_id: string;
  project_id: string;
  clock_in: string;
  clock_out: string | null;
  duration_seconds: number | null;
  clock_in_lat: number | null;
  clock_in_lng: number | null;
  clock_out_lat: number | null;
  clock_out_lng: number | null;
};

type GeofenceEventRow = {
  id: string;
  employee_id: string;
  project_id: string;
  time_entry_id: string | null;
  event_type: "enter" | "exit";
  occurred_at: string;
  distance_m: number;
  inside: boolean;
};

type ProfileRow = {
  id: string;
  first_name: string;
  last_name: string;
  phone: string;
};

type AttentionItem =
  | {
      type: "outside_geofence";
      employee_id: string;
      employee_name: string;
      project_id: string;
      project_name: string;
      distance_m: number;
      radius_m: number;
      clock_in: string;
    }
  | {
      type: "left_site";
      employee_id: string;
      employee_name: string;
      project_id: string;
      project_name: string;
      occurred_at: string;
    }
  | {
      type: "long_shift";
      employee_id: string;
      employee_name: string;
      project_id: string;
      project_name: string;
      hours: number;
      clock_in: string;
    }
  | {
      type: "missed_clock_out";
      employee_id: string;
      employee_name: string;
      project_id: string;
      project_name: string;
      clock_in: string;
    };

function jsonNoStore(payload: Record<string, unknown>, status: number) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      Pragma: "no-cache",
    },
  });
}

function asActiveBusinessId(rawCookieValue: string | undefined): string {
  if (!rawCookieValue) return "";
  try {
    return decodeURIComponent(rawCookieValue).trim();
  } catch {
    return rawCookieValue.trim();
  }
}

function startOfUtcDay(date: Date): Date {
  const next = new Date(date);
  next.setUTCHours(0, 0, 0, 0);
  return next;
}

function startOfUtcWeek(date: Date): Date {
  const next = startOfUtcDay(date);
  next.setUTCDate(next.getUTCDate() - next.getUTCDay());
  return next;
}

function durationSeconds(entry: TimeEntryRow): number {
  if (
    typeof entry.duration_seconds === "number" &&
    Number.isFinite(entry.duration_seconds)
  ) {
    return Math.max(0, Math.round(entry.duration_seconds));
  }

  if (!entry.clock_out) return 0;
  const startMs = Date.parse(entry.clock_in);
  const endMs = Date.parse(entry.clock_out);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0;
  return Math.max(0, Math.round((endMs - startMs) / 1000));
}

function getProfileName(profile: ProfileRow | undefined, fallback: string): string {
  if (!profile) return fallback;
  const full = `${profile.first_name ?? ""} ${profile.last_name ?? ""}`.trim();
  return full || profile.phone || fallback;
}

function keyForDate(isoDate: string): string {
  return isoDate.slice(0, 10);
}

function hoursRound(seconds: number): number {
  return Math.round((seconds / 3600) * 100) / 100;
}

function pointOutsideProjectRadius(
  project: ProjectRow | undefined,
  lat: number | null,
  lng: number | null
): { outside: boolean; distance_m: number; radius_m: number } | null {
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
  return {
    outside: distance > project.geo_radius_m,
    distance_m: Math.round(distance),
    radius_m: project.geo_radius_m,
  };
}

async function resolveBusinessForActor(
  actor: ActorProfile,
  requestedBusinessId: string,
  sessionClient: Awaited<ReturnType<typeof createClient>>,
  admin: ReturnType<typeof createAdminClient>
): Promise<BusinessRow | null> {
  const actorAccountId = actor.account_id ?? actor.company_id;
  if (!actorAccountId) return null;

  if (requestedBusinessId) {
    const { data } = await admin
      .from("businesses")
      .select("id, name, account_id")
      .eq("id", requestedBusinessId)
      .maybeSingle();

    if (data && data.account_id === actorAccountId) {
      return data as BusinessRow;
    }
  }

  if (actor.role === "admin") {
    const { data } = await admin
      .from("businesses")
      .select("id, name, account_id")
      .eq("account_id", actorAccountId)
      .order("name")
      .limit(1)
      .maybeSingle();

    if (data) return data as BusinessRow;
  }

  const { data: memberships } = await sessionClient
    .from("business_memberships")
    .select("business_id, is_active")
    .eq("profile_id", actor.id)
    .eq("is_active", true);

  const membershipRows = (memberships ?? []) as MembershipRow[];
  const membershipBusinessIds = membershipRows.map((row) => row.business_id);
  if (membershipBusinessIds.length > 0) {
    const { data } = await admin
      .from("businesses")
      .select("id, name, account_id")
      .eq("account_id", actorAccountId)
      .in("id", membershipBusinessIds)
      .order("name")
      .limit(1)
      .maybeSingle();

    if (data) return data as BusinessRow;
  }

  if (actor.company_id) {
    const { data } = await admin
      .from("businesses")
      .select("id, name, account_id")
      .eq("id", actor.company_id)
      .maybeSingle();

    if (data && data.account_id === actorAccountId) {
      return data as BusinessRow;
    }
  }

  return null;
}

export async function GET() {
  try {
    const sessionClient = await createClient();
    const {
      data: { user },
    } = await sessionClient.auth.getUser();

    if (!user) {
      return jsonNoStore({ ok: false, error: "Unauthorized" }, 401);
    }

    const { data: actor, error: actorError } = await sessionClient
      .from("profiles")
      .select("id, role, company_id, account_id, is_active")
      .eq("id", user.id)
      .single();

    if (actorError || !actor) {
      return jsonNoStore({ ok: false, error: "Unable to load your profile." }, 403);
    }

    const actorProfile = actor as ActorProfile;
    if (!actorProfile.is_active) {
      return jsonNoStore({ ok: false, error: "Your account is inactive." }, 403);
    }

    if (actorProfile.role === "worker") {
      return jsonNoStore(
        { ok: false, error: "Dashboard summary is limited to managers and admins." },
        403
      );
    }

    const cookieStore = await cookies();
    const requestedBusinessId = asActiveBusinessId(
      cookieStore.get("crewclock.activeBusinessId")?.value
    );

    const admin = createAdminClient();
    const business = await resolveBusinessForActor(
      actorProfile,
      requestedBusinessId,
      sessionClient,
      admin
    );

    if (!business) {
      return jsonNoStore(
        { ok: false, error: "Select an active business to view dashboard stats." },
        400
      );
    }

    if (actorProfile.role === "manager") {
      const { data: managerMembership } = await sessionClient
        .from("business_memberships")
        .select("id")
        .eq("business_id", business.id)
        .eq("profile_id", actorProfile.id)
        .eq("is_active", true)
        .maybeSingle();

      if (!managerMembership) {
        return jsonNoStore(
          { ok: false, error: "You do not have access to this business." },
          403
        );
      }
    }

    const now = new Date();
    const startToday = startOfUtcDay(now);
    const startWeek = startOfUtcWeek(now);
    const startLast7Days = new Date(startToday);
    startLast7Days.setUTCDate(startLast7Days.getUTCDate() - 6);
    const yesterdayStart = new Date(startToday);
    yesterdayStart.setUTCDate(yesterdayStart.getUTCDate() - 1);

    const nowIso = now.toISOString();
    const startTodayIso = startToday.toISOString();
    const startWeekIso = startWeek.toISOString();
    const startLast7Iso = startLast7Days.toISOString();
    const yesterdayStartIso = yesterdayStart.toISOString();

    const [openResult, entriesResult, projectsResult] = await Promise.all([
      admin
        .from("time_entries")
        .select(
          "id, employee_id, project_id, clock_in, clock_out, duration_seconds, clock_in_lat, clock_in_lng, clock_out_lat, clock_out_lng"
        )
        .eq("business_id", business.id)
        .is("clock_out", null),
      admin
        .from("time_entries")
        .select(
          "id, employee_id, project_id, clock_in, clock_out, duration_seconds, clock_in_lat, clock_in_lng, clock_out_lat, clock_out_lng"
        )
        .eq("business_id", business.id)
        .gte("clock_in", startLast7Iso)
        .lte("clock_in", nowIso),
      admin
        .from("projects")
        .select("id, name, address, status, lat, lng, geo_radius_m")
        .eq("business_id", business.id),
    ]);

    if (openResult.error || entriesResult.error || projectsResult.error) {
      return jsonNoStore(
        { ok: false, error: "Unable to load dashboard metrics." },
        500
      );
    }

    const openEntries = (openResult.data ?? []) as TimeEntryRow[];
    const entriesLast7Days = (entriesResult.data ?? []) as TimeEntryRow[];
    const projects = (projectsResult.data ?? []) as ProjectRow[];
    const projectById = new Map(projects.map((project) => [project.id, project]));

    const openEntryIds = openEntries.map((entry) => entry.id);
    const employeeIds = new Set<string>();
    openEntries.forEach((entry) => employeeIds.add(entry.employee_id));
    entriesLast7Days.forEach((entry) => employeeIds.add(entry.employee_id));

    let geofenceEventsToday: GeofenceEventRow[] = [];
    const geofenceTodayResult = await admin
      .from("geofence_events")
      .select(
        "id, employee_id, project_id, time_entry_id, event_type, occurred_at, distance_m, inside"
      )
      .eq("business_id", business.id)
      .gte("occurred_at", startTodayIso);

    if (!geofenceTodayResult.error) {
      geofenceEventsToday = (geofenceTodayResult.data ?? []) as GeofenceEventRow[];
      geofenceEventsToday.forEach((event) => employeeIds.add(event.employee_id));
    }

    let geofenceForOpenEntries: GeofenceEventRow[] = [];
    if (openEntryIds.length > 0) {
      const geofenceOpenResult = await admin
        .from("geofence_events")
        .select(
          "id, employee_id, project_id, time_entry_id, event_type, occurred_at, distance_m, inside"
        )
        .eq("business_id", business.id)
        .in("time_entry_id", openEntryIds)
        .order("occurred_at", { ascending: false });

      if (!geofenceOpenResult.error) {
        geofenceForOpenEntries = (geofenceOpenResult.data ?? []) as GeofenceEventRow[];
      }
    }

    const uniqueEmployeeIds = Array.from(employeeIds);
    let profiles: ProfileRow[] = [];
    if (uniqueEmployeeIds.length > 0) {
      const { data: profileRows } = await admin
        .from("profiles")
        .select("id, first_name, last_name, phone")
        .in("id", uniqueEmployeeIds);

      profiles = (profileRows ?? []) as ProfileRow[];
    }
    const profileById = new Map(profiles.map((profile) => [profile.id, profile]));

    const entriesToday = entriesLast7Days.filter((entry) => entry.clock_in >= startTodayIso);
    const closedToday = entriesToday.filter(
      (entry) => entry.clock_out && entry.clock_in >= startTodayIso
    );
    const closedWeek = entriesLast7Days.filter(
      (entry) => entry.clock_out && entry.clock_in >= startWeekIso
    );
    const hoursTodaySeconds = closedToday.reduce(
      (sum, entry) => sum + durationSeconds(entry),
      0
    );
    const hoursWeekSeconds = closedWeek.reduce(
      (sum, entry) => sum + durationSeconds(entry),
      0
    );

    const activeSites = projects.filter((project) => project.status === "active").length;

    const geofenceIncidentKeys = new Set<string>();
    entriesToday.forEach((entry) => {
      const project = projectById.get(entry.project_id);
      const inCheck = pointOutsideProjectRadius(
        project,
        entry.clock_in_lat,
        entry.clock_in_lng
      );
      if (inCheck?.outside) {
        geofenceIncidentKeys.add(`${entry.id}:clock_in`);
      }
      const outCheck = pointOutsideProjectRadius(
        project,
        entry.clock_out_lat,
        entry.clock_out_lng
      );
      if (outCheck?.outside) {
        geofenceIncidentKeys.add(`${entry.id}:clock_out`);
      }
    });

    geofenceEventsToday
      .filter((event) => event.event_type === "exit")
      .forEach((event) => geofenceIncidentKeys.add(`exit:${event.id}`));

    const hoursByDate = new Map<string, number>();
    for (let i = 0; i < 7; i += 1) {
      const date = new Date(startLast7Days);
      date.setUTCDate(startLast7Days.getUTCDate() + i);
      hoursByDate.set(keyForDate(date.toISOString()), 0);
    }

    entriesLast7Days.forEach((entry) => {
      if (!entry.clock_out) return;
      const dayKey = keyForDate(entry.clock_in);
      if (!hoursByDate.has(dayKey)) return;
      hoursByDate.set(dayKey, (hoursByDate.get(dayKey) ?? 0) + durationSeconds(entry));
    });

    const hoursLast7Days = Array.from(hoursByDate.entries()).map(([date, seconds]) => ({
      date,
      hours: hoursRound(seconds),
    }));

    const projectWeekSeconds = new Map<string, number>();
    closedWeek.forEach((entry) => {
      projectWeekSeconds.set(
        entry.project_id,
        (projectWeekSeconds.get(entry.project_id) ?? 0) + durationSeconds(entry)
      );
    });

    const topProjectsWeek = Array.from(projectWeekSeconds.entries())
      .map(([projectId, seconds]) => ({
        project_id: projectId,
        name: projectById.get(projectId)?.name ?? "Unknown project",
        hours: hoursRound(seconds),
      }))
      .sort((a, b) => b.hours - a.hours)
      .slice(0, 10);

    const latestEventByTimeEntry = new Map<string, GeofenceEventRow>();
    geofenceForOpenEntries.forEach((event) => {
      if (!event.time_entry_id) return;
      if (!latestEventByTimeEntry.has(event.time_entry_id)) {
        latestEventByTimeEntry.set(event.time_entry_id, event);
      }
    });

    const attention: AttentionItem[] = [];
    openEntries.forEach((entry) => {
      const project = projectById.get(entry.project_id);
      const profile = profileById.get(entry.employee_id);
      const employeeName = getProfileName(profile, entry.employee_id);
      const projectName = project?.name ?? "Unknown project";

      const clockInOutside = pointOutsideProjectRadius(
        project,
        entry.clock_in_lat,
        entry.clock_in_lng
      );
      if (clockInOutside?.outside) {
        attention.push({
          type: "outside_geofence",
          employee_id: entry.employee_id,
          employee_name: employeeName,
          project_id: entry.project_id,
          project_name: projectName,
          distance_m: clockInOutside.distance_m,
          radius_m: clockInOutside.radius_m,
          clock_in: entry.clock_in,
        });
      }

      const latestEvent = latestEventByTimeEntry.get(entry.id);
      if (latestEvent?.event_type === "exit") {
        attention.push({
          type: "left_site",
          employee_id: entry.employee_id,
          employee_name: employeeName,
          project_id: entry.project_id,
          project_name: projectName,
          occurred_at: latestEvent.occurred_at,
        });
      }

      const clockInMs = Date.parse(entry.clock_in);
      if (Number.isFinite(clockInMs)) {
        const runningHours = (Date.now() - clockInMs) / 3_600_000;
        if (runningHours > 10) {
          attention.push({
            type: "long_shift",
            employee_id: entry.employee_id,
            employee_name: employeeName,
            project_id: entry.project_id,
            project_name: projectName,
            hours: Math.round(runningHours * 100) / 100,
            clock_in: entry.clock_in,
          });
        }
      }

      if (entry.clock_in < yesterdayStartIso) {
        attention.push({
          type: "missed_clock_out",
          employee_id: entry.employee_id,
          employee_name: employeeName,
          project_id: entry.project_id,
          project_name: projectName,
          clock_in: entry.clock_in,
        });
      }
    });

    const payload = {
      kpis: {
        active_now: openEntries.length,
        open_shifts: openEntries.length,
        hours_today: hoursRound(hoursTodaySeconds),
        hours_week: hoursRound(hoursWeekSeconds),
        active_sites: activeSites,
        geofence_alerts_today: geofenceIncidentKeys.size,
      },
      charts: {
        hours_last_7_days: hoursLast7Days,
        top_projects_week: topProjectsWeek,
      },
      attention: attention.slice(0, 10),
    };

    return jsonNoStore(payload, 200);
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unexpected dashboard summary error.";
    return jsonNoStore({ ok: false, error: message }, 500);
  }
}
