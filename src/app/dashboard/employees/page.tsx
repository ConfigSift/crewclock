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
import { useBusiness } from "@/contexts/BusinessContext";

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

type StaffAuthPayload = {
  email?: string | null;
  email_confirmed_at?: string | null;
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

const ADMIN_PROTECTED_MESSAGE = "Admin accounts are protected.";
const isAdminRole = (role?: string) => (role ?? "").toLowerCase() === "admin";

export default function EmployeesPage() {
  const { profile, employees, projects, timeEntries, setEmployees } = useAppStore();
  const { activeBusinessId } = useBusiness();

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
  const [editEmail, setEditEmail] = useState("");
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailActionSaving, setEmailActionSaving] = useState(false);
  const [emailActionMessage, setEmailActionMessage] = useState("");
  const [staffAuthById, setStaffAuthById] = useState<Record<string, StaffAuthPayload>>(
    {}
  );

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

  const isInternalEmail = (email: string | null | undefined): boolean =>
    Boolean(email && email.toLowerCase().endsWith("@internal.crewclock.local"));

  const isRealEmail = (email: string | null | undefined): boolean =>
    Boolean(email && !isInternalEmail(email));
  const currentUserIsAdmin = isAdminRole(profile?.role);
  const targetIsAdmin = isAdminRole(editTarget?.role);
  const canEditRole = currentUserIsAdmin && !targetIsAdmin;

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

  useEffect(() => {
    if (!isOwnerOrAdmin) {
      setStaffAuthById({});
      return;
    }
    const targets = employees.map((emp) => emp.id);
    if (targets.length === 0) {
      setStaffAuthById({});
      return;
    }

    let cancelled = false;

    const load = async () => {
      const response = await fetch(
        `/api/staff/emails?ids=${encodeURIComponent(targets.join(","))}`,
        {
          method: "GET",
          cache: "no-store",
        }
      );

      const payload = (await response.json().catch(() => null)) as
        | { emails?: Record<string, StaffAuthPayload> }
        | null;

      if (!response.ok || !payload?.emails) return;
      if (!cancelled) {
        setStaffAuthById(payload.emails);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [employees, isOwnerOrAdmin]);

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
    if (!profile || !activeBusinessId) {
      setEmployees([]);
      return;
    }

    const supabase = createClient();
    const { data: memberships } = await supabase
      .from("business_memberships")
      .select("profiles(*)")
      .eq("business_id", activeBusinessId)
      .eq("is_active", true);

    const nextEmployees = (memberships ?? [])
      .map(
        (row) =>
          (row as { profiles: Profile | Profile[] | null }).profiles ?? null
      )
      .flat()
      .filter(Boolean) as Profile[];

    setEmployees(
      nextEmployees.sort((a, b) =>
        `${a.first_name} ${a.last_name}`.localeCompare(
          `${b.first_name} ${b.last_name}`
        )
      )
    );
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

    if (!activeBusinessId) {
      setError("Select a business before creating staff.");
      return;
    }

    setSaving(true);

    const sendCreate = async (allowRoleUpgrade: boolean) => {
      const response = await fetch("/api/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_id: activeBusinessId,
          first_name,
          last_name,
          phone,
          role: form.role,
          allowRoleUpgrade,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | {
            error?: string;
            code?: string | null;
            details?: string | null;
            hint?: string | null;
            created?: boolean;
            attached?: boolean;
            profile_id?: string;
            role?: StaffRole;
            passcode?: string;
          }
        | null;

      return { response, payload };
    };

    let { response, payload } = await sendCreate(false);
    if (
      !response.ok &&
      payload?.code === "ROLE_UPGRADE_CONFIRM_REQUIRED" &&
      window.confirm(
        "This phone already belongs to a worker. Promote to manager and continue?"
      )
    ) {
      ({ response, payload } = await sendCreate(true));
    }

    if (!response.ok) {
      setError(formatCreateStaffError(payload));
      setSaving(false);
      return;
    }

    await reloadEmployees();

    if (payload?.created && payload.passcode) {
      setPasscodeReveal({
        kind: "created",
        staffName: `${first_name} ${last_name}`,
        phone,
        passcode: payload.passcode,
      });
    } else {
      setPasscodeReveal(null);
    }

    setShowAddStaff(false);
    setSaving(false);
    resetForm();
  };

  const resetPasscode = async (employee: Profile) => {
    const targetIsAdmin = isAdminRole(employee.role);
    if (targetIsAdmin) {
      setActionError(ADMIN_PROTECTED_MESSAGE);
      return;
    }

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
    const cachedEmail = staffAuthById[employee.id]?.email ?? "";
    setEditEmail(cachedEmail);
    setEditError("");
    setEmailActionMessage("");
    setEmailActionSaving(false);
    setEmailSaving(false);
  };

  useEffect(() => {
    if (!editTarget || !editForm || !isOwnerOrAdmin) return;

    let cancelled = false;
    const run = async () => {
      const result = await loadStaffAuth(editTarget.id);
      if (cancelled) return;
      if (result.error) {
        setEditError(result.error);
        return;
      }
      setEditEmail(result.data?.email ?? "");
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [editTarget?.id, editForm?.role, isOwnerOrAdmin]);

  const loadStaffAuth = async (userId: string) => {
    const response = await fetch(`/api/staff/${userId}/auth`, {
      method: "GET",
      cache: "no-store",
    });

    const payload = (await response.json().catch(() => null)) as
      | (StaffAuthPayload & CreateStaffErrorPayload)
      | null;

    if (!response.ok || !payload) {
      return {
        error: formatApiError(payload, "Failed to load staff auth details."),
      };
    }

    const normalized = {
      email: payload.email ?? null,
      email_confirmed_at: payload.email_confirmed_at ?? null,
    };

    setStaffAuthById((prev) => ({ ...prev, [userId]: normalized }));
    return { data: normalized };
  };

  const saveEdit = async () => {
    if (!editTarget || !editForm) return;
    const currentUserIsAdmin = isAdminRole(profile?.role);
    const targetIsAdmin = isAdminRole(editTarget.role);
    const canEditRole = currentUserIsAdmin && !targetIsAdmin;
    const roleChanged = editForm.role !== editTarget.role;

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

    if (roleChanged && !canEditRole) {
      setEditError(
        targetIsAdmin
          ? ADMIN_PROTECTED_MESSAGE
          : "Only admins can change roles."
      );
      setEditSaving(false);
      return;
    }

    if (canEditRole && roleChanged) {
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

    if (isOwnerOrAdmin) {
      const existingEmail = (staffAuthById[editTarget.id]?.email ?? "")
        .trim()
        .toLowerCase();
      const nextEmail = editEmail.trim().toLowerCase();

      if (nextEmail !== existingEmail) {
        if (editForm.role !== "worker" && nextEmail && isInternalEmail(nextEmail)) {
          setEditError("Use a real email address, not the internal placeholder domain.");
          setEditSaving(false);
          return;
        }

        setEmailSaving(true);
        const emailResponse = await fetch(`/api/staff/${editTarget.id}/email`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: nextEmail }),
        });

        const emailPayload = (await emailResponse.json().catch(() => null)) as
          | (CreateStaffErrorPayload & StaffAuthPayload & { message?: string })
          | null;

        if (!emailResponse.ok) {
          setEditError(formatApiError(emailPayload, "Failed to update staff email."));
          setEmailSaving(false);
          setEditSaving(false);
          return;
        }

        setStaffAuthById((prev) => ({
          ...prev,
          [editTarget.id]: {
            email: emailPayload?.email ?? nextEmail,
            email_confirmed_at: emailPayload?.email_confirmed_at ?? null,
          },
        }));
        setEmailActionMessage(
          emailPayload?.message ?? "Email updated successfully."
        );
        setEditEmail(emailPayload?.email ?? nextEmail);
        setEmailSaving(false);
      }
    }

    if (isOwnerOrAdmin && editForm.is_active !== editTarget.is_active) {
      if (targetIsAdmin) {
        setEditError(ADMIN_PROTECTED_MESSAGE);
        setEditSaving(false);
        return;
      }

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

  const sendEmailReset = async () => {
    if (!editTarget || !editForm) return;

    const targetEmail = editEmail.trim().toLowerCase();
    if (!targetEmail || isInternalEmail(targetEmail)) {
      setEditError("Set a real email before sending password reset.");
      return;
    }

    setEmailActionSaving(true);
    setEmailActionMessage("");
    setEditError("");

    const response = await fetch(`/api/staff/${editTarget.id}/send-reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: targetEmail }),
    });

    const payload = (await response.json().catch(() => null)) as
      | (CreateStaffErrorPayload & { message?: string })
      | null;

    if (!response.ok) {
      setEditError(formatApiError(payload, "Failed to send reset email."));
      setEmailActionSaving(false);
      return;
    }

    setEmailActionMessage(
      payload?.message ?? "If the email exists, a reset link was sent."
    );
    setEmailActionSaving(false);
  };

  const openDeleteModal = (employee: Profile) => {
    const targetIsAdmin = isAdminRole(employee.role);
    if (targetIsAdmin) {
      setActionError(ADMIN_PROTECTED_MESSAGE);
      return;
    }

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
    const targetIsAdmin = isAdminRole(employee.role);

    if (employee.id === profile.id) {
      setDeleteError("You cannot delete your own account.");
      return;
    }
    if (employee.id === ownerUserId || targetIsAdmin) {
      setDeleteError(ADMIN_PROTECTED_MESSAGE);
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
    const targetIsAdmin = isAdminRole(employee.role);
    if (targetIsAdmin) {
      setActionError(ADMIN_PROTECTED_MESSAGE);
      return;
    }
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
          const targetIsAdmin = isAdminRole(emp.role);
          const canEdit = canEditStaff(emp);
          const canResetPasscode = !isProtectedAdmin && !targetIsAdmin;
          const canDelete =
            isOwnerOrAdmin &&
            !isProtectedAdmin &&
            !targetIsAdmin &&
            profile?.id !== emp.id;
          const canToggleActive =
            isOwnerOrAdmin &&
            !isProtectedAdmin &&
            !targetIsAdmin &&
            profile?.id !== emp.id;
          const staffEmail = staffAuthById[emp.id]?.email ?? null;
          const visibleEmail = isRealEmail(staffEmail) ? staffEmail : "-";

          return (
            <div
              key={emp.id}
              className="bg-card rounded-xl border border-border px-3 py-2.5 animate-fade-in hover:border-border-light transition-all"
              style={{ animationDelay: `${i * 0.03}s` }}
            >
              <div className="flex justify-between items-start gap-2.5">
                <div className="flex gap-3 items-start min-w-0">
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
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-[14px] font-bold leading-tight truncate max-w-[180px]">
                        {emp.first_name} {emp.last_name}
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
                      {targetIsAdmin && (
                        <span className="inline-flex px-2 py-0.5 rounded-md text-[9px] font-semibold tracking-wide border border-border text-text-dim bg-bg">
                          Admin (protected)
                        </span>
                      )}
                      {!emp.is_active && (
                        <span className="inline-flex px-1.5 py-0.5 rounded-md text-[9px] text-red font-bold uppercase tracking-widest border border-red-border bg-red-dark">
                          inactive
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-text-muted leading-tight truncate max-w-[240px] mt-0.5">
                      {emp.phone}
                    </p>
                    <p className="text-[11px] text-text-dim leading-tight truncate max-w-[240px] mt-0.5">
                      {visibleEmail}
                    </p>
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
                    !canEdit && (isProtectedAdmin || targetIsAdmin)
                      ? "Protected Admin account"
                      : undefined
                  }
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-border rounded-lg text-[11px] font-semibold text-text-muted hover:bg-bg hover:text-text transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Pencil size={14} /> Edit
                </button>
                {!targetIsAdmin && (
                  <button
                    onClick={() => resetPasscode(emp)}
                    disabled={!canResetPasscode}
                    title={!canResetPasscode ? "Protected Admin account" : undefined}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-border rounded-lg text-[11px] font-semibold text-text-muted hover:bg-bg hover:text-text transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <KeyRound size={14} /> Reset passcode
                  </button>
                )}
                {isOwnerOrAdmin && !targetIsAdmin && (
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
                {isOwnerOrAdmin && !targetIsAdmin && (
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
                  <label className="block text-[11px] font-bold text-text-muted uppercase tracking-widest mb-1.5">
                    Email (Optional)
                  </label>
                  <input
                    type="email"
                    className="w-full p-3 bg-bg border border-border rounded-lg text-text text-sm mb-1.5 outline-none focus:border-accent"
                    value={editEmail}
                    onChange={(event) => setEditEmail(event.target.value)}
                    placeholder="name@company.com"
                    disabled={editSaving || emailSaving || emailActionSaving}
                  />
                  {isInternalEmail(editEmail) && (
                    <p className="text-[11px] text-text-muted mb-2">
                      Internal placeholder email detected.
                    </p>
                  )}
                  {editForm.role === "worker" && !editEmail.trim() && (
                    <p className="text-[11px] text-text-muted mb-2">
                      Leave blank to keep an internal placeholder email.
                    </p>
                  )}
                  {!isInternalEmail(editEmail) && editEmail.trim() && (
                    <p className="text-[11px] text-text-muted mb-2">
                      {staffAuthById[editTarget.id]?.email_confirmed_at
                        ? `Confirmed ${new Date(
                            staffAuthById[editTarget.id]?.email_confirmed_at as string
                          ).toLocaleString()}`
                        : "Unconfirmed email"}
                    </p>
                  )}
                  {editForm.role !== "worker" &&
                    !isInternalEmail(editEmail) &&
                    editEmail.trim() && (
                      <button
                        type="button"
                        onClick={sendEmailReset}
                        disabled={emailActionSaving || editSaving || emailSaving}
                        className="mb-3.5 inline-flex items-center gap-1 px-2.5 py-1.5 border border-border rounded-lg text-[11px] font-semibold text-text-muted hover:bg-bg hover:text-text transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {emailActionSaving
                          ? "Sending reset..."
                          : "Send password reset email"}
                      </button>
                    )}

                  <label className="block text-[11px] font-bold text-text-muted uppercase tracking-widest mb-1.5">
                    Account Type
                  </label>
                  <select
                    className={`w-full p-3 bg-bg border rounded-lg text-sm mb-1.5 outline-none ${
                      !canEditRole
                        ? "border-border text-text-dim opacity-60 cursor-not-allowed"
                        : "border-border text-text focus:border-accent"
                    }`}
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
                    disabled={!canEditRole}
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
                    {targetIsAdmin
                      ? "Admin role cannot be changed."
                      : !currentUserIsAdmin
                        ? "Only admins can change roles."
                      : "Only the protected owner account can be admin."}
                  </p>

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
                        targetIsAdmin ||
                        ownerUserId === editTarget.id ||
                        (profile?.id === editTarget.id && editForm.is_active === true)
                      }
                      title={
                        targetIsAdmin
                          ? ADMIN_PROTECTED_MESSAGE
                          : ownerUserId === editTarget.id
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

              {emailActionMessage && (
                <p className="text-green text-sm font-semibold mb-3 rounded-lg border border-green-border bg-green-dark px-3 py-2">
                  {emailActionMessage}
                </p>
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

              <label className="block text-[11px] font-bold text-text-muted uppercase tracking-widest mb-1.5">
                Email (Optional)
              </label>
              <input
                type="email"
                className="w-full p-3 bg-bg border border-border rounded-lg text-text text-sm mb-1.5 outline-none focus:border-accent"
                value={form.email}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, email: event.target.value }))
                }
                placeholder="name@company.com"
              />
              {form.role === "worker" && !form.email.trim() && (
                <p className="text-[11px] text-text-dim mb-3.5">
                  Leave blank to use an internal placeholder email.
                </p>
              )}
              {form.role !== "worker" && <div className="mb-3.5" />}
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
