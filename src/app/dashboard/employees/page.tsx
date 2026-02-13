"use client";

import { useEffect, useMemo, useState } from "react";
import {
  User,
  MapPin,
  Search,
  Plus,
  KeyRound,
  Copy,
  Check,
  Pencil,
  Trash2,
  Power,
} from "lucide-react";
import { useAppStore } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import {
  formatHours,
  formatTime,
  calcTotalSeconds,
  type Period,
} from "@/lib/utils";
import { generatePasscode, isValidPasscode } from "@/lib/staff-utils";
import type { Profile, UserRole } from "@/types/database";

function LiveDot() {
  return (
    <span className="inline-block w-2 h-2 rounded-full bg-green animate-pulse-dot" />
  );
}

type StaffRole = "worker" | "manager";

type PasscodeReveal = {
  kind: "created" | "reset";
  staffName: string;
  phone: string;
  passcode: string;
};

type CreateStaffErrorPayload = {
  error?: string;
  code?: string | null;
  details?: string | null;
  hint?: string | null;
};

type EditStaffPayload = {
  first_name: string;
  last_name: string;
  phone: string;
  role: UserRole;
  is_active: boolean;
};

const emptyForm = {
  first_name: "",
  last_name: "",
  phone: "",
  role: "worker" as StaffRole,
  email: "",
  manualPasscode: "",
  passcodeMode: "auto" as "auto" | "manual",
};

function formatCreateStaffError(payload: CreateStaffErrorPayload | null): string {
  if (!payload) return "Failed to create staff account.";

  const lines = [payload.error || "Failed to create staff account."];
  if (payload.code) lines.push(`Code: ${payload.code}`);
  if (payload.details) lines.push(`Details: ${payload.details}`);
  if (payload.hint) lines.push(`Hint: ${payload.hint}`);
  return lines.join(" ");
}

function formatApiError(payload: CreateStaffErrorPayload | null, fallback: string): string {
  if (!payload) return fallback;
  const lines = [payload.error || fallback];
  if (payload.code) lines.push(`Code: ${payload.code}`);
  if (payload.details) lines.push(`Details: ${payload.details}`);
  if (payload.hint) lines.push(`Hint: ${payload.hint}`);
  return lines.join(" ");
}

