"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  MapPin,
  Building2,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { useAppStore } from "@/lib/store";
import { clockIn, clockOut } from "@/lib/actions";
import {
  getCurrentPosition,
  haversineDistanceMeters,
  type GeoStatus,
  type LatLng,
} from "@/lib/geo";
import { formatDuration, formatTime, formatDate, formatHours } from "@/lib/utils";

type AutoSiteStatus =
  | "idle"
  | "locating"
  | "selected"
  | "multiple"
  | "none"
  | "unavailable";

type GeofenceEventType = "enter" | "exit";

function LiveDot() {
  return (
    <span className="inline-block w-2 h-2 rounded-full bg-green animate-pulse-dot" />
  );
}

function toFriendlyClockError(message: string): string {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("permission") ||
    normalized.includes("rls") ||
    normalized.includes("policy")
  ) {
    return "Unable to clock in/out for this account. Please contact your administrator.";
  }
  return message;
}

export default function ClockPanel() {
  const {
    profile,
    projects,
    activeEntry,
    setActiveEntry,
    timeEntries,
    addTimeEntry,
  } = useAppStore();

  const activeProjects = projects.filter((p) => p.status === "active");

  const [selectedProject, setSelectedProject] = useState("");
  const [geoStatus, setGeoStatus] = useState<GeoStatus>("idle");
  const [distance, setDistance] = useState<number | null>(null);
  const [coords, setCoords] = useState<LatLng | null>(null);
  const [locationDenied, setLocationDenied] = useState(false);
  const [autoSiteStatus, setAutoSiteStatus] = useState<AutoSiteStatus>("idle");
  const [autoSiteProjectName, setAutoSiteProjectName] = useState("");
  const [autoSiteDistance, setAutoSiteDistance] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const initialGeoRequestedRef = useRef(false);
  const geofenceLastInsideByShiftRef = useRef<Record<string, boolean | undefined>>({});
  const geofenceLastEmitAtByProjectRef = useRef<Record<string, number>>({});

  const refreshMyActiveEntry = useCallback(async () => {
    const { createClient } = await import("@/lib/supabase/client");
    const supabase = createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setActiveEntry(null);
      return null;
    }

    const { data: entry, error: entryError } = await supabase
      .from("time_entries")
      .select("*")
      .eq("employee_id", user.id)
      .is("clock_out", null)
      .order("clock_in", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (entryError) {
      setActiveEntry(null);
      return null;
    }

    setActiveEntry(entry ?? null);
    return entry ?? null;
  }, [setActiveEntry]);

  // Live timer
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    void refreshMyActiveEntry();
  }, [refreshMyActiveEntry]);

  const getEligibleProjects = useCallback(
    (point: LatLng) => {
      return activeProjects
        .map((project) => {
          const distanceMeters = Math.round(
            haversineDistanceMeters(point.lat, point.lng, project.lat, project.lng)
          );
          const radius = project.geo_radius_m || 300;
          return {
            project,
            distanceMeters,
            radius,
          };
        })
        .filter((candidate) => candidate.distanceMeters <= candidate.radius)
        .sort((a, b) => a.distanceMeters - b.distanceMeters);
    },
    [activeProjects]
  );

  const applyAutoSelection = useCallback(
    (point: LatLng) => {
      const eligible = getEligibleProjects(point);

      if (eligible.length === 0) {
        setSelectedProject("");
        setGeoStatus("idle");
        setDistance(null);
        setAutoSiteStatus("none");
        return;
      }

      const closest = eligible[0];
      setSelectedProject(closest.project.id);
      setGeoStatus("on_site");
      setDistance(closest.distanceMeters);
      setAutoSiteProjectName(closest.project.name);
      setAutoSiteDistance(closest.distanceMeters);
      setAutoSiteStatus(eligible.length === 1 ? "selected" : "multiple");
    },
    [getEligibleProjects]
  );

  const runAutoProjectDetection = useCallback(async () => {
    setAutoSiteStatus("locating");
    setAutoSiteProjectName("");
    setAutoSiteDistance(null);
    setGeoStatus("checking");
    setDistance(null);

    try {
      const pos = await getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 30000,
      });

      const nextCoords = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
      };
      setCoords(nextCoords);
      setLocationDenied(false);
      applyAutoSelection(nextCoords);
    } catch (err: unknown) {
      setCoords(null);
      setDistance(null);
      const geoErr = err as GeolocationPositionError;
      const denied = geoErr?.code === 1;
      setLocationDenied(denied);
      setGeoStatus(denied ? "denied" : "error");
      setAutoSiteStatus("unavailable");
    }
  }, [applyAutoSelection]);

  const emitGeofenceEventBestEffort = useCallback(
    async (args: {
      projectId: string;
      timeEntryId: string;
      eventType: GeofenceEventType;
      lat: number;
      lng: number;
    }) => {
      try {
        const response = await fetch("/api/geofence/event", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          cache: "no-store",
          body: JSON.stringify({
            project_id: args.projectId,
            event_type: args.eventType,
            occurred_at: new Date().toISOString(),
            lat: args.lat,
            lng: args.lng,
            time_entry_id: args.timeEntryId,
            source: "web",
          }),
        });

        if (!response.ok && process.env.NODE_ENV !== "production") {
          const payload = (await response.json().catch(() => ({}))) as {
            error?: string;
          };
          console.warn("[geofence-events] failed to log event", {
            status: response.status,
            event_type: args.eventType,
            error: payload.error ?? "unknown",
          });
        }
      } catch (eventError) {
        if (process.env.NODE_ENV !== "production") {
          console.warn("[geofence-events] request failed", eventError);
        }
      }
    },
    []
  );

  // One location request on initial mount.
  useEffect(() => {
    if (initialGeoRequestedRef.current) return;
    initialGeoRequestedRef.current = true;
    runAutoProjectDetection();
  }, [runAutoProjectDetection]);

  // If projects load after initial location lookup, auto-select using cached coords.
  useEffect(() => {
    if (!coords || selectedProject) return;
    if (autoSiteStatus !== "none") return;
    applyAutoSelection(coords);
  }, [coords, selectedProject, autoSiteStatus, applyAutoSelection]);

  // Recompute on-site status for the selected project from the latest known coords.
  useEffect(() => {
    if (!selectedProject) {
      setGeoStatus("idle");
      setDistance(null);
      return;
    }

    const project = activeProjects.find((p) => p.id === selectedProject);
    if (!project) {
      setGeoStatus("error");
      setDistance(null);
      return;
    }

    if (!coords) {
      setGeoStatus(locationDenied ? "denied" : "error");
      setDistance(null);
      return;
    }

    const distanceMeters = Math.round(
      haversineDistanceMeters(coords.lat, coords.lng, project.lat, project.lng)
    );

    setDistance(distanceMeters);
    setGeoStatus(
      distanceMeters <= (project.geo_radius_m || 300) ? "on_site" : "too_far"
    );
  }, [selectedProject, activeProjects, coords, locationDenied]);

  // Clock in
  const handleClockIn = async () => {
    if (!selectedProject || geoStatus !== "on_site" || !coords) return;
    setLoading(true);
    setError("");

    const result = await clockIn(selectedProject, coords.lat, coords.lng);

    if (result.error) {
      setError(toFriendlyClockError(result.error));
      setLoading(false);
      return;
    }

    const entry = await refreshMyActiveEntry();

    if (entry && !timeEntries.some((existing) => existing.id === entry.id)) {
      addTimeEntry(entry);
    }
    setSelectedProject("");
    setGeoStatus("idle");
    setLoading(false);
  };

  // Clock out
  const handleClockOut = async () => {
    setLoading(true);
    setError("");

    // Optionally capture clock-out location
    let outLat: number | undefined;
    let outLng: number | undefined;
    try {
      const pos = await new Promise<GeolocationPosition>((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej, { timeout: 5000 })
      );
      outLat = pos.coords.latitude;
      outLng = pos.coords.longitude;
    } catch {
      // Fine - clock-out location is optional
    }

    const result = await clockOut(outLat, outLng);

    if (result.error) {
      setError(toFriendlyClockError(result.error));
      setLoading(false);
      return;
    }

    await refreshMyActiveEntry();
    setLoading(false);
  };

  const activeProject = activeEntry
    ? projects.find((p) => p.id === activeEntry.project_id)
    : null;
  const elapsed = activeEntry
    ? now - new Date(activeEntry.clock_in).getTime()
    : 0;

  // Worker-only geofence state tracking while actively clocked in on one project.
  useEffect(() => {
    const isWorker = profile?.role === "worker";
    const isRunningShift = Boolean(activeEntry && !activeEntry.clock_out);
    const project = activeProject;

    if (!isWorker || !isRunningShift || !activeEntry || !project) {
      return;
    }

    const shiftKey = `${activeEntry.id}:${project.id}`;
    const pollEveryMs = 30_000;
    const minEmitIntervalMs = 30_000;

    let cancelled = false;

    const pollAndTrack = async () => {
      try {
        const pos = await getCurrentPosition({
          enableHighAccuracy: true,
          timeout: 10_000,
          maximumAge: 20_000,
        });

        if (cancelled) return;

        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const radius = project.geo_radius_m || 300;
        const distanceMeters = haversineDistanceMeters(lat, lng, project.lat, project.lng);
        const inside = distanceMeters <= radius;

        const previousInside = geofenceLastInsideByShiftRef.current[shiftKey];
        if (previousInside === undefined) {
          geofenceLastInsideByShiftRef.current[shiftKey] = inside;
          return;
        }

        if (previousInside === inside) {
          geofenceLastInsideByShiftRef.current[shiftKey] = inside;
          return;
        }

        const nowMs = Date.now();
        const lastEmitAt = geofenceLastEmitAtByProjectRef.current[project.id] ?? 0;
        if (nowMs - lastEmitAt < minEmitIntervalMs) {
          return;
        }

        geofenceLastEmitAtByProjectRef.current[project.id] = nowMs;
        geofenceLastInsideByShiftRef.current[shiftKey] = inside;
        void emitGeofenceEventBestEffort({
          projectId: project.id,
          timeEntryId: activeEntry.id,
          eventType: inside ? "enter" : "exit",
          lat,
          lng,
        });
      } catch {
        // Location errors are expected on some devices/browsers; skip this poll tick.
      }
    };

    void pollAndTrack();
    const intervalId = window.setInterval(() => {
      void pollAndTrack();
    }, pollEveryMs);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [activeEntry, activeProject, emitGeofenceEventBestEffort, profile?.role]);

  // CLOCKED IN VIEW
  if (activeEntry && activeProject) {
    return (
      <div className="p-5">
        <div className="text-center mb-5">
          <p className="text-[11px] font-bold text-text-muted uppercase tracking-widest mb-1">
            Currently Clocked In
          </p>
          <div className="inline-flex items-center gap-1.5">
            <LiveDot />
            <span className="text-[13px] font-bold text-green">ACTIVE</span>
          </div>
        </div>

        {/* Timer */}
        <div className="bg-gradient-to-br from-[var(--color-hero-from)] to-card rounded-2xl border border-[var(--color-hero-border)] p-8 text-center mb-4">
          <div className="text-[52px] font-extrabold font-mono text-accent leading-none tracking-tight shadow-[0_0_50px_var(--color-accent-glow)]">
            {formatDuration(elapsed)}
          </div>
          <p className="text-xs text-text-muted mt-2">
            Started at {formatTime(activeEntry.clock_in)}
          </p>
        </div>

        {/* Project Info */}
        <div className="bg-card rounded-2xl border border-border p-5 mb-4">
          <div className="flex items-start gap-3">
            <div className="p-2.5 bg-bg rounded-xl shrink-0">
              <Building2 size={20} className="text-accent" />
            </div>
            <div>
              <p className="text-base font-bold mb-1">{activeProject.name}</p>
              <p className="text-[13px] text-text-muted flex items-center gap-1">
                <MapPin size={13} /> {activeProject.address}
              </p>
            </div>
          </div>
        </div>

        {/* Clock Out Button */}
        <button
          onClick={handleClockOut}
          disabled={loading}
          className="w-full p-4 bg-gradient-to-br from-red to-[#d63333] rounded-xl text-white text-base font-extrabold shadow-[0_4px_20px_rgba(232,69,69,0.2)] hover:-translate-y-0.5 transition-all disabled:opacity-50"
        >
          {loading ? "Clocking out..." : "Clock Out"}
        </button>

        {error && (
          <p className="text-red text-sm font-semibold mt-3 text-center">
            {error}
          </p>
        )}
      </div>
    );
  }

  // CLOCK IN VIEW
  const canClockIn = selectedProject && geoStatus === "on_site";
  const selProject = activeProjects.find((p) => p.id === selectedProject);
  const recentEntries = timeEntries.filter(
    (e) => e.employee_id === profile?.id && e.clock_out
  );

  return (
    <div className="p-5">
      <div className="text-center mb-6">
        <p className="text-lg font-bold mb-1">
          Ready to work{profile ? `, ${profile.first_name}` : ""}?
        </p>
        <p className="text-[13px] text-text-muted">Select a project to get started</p>
      </div>

      {/* Project Selector */}
      <div className="bg-card rounded-2xl border border-border p-5 mb-4">
        <label className="block text-[11px] font-bold text-text-muted uppercase tracking-widest mb-1.5">
          Select Project
        </label>
        <select
          className={`w-full p-3 bg-bg border-2 rounded-xl text-text text-sm font-sans cursor-pointer appearance-none pr-10 outline-none transition-colors ${
            selectedProject ? "border-accent" : "border-border"
          }`}
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%23808590' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10z'/%3E%3C/svg%3E")`,
            backgroundRepeat: "no-repeat",
            backgroundPosition: "right 14px center",
          }}
          value={selectedProject}
          onChange={(e) => {
            setSelectedProject(e.target.value);
            if (autoSiteStatus === "selected" || autoSiteStatus === "multiple") {
              setAutoSiteStatus("idle");
            }
          }}
        >
          <option value="">Choose a project...</option>
          {activeProjects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        <div className="mt-2">
          {autoSiteStatus === "locating" && (
            <p className="text-[12px] text-text-dim">Detecting your location...</p>
          )}

          {autoSiteStatus === "selected" && autoSiteDistance !== null && (
            <div className="flex items-center justify-between gap-2">
              <p className="text-[12px] text-green font-semibold">
                Auto-selected: {autoSiteProjectName} ({autoSiteDistance}m away)
              </p>
              <button
                type="button"
                onClick={runAutoProjectDetection}
                className="text-[12px] text-accent font-semibold hover:underline"
              >
                Re-check
              </button>
            </div>
          )}

          {autoSiteStatus === "multiple" && autoSiteDistance !== null && (
            <div className="flex items-center justify-between gap-2">
              <p className="text-[12px] text-accent font-semibold">
                Closest selected: {autoSiteProjectName} ({autoSiteDistance}m). Multiple sites nearby. Change if needed.
              </p>
              <button
                type="button"
                onClick={runAutoProjectDetection}
                className="text-[12px] text-accent font-semibold hover:underline"
              >
                Re-check
              </button>
            </div>
          )}

          {autoSiteStatus === "none" && (
            <p className="text-[12px] text-text-dim">
              Not within range of any job site. Select manually.
            </p>
          )}

          {autoSiteStatus === "unavailable" && (
            <div className="flex items-center justify-between gap-2">
              <p className="text-[12px] text-text-dim">
                Location unavailable - select a project manually.
              </p>
              <button
                type="button"
                onClick={runAutoProjectDetection}
                className="text-[12px] text-accent font-semibold hover:underline"
              >
                Try again
              </button>
            </div>
          )}
        </div>

        {/* Project details + geo status */}
        {selProject && (
          <div className="mt-3 p-3 bg-bg rounded-lg space-y-2">
            <div className="flex items-center gap-1.5 text-[13px] text-text-muted">
              <MapPin size={13} /> {selProject.address}
            </div>

            {geoStatus === "checking" && (
              <div className="flex items-center gap-2 p-2.5 bg-accent/5 rounded-lg border border-accent/15">
                <Loader2 size={16} className="text-accent animate-spin-slow" />
                <span className="text-[13px] text-accent font-semibold">
                  Verifying your location...
                </span>
              </div>
            )}
            {geoStatus === "on_site" && (
              <div className="flex items-center gap-2 p-2.5 bg-green/5 rounded-lg border border-green-border">
                <CheckCircle2 size={16} className="text-green" />
                <span className="text-[13px] text-green font-semibold">
                  You&apos;re on site ({distance}m away)
                </span>
              </div>
            )}
            {geoStatus === "too_far" && (
              <div className="flex items-center gap-2 p-2.5 bg-red/5 rounded-lg border border-red-border">
                <AlertCircle size={16} className="text-red" />
                <div>
                  <p className="text-[13px] text-red font-semibold">
                    Too far from job site ({distance}m away)
                  </p>
                  <p className="text-[11px] text-text-muted mt-0.5">
                    Must be within {selProject.geo_radius_m || 300}m to clock in
                  </p>
                </div>
              </div>
            )}
            {geoStatus === "denied" && (
              <div className="flex items-center gap-2 p-2.5 bg-red/5 rounded-lg border border-red-border">
                <AlertCircle size={16} className="text-red" />
                <div>
                  <p className="text-[13px] text-red font-semibold">
                    Location access denied
                  </p>
                  <p className="text-[11px] text-text-muted mt-0.5">
                    Enable location permissions in your browser settings
                  </p>
                </div>
              </div>
            )}
            {geoStatus === "error" && (
              <div className="flex items-center gap-2 p-2.5 bg-red/5 rounded-lg border border-red-border">
                <AlertCircle size={16} className="text-red" />
                <span className="text-[13px] text-red font-semibold">
                  Could not determine location
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Clock In Button */}
      <button
        onClick={handleClockIn}
        disabled={!canClockIn || loading}
        className="w-full p-4 bg-gradient-to-br from-accent to-accent-dark rounded-xl text-bg text-base font-extrabold shadow-[0_4px_20px_var(--color-accent-glow)] hover:-translate-y-0.5 transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none disabled:translate-y-0"
      >
        {loading
          ? "Clocking in..."
          : geoStatus === "checking"
            ? "Verifying Location..."
            : geoStatus === "too_far"
              ? "Too Far From Job Site"
              : geoStatus === "denied"
                ? "Location Required"
                : "Clock In"}
      </button>

      {error && <p className="text-red text-sm font-semibold mt-3 text-center">{error}</p>}

      {/* Recent Activity */}
      {recentEntries.length > 0 && (
        <div className="bg-card rounded-2xl border border-border p-5 mt-5">
          <p className="text-[11px] font-bold text-text-muted uppercase tracking-widest mb-3">
            Recent Activity
          </p>
          {recentEntries.slice(0, 5).map((entry) => {
            const proj = projects.find((p) => p.id === entry.project_id);
            const dur = entry.duration_seconds || 0;
            return (
              <div
                key={entry.id}
                className="flex justify-between items-center py-2.5 border-b border-border last:border-0"
              >
                <div>
                  <p className="text-sm font-semibold">{proj?.name || "Unknown"}</p>
                  <p className="text-xs text-text-muted">
                    {formatDate(entry.clock_in)}
                  </p>
                </div>
                <span className="text-sm font-bold text-accent">
                  {formatHours(dur)}h
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
