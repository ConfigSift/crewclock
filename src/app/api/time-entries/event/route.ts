import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  computeDistanceMeters,
  computeInsideGeofence,
  ensureFiniteNumber,
  parseOccurredAt,
} from "@/lib/event-utils";

type TimeEntryEventType = "clock_in" | "clock_out" | "manager_clock_out" | "edit";

type RequestBody = {
  time_entry_id?: string;
  event_type?: TimeEntryEventType;
  occurred_at?: string;
  lat?: number;
  lng?: number;
  project_id?: string;
  source?: string;
  metadata?: Record<string, unknown>;
};

type ActorProfile = {
  id: string;
  role: "admin" | "manager" | "worker";
  company_id: string;
  account_id: string | null;
  is_active: boolean;
};

type BusinessRow = {
  id: string;
  account_id: string;
};

type MembershipRow = {
  id: string;
};

type TimeEntryRow = {
  id: string;
  business_id: string | null;
  employee_id: string;
  project_id: string;
};

type ProjectRow = {
  id: string;
  business_id: string | null;
  lat: number | null;
  lng: number | null;
  geo_radius_m: number | null;
};

type TimeEntryEventRow = {
  id: string;
  business_id: string;
  time_entry_id: string;
  employee_id: string;
  event_type: TimeEntryEventType;
  occurred_at: string;
  lat: number | null;
  lng: number | null;
  distance_m: number | null;
  inside: boolean | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

type ErrorPayload = {
  ok: false;
  error: string;
  code: string;
  details?: unknown;
};

const EVENT_TYPES: TimeEntryEventType[] = [
  "clock_in",
  "clock_out",
  "manager_clock_out",
  "edit",
];

const SHOULD_DEBUG_TIME_EVENTS = process.env.DEBUG_TIME_EVENTS === "1";

function debugLog(message: string, details?: Record<string, unknown>) {
  if (!SHOULD_DEBUG_TIME_EVENTS) return;
  console.log("[time-entry-events]", message, details ?? {});
}

function jsonNoStore(payload: Record<string, unknown>, status: number) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      Pragma: "no-cache",
    },
  });
}

function errorJson(
  status: number,
  code: string,
  error: string,
  details?: unknown
) {
  const payload: ErrorPayload = {
    ok: false,
    code,
    error,
  };
  if (details !== undefined) {
    payload.details = details;
  }
  return jsonNoStore(payload, status);
}

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseEventType(value: unknown): TimeEntryEventType {
  if (typeof value !== "string" || !EVENT_TYPES.includes(value as TimeEntryEventType)) {
    throw new Error(
      "event_type must be one of: clock_in, clock_out, manager_clock_out, edit."
    );
  }
  return value as TimeEntryEventType;
}

function parseLatLng(value: unknown, fieldName: "lat" | "lng"): number | null {
  if (value === undefined || value === null) return null;
  return ensureFiniteNumber(value, fieldName);
}

function parseMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asActiveBusinessId(rawCookieValue: string | undefined): string {
  if (!rawCookieValue) return "";
  try {
    return decodeURIComponent(rawCookieValue).trim();
  } catch {
    return rawCookieValue.trim();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function readTimeEntryWithRetry(
  admin: ReturnType<typeof createAdminClient>,
  timeEntryId: string,
  maxAttempts = 3,
  delayMs = 100
): Promise<{ entry: TimeEntryRow | null; attempts: number; readErrorCode: string | null }> {
  let attempts = 0;

  while (attempts < maxAttempts) {
    attempts += 1;
    const { data, error } = await admin
      .from("time_entries")
      .select("id, business_id, employee_id, project_id")
      .eq("id", timeEntryId)
      .maybeSingle();

    if (data) {
      return {
        entry: data as TimeEntryRow,
        attempts,
        readErrorCode: null,
      };
    }

    if (error) {
      return {
        entry: null,
        attempts,
        readErrorCode: error.code ?? null,
      };
    }

    if (attempts < maxAttempts) {
      await sleep(delayMs);
    }
  }

  return { entry: null, attempts, readErrorCode: null };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as RequestBody;
    const timeEntryId = asTrimmedString(body.time_entry_id);
    if (!timeEntryId) {
      return errorJson(
        400,
        "TIME_ENTRY_ID_REQUIRED",
        "time_entry_id is required."
      );
    }

    let eventType: TimeEntryEventType;
    let occurredAtIso: string;
    let lat: number | null;
    let lng: number | null;
    let metadata: Record<string, unknown>;

    try {
      eventType = parseEventType(body.event_type);
      occurredAtIso = parseOccurredAt(body.occurred_at);
      lat = parseLatLng(body.lat, "lat");
      lng = parseLatLng(body.lng, "lng");
      metadata = parseMetadata(body.metadata);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Invalid request body.";
      return errorJson(400, "INVALID_PAYLOAD", message);
    }

    if ((lat === null) !== (lng === null)) {
      return errorJson(
        400,
        "INVALID_COORDINATES",
        "lat and lng must both be provided together."
      );
    }

    const projectIdOverride = asTrimmedString(body.project_id) || null;
    const source = asTrimmedString(body.source) || "unknown";
    if (!("source" in metadata)) {
      metadata.source = source;
    }

    debugLog("received payload", {
      event_type: eventType,
      time_entry_id: timeEntryId,
      has_lat_lng: lat !== null && lng !== null,
      has_project_id: Boolean(projectIdOverride),
      has_occurred_at: typeof body.occurred_at === "string" && body.occurred_at.length > 0,
    });

    const sessionClient = await createClient();
    const {
      data: { user },
    } = await sessionClient.auth.getUser();

    if (!user) {
      return errorJson(401, "UNAUTHORIZED", "Unauthorized");
    }

    const { data: actor, error: actorError } = await sessionClient
      .from("profiles")
      .select("id, role, company_id, account_id, is_active")
      .eq("id", user.id)
      .single();

    if (actorError || !actor) {
      return errorJson(
        403,
        "PROFILE_NOT_FOUND",
        "Unable to load your profile.",
        actorError
      );
    }

    const actorProfile = actor as ActorProfile;
    if (!actorProfile.is_active) {
      return errorJson(403, "PROFILE_INACTIVE", "Your account is inactive.");
    }

    const actorAccountId = actorProfile.account_id ?? actorProfile.company_id;
    if (!actorAccountId) {
      return errorJson(
        400,
        "ACCOUNT_CONTEXT_MISSING",
        "Unable to determine account context for this user."
      );
    }

    const cookieStore = await cookies();
    const activeBusinessIdFromCookie = asActiveBusinessId(
      cookieStore.get("crewclock.activeBusinessId")?.value
    );

    debugLog("resolved auth context", {
      user_id: user.id,
      role: actorProfile.role,
      active_business_cookie: activeBusinessIdFromCookie || null,
    });

    const admin = createAdminClient();
    const { entry: timeEntry, attempts, readErrorCode } = await readTimeEntryWithRetry(
      admin,
      timeEntryId,
      3,
      100
    );

    if (!timeEntry) {
      return errorJson(
        404,
        "TIME_ENTRY_NOT_FOUND",
        "time_entry_id not found after retry.",
        {
          attempts,
          read_error_code: readErrorCode,
        }
      );
    }

    if (!timeEntry.business_id) {
      return errorJson(
        400,
        "TIME_ENTRY_MISSING_BUSINESS",
        "time_entry_id has no business_id."
      );
    }

    const effectiveBusinessId =
      timeEntry.business_id !== activeBusinessIdFromCookie && activeBusinessIdFromCookie
        ? timeEntry.business_id
        : activeBusinessIdFromCookie || timeEntry.business_id;

    if (!effectiveBusinessId) {
      return errorJson(
        400,
        "ACTIVE_BUSINESS_REQUIRED",
        "Select a business before sending time entry events."
      );
    }

    if (
      activeBusinessIdFromCookie &&
      timeEntry.business_id &&
      activeBusinessIdFromCookie !== timeEntry.business_id
    ) {
      debugLog("business mismatch detected; using time entry business", {
        active_business_cookie: activeBusinessIdFromCookie,
        time_entry_business_id: timeEntry.business_id,
      });
    }

    const { data: business, error: businessError } = await admin
      .from("businesses")
      .select("id, account_id")
      .eq("id", effectiveBusinessId)
      .single();

    if (businessError || !business) {
      return errorJson(
        404,
        "BUSINESS_NOT_FOUND",
        "Business not found for this event.",
        {
          business_id: effectiveBusinessId,
        }
      );
    }

    const businessRow = business as BusinessRow;
    if (businessRow.account_id !== actorAccountId) {
      return errorJson(
        403,
        "BUSINESS_ACCESS_DENIED",
        "You do not have access to the selected business.",
        {
          business_id: effectiveBusinessId,
        }
      );
    }

    const { data: membership, error: membershipError } = await sessionClient
      .from("business_memberships")
      .select("id")
      .eq("business_id", effectiveBusinessId)
      .eq("profile_id", actorProfile.id)
      .eq("is_active", true)
      .maybeSingle();

    if (membershipError) {
      return errorJson(
        400,
        "MEMBERSHIP_LOOKUP_FAILED",
        "Unable to verify business membership.",
        membershipError
      );
    }

    const membershipRow = membership as MembershipRow | null;
    if (!membershipRow && actorProfile.role !== "admin") {
      return errorJson(
        403,
        "MEMBERSHIP_REQUIRED",
        "Active membership required for the selected business."
      );
    }

    if (actorProfile.role === "worker" && timeEntry.employee_id !== actorProfile.id) {
      return errorJson(
        403,
        "WORKER_EVENT_FORBIDDEN",
        "Workers can only log their own time entry events."
      );
    }

    const projectId = projectIdOverride ?? timeEntry.project_id;

    let distanceMeters: number | null = null;
    let inside: boolean | null = null;
    if (lat !== null && lng !== null && projectId) {
      const { data: project, error: projectError } = await admin
        .from("projects")
        .select("id, business_id, lat, lng, geo_radius_m")
        .eq("id", projectId)
        .maybeSingle();

      if (!projectError && project) {
        const projectRow = project as ProjectRow;
        if (
          projectRow.business_id === effectiveBusinessId &&
          typeof projectRow.lat === "number" &&
          typeof projectRow.lng === "number"
        ) {
          distanceMeters = computeDistanceMeters(lat, lng, projectRow.lat, projectRow.lng);
          inside = computeInsideGeofence(distanceMeters, projectRow.geo_radius_m);
        }
      }
    }

    const { data: inserted, error: insertError } = await admin
      .from("time_entry_events")
      .insert({
        business_id: effectiveBusinessId,
        time_entry_id: timeEntry.id,
        employee_id: timeEntry.employee_id,
        event_type: eventType,
        occurred_at: occurredAtIso,
        lat,
        lng,
        distance_m: distanceMeters,
        inside,
        metadata,
      })
      .select("*")
      .single();

    if (insertError) {
      if (insertError.code === "42P01") {
        return errorJson(
          501,
          "TIME_ENTRY_EVENTS_TABLE_MISSING",
          "time_entry_events table is not available."
        );
      }

      return errorJson(
        400,
        "TIME_ENTRY_EVENT_INSERT_FAILED",
        "Unable to store time entry event.",
        {
          code: insertError.code ?? null,
          details: insertError.details ?? null,
          hint: insertError.hint ?? null,
          message: insertError.message,
        }
      );
    }

    debugLog("event inserted", {
      event_id: (inserted as TimeEntryEventRow).id,
      event_type: eventType,
      time_entry_id: timeEntry.id,
      business_id: effectiveBusinessId,
    });

    return jsonNoStore({ ok: true, event: inserted as TimeEntryEventRow }, 201);
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unexpected time entry event failure.";
    return errorJson(500, "UNEXPECTED_ERROR", message);
  }
}