export default function EmployeesPage() {
  const { profile, employees, projects, timeEntries, setEmployees } = useAppStore();

  const [period, setPeriod] = useState<Period>("week");
  const [search, setSearch] = useState("");
  const [showAddStaff, setShowAddStaff] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [passcodeReveal, setPasscodeReveal] = useState<PasscodeReveal | null>(null);
  const [copied, setCopied] = useState(false);

  const [ownerUserId, setOwnerUserId] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<Profile | null>(null);
  const [editForm, setEditForm] = useState<EditStaffPayload | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [deletingStaffId, setDeletingStaffId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Profile | null>(null);
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [editError, setEditError] = useState("");

  const filtered = employees.filter((e) =>
    `${e.first_name} ${e.last_name}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  const activeEmployeeIds = new Set(
    timeEntries.filter((e) => !e.clock_out).map((e) => e.employee_id)
  );

  const tabs: { key: Period; label: string }[] = [
    { key: "week", label: "Week" },
    { key: "month", label: "Month" },
    { key: "year", label: "Year" },
  ];

  const isOwnerOrAdmin = useMemo(() => {
    if (!profile) return false;
    return profile.role === "admin" || profile.id === ownerUserId;
  }, [profile, ownerUserId]);

  useEffect(() => {
    if (!passcodeReveal) return;
    const timeout = window.setTimeout(() => {
      setPasscodeReveal(null);
      setCopied(false);
    }, 60000);
    return () => window.clearTimeout(timeout);
  }, [passcodeReveal]);

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;

    const loadOwner = async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("companies")
        .select("owner_user_id")
        .eq("id", profile.company_id)
        .single();

      if (!cancelled) {
        setOwnerUserId(
          (data as { owner_user_id?: string | null } | null)?.owner_user_id ??
            null
        );
      }
    };

    loadOwner();

    return () => {
      cancelled = true;
    };
  }, [profile]);

  const resetForm = () => {
    setForm(emptyForm);
    setError("");
  };

  const canEditStaff = (employee: Profile): boolean => {
    if (!profile) return false;
    if (isOwnerOrAdmin) return true;
    if (profile.role === "manager") {
      return employee.id !== ownerUserId && employee.role !== "admin";
    }
    return false;
  };

  const reloadEmployees = async () => {
    if (!profile) return;

    const supabase = createClient();
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("company_id", profile.company_id)
      .order("first_name");

    setEmployees((data as Profile[]) || []);
  };

  const copyPasscode = async () => {
    if (!passcodeReveal) return;

    try {
      await navigator.clipboard.writeText(passcodeReveal.passcode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const createStaff = async () => {
    setError("");
    setActionError("");

    const first_name = form.first_name.trim();
    const last_name = form.last_name.trim();
    const phone = form.phone.trim();

    if (!first_name || !last_name || !phone) {
      setError("First name, last name, and phone are required.");
      return;
    }

    const passcode =
      form.passcodeMode === "manual" ? form.manualPasscode.trim() : "";

    if (form.passcodeMode === "manual" && !isValidPasscode(passcode)) {
      setError("Manual passcode must be exactly 6 digits.");
      return;
    }

    setSaving(true);

    const response = await fetch("/api/staff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        first_name,
        last_name,
        phone,
        role: form.role,
        email: form.role === "manager" ? form.email.trim() : "",
        passcode,
      }),
    });

    const payload = (await response.json().catch(() => null)) as
      | {
          error?: string;
          code?: string | null;
          details?: string | null;
          hint?: string | null;
          passcode?: string;
          staff?: Profile;
        }
      | null;

    if (!response.ok) {
      setError(formatCreateStaffError(payload));
      setSaving(false);
      return;
    }

    if (payload?.staff) {
      setEmployees(
        [...employees, payload.staff].sort((a, b) =>
          `${a.first_name} ${a.last_name}`.localeCompare(
            `${b.first_name} ${b.last_name}`
          )
        )
      );
    } else {
      await reloadEmployees();
    }

    setPasscodeReveal({
      kind: "created",
      staffName: `${first_name} ${last_name}`,
      phone: payload?.staff?.phone ?? phone,
      passcode: payload?.passcode || passcode || generatePasscode(),
    });

    setShowAddStaff(false);
    setSaving(false);
    resetForm();
  };

  const resetPasscode = async (employee: Profile) => {
    setActionError("");

    const response = await fetch("/api/staff/reset-passcode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: employee.id, phone: employee.phone }),
    });

    const payload = (await response.json().catch(() => null)) as
      | {
          error?: string;
          passcode?: string;
          phone?: string;
          code?: string | null;
          details?: string | null;
          hint?: string | null;
        }
      | null;

    if (!response.ok || !payload?.passcode) {
      setActionError(formatApiError(payload, "Failed to reset passcode."));
      return;
    }

    setPasscodeReveal({
      kind: "reset",
      staffName: `${employee.first_name} ${employee.last_name}`,
      phone: payload.phone ?? employee.phone,
      passcode: payload.passcode,
    });

    await reloadEmployees();
  };

  const openEditModal = (employee: Profile) => {
    setEditTarget(employee);
    setEditForm({
      first_name: employee.first_name,
      last_name: employee.last_name,
      phone: employee.phone,
      role: employee.role,
      is_active: employee.is_active,
    });
    setEditError("");
  };

  const saveEdit = async () => {
    if (!editTarget || !editForm) return;

    setEditSaving(true);
    setEditError("");

    const profileResponse = await fetch("/api/staff/update-profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: editTarget.id,
        first_name: editForm.first_name,
        last_name: editForm.last_name,
        phone: editForm.phone,
      }),
    });

    const profilePayload = (await profileResponse.json().catch(() => null)) as
      | CreateStaffErrorPayload
      | null;

    if (!profileResponse.ok) {
      setEditError(formatApiError(profilePayload, "Failed to update staff profile."));
      setEditSaving(false);
      return;
    }

    if (
      isOwnerOrAdmin &&
      editForm.role !== "admin" &&
      editForm.role !== editTarget.role
    ) {
      const roleResponse = await fetch("/api/staff/update-role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: editTarget.id, role: editForm.role }),
      });

      const rolePayload = (await roleResponse.json().catch(() => null)) as
        | CreateStaffErrorPayload
        | null;

      if (!roleResponse.ok) {
        setEditError(formatApiError(rolePayload, "Failed to update staff role."));
        setEditSaving(false);
        return;
      }
    }

    if (isOwnerOrAdmin && editForm.is_active !== editTarget.is_active) {
      const activeResponse = await fetch("/api/staff/set-active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: editTarget.id,
          is_active: editForm.is_active,
        }),
      });

      const activePayload = (await activeResponse.json().catch(() => null)) as
        | CreateStaffErrorPayload
        | null;

      if (!activeResponse.ok) {
        setEditError(
          formatApiError(activePayload, "Failed to update active status.")
        );
        setEditSaving(false);
        return;
      }
    }

    await reloadEmployees();
    setEditSaving(false);
    setEditTarget(null);
    setEditForm(null);
  };

  const openDeleteModal = (employee: Profile) => {
    setDeleteTarget(employee);
    setDeleteError("");
  };

  const closeDeleteModal = () => {
    if (deleteSaving) return;
    setDeleteTarget(null);
    setDeleteError("");
  };

  const deleteStaff = async () => {
    const employee = deleteTarget;
    if (!employee) return;
    if (!profile || !isOwnerOrAdmin) return;
    if (employee.id === profile.id) {
      setDeleteError("You cannot delete your own account.");
      return;
    }
    if (employee.id === ownerUserId || employee.role === "admin") {
      setDeleteError("Protected admin account cannot be deleted.");
      return;
    }
    setDeleteError("");
    setDeleteSaving(true);
    setDeletingStaffId(employee.id);

    try {
      const response = await fetch("/api/staff/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: employee.id }),
      });

      const payload = (await response.json().catch(() => null)) as
        | CreateStaffErrorPayload
        | null;

      if (!response.ok) {
        setDeleteError(formatApiError(payload, "Failed to delete staff member."));
        return;
      }

      if (editTarget?.id === employee.id) {
        setEditTarget(null);
        setEditForm(null);
        setEditError("");
      }

      await reloadEmployees();
      setDeleteTarget(null);
      setDeleteError("");
    } catch {
      setDeleteError("Failed to delete staff member.");
    } finally {
      setDeleteSaving(false);
      setDeletingStaffId(null);
    }
  };

  const toggleStaffActive = async (employee: Profile) => {
    if (!isOwnerOrAdmin) return;
    if (employee.id === ownerUserId || employee.id === profile?.id) {
      setActionError("Protected account status cannot be changed.");
      return;
    }

    setActionError("");
    const response = await fetch("/api/staff/set-active", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: employee.id,
        is_active: !employee.is_active,
      }),
    });

    const payload = (await response.json().catch(() => null)) as
      | CreateStaffErrorPayload
      | null;

    if (!response.ok) {
      setActionError(formatApiError(payload, "Failed to update active status."));
      return;
    }

    await reloadEmployees();
  };

  return (
    <div className="animate-fade-in">
      <div className="flex flex-wrap justify-between items-center gap-3 mb-5">
        <h1 className="text-[22px] font-extrabold tracking-tight">Crew</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search
              size={15}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-text-dim"
            />
            <input
              className="pl-9 pr-3 py-2 bg-bg border border-border rounded-lg text-sm text-text w-[200px] outline-none focus:border-accent"
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button
            onClick={() => {
              setShowAddStaff(true);
              setError("");
            }}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-gradient-to-br from-accent to-accent-dark rounded-xl text-bg text-[13px] font-extrabold shadow-[0_4px_20px_var(--color-accent-glow)] hover:-translate-y-0.5 transition-all"
          >
            <Plus size={15} /> Add Staff
          </button>
        </div>
      </div>

      <div className="mb-4 rounded-xl border border-border bg-bg px-3.5 py-2.5">
        <p className="text-xs font-semibold text-text-muted">
          Staff accounts are internal only. Employees must be added by an admin or manager.
        </p>
      </div>

      <div className="flex gap-1 bg-bg p-1 rounded-xl mb-5 max-w-[300px]">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setPeriod(t.key)}
            className={`flex-1 py-2 rounded-lg text-[13px] font-semibold transition-all ${
              period === t.key ? "bg-card text-accent" : "text-text-muted"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {passcodeReveal && (
        <div className="bg-card rounded-2xl border border-accent/30 p-4 mb-5">
          <p className="text-xs font-bold text-accent uppercase tracking-widest mb-1.5">
            {passcodeReveal.kind === "created" ? "Staff Created" : "Passcode Reset"}
          </p>
          <p className="text-sm font-semibold mb-3">
            {passcodeReveal.staffName} ({passcodeReveal.phone})
          </p>
          <div className="flex items-center gap-2.5">
            <div className="px-3 py-2 rounded-lg bg-bg border border-border font-mono text-lg tracking-[0.28em]">
              {passcodeReveal.passcode}
            </div>
            <button
              onClick={copyPasscode}
              className="inline-flex items-center gap-1.5 px-3 py-2 border border-border rounded-lg text-sm font-semibold hover:bg-bg transition-colors"
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              onClick={() => setPasscodeReveal(null)}
              className="ml-auto text-xs font-semibold text-text-muted hover:text-text"
            >
              Dismiss
            </button>
          </div>
          <p className="text-[11px] text-text-dim mt-2">
            This passcode is shown once. Share it securely with the staff member.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="bg-card rounded-2xl border border-border p-5">
          <div className="bg-bg rounded-xl p-3.5 text-center">
            <p className="text-[26px] font-extrabold">{employees.length}</p>
            <p className="text-[10px] font-semibold text-text-muted uppercase tracking-widest">
              Total Crew
            </p>
          </div>
        </div>
        <div className="bg-card rounded-2xl border border-border p-5">
          <div className="bg-bg rounded-xl p-3.5 text-center">
            <p className="text-[26px] font-extrabold text-green">{activeEmployeeIds.size}</p>
            <p className="text-[10px] font-semibold text-text-muted uppercase tracking-widest">
              Active Now
            </p>
          </div>
        </div>
      </div>

      {actionError && (
        <p className="text-red text-sm font-semibold mb-3 rounded-lg border border-red-border bg-red-dark px-3 py-2">
          {actionError}
        </p>
      )}

      <div className="space-y-2">
        {filtered.map((emp, i) => {
          const empEntries = timeEntries.filter((e) => e.employee_id === emp.id);
          const activeEntry = empEntries.find((e) => !e.clock_out);
          const totalSec = calcTotalSeconds(empEntries, period);
          const activeProject = activeEntry
            ? projects.find((p) => p.id === activeEntry.project_id)
            : null;
          const isActive = activeEmployeeIds.has(emp.id);
          const isProtectedAdmin = ownerUserId !== null && emp.id === ownerUserId;
          const isAdminAccount = emp.role === "admin";
          const canEdit = canEditStaff(emp);
          const canResetPasscode = !isProtectedAdmin;
          const canDelete =
            isOwnerOrAdmin &&
            !isProtectedAdmin &&
            emp.role !== "admin" &&
            profile?.id !== emp.id;
          const canToggleActive =
            isOwnerOrAdmin &&
            !isProtectedAdmin &&
            emp.role !== "admin" &&
            profile?.id !== emp.id;

          return (
            <div
              key={emp.id}
              className="bg-card rounded-xl border border-border px-3 py-2.5 animate-fade-in hover:border-border-light transition-all"
              style={{ animationDelay: `${i * 0.03}s` }}
            >
              <div className="flex justify-between items-center gap-2.5">
                <div className="flex gap-3 items-center min-w-0">
                  <div
                    className={`w-9 h-9 rounded-lg flex items-center justify-center border ${
                      isActive
                        ? "bg-green-dark border-green-border"
                        : "bg-bg border-border"
                    }`}
                  >
                    <User
                      size={16}
                      className={isActive ? "text-green" : "text-text-muted"}
                    />
                  </div>
                  <div className="min-w-0 flex items-center gap-1.5 flex-wrap">
                    <p className="text-[14px] font-bold leading-tight truncate max-w-[180px]">
                      {emp.first_name} {emp.last_name}
                    </p>
                    <p className="text-[11px] text-text-muted leading-tight truncate">
                      {emp.phone}
                    </p>
                    <span
                      className={`inline-flex px-2 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-widest border ${
                        emp.role === "manager"
                          ? "bg-accent/10 text-accent border-accent/25"
                          : emp.role === "admin"
                            ? "bg-red/10 text-red border-red-border"
                            : "bg-bg text-text-muted border-border"
                      }`}
                    >
                      {emp.role}
                    </span>
                    {!emp.is_active && (
                      <span className="inline-flex px-1.5 py-0.5 rounded-md text-[9px] text-red font-bold uppercase tracking-widest border border-red-border bg-red-dark">
                        inactive
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[17px] leading-none font-extrabold text-accent">
                    {formatHours(totalSec)}h
                    <span className="ml-1 text-[10px] text-text-muted font-semibold uppercase">
                      {period}
                    </span>
                  </p>
                  {isActive && <p className="text-[9px] text-green font-bold uppercase tracking-widest mt-0.5">live</p>}
                </div>
              </div>

              <div className="mt-2 flex justify-end gap-1.5 flex-wrap">
                <button
                  onClick={() => openEditModal(emp)}
                  disabled={!canEdit}
                  title={
                    !canEdit && (isProtectedAdmin || isAdminAccount)
                      ? "Protected Admin account"
                      : undefined
                  }
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-border rounded-lg text-[11px] font-semibold text-text-muted hover:bg-bg hover:text-text transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Pencil size={14} /> Edit
                </button>
                <button
                  onClick={() => resetPasscode(emp)}
                  disabled={!canResetPasscode}
                  title={!canResetPasscode ? "Protected Admin account" : undefined}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-border rounded-lg text-[11px] font-semibold text-text-muted hover:bg-bg hover:text-text transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <KeyRound size={14} /> Reset passcode
                </button>
                {isOwnerOrAdmin && (
                  <button
                    onClick={() => toggleStaffActive(emp)}
                    disabled={!canToggleActive}
                    title={!canToggleActive ? "Protected Admin account" : undefined}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-border rounded-lg text-[11px] font-semibold text-text-muted hover:bg-bg hover:text-text transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Power size={13} />
                    {emp.is_active ? "Deactivate" : "Activate"}
                  </button>
                )}
                {isOwnerOrAdmin && (
                  <button
                    onClick={() => openDeleteModal(emp)}
                    disabled={!canDelete || deletingStaffId === emp.id || deleteSaving}
                    title={
                      !canDelete
                        ? emp.id === profile?.id
                          ? "Cannot delete your own account"
                          : "Protected Admin account"
                        : undefined
                    }
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-red-border rounded-lg text-[11px] font-semibold text-red hover:bg-red-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Trash2 size={14} />
                    Delete
                  </button>
                )}
              </div>

              {(isProtectedAdmin || isAdminAccount) && !isOwnerOrAdmin && (
                <p className="mt-2 text-[11px] text-text-muted font-semibold">
                  Protected Admin account
                </p>
              )}

              {activeEntry && activeProject && (
                <div className="mt-2 p-2 bg-green-dark rounded-lg border border-green-border">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <LiveDot />
                    <span className="text-xs font-bold text-green">CLOCKED IN</span>
                    <span className="text-xs text-text-muted ml-auto">
                      Since {formatTime(activeEntry.clock_in)}
                    </span>
                  </div>
                  <p className="text-[12px] font-semibold mb-0.5">{activeProject.name}</p>
                  <p className="text-xs text-text-muted flex items-center gap-1">
                    <MapPin size={12} /> {activeProject.address}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {editTarget && editForm && (
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center p-5"
          onClick={() => {
            setEditTarget(null);
            setEditForm(null);
            setEditError("");
          }}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            onClick={(event) => event.stopPropagation()}
            className="relative bg-card rounded-2xl border border-border w-full max-w-[520px] max-h-[90vh] overflow-auto animate-scale-in"
          >
            <div className="flex justify-between items-center px-6 py-4 border-b border-border">
              <h3 className="text-[17px] font-bold">Edit Staff</h3>
              <button
                onClick={() => {
                  setEditTarget(null);
                  setEditForm(null);
                  setEditError("");
                }}
                className="text-text-muted hover:text-text text-sm font-semibold"
              >
                Close
              </button>
            </div>

            <div className="px-6 py-5">
              <div className="grid grid-cols-2 gap-2.5 mb-3.5">
                <div>
                  <label className="block text-[11px] font-bold text-text-muted uppercase tracking-widest mb-1.5">
                    First Name
                  </label>
                  <input
                    className="w-full p-3 bg-bg border border-border rounded-lg text-text text-sm outline-none focus:border-accent"
                    value={editForm.first_name}
                    onChange={(event) =>
                      setEditForm((prev) =>
                        prev ? { ...prev, first_name: event.target.value } : prev
                      )
                    }
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-text-muted uppercase tracking-widest mb-1.5">
                    Last Name
                  </label>
                  <input
                    className="w-full p-3 bg-bg border border-border rounded-lg text-text text-sm outline-none focus:border-accent"
                    value={editForm.last_name}
                    onChange={(event) =>
                      setEditForm((prev) =>
                        prev ? { ...prev, last_name: event.target.value } : prev
                      )
                    }
                  />
                </div>
              </div>

              <label className="block text-[11px] font-bold text-text-muted uppercase tracking-widest mb-1.5">
                Phone Number
              </label>
              <input
                className="w-full p-3 bg-bg border border-border rounded-lg text-text text-sm mb-3.5 outline-none focus:border-accent"
                value={editForm.phone}
                onChange={(event) =>
                  setEditForm((prev) =>
                    prev ? { ...prev, phone: event.target.value } : prev
                  )
                }
                placeholder="(555) 123-4567"
              />
              {isOwnerOrAdmin && (
                <>
                  {ownerUserId === editTarget.id ? (
                    <p className="text-[11px] text-text-muted mb-3.5">
                      Protected owner account must remain admin.
                    </p>
                  ) : (
                    <>
                      <label className="block text-[11px] font-bold text-text-muted uppercase tracking-widest mb-1.5">
                        Account Type
                      </label>
                      <select
                        className="w-full p-3 bg-bg border border-border rounded-lg text-text text-sm mb-1.5 outline-none focus:border-accent"
                        value={editForm.role === "admin" ? "" : editForm.role}
                        onChange={(event) =>
                          setEditForm((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  role: event.target.value as UserRole,
                                }
                              : prev
                          )
                        }
                      >
                        {editForm.role === "admin" && (
                          <option value="" disabled>
                            current: admin (legacy)
                          </option>
                        )}
                        <option value="worker">worker</option>
                        <option value="manager">manager</option>
                      </select>
                      <p className="text-[11px] text-text-muted mb-3.5">
                        Only the protected owner account can be admin.
                      </p>
                    </>
                  )}

                  <label className="block text-[11px] font-bold text-text-muted uppercase tracking-widest mb-1.5">
                    Active Status
                  </label>
                  <div className="mb-3.5 flex items-center justify-between rounded-lg border border-border bg-bg px-3 py-2.5">
                    <p className="text-sm font-semibold">
                      {editForm.is_active ? "Active" : "Inactive"}
                    </p>
                    <button
                      type="button"
                      disabled={
                        ownerUserId === editTarget.id ||
                        (profile?.id === editTarget.id && editForm.is_active === true)
                      }
                      title={
                        ownerUserId === editTarget.id
                          ? "Protected Admin account"
                          : profile?.id === editTarget.id && editForm.is_active === true
                            ? "Cannot deactivate your own owner/admin account"
                            : undefined
                      }
                      onClick={() =>
                        setEditForm((prev) =>
                          prev ? { ...prev, is_active: !prev.is_active } : prev
                        )
                      }
                      className="px-3 py-1.5 border border-border rounded-lg text-xs font-semibold text-text-muted hover:bg-card disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Toggle
                    </button>
                  </div>
                </>
              )}

              {editError && (
                <p className="text-red text-sm font-semibold mb-3 rounded-lg border border-red-border bg-red-dark px-3 py-2">
                  {editError}
                </p>
              )}

              <div className="flex gap-2.5">
                <button
                  onClick={() => {
                    setEditTarget(null);
                    setEditForm(null);
                    setEditError("");
                  }}
                  className="flex-1 py-3 border border-border rounded-xl text-text-muted text-sm font-semibold hover:bg-bg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={saveEdit}
                  disabled={editSaving}
                  className="flex-[2] py-3 bg-gradient-to-br from-accent to-accent-dark rounded-xl text-bg text-sm font-extrabold shadow-[0_4px_20px_var(--color-accent-glow)] hover:-translate-y-0.5 transition-all disabled:opacity-50"
                >
                  {editSaving ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center p-5"
          onClick={closeDeleteModal}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            onClick={(event) => event.stopPropagation()}
            className="relative bg-card rounded-2xl border border-border w-full max-w-[460px] animate-scale-in"
          >
            <div className="flex justify-between items-center px-6 py-4 border-b border-border">
              <h3 className="text-[17px] font-bold">Delete staff member?</h3>
              <button
                onClick={closeDeleteModal}
                disabled={deleteSaving}
                className="text-text-muted hover:text-text text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Close
              </button>
            </div>

            <div className="px-6 py-5">
              <p className="text-sm text-text-muted mb-4">
                Delete {deleteTarget.first_name} {deleteTarget.last_name}? This cannot
                be undone.
              </p>

              {deleteError && (
                <p className="text-red text-sm font-semibold mb-3 rounded-lg border border-red-border bg-red-dark px-3 py-2">
                  {deleteError}
                </p>
              )}

              <div className="flex gap-2.5">
                <button
                  onClick={closeDeleteModal}
                  disabled={deleteSaving}
                  className="flex-1 py-3 border border-border rounded-xl text-text-muted text-sm font-semibold hover:bg-bg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
                <button
                  onClick={deleteStaff}
                  disabled={deleteSaving}
                  className="flex-[2] py-3 border border-red-border bg-red-dark rounded-xl text-red text-sm font-extrabold hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {deleteSaving ? "Deleting..." : "Delete"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showAddStaff && (
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center p-5"
          onClick={() => setShowAddStaff(false)}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            onClick={(event) => event.stopPropagation()}
            className="relative bg-card rounded-2xl border border-border w-full max-w-[520px] max-h-[90vh] overflow-auto animate-scale-in"
          >
            <div className="flex justify-between items-center px-6 py-4 border-b border-border">
              <h3 className="text-[17px] font-bold">Add Staff Member</h3>
              <button
                onClick={() => {
                  setShowAddStaff(false);
                  resetForm();
                }}
                className="text-text-muted hover:text-text text-sm font-semibold"
              >
                Close
              </button>
            </div>

            <div className="px-6 py-5">
              <div className="grid grid-cols-2 gap-2.5 mb-3.5">
                <div>
                  <label className="block text-[11px] font-bold text-text-muted uppercase tracking-widest mb-1.5">
                    First Name
                  </label>
                  <input
                    className="w-full p-3 bg-bg border border-border rounded-lg text-text text-sm outline-none focus:border-accent"
                    value={form.first_name}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, first_name: event.target.value }))
                    }
                    placeholder="John"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-text-muted uppercase tracking-widest mb-1.5">
                    Last Name
                  </label>
                  <input
                    className="w-full p-3 bg-bg border border-border rounded-lg text-text text-sm outline-none focus:border-accent"
                    value={form.last_name}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, last_name: event.target.value }))
                    }
                    placeholder="Doe"
                  />
                </div>
              </div>

              <label className="block text-[11px] font-bold text-text-muted uppercase tracking-widest mb-1.5">
                Phone Number
              </label>
              <input
                className="w-full p-3 bg-bg border border-border rounded-lg text-text text-sm mb-3.5 outline-none focus:border-accent"
                value={form.phone}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, phone: event.target.value }))
                }
                placeholder="(555) 123-4567"
              />

              <label className="block text-[11px] font-bold text-text-muted uppercase tracking-widest mb-1.5">
                Role
              </label>
              <div className="flex gap-1 bg-bg p-1 rounded-xl mb-3.5 max-w-[220px]">
                <button
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, role: "worker" }))}
                  className={`flex-1 py-2 rounded-lg text-[13px] font-semibold transition-all ${
                    form.role === "worker" ? "bg-card text-accent" : "text-text-muted"
                  }`}
                >
                  Worker
                </button>
                <button
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, role: "manager" }))}
                  className={`flex-1 py-2 rounded-lg text-[13px] font-semibold transition-all ${
                    form.role === "manager" ? "bg-card text-accent" : "text-text-muted"
                  }`}
                >
                  Manager
                </button>
              </div>

              {form.role === "manager" && (
                <>
                  <label className="block text-[11px] font-bold text-text-muted uppercase tracking-widest mb-1.5">
                    Email (Optional)
                  </label>
                  <input
                    type="email"
                    className="w-full p-3 bg-bg border border-border rounded-lg text-text text-sm mb-3.5 outline-none focus:border-accent"
                    value={form.email}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, email: event.target.value }))
                    }
                    placeholder="manager@company.com"
                  />
                </>
              )}
              <label className="block text-[11px] font-bold text-text-muted uppercase tracking-widest mb-1.5">
                Passcode
              </label>
              <div className="flex gap-1 bg-bg p-1 rounded-xl mb-2.5 max-w-[220px]">
                <button
                  type="button"
                  onClick={() =>
                    setForm((prev) => ({ ...prev, passcodeMode: "auto", manualPasscode: "" }))
                  }
                  className={`flex-1 py-2 rounded-lg text-[13px] font-semibold transition-all ${
                    form.passcodeMode === "auto"
                      ? "bg-card text-accent"
                      : "text-text-muted"
                  }`}
                >
                  Generate
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setForm((prev) => ({
                      ...prev,
                      passcodeMode: "manual",
                      manualPasscode: prev.manualPasscode || generatePasscode(),
                    }))
                  }
                  className={`flex-1 py-2 rounded-lg text-[13px] font-semibold transition-all ${
                    form.passcodeMode === "manual"
                      ? "bg-card text-accent"
                      : "text-text-muted"
                  }`}
                >
                  Manual
                </button>
              </div>

              {form.passcodeMode === "manual" && (
                <input
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  className="w-full p-3 bg-bg border border-border rounded-lg text-text text-sm font-mono tracking-[0.3em] mb-1.5 outline-none focus:border-accent"
                  value={form.manualPasscode}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      manualPasscode: event.target.value.replace(/\D/g, "").slice(0, 6),
                    }))
                  }
                  placeholder="000000"
                />
              )}

              <p className="text-[11px] text-text-dim mb-4">
                The passcode will be shown once after account creation.
              </p>

              {error && (
                <p className="text-red text-sm font-semibold mb-3 rounded-lg border border-red-border bg-red-dark px-3 py-2">
                  {error}
                </p>
              )}

              <div className="flex gap-2.5">
                <button
                  onClick={() => {
                    setShowAddStaff(false);
                    resetForm();
                  }}
                  className="flex-1 py-3 border border-border rounded-xl text-text-muted text-sm font-semibold hover:bg-bg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={createStaff}
                  disabled={saving}
                  className="flex-[2] py-3 bg-gradient-to-br from-accent to-accent-dark rounded-xl text-bg text-sm font-extrabold shadow-[0_4px_20px_var(--color-accent-glow)] hover:-translate-y-0.5 transition-all disabled:opacity-50"
                >
                  {saving ? "Creating..." : "Create Staff"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
