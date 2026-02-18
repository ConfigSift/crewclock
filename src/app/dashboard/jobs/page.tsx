"use client";

import { useState, useEffect, useRef } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  Archive,
  MapPin,
  Crosshair,
  X,
  Loader2,
  Building2,
  User,
} from "lucide-react";
import { useAppStore } from "@/lib/store";
import {
  createProject,
  updateProject as updateProjectAction,
  deleteProject as deleteProjectAction,
} from "@/lib/actions";
import {
  formatHours,
  formatTime,
  calcTotalSeconds,
  isInPeriod,
  type Period,
} from "@/lib/utils";
import { loadGooglePlaces } from "@/lib/google-places";
import type { Project } from "@/types/database";

// ─── Modal Wrapper ───────────────────────────────────
function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center p-5"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative bg-card rounded-2xl border border-border w-full max-w-[520px] max-h-[90vh] overflow-auto animate-scale-in"
      >
        <div className="flex justify-between items-center px-6 py-4 border-b border-border">
          <h3 className="text-[17px] font-bold">{title}</h3>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text p-1"
          >
            <X size={20} />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

// ─── Job Form ────────────────────────────────────────
function JobForm({
  job,
  onSave,
  onClose,
}: {
  job?: Project;
  onSave: () => void;
  onClose: () => void;
}) {
  const profile = useAppStore((s) => s.profile);
  const { addProject, updateProject: storeUpdate } = useAppStore();

  const [form, setForm] = useState({
    name: "",
    address: "",
    lat: "",
    lng: "",
    geo_radius_m: "300",
  });
  const [geoLoading, setGeoLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const addressRef = useRef<HTMLInputElement | null>(null);
  const [placesReady, setPlacesReady] = useState(false);
  const [placesError, setPlacesError] = useState<string | null>(null);

  useEffect(() => {
    if (job) {
      setForm({
        name: job.name,
        address: job.address,
        lat: String(job.lat),
        lng: String(job.lng),
        geo_radius_m: String(job.geo_radius_m || 300),
      });
    }
  }, [job]);

  useEffect(() => {
    let mounted = true;
    let placeListener: { remove: () => void } | null = null;

    const initPlacesAutocomplete = async () => {
      try {
        await loadGooglePlaces();
        if (!mounted || !addressRef.current) return;

        const googleMaps = (window as Window & { google?: any }).google;
        if (!googleMaps?.maps?.places?.Autocomplete) {
          setPlacesReady(false);
          setPlacesError("Address suggestions unavailable  enter address manually.");
          return;
        }

        const autocomplete = new googleMaps.maps.places.Autocomplete(
          addressRef.current,
          {
            fields: ["formatted_address", "geometry"],
            types: ["address"],
          }
        );

        placeListener = autocomplete.addListener("place_changed", () => {
          const place = autocomplete.getPlace();
          if (place.geometry?.location) {
            const lat = place.geometry.location.lat();
            const lng = place.geometry.location.lng();
            setForm((f) => ({
              ...f,
              address: place.formatted_address ?? f.address,
              lat: lat.toFixed(6),
              lng: lng.toFixed(6),
            }));
            setPlacesError(null);
            return;
          }

          setPlacesError("Selected address has no coordinates");
        });

        setPlacesReady(true);
        setPlacesError(null);
      } catch {
        if (!mounted) return;
        setPlacesReady(false);
        setPlacesError("Address suggestions unavailable  enter address manually.");
      }
    };

    initPlacesAutocomplete();

    return () => {
      mounted = false;
      placeListener?.remove();
    };
  }, []);

  const handleUseLocation = () => {
    if (!navigator.geolocation) {
      setErr("Geolocation not supported");
      return;
    }
    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setForm((f) => ({
          ...f,
          lat: pos.coords.latitude.toFixed(6),
          lng: pos.coords.longitude.toFixed(6),
        }));
        setGeoLoading(false);
      },
      () => {
        setErr("Could not get location");
        setGeoLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      setErr("Job name is required");
      return;
    }
    if (!form.address.trim()) {
      setErr("Address is required");
      return;
    }
    if (
      !form.lat ||
      !form.lng ||
      isNaN(Number(form.lat)) ||
      isNaN(Number(form.lng))
    ) {
      setErr("Valid GPS coordinates are required");
      return;
    }

    setSaving(true);
    setErr("");

    if (job) {
      const result = await updateProjectAction(job.id, {
        name: form.name.trim(),
        address: form.address.trim(),
        lat: Number(form.lat),
        lng: Number(form.lng),
        geo_radius_m: Number(form.geo_radius_m) || 300,
      });
      if (result.error) {
        setErr(result.error);
        setSaving(false);
        return;
      }
      if (result.project) storeUpdate(job.id, result.project);
    } else {
      const result = await createProject({
        company_id: profile!.company_id,
        name: form.name.trim(),
        address: form.address.trim(),
        lat: Number(form.lat),
        lng: Number(form.lng),
        geo_radius_m: Number(form.geo_radius_m) || 300,
        status: "active",
      });
      if (result.error) {
        setErr(result.error);
        setSaving(false);
        return;
      }
      if (result.project) addProject(result.project);
    }

    setSaving(false);
    onSave();
    onClose();
  };

  return (
    <>
      <label className="block text-[11px] font-bold text-text-muted uppercase tracking-widest mb-1.5">
        Job / Project Name *
      </label>
      <input
        className="w-full p-3 bg-bg border border-border rounded-lg text-text text-sm mb-4 outline-none focus:border-accent"
        placeholder="e.g. Highland Towers Phase 2"
        value={form.name}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
      />

      <label className="block text-[11px] font-bold text-text-muted uppercase tracking-widest mb-1.5">
        Job Site Address *
      </label>
      <input
        ref={addressRef}
        className="w-full p-3 bg-bg border border-border rounded-lg text-text text-sm mb-4 outline-none focus:border-accent"
        placeholder="1420 Highland Ave, Denver CO"
        value={form.address}
        onChange={(e) => setForm({ ...form, address: e.target.value })}
      />
      {placesError && (
        <p
          className={`text-[11px] mb-4 ${placesReady ? "text-red" : "text-text-dim"}`}
        >
          {placesError}
        </p>
      )}

      <div className="flex justify-between items-center mb-2">
        <label className="text-[11px] font-bold text-text-muted uppercase tracking-widest">
          GPS Coordinates *
        </label>
        <button
          onClick={handleUseLocation}
          disabled={geoLoading}
          className="flex items-center gap-1.5 text-accent text-xs font-semibold hover:underline disabled:opacity-50"
        >
          {geoLoading ? (
            <>
              <Loader2 size={12} className="animate-spin" /> Getting...
            </>
          ) : (
            <>
              <Crosshair size={14} /> Use my current location
            </>
          )}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2.5 mb-2">
        <input
          className="w-full p-3 bg-bg border border-border rounded-lg text-text text-sm outline-none focus:border-accent"
          placeholder="Latitude (e.g. 39.7392)"
          value={form.lat}
          onChange={(e) => setForm({ ...form, lat: e.target.value })}
        />
        <input
          className="w-full p-3 bg-bg border border-border rounded-lg text-text text-sm outline-none focus:border-accent"
          placeholder="Longitude (e.g. -104.9903)"
          value={form.lng}
          onChange={(e) => setForm({ ...form, lng: e.target.value })}
        />
      </div>

      <label className="block text-[11px] font-bold text-text-muted uppercase tracking-widest mt-4 mb-1.5">
        Geofence Radius (meters)
      </label>
      <input
        type="number"
        className="w-full p-3 bg-bg border border-border rounded-lg text-text text-sm mb-1 outline-none focus:border-accent"
        placeholder="300"
        value={form.geo_radius_m}
        onChange={(e) => setForm({ ...form, geo_radius_m: e.target.value })}
      />
      <p className="text-[11px] text-text-dim mb-5 leading-relaxed">
        Workers must be within this distance to clock in. Stand at the job site
        and use &quot;Use my current location&quot; for accuracy.
      </p>

      {err && <p className="text-red text-sm font-semibold mb-3">{err}</p>}

      <div className="flex gap-2.5">
        <button
          onClick={onClose}
          className="flex-1 py-3 border border-border rounded-xl text-text-muted text-sm font-semibold hover:bg-card transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex-[2] py-3 bg-gradient-to-br from-accent to-accent-dark rounded-xl text-bg text-sm font-extrabold shadow-[0_4px_20px_var(--color-accent-glow)] hover:-translate-y-0.5 transition-all disabled:opacity-50"
        >
          {saving ? "Saving..." : job ? "Save Changes" : "Create Job"}
        </button>
      </div>
    </>
  );
}

