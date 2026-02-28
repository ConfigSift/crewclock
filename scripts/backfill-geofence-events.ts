/* eslint-disable no-console */
type CliConfig = {
  businessId: string;
  days: number;
  maxEventsPerEntry: number;
  dryRun: boolean;
  overwrite: boolean;
};

type TimeEntryRow = {
  id: string;
  business_id: string;
  project_id: string;
  employee_id: string;
  clock_in: string;
  clock_out: string | null;
};

type ProjectRow = {
  id: string;
  business_id: string;
  lat: number | null;
  lng: number | null;
  geo_radius_m: number | null;
};

type GeofenceEventRow = {
  time_entry_id: string | null;
};

type InsertGeofenceEvent = {
  business_id: string;
  project_id: string;
  employee_id: string;
  time_entry_id: string;
  event_type: "enter" | "exit";
  occurred_at: string;
  lat: number;
  lng: number;
  distance_m: number;
  inside: boolean;
  source: "system";
};

const DEFAULT_DAYS = 60;
const DEFAULT_MAX_EVENTS = 3;
const DEFAULT_DRY_RUN = true;
const DEFAULT_OVERWRITE = false;
const INSERT_BATCH_SIZE = 200;
const READ_PAGE_SIZE = 1000;

function usage(): string {
  return [
    "Usage:",
    "  pnpm exec tsx scripts/backfill-geofence-events.ts --business-id <uuid> [options]",
    "",
    "Options:",
    `  --days <number>                 Default ${DEFAULT_DAYS}`,
    `  --max-events-per-entry <n>      Default ${DEFAULT_MAX_EVENTS} (0-3)`,
    `  --dry-run [true|false]          Default ${DEFAULT_DRY_RUN}`,
    `  --overwrite [true|false]        Default ${DEFAULT_OVERWRITE}`,
    "",
    "Environment:",
    "  SUPABASE_URL",
    "  SUPABASE_SERVICE_ROLE_KEY",
  ].join("\n");
}

function parseBooleanValue(
  value: string | undefined,
  defaultValue: boolean,
  implicitValueWhenMissing = true
): boolean {
  if (value === undefined) return implicitValueWhenMissing;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return defaultValue;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function parseArgs(argv: string[]): CliConfig {
  const values = new Map<string, string | undefined>();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;

    const [rawKey, inlineValue] = token.split("=", 2);
    const key = rawKey.trim();
    if (inlineValue !== undefined) {
      values.set(key, inlineValue);
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      values.set(key, next);
      index += 1;
    } else {
      values.set(key, undefined);
    }
  }

  const businessId = values.get("--business-id")?.trim() ?? "";
  const days = parsePositiveInt(values.get("--days"), DEFAULT_DAYS);
  const maxEventsRaw = parsePositiveInt(
    values.get("--max-events-per-entry"),
    DEFAULT_MAX_EVENTS
  );
  const maxEventsPerEntry = Math.max(0, Math.min(3, maxEventsRaw));
  const dryRun = values.has("--dry-run")
    ? parseBooleanValue(values.get("--dry-run"), DEFAULT_DRY_RUN)
    : DEFAULT_DRY_RUN;
  const overwrite = values.has("--overwrite")
    ? parseBooleanValue(values.get("--overwrite"), DEFAULT_OVERWRITE)
    : DEFAULT_OVERWRITE;

  return {
    businessId,
    days,
    maxEventsPerEntry,
    dryRun,
    overwrite,
  };
}

function ensureEnv(name: "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function buildRestUrl(
  supabaseUrl: string,
  table: string,
  params: Record<string, string>
): string {
  const url = new URL(`/rest/v1/${table}`, supabaseUrl);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  return url.toString();
}

