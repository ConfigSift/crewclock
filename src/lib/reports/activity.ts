import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

type TimelineType = "clock_in" | "clock_out" | "enter" | "exit";

type TimeEntryEventRow = {
  id: string;
  time_entry_id: string;
  employee_id: string;
  event_type: "clock_in" | "clock_out" | "manager_clock_out" | "edit";
  occurred_at: string;
  metadata: Record<string, unknown>;
};

type TimeEntryRow = {
  id: string;
  employee_id: string;
  project_id: string;
  clock_in: string;
  clock_out: string | null;
};

type GeofenceEventRow = {
  id: string;
  employee_id: string;
  project_id: string;
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

type ProjectRow = {
  id: string;
  name: string;
};

type RawTimelineEvent = {
  id: string;
  occurred_at: string;
  type: TimelineType;
  employee_id: string;
  project_id: string;
  source: "time_entry_events" | "time_entries" | "geofence_events";
  distance_m: number | null;
  inside: boolean | null;
};

export type ActivityTimelineRow = {
  id: string;
  occurred_at: string;
  type: TimelineType;
  employee_id: string;
  employee_name: string;
  project_id: string;
  project_name: string;
  source: "time_entry_events" | "time_entries" | "geofence_events";
  distance_m: number | null;
  inside: boolean | null;
};

export type ActivityTimelineResult = {
  rows: ActivityTimelineRow[];
  used_time_entry_events: boolean;
  used_time_entries_fallback: boolean;
};

type TimelineQueryInput = {
  businessId: string;
  fromIso: string;
  toIso: string;
  workerId?: string;
  projectId?: string;
  employeeId?: string;
  maxRows?: number;
};

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function inRange(value: string, fromIso: string, toIso: string): boolean {
  return value >= fromIso && value <= toIso;
}

function mapClockType(
  eventType: TimeEntryEventRow["event_type"]
): "clock_in" | "clock_out" | null {
  if (eventType === "clock_in") return "clock_in";
  if (eventType === "clock_out" || eventType === "manager_clock_out") return "clock_out";
  return null;
}

function profileName(profile: ProfileRow | undefined, fallbackId: string): string {
  if (!profile) return fallbackId;
  const full = `${profile.first_name ?? ""} ${profile.last_name ?? ""}`.trim();
  return full || profile.phone || fallbackId;
}

export async function getActivityTimelineData(
  input: TimelineQueryInput
): Promise<ActivityTimelineResult> {
  const admin = createAdminClient();
  const maxRows = input.maxRows ?? 500;
  const effectiveWorker = input.employeeId?.trim() || input.workerId?.trim() || "";
  const projectFilter = input.projectId?.trim() || "";
  const rawEvents: RawTimelineEvent[] = [];

  let usedTimeEntryEvents = false;
  let usedTimeEntriesFallback = false;

  let geofenceQuery = admin
    .from("geofence_events")
    .select("id, employee_id, project_id, event_type, occurred_at, distance_m, inside")
    .eq("business_id", input.businessId)
    .gte("occurred_at", input.fromIso)
    .lte("occurred_at", input.toIso);

  if (effectiveWorker) {
    geofenceQuery = geofenceQuery.eq("employee_id", effectiveWorker);
  }

  if (projectFilter) {
    geofenceQuery = geofenceQuery.eq("project_id", projectFilter);
  }

  const { data: geofenceEvents } = await geofenceQuery.order("occurred_at", {
    ascending: false,
  });

  ((geofenceEvents ?? []) as GeofenceEventRow[]).forEach((event) => {
    rawEvents.push({
      id: `geofence-${event.id}`,
      occurred_at: event.occurred_at,
      type: event.event_type,
      employee_id: event.employee_id,
      project_id: event.project_id,
      source: "geofence_events",
      distance_m: event.distance_m,
      inside: event.inside,
    });
  });

  let timeEntryEventsQuery = admin
    .from("time_entry_events")
    .select("id, time_entry_id, employee_id, event_type, occurred_at, metadata")
    .eq("business_id", input.businessId)
    .gte("occurred_at", input.fromIso)
    .lte("occurred_at", input.toIso)
    .in("event_type", ["clock_in", "clock_out", "manager_clock_out"]);

  if (effectiveWorker) {
    timeEntryEventsQuery = timeEntryEventsQuery.eq("employee_id", effectiveWorker);
  }

  const { data: timeEntryEvents, error: timeEntryEventsError } = await timeEntryEventsQuery.order(
    "occurred_at",
    { ascending: false }
  );

  const timeEntryEventRows =
    !timeEntryEventsError && Array.isArray(timeEntryEvents)
      ? (timeEntryEvents as TimeEntryEventRow[])
      : [];

  if (timeEntryEventRows.length > 0) {
    const timeEntryIds = Array.from(
      new Set(timeEntryEventRows.map((event) => event.time_entry_id).filter(Boolean))
    );
    const timeEntryById = new Map<string, TimeEntryRow>();

    if (timeEntryIds.length > 0) {
      const { data: linkedEntries } = await admin
        .from("time_entries")
        .select("id, employee_id, project_id, clock_in, clock_out")
        .eq("business_id", input.businessId)
        .in("id", timeEntryIds);

      ((linkedEntries ?? []) as TimeEntryRow[]).forEach((entry) => {
        timeEntryById.set(entry.id, entry);
      });
    }

    timeEntryEventRows.forEach((event) => {
      const mappedType = mapClockType(event.event_type);
      if (!mappedType) return;

      const linkedEntry = timeEntryById.get(event.time_entry_id);
      const metadataProjectId = asString(event.metadata?.project_id);
      const projectId = linkedEntry?.project_id ?? metadataProjectId;
      if (!projectId) return;
      if (projectFilter && projectId !== projectFilter) return;

      rawEvents.push({
        id: `clock-event-${event.id}`,
        occurred_at: event.occurred_at,
        type: mappedType,
        employee_id: event.employee_id,
        project_id: projectId,
        source: "time_entry_events",
        distance_m: null,
        inside: null,
      });
    });

    usedTimeEntryEvents = rawEvents.some((event) => event.source === "time_entry_events");
  }

  if (!usedTimeEntryEvents) {
    usedTimeEntriesFallback = true;

    let entriesQuery = admin
      .from("time_entries")
      .select("id, employee_id, project_id, clock_in, clock_out")
      .eq("business_id", input.businessId)
      .lte("clock_in", input.toIso);

    if (effectiveWorker) {
      entriesQuery = entriesQuery.eq("employee_id", effectiveWorker);
    }
    if (projectFilter) {
      entriesQuery = entriesQuery.eq("project_id", projectFilter);
    }

    const { data: timeEntries } = await entriesQuery.order("clock_in", { ascending: false });
    const entries = (timeEntries ?? []) as TimeEntryRow[];

    entries.forEach((entry) => {
      if (inRange(entry.clock_in, input.fromIso, input.toIso)) {
        rawEvents.push({
          id: `clock-in-${entry.id}`,
          occurred_at: entry.clock_in,
          type: "clock_in",
          employee_id: entry.employee_id,
          project_id: entry.project_id,
          source: "time_entries",
          distance_m: null,
          inside: null,
        });
      }

      if (entry.clock_out && inRange(entry.clock_out, input.fromIso, input.toIso)) {
        rawEvents.push({
          id: `clock-out-${entry.id}`,
          occurred_at: entry.clock_out,
          type: "clock_out",
          employee_id: entry.employee_id,
          project_id: entry.project_id,
          source: "time_entries",
          distance_m: null,
          inside: null,
        });
      }
    });
  }

  const employeeIds = Array.from(new Set(rawEvents.map((event) => event.employee_id)));
  const projectIds = Array.from(new Set(rawEvents.map((event) => event.project_id)));

  const profileById = new Map<string, ProfileRow>();
  if (employeeIds.length > 0) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, first_name, last_name, phone")
      .in("id", employeeIds);

    ((profiles ?? []) as ProfileRow[]).forEach((profile) => profileById.set(profile.id, profile));
  }

  const projectById = new Map<string, ProjectRow>();
  if (projectIds.length > 0) {
    const { data: projects } = await admin
      .from("projects")
      .select("id, name")
      .in("id", projectIds);

    ((projects ?? []) as ProjectRow[]).forEach((project) => projectById.set(project.id, project));
  }

  const rows = rawEvents
    .sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at))
    .slice(0, maxRows)
    .map((event) => ({
      id: event.id,
      occurred_at: event.occurred_at,
      type: event.type,
      employee_id: event.employee_id,
      employee_name: profileName(profileById.get(event.employee_id), event.employee_id),
      project_id: event.project_id,
      project_name: projectById.get(event.project_id)?.name ?? event.project_id,
      source: event.source,
      distance_m: event.distance_m,
      inside: event.inside,
    }));

  return {
    rows,
    used_time_entry_events: usedTimeEntryEvents,
    used_time_entries_fallback: usedTimeEntriesFallback,
  };
}