// ─── Confirm Delete Dialog ───────────────────────────
function ConfirmDelete({
  job,
  onConfirm,
  onClose,
}: {
  job: Project;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);

  const handleDelete = async () => {
    setLoading(true);
    await onConfirm();
    setLoading(false);
  };

  return (
    <>
      <p className="text-sm text-text-muted leading-relaxed mb-6">
        Are you sure you want to permanently delete &quot;{job.name}&quot;? This
        will not remove existing time entries but workers will no longer be able
        to clock in to this job.
      </p>
      <div className="flex gap-2.5 justify-end">
        <button
          onClick={onClose}
          className="px-4 py-2.5 border border-border rounded-lg text-text-muted text-sm font-semibold hover:bg-card"
        >
          Cancel
        </button>
        <button
          onClick={handleDelete}
          disabled={loading}
          className="px-4 py-2.5 bg-red/10 border border-red-border rounded-lg text-red text-sm font-semibold hover:bg-red/20 disabled:opacity-50"
        >
          {loading ? "Deleting..." : "Delete"}
        </button>
      </div>
    </>
  );
}

// ─── Live Dot ────────────────────────────────────────
function LiveDot() {
  return (
    <span className="inline-block w-2 h-2 rounded-full bg-green animate-pulse-dot" />
  );
}