async function fetchPaged<T>(
  supabaseUrl: string,
  serviceRoleKey: string,
  table: string,
  params: Record<string, string>
): Promise<T[]> {
  const rows: T[] = [];
  let offset = 0;

  while (true) {
    const response = await fetch(buildRestUrl(supabaseUrl, table, params), {
      method: "GET",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Accept: "application/json",
        Range: `${offset}-${offset + READ_PAGE_SIZE - 1}`,
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Failed to fetch ${table}: HTTP ${response.status} ${response.statusText} ${body}`
      );
    }

    const page = (await response.json().catch(() => [])) as T[];
    rows.push(...page);

    if (page.length < READ_PAGE_SIZE) {
      break;
    }
    offset += READ_PAGE_SIZE;
  }

  return rows;
}

async function insertBatch(
  supabaseUrl: string,
  serviceRoleKey: string,
  table: string,
  rows: InsertGeofenceEvent[]
): Promise<void> {
  if (rows.length === 0) return;
  const response = await fetch(buildRestUrl(supabaseUrl, table, {}), {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(rows),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Failed to insert into ${table}: HTTP ${response.status} ${response.statusText} ${body}`
    );
  }
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function metersToLatLng(
  lat: number,
  lng: number,
  meters: number,
  bearingRad: number
): { lat: number; lng: number } {
  const metersPerDegLat = 111_320;
  const metersPerDegLng = metersPerDegLat * Math.cos((lat * Math.PI) / 180);
  const deltaNorth = meters * Math.cos(bearingRad);
  const deltaEast = meters * Math.sin(bearingRad);
  const latOffset = deltaNorth / metersPerDegLat;
  const lngOffset = metersPerDegLng === 0 ? 0 : deltaEast / metersPerDegLng;
  return {
    lat: lat + latOffset,
    lng: lng + lngOffset,
  };
}

function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const earthRadiusMeters = 6_371_000;
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

function generateEventPosition(
  project: ProjectRow,
  eventType: "enter" | "exit"
): { lat: number; lng: number; distance_m: number; inside: boolean } | null {
  if (
    typeof project.lat !== "number" ||
    typeof project.lng !== "number" ||
    !Number.isFinite(project.lat) ||
    !Number.isFinite(project.lng)
  ) {
    return null;
  }

  const radius = Number.isFinite(project.geo_radius_m ?? NaN) && (project.geo_radius_m ?? 0) > 0
    ? (project.geo_radius_m as number)
    : 300;

  const enterJitter = randomBetween(3, 25);
  const exitTarget = clamp(radius + randomBetween(8, 22), 18, 50);
  const jitterMeters = eventType === "enter" ? enterJitter : exitTarget;
  const bearing = randomBetween(0, Math.PI * 2);
  const point = metersToLatLng(project.lat, project.lng, jitterMeters, bearing);
  const distance = haversineMeters(project.lat, project.lng, point.lat, point.lng);

  return {
    lat: point.lat,
    lng: point.lng,
    distance_m: Math.round(distance),
    inside: distance <= radius,
  };
}

function generateEventsForEntry(
  entry: TimeEntryRow,
  project: ProjectRow,
  maxEventsPerEntry: number
): InsertGeofenceEvent[] {
  if (maxEventsPerEntry <= 0) return [];

  const startMs = Date.parse(entry.clock_in);
  if (!Number.isFinite(startMs)) return [];

  const parsedEndMs = entry.clock_out ? Date.parse(entry.clock_out) : Number.NaN;
  const hasClockOut = Number.isFinite(parsedEndMs);
  const endMs = hasClockOut ? parsedEndMs : startMs + 2 * 60 * 60 * 1000;
  const boundedEndMs = Math.max(endMs, startMs + 60 * 1000);
  const durationMs = boundedEndMs - startMs;

  const events: Array<{ event_type: "enter" | "exit"; occurred_ms: number }> = [];

  const enterMs = clamp(
    startMs + randomBetween(-5, 10) * 60_000,
    startMs,
    boundedEndMs
  );
  events.push({ event_type: "enter", occurred_ms: enterMs });

  if (hasClockOut && maxEventsPerEntry > 1 && durationMs > 30 * 60 * 1000) {
    const exitLower = startMs + durationMs * 0.2;
    const exitUpper = startMs + durationMs * 0.7;
    const exitMs = clamp(
      randomBetween(exitLower, exitUpper),
      enterMs + 5 * 60_000,
      boundedEndMs - 10 * 60_000
    );

    if (exitMs > enterMs) {
      events.push({ event_type: "exit", occurred_ms: exitMs });

      if (maxEventsPerEntry > 2) {
        const reEnterMs = clamp(
          randomBetween(exitMs + 5 * 60_000, boundedEndMs - 1 * 60_000),
          exitMs + 60_000,
          boundedEndMs
        );
        if (reEnterMs > exitMs && reEnterMs <= boundedEndMs) {
          events.push({ event_type: "enter", occurred_ms: reEnterMs });
        }
      }
    }
  }

  return events
    .slice(0, maxEventsPerEntry)
    .map((event) => {
      const position = generateEventPosition(project, event.event_type);
      if (!position) return null;

      return {
        business_id: entry.business_id,
        project_id: entry.project_id,
        employee_id: entry.employee_id,
        time_entry_id: entry.id,
        event_type: event.event_type,
        occurred_at: toIso(event.occurred_ms),
        lat: position.lat,
        lng: position.lng,
        distance_m: position.distance_m,
        inside: position.inside,
        source: "system",
      } satisfies InsertGeofenceEvent;
    })
    .filter((row): row is InsertGeofenceEvent => row !== null);
}

async function fetchExistingEventEntryIds(
  supabaseUrl: string,
  serviceRoleKey: string,
  businessId: string,
  timeEntryIds: string[]
): Promise<Set<string>> {
  const existing = new Set<string>();
  const chunks = chunkArray(timeEntryIds, 200);

  for (const chunk of chunks) {
    const idFilter = chunk.join(",");
    const rows = await fetchPaged<GeofenceEventRow>(
      supabaseUrl,
      serviceRoleKey,
      "geofence_events",
      {
        select: "time_entry_id",
        business_id: `eq.${businessId}`,
        time_entry_id: `in.(${idFilter})`,
      }
    );

    rows.forEach((row) => {
      if (row.time_entry_id) {
        existing.add(row.time_entry_id);
      }
    });
  }

  return existing;
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));

  if (!config.businessId) {
    console.error("Missing required argument: --business-id");
    console.error(usage());
    process.exitCode = 1;
    return;
  }

  const supabaseUrl = ensureEnv("SUPABASE_URL");
  const serviceRoleKey = ensureEnv("SUPABASE_SERVICE_ROLE_KEY");
  const sinceIso = new Date(Date.now() - config.days * 24 * 60 * 60 * 1000).toISOString();

  console.log("[backfill] starting", {
    business_id: config.businessId,
    days: config.days,
    max_events_per_entry: config.maxEventsPerEntry,
    dry_run: config.dryRun,
    overwrite: config.overwrite,
    since: sinceIso,
  });

  const timeEntries = await fetchPaged<TimeEntryRow>(
    supabaseUrl,
    serviceRoleKey,
    "time_entries",
    {
      select: "id,business_id,project_id,employee_id,clock_in,clock_out",
      business_id: `eq.${config.businessId}`,
      clock_in: `gte.${sinceIso}`,
      order: "clock_in.asc",
    }
  );

  const projects = await fetchPaged<ProjectRow>(
    supabaseUrl,
    serviceRoleKey,
    "projects",
    {
      select: "id,business_id,lat,lng,geo_radius_m",
      business_id: `eq.${config.businessId}`,
    }
  );
  const projectById = new Map(projects.map((project) => [project.id, project]));

  const existingEntryIds =
    config.overwrite || timeEntries.length === 0
      ? new Set<string>()
      : await fetchExistingEventEntryIds(
          supabaseUrl,
          serviceRoleKey,
          config.businessId,
          timeEntries.map((entry) => entry.id)
        );

  const eventsToInsert: InsertGeofenceEvent[] = [];
  let skippedAlreadyHadEvents = 0;
  let skippedMissingProjectData = 0;

  for (const entry of timeEntries) {
    if (!config.overwrite && existingEntryIds.has(entry.id)) {
      skippedAlreadyHadEvents += 1;
      continue;
    }

    const project = projectById.get(entry.project_id);
    if (!project) {
      skippedMissingProjectData += 1;
      continue;
    }

    if (
      typeof project.lat !== "number" ||
      typeof project.lng !== "number" ||
      !Number.isFinite(project.lat) ||
      !Number.isFinite(project.lng)
    ) {
      skippedMissingProjectData += 1;
      continue;
    }

    const generated = generateEventsForEntry(entry, project, config.maxEventsPerEntry);
    eventsToInsert.push(...generated);
  }

  let insertedCount = 0;
  if (!config.dryRun && eventsToInsert.length > 0) {
    const batches = chunkArray(eventsToInsert, INSERT_BATCH_SIZE);
    for (const batch of batches) {
      await insertBatch(supabaseUrl, serviceRoleKey, "geofence_events", batch);
      insertedCount += batch.length;
      console.log(`[backfill] inserted batch of ${batch.length} events`);
    }
  }

  console.log("[backfill] complete", {
    entries_scanned: timeEntries.length,
    skipped_already_had_events: skippedAlreadyHadEvents,
    skipped_missing_project_data: skippedMissingProjectData,
    events_generated: eventsToInsert.length,
    events_inserted: config.dryRun ? 0 : insertedCount,
    dry_run: config.dryRun,
  });
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[backfill] failed", { message });
  process.exitCode = 1;
});
