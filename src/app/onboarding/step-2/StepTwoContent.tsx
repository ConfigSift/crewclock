"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useBusiness } from "@/contexts/BusinessContext";

type StaffRole = "worker" | "manager";

type StaffCreatePayload = {
  error?: string;
  code?: string | null;
  details?: string | null;
  hint?: string | null;
  created?: boolean;
  attached?: boolean;
  profile_id?: string;
  role?: StaffRole;
  passcode?: string;
};

type AddedStaff = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  role: StaffRole;
  status: "created" | "attached";
};

function formatStaffError(payload: StaffCreatePayload | null): string {
  if (!payload) return "Failed to add staff member.";
  const parts = [payload.error || "Failed to add staff member."];
  if (payload.code) parts.push(`Code: ${payload.code}`);
  if (payload.details) parts.push(`Details: ${payload.details}`);
  if (payload.hint) parts.push(`Hint: ${payload.hint}`);
  return parts.join(" ");
}

export default function StepTwoContent() {
  const router = useRouter();
  const {
    businesses,
    activeBusinessId,
    activeBusiness,
    setActiveBusinessId,
    loading: businessLoading,
  } = useBusiness();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<StaffRole>("worker");
  const [fieldErrors, setFieldErrors] = useState<{
    firstName?: string;
    lastName?: string;
    phone?: string;
  }>({});
  const [error, setError] = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [continueLoading, setContinueLoading] = useState(false);
  const [addedStaff, setAddedStaff] = useState<AddedStaff[]>([]);
  const [passcodeModal, setPasscodeModal] = useState<{
    staffName: string;
    passcode: string;
  } | null>(null);

  const canSubmitStaff = useMemo(
    () => !businessLoading && Boolean(activeBusinessId) && !addLoading,
    [businessLoading, activeBusinessId, addLoading]
  );

  const validate = () => {
    const next: { firstName?: string; lastName?: string; phone?: string } = {};
    if (!firstName.trim()) next.firstName = "First name is required.";
    if (!lastName.trim()) next.lastName = "Last name is required.";
    if (!phone.trim()) next.phone = "Phone is required.";
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  };

  const sendCreateStaff = async (allowRoleUpgrade: boolean) => {
    const response = await fetch("/api/staff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        business_id: activeBusinessId,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        phone: phone.trim(),
        role,
        allowRoleUpgrade,
      }),
    });

    const payload = (await response.json().catch(() => null)) as
      | StaffCreatePayload
      | null;

    return { response, payload };
  };

  const handleAddStaff = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    if (!validate()) return;
    if (!activeBusinessId) {
      setError("Select an active business before adding crew.");
      return;
    }

    setAddLoading(true);
    let { response, payload } = await sendCreateStaff(false);

    if (
      !response.ok &&
      payload?.code === "ROLE_UPGRADE_CONFIRM_REQUIRED" &&
      window.confirm(
        "This phone already belongs to a worker. Promote to manager and continue?"
      )
    ) {
      ({ response, payload } = await sendCreateStaff(true));
    }

    if (!response.ok) {
      setError(formatStaffError(payload));
      setAddLoading(false);
      return;
    }

    const staffName = `${firstName.trim()} ${lastName.trim()}`.trim();
    const resolvedRole = payload?.role === "manager" ? "manager" : "worker";
    setAddedStaff((prev) => [
      ...prev,
      {
        id: payload?.profile_id ?? `${Date.now()}`,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim(),
        role: resolvedRole,
        status: payload?.created ? "created" : "attached",
      },
    ]);

    if (payload?.created && payload.passcode) {
      setPasscodeModal({ staffName, passcode: payload.passcode });
    }

    setFirstName("");
    setLastName("");
    setPhone("");
    setRole("worker");
    setFieldErrors({});
    setAddLoading(false);
  };

  const handleCompleteStep = async () => {
    setError("");
    if (!activeBusinessId) {
      setError("Select an active business before continuing.");
      return;
    }

    setContinueLoading(true);
    try {
      const response = await fetch("/api/onboarding/step-2/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_id: activeBusinessId }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { error?: string; nextPath?: string }
        | null;

      if (!response.ok) {
        setError(payload?.error ?? "Unable to continue onboarding.");
        setContinueLoading(false);
        return;
      }

      const nextPath =
        typeof payload?.nextPath === "string" && payload.nextPath.startsWith("/")
          ? payload.nextPath
          : "/onboarding/step-3";
      router.push(nextPath);
      router.refresh();
    } catch {
      setError("Unable to continue onboarding.");
      setContinueLoading(false);
    }
  };

  return (
    <>
      {businesses.length > 1 && (
        <div className="mb-5">
          <label className="block text-[11px] font-bold text-text-muted uppercase tracking-widest mb-1.5">
            Active Business
          </label>
          <select
            value={activeBusinessId ?? ""}
            onChange={(event) => setActiveBusinessId(event.target.value)}
            className="w-full p-3 bg-bg border border-border rounded-lg text-text text-sm font-sans focus:border-accent outline-none"
          >
            {businesses.map((business) => (
              <option key={business.id} value={business.id}>
                {business.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <p className="text-xs text-text-muted mb-5">
        Active business:{" "}
        <span className="font-semibold text-text">
          {businessLoading
            ? "Loading..."
            : activeBusiness?.name ?? "No active business selected"}
        </span>
      </p>

      <form onSubmit={handleAddStaff} noValidate>
        <label className="block text-[11px] font-bold text-text-muted uppercase tracking-widest mb-1.5">
          First Name
        </label>
        <input
          type="text"
          value={firstName}
          onChange={(event) => setFirstName(event.target.value)}
          className="w-full p-3 bg-bg border border-border rounded-lg text-text text-sm font-sans mb-1.5 focus:border-accent outline-none"
          required
        />
        {fieldErrors.firstName && (
          <p className="text-red text-xs font-semibold mb-3">{fieldErrors.firstName}</p>
        )}

        <label className="block text-[11px] font-bold text-text-muted uppercase tracking-widest mb-1.5">
          Last Name
        </label>
        <input
          type="text"
          value={lastName}
          onChange={(event) => setLastName(event.target.value)}
          className="w-full p-3 bg-bg border border-border rounded-lg text-text text-sm font-sans mb-1.5 focus:border-accent outline-none"
          required
        />
        {fieldErrors.lastName && (
          <p className="text-red text-xs font-semibold mb-3">{fieldErrors.lastName}</p>
        )}

        <label className="block text-[11px] font-bold text-text-muted uppercase tracking-widest mb-1.5">
          Phone
        </label>
        <input
          type="tel"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          className="w-full p-3 bg-bg border border-border rounded-lg text-text text-sm font-sans mb-1.5 focus:border-accent outline-none"
          placeholder="(555) 123-4567"
          required
        />
        {fieldErrors.phone && (
          <p className="text-red text-xs font-semibold mb-3">{fieldErrors.phone}</p>
        )}

        <label className="block text-[11px] font-bold text-text-muted uppercase tracking-widest mb-2">
          Role
        </label>
        <div className="flex gap-2 mb-4">
          <button
            type="button"
            onClick={() => setRole("worker")}
            className={`flex-1 py-2.5 rounded-lg border text-sm font-semibold transition-colors ${
              role === "worker"
                ? "border-accent text-accent bg-accent/[0.08]"
                : "border-border text-text-muted"
            }`}
          >
            Worker
          </button>
          <button
            type="button"
            onClick={() => setRole("manager")}
            className={`flex-1 py-2.5 rounded-lg border text-sm font-semibold transition-colors ${
              role === "manager"
                ? "border-accent text-accent bg-accent/[0.08]"
                : "border-border text-text-muted"
            }`}
          >
            Manager
          </button>
        </div>

        <button
          type="submit"
          disabled={!canSubmitStaff}
          className="w-full p-3.5 bg-gradient-to-br from-accent to-accent-dark rounded-xl text-bg text-[15px] font-extrabold shadow-[0_4px_20px_var(--color-accent-glow)] hover:shadow-[0_6px_28px_var(--color-accent-glow)] hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {addLoading ? "Adding..." : "Add"}
        </button>
      </form>

      {addedStaff.length > 0 && (
        <div className="mt-6 rounded-xl border border-border bg-bg p-4">
          <h3 className="text-sm font-bold text-text mb-2.5">Added in this step</h3>
          <div className="space-y-2">
            {addedStaff.map((staff) => (
              <div
                key={`${staff.id}-${staff.phone}-${staff.status}`}
                className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
              >
                <div>
                  <p className="text-sm font-semibold text-text">
                    {staff.firstName} {staff.lastName}
                  </p>
                  <p className="text-xs text-text-muted">
                    {staff.phone} • {staff.role}
                  </p>
                </div>
                <span className="text-[11px] font-bold uppercase tracking-wide text-accent">
                  {staff.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && (
        <p className="text-red text-sm font-semibold mt-5 mb-3 rounded-lg border border-red-border bg-red-dark px-3 py-2">
          {error}
        </p>
      )}

      <div className="mt-6 flex flex-col sm:flex-row gap-2.5">
        <button
          type="button"
          onClick={handleCompleteStep}
          disabled={continueLoading || businessLoading}
          className="flex-1 py-3 border border-border rounded-xl text-text-muted text-sm font-semibold hover:bg-bg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {continueLoading ? "Please wait..." : "Skip for now"}
        </button>
        <button
          type="button"
          onClick={handleCompleteStep}
          disabled={continueLoading || businessLoading}
          className="flex-1 py-3 bg-gradient-to-br from-accent to-accent-dark rounded-xl text-bg text-sm font-extrabold shadow-[0_4px_20px_var(--color-accent-glow)] hover:-translate-y-0.5 transition-all disabled:opacity-50"
        >
          {continueLoading ? "Please wait..." : "Continue"}
        </button>
      </div>

      {passcodeModal && (
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center p-5"
          onClick={() => setPasscodeModal(null)}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            onClick={(event) => event.stopPropagation()}
            className="relative bg-card rounded-2xl border border-border w-full max-w-[420px] p-6"
          >
            <h3 className="text-[18px] font-black tracking-tight text-text mb-1">
              Passcode (shown once)
            </h3>
            <p className="text-sm text-text-muted mb-4">{passcodeModal.staffName}</p>
            <p className="rounded-xl border border-border bg-bg px-4 py-3 text-center text-[28px] font-black tracking-[0.16em] text-accent">
              {passcodeModal.passcode}
            </p>
            <button
              type="button"
              onClick={() => setPasscodeModal(null)}
              className="w-full mt-4 py-3 border border-border rounded-xl text-sm font-semibold text-text-muted hover:bg-bg transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
