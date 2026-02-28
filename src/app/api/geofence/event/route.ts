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

type GeofenceEventType = "enter" | "exit";
type GeofenceSource = "mobile" | "web" | "system";

type RequestBody = {
  project_id?: string;
  event_type?: GeofenceEventType;
  occurred_at?: string;
  lat?: number;
  lng?: number;
  time_entry_id?: string;
  source?: GeofenceSource;
};

type ActorProfile = {
  id: string;
  role: "admin" | "manager" | "worker";
  company_id: string;
  account_id: string | null;
  is_active: boolean;
};

type ProjectRow = {
  id: string;
  business_id: string | null;
  lat: number | null;
  lng: number | null;
  geo_radius_m: number | null;
};

type BusinessRow = {
  id: string;
  account_id: string;
};

type TimeEntryRow = {
  id: string;
  business_id: string | null;
  employee_id: string;
};

type GeofenceEventRow = {
  id: string;
  business_id: string;
  project_id: string;
  employee_id: string;
  time_entry_id: string | null;
  event_type: GeofenceEventType;
  occurred_at: string;
  lat: number;
  lng: number;
  distance_m: number;
  inside: boolean;
  source: string;
  created_at: string;
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

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asActiveBusinessId(rawCookieValue: string | undefined): string {
  if (!rawCookieValue) return "";
  try {
    return decodeURIComponent(rawCookieValue).trim();
  } catch {
    return rawCookieValue.trim();
  }
}

function parseEventType(value: unknown): GeofenceEventType {
  if (value === "enter" || value === "exit") return value;
  throw new Error("event_type must be 'enter' or 'exit'.");
}

function parseSource(value: unknown): GeofenceSource {
  if (value === "mobile" || value === "web" || value === "system") return value;
  return "mobile";
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as RequestBody;
    const projectId = asTrimmedString(body.project_id);
    const timeEntryId = asTrimmedString(body.time_entry_id) || null;

    if (!projectId) {
      return jsonNoStore({ ok: false, error: "project_id is required." }, 400);
    }

    let eventType: GeofenceEventType;
    let lat: number;
    let lng: number;
    let occurredAtIso: string;
    let source: GeofenceSource;

    try {
      eventType = parseEventType(body.event_type);
      lat = ensureFiniteNumber(body.lat, "lat");
      lng = ensureFiniteNumber(body.lng, "lng");
      occurredAtIso = parseOccurredAt(body.occurred_at);
      source = parseSource(body.source);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Invalid request body.";
      return jsonNoStore({ ok: false, error: message }, 400);
    }

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

    const cookieStore = await cookies();
    const activeBusinessId = asActiveBusinessId(
      cookieStore.get("crewclock.activeBusinessId")?.value
    );

    if (!activeBusinessId) {
      return jsonNoStore(
        { ok: false, error: "Select a business before sending geofence events." },
        400
      );
    }

    const admin = createAdminClient();
    const actorAccountId = actorProfile.account_id ?? actorProfile.company_id;

    const { data: business, error: businessError } = await admin
      .from("businesses")
      .select("id, account_id")
      .eq("id", activeBusinessId)
      .single();

    if (businessError || !business) {
      return jsonNoStore({ ok: false, error: "Active business not found." }, 404);
    }

    const businessRow = business as BusinessRow;
    if (businessRow.account_id !== actorAccountId) {
      return jsonNoStore(
        { ok: false, error: "You do not have access to the selected business." },
        403
      );
    }

    const { data: membership, error: membershipError } = await sessionClient
      .from("business_memberships")
      .select("id")
      .eq("business_id", activeBusinessId)
      .eq("profile_id", actorProfile.id)
      .eq("is_active", true)
      .maybeSingle();

    if (membershipError) {
      return jsonNoStore(
        { ok: false, error: "Unable to verify business membership." },
        400
      );
    }

    if (!membership && actorProfile.role !== "admin") {
      return jsonNoStore(
        { ok: false, error: "Active membership required for the selected business." },
        403
      );
    }

    const { data: project, error: projectError } = await admin
      .from("projects")
      .select("id, business_id, lat, lng, geo_radius_m")
      .eq("id", projectId)
      .single();

    if (projectError || !project) {
      return jsonNoStore({ ok: false, error: "Project not found." }, 404);
    }

    const projectRow = project as ProjectRow;
    if (!projectRow.business_id || projectRow.business_id !== activeBusinessId) {
      return jsonNoStore(
        { ok: false, error: "project_id does not belong to the active business." },
        400
      );
    }

    if (
      typeof projectRow.lat !== "number" ||
      typeof projectRow.lng !== "number" ||
      !Number.isFinite(projectRow.lat) ||
      !Number.isFinite(projectRow.lng)
    ) {
      return jsonNoStore(
        { ok: false, error: "Project is missing geofence coordinates." },
        400
      );
    }

    if (timeEntryId) {
      const { data: entry, error: entryError } = await admin
        .from("time_entries")
        .select("id, business_id, employee_id")
        .eq("id", timeEntryId)
        .single();

      if (entryError || !entry) {
        return jsonNoStore({ ok: false, error: "time_entry_id not found." }, 404);
      }

      const timeEntry = entry as TimeEntryRow;
      if (timeEntry.business_id !== activeBusinessId || timeEntry.employee_id !== actorProfile.id) {
        return jsonNoStore(
          {
            ok: false,
            error:
              "time_entry_id must belong to your active business and your own profile.",
          },
          403
        );
      }
    }

    const distanceMeters = computeDistanceMeters(
      lat,
      lng,
      projectRow.lat,
      projectRow.lng
    );
    const inside = computeInsideGeofence(distanceMeters, projectRow.geo_radius_m);

    const { data: lastEvent } = await sessionClient
      .from("geofence_events")
      .select("id, event_type, occurred_at")
      .eq("employee_id", actorProfile.id)
      .eq("project_id", projectRow.id)
      .eq("business_id", activeBusinessId)
      .order("occurred_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastEvent) {
      const lastOccurredAtMs = Date.parse(lastEvent.occurred_at);
      const nextOccurredAtMs = Date.parse(occurredAtIso);
      if (
        Number.isFinite(lastOccurredAtMs) &&
        Number.isFinite(nextOccurredAtMs) &&
        lastEvent.event_type === eventType &&
        Math.abs(nextOccurredAtMs - lastOccurredAtMs) <= 30_000
      ) {
        return jsonNoStore(
          {
            ok: true,
            deduped: true,
            event: lastEvent,
          },
          200
        );
      }
    }

    const { data: inserted, error: insertError } = await sessionClient
      .from("geofence_events")
      .insert({
        business_id: activeBusinessId,
        project_id: projectRow.id,
        employee_id: actorProfile.id,
        time_entry_id: timeEntryId,
        event_type: eventType,
        occurred_at: occurredAtIso,
        lat,
        lng,
        distance_m: distanceMeters,
        inside,
        source,
      })
      .select("*")
      .single();

    if (insertError) {
      if (insertError.code === "42P01") {
        return jsonNoStore(
          { ok: false, error: "geofence_events table is not available." },
          501
        );
      }
      return jsonNoStore(
        {
          ok: false,
          error: "Unable to store geofence event.",
          code: insertError.code ?? null,
          details: insertError.details ?? null,
          hint: insertError.hint ?? null,
        },
        400
      );
    }

    return jsonNoStore({ ok: true, event: inserted as GeofenceEventRow }, 201);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unexpected geofence event failure.";
    return jsonNoStore({ ok: false, error: message }, 500);
  }
}