// ─── MAIN PAGE ───────────────────────────────────────
export default function JobsPage() {
  const { projects, timeEntries, employees, removeProject, updateProject } =
    useAppStore();

  const [showForm, setShowForm] = useState(false);
  const [editJob, setEditJob] = useState<Project | undefined>();
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [period, setPeriod] = useState<Period>("week");
  const [viewMode, setViewMode] = useState<"active" | "archived">("active");

  const displayed = projects.filter((p) =>
    viewMode === "active" ? p.status === "active" : p.status === "archived"
  );

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const result = await deleteProjectAction(deleteTarget.id);
    if (!result.error) {
      removeProject(deleteTarget.id);
    }
    setDeleteTarget(null);
  };

  const handleArchive = async (job: Project) => {
    const newStatus = job.status === "active" ? "archived" : "active";
    const result = await updateProjectAction(job.id, { status: newStatus });
    if (result.project) {
      updateProject(job.id, { status: newStatus });
    }
  };

  const tabs: { key: Period; label: string }[] = [
    { key: "week", label: "Week" },
    { key: "month", label: "Month" },
    { key: "year", label: "Year" },
  ];

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="flex flex-wrap justify-between items-center gap-3 mb-5">
        <h1 className="text-[22px] font-extrabold tracking-tight">
          Job Management
        </h1>
        <button
          onClick={() => {
            setEditJob(undefined);
            setShowForm(true);
          }}
          className="flex items-center gap-1.5 px-5 py-2.5 bg-gradient-to-br from-accent to-accent-dark rounded-xl text-bg text-[13px] font-extrabold shadow-[0_4px_20px_var(--color-accent-glow)] hover:-translate-y-0.5 transition-all"
        >
          <Plus size={16} /> New Job
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2.5 mb-5">
        <div className="flex gap-1 bg-bg p-1 rounded-xl flex-1 min-w-[200px]">
          <button
            onClick={() => setViewMode("active")}
            className={`flex-1 py-2 rounded-lg text-[13px] font-semibold transition-all ${
              viewMode === "active"
                ? "bg-card text-accent"
                : "text-text-muted"
            }`}
          >
            Active ({projects.filter((p) => p.status === "active").length})
          </button>
          <button
            onClick={() => setViewMode("archived")}
            className={`flex-1 py-2 rounded-lg text-[13px] font-semibold transition-all ${
              viewMode === "archived"
                ? "bg-card text-accent"
                : "text-text-muted"
            }`}
          >
            Archived ({projects.filter((p) => p.status === "archived").length})
          </button>
        </div>
        <div className="flex gap-1 bg-bg p-1 rounded-xl flex-1 min-w-[200px]">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setPeriod(t.key)}
              className={`flex-1 py-2 rounded-lg text-[13px] font-semibold transition-all ${
                period === t.key
                  ? "bg-card text-accent"
                  : "text-text-muted"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Empty State */}
      {displayed.length === 0 && (
        <div className="bg-card rounded-2xl border border-border p-10 text-center">
          <Building2 size={36} className="text-text-dim mx-auto mb-3" />
          <p className="text-[15px] font-semibold text-text-muted">
            No {viewMode} jobs
          </p>
          {viewMode === "active" && (
            <p className="text-[13px] text-text-dim mt-1">
              Create your first job to get started
            </p>
          )}
        </div>
      )}

      {/* Job Cards Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
        {displayed.map((project, i) => {
          const projEntries = timeEntries.filter(
            (e) => e.project_id === project.id
          );
          const filteredEntries = projEntries.filter((e) =>
            isInPeriod(e.clock_in, period)
          );
          const totalSec = calcTotalSeconds(projEntries, period);
          const activeEntries = projEntries.filter((e) => !e.clock_out);
          const uniqueWorkers = [
            ...new Set(filteredEntries.map((e) => e.employee_id)),
          ];

          return (
            <div
              key={project.id}
              className={`bg-card rounded-2xl border border-border p-5 animate-fade-in hover:border-border-light transition-all ${
                project.status === "archived" ? "opacity-60" : ""
              }`}
              style={{ animationDelay: `${i * 0.05}s` }}
            >
              {/* Header */}
              <div className="flex justify-between items-start mb-3.5">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-base font-bold truncate">
                      {project.name}
                    </h3>
                    {activeEntries.length > 0 && (
                      <span className="flex items-center gap-1 bg-green-dark px-2 py-0.5 rounded-md border border-green-border shrink-0">
                        <LiveDot />
                        <span className="text-[10px] font-bold text-green">
                          {activeEntries.length}
                        </span>
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-text-muted flex items-center gap-1">
                    <MapPin size={12} /> {project.address}
                  </p>
                  <p className="text-[11px] text-text-dim font-mono mt-1">
                    {project.lat.toFixed(4)}, {project.lng.toFixed(4)} ·{" "}
                    {project.geo_radius_m || 300}m radius
                  </p>
                </div>

                {/* Actions */}
                <div className="flex gap-1 shrink-0 ml-2">
                  <button
                    onClick={() => {
                      setEditJob(project);
                      setShowForm(true);
                    }}
                    className="p-1.5 border border-border rounded-md text-text-muted hover:text-text hover:bg-bg transition-colors"
                    title="Edit"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => handleArchive(project)}
                    className="p-1.5 border border-border rounded-md text-text-muted hover:text-text hover:bg-bg transition-colors"
                    title={
                      project.status === "active" ? "Archive" : "Restore"
                    }
                  >
                    <Archive size={14} />
                  </button>
                  <button
                    onClick={() => setDeleteTarget(project)}
                    className="p-1.5 border border-red-border rounded-md text-red hover:bg-red/10 transition-colors"
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-2 mb-3">
                <div className="bg-bg rounded-xl p-2.5 text-center">
                  <p className="text-lg font-extrabold text-accent">
                    {formatHours(totalSec)}
                  </p>
                  <p className="text-[10px] text-text-muted font-semibold uppercase">
                    Hours
                  </p>
                </div>
                <div className="bg-bg rounded-xl p-2.5 text-center">
                  <p className="text-lg font-extrabold">
                    {uniqueWorkers.length}
                  </p>
                  <p className="text-[10px] text-text-muted font-semibold uppercase">
                    Workers
                  </p>
                </div>
                <div className="bg-bg rounded-xl p-2.5 text-center">
                  <p className="text-lg font-extrabold">
                    {filteredEntries.length}
                  </p>
                  <p className="text-[10px] text-text-muted font-semibold uppercase">
                    Entries
                  </p>
                </div>
              </div>

              {/* Active Workers */}
              {activeEntries.length > 0 && (
                <div className="bg-bg rounded-xl p-3">
                  <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-2">
                    On Site Now
                  </p>
                  {activeEntries.map((entry) => {
                    const emp = employees.find(
                      (e) => e.id === entry.employee_id
                    );
                    if (!emp) return null;
                    return (
                      <div
                        key={entry.id}
                        className="flex justify-between items-center py-1"
                      >
                        <span className="text-[13px] font-semibold flex items-center gap-1.5">
                          <User size={12} className="text-green" />
                          {emp.first_name} {emp.last_name}
                        </span>
                        <span className="text-[11px] text-text-muted">
                          Since {formatTime(entry.clock_in)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Create/Edit Modal */}
      <Modal
        open={showForm}
        onClose={() => {
          setShowForm(false);
          setEditJob(undefined);
        }}
        title={editJob ? "Edit Job" : "Create New Job"}
      >
        <JobForm
          job={editJob}
          onSave={() => {}}
          onClose={() => {
            setShowForm(false);
            setEditJob(undefined);
          }}
        />
      </Modal>

      {/* Delete Confirmation */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete Job"
      >
        {deleteTarget && (
          <ConfirmDelete
            job={deleteTarget}
            onConfirm={handleDelete}
            onClose={() => setDeleteTarget(null)}
          />
        )}
      </Modal>
    </div>
  );
}

