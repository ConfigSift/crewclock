"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Phone, User, AlertTriangle } from "lucide-react";
import { signOut } from "@/lib/actions";
import { useAppStore } from "@/lib/store";
import { useBusiness } from "@/contexts/BusinessContext";
import BusinessSwitcher from "@/components/dashboard/BusinessSwitcher";
import SubscriptionCard from "@/components/dashboard/SubscriptionCard";

function roleLabel(role?: string | null) {
  if (role === "admin") return "Admin";
  if (role === "manager") return "Manager";
  return "Worker";
}

export default function AccountPage() {
  const router = useRouter();
  const profile = useAppStore((s) => s.profile);
  const {
    businesses,
    activeBusiness,
    activeBusinessId,
    selectionHint,
    setActiveBusinessId,
    refreshBusinesses,
  } = useBusiness();
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleteSuccess, setDeleteSuccess] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [billingFlowMessage, setBillingFlowMessage] = useState<{
    tone: "success" | "warning";
    text: string;
  } | null>(null);
  const [subscriptionRefreshToken, setSubscriptionRefreshToken] = useState(0);

  const badgeClass = useMemo(() => {
    if (profile?.role === "admin") {
      return "text-accent border-accent/40 bg-accent/[0.12]";
    }
    if (profile?.role === "manager") {
      return "text-green border-green-border bg-green-dark";
    }
    return "text-text-muted border-border bg-bg";
  }, [profile?.role]);

  const shouldPromptSelection =
    businesses.length > 1 && (!activeBusinessId || Boolean(selectionHint));
  const canDeleteBusiness = profile?.role === "admin" && !!activeBusiness;
  const deleteNameMatches =
    !!activeBusiness && deleteConfirmName.trim() === activeBusiness.name;

  const handleSignOut = async () => {
    await signOut();
    router.push("/login");
    router.refresh();
  };

  const closeDeleteModal = () => {
    if (deleting) return;
    setShowDeleteModal(false);
    setDeleteConfirmName("");
    setDeleteError("");
  };

  const handleDeleteBusiness = async () => {
    if (!activeBusiness) {
      setDeleteError("No active business selected.");
      return;
    }

    if (!deleteNameMatches) {
      setDeleteError("Business name confirmation does not match.");
      return;
    }

    setDeleting(true);
    setDeleteError("");
    setDeleteSuccess("");

    const nextBusinessId =
      businesses.find((business) => business.id !== activeBusiness.id)?.id ?? null;

    const response = await fetch(`/api/businesses/${activeBusiness.id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
    });

    const payload = (await response.json().catch(() => null)) as
      | {
          ok?: boolean;
          error?: string;
          deletedBusinessId?: string;
          deletedStaffCount?: number;
        }
      | null;

    if (!response.ok || !payload?.ok) {
      setDeleteError(payload?.error ?? "Failed to delete business.");
      setDeleting(false);
      return;
    }

    if (nextBusinessId) {
      setActiveBusinessId(nextBusinessId);
    }

    await refreshBusinesses();

    const deletedStaffCount =
      typeof payload.deletedStaffCount === "number" ? payload.deletedStaffCount : 0;

    if (nextBusinessId) {
      setDeleteSuccess(
        `Business deleted. Removed ${deletedStaffCount} staff account${
          deletedStaffCount === 1 ? "" : "s"
        } with no other memberships.`
      );
    } else {
      setDeleteSuccess(
        `Business deleted. Removed ${deletedStaffCount} staff account${
          deletedStaffCount === 1 ? "" : "s"
        } with no other memberships. No businesses remain yet.`
      );
    }

    setDeleting(false);
    setShowDeleteModal(false);
    setDeleteConfirmName("");
  };

  return (
    <div className="animate-fade-in">
      <h1 className="text-[22px] font-extrabold tracking-tight mb-5">Account</h1>

      {deleteSuccess && (
        <div className="mb-4 rounded-xl border border-green-border bg-green-dark px-4 py-3">
          <p className="text-[12px] text-green font-semibold">{deleteSuccess}</p>
        </div>
      )}

      {billingFlowMessage && (
        <div
          className={`mb-4 rounded-xl px-4 py-3 ${
            billingFlowMessage.tone === "success"
              ? "border border-green-border bg-green-dark"
              : "border border-accent/30 bg-accent/[0.09]"
          }`}
        >
          <p
            className={`text-[12px] font-semibold ${
              billingFlowMessage.tone === "success" ? "text-green" : "text-accent"
            }`}
          >
            {billingFlowMessage.text}
          </p>
        </div>
      )}

      {shouldPromptSelection && (
        <div className="mb-4 rounded-xl border border-accent/30 bg-accent/[0.09] px-4 py-3">
          <p className="text-[12px] text-accent font-semibold">
            You have access to multiple businesses. Confirm your active business below.
          </p>
        </div>
      )}

      <div className="bg-card rounded-2xl border border-border p-5 mb-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-[10px] bg-bg border border-border flex items-center justify-center">
            <User size={18} className="text-text-muted" />
          </div>
          <div className="min-w-0">
            <p className="text-base font-bold truncate">
              {profile?.first_name} {profile?.last_name}
            </p>
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[10px] uppercase tracking-widest font-bold ${badgeClass}`}
            >
              {roleLabel(profile?.role)}
            </span>
          </div>
        </div>

        <p className="text-[13px] text-text-muted flex items-center gap-1.5">
          <Phone size={13} /> {profile?.phone || "No phone"}
        </p>
      </div>

      <div className="bg-card rounded-2xl border border-border p-5 mb-4">
        <p className="text-[11px] font-bold text-text-muted uppercase tracking-widest mb-3">
          Current Business
        </p>
        <BusinessSwitcher
          onCheckoutSuccess={(business) => {
            setBillingFlowMessage({
              tone: "success",
              text: `Subscription active for ${business.name}.`,
            });
            setSubscriptionRefreshToken((current) => current + 1);
          }}
          onCheckoutCanceled={(business) => {
            setBillingFlowMessage({
              tone: "warning",
              text: `${business.name} was not created because checkout was canceled.`,
            });
            setSubscriptionRefreshToken((current) => current + 1);
          }}
        />
      </div>

      <SubscriptionCard
        businessId={activeBusinessId}
        selectedBusinessName={activeBusiness?.name ?? null}
        canManageBilling={profile?.role === "admin"}
        refreshToken={subscriptionRefreshToken}
      />

      <button
        type="button"
        onClick={handleSignOut}
        className="inline-flex items-center gap-1.5 px-4 py-2.5 border border-border rounded-xl text-[13px] font-semibold text-text-muted hover:bg-card hover:text-text transition-colors"
      >
        <LogOut size={14} /> Sign Out
      </button>

      {profile?.role === "admin" && (
        <div className="mt-6 rounded-2xl border border-red-border bg-red-dark p-5">
          <p className="text-[11px] font-bold text-red uppercase tracking-widest mb-2">
            Danger Zone
          </p>
          <p className="text-[12px] text-text-muted mb-4 leading-relaxed">
            Deleting a business permanently removes projects, time entries, and memberships
            in that business. Staff with no remaining business memberships will also be
            deleted.
          </p>
          <button
            type="button"
            onClick={() => {
              setDeleteError("");
              setShowDeleteModal(true);
            }}
            disabled={!canDeleteBusiness}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 border border-red-border rounded-xl text-[13px] font-semibold text-red hover:bg-red/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <AlertTriangle size={14} /> Delete Business
          </button>
          {!activeBusiness && (
            <p className="mt-2 text-[11px] text-text-muted">
              Select a business first before deleting.
            </p>
          )}
        </div>
      )}

      {showDeleteModal && (
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center p-5"
          onClick={closeDeleteModal}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            onClick={(event) => event.stopPropagation()}
            className="relative bg-card rounded-2xl border border-border w-full max-w-[520px] max-h-[90vh] overflow-auto animate-scale-in"
          >
            <div className="flex justify-between items-center px-6 py-4 border-b border-border">
              <h3 className="text-[17px] font-bold text-red">Delete Business</h3>
              <button
                type="button"
                onClick={closeDeleteModal}
                disabled={deleting}
                className="text-text-muted hover:text-text text-sm font-semibold disabled:opacity-50"
              >
                Close
              </button>
            </div>

            <div className="px-6 py-5">
              <p className="text-sm text-text-muted mb-3 leading-relaxed">
                This permanently deletes{" "}
                <span className="font-bold text-text">{activeBusiness?.name}</span> and all
                associated projects, time entries, and memberships.
              </p>
              <p className="text-sm text-text-muted mb-3 leading-relaxed">
                Staff who are not members of any other business will be deleted from the
                system.
              </p>
              <p className="text-sm text-text-muted mb-2">
                Type{" "}
                <span className="font-bold text-text">{activeBusiness?.name ?? "-"}</span> to
                confirm:
              </p>
              <input
                className="w-full p-3 bg-bg border border-border rounded-lg text-text text-sm mb-3.5 outline-none focus:border-red"
                value={deleteConfirmName}
                onChange={(event) => setDeleteConfirmName(event.target.value)}
                disabled={deleting}
                placeholder={activeBusiness?.name ?? "Business name"}
              />

              {deleteError && (
                <p className="text-red text-sm font-semibold mb-3 rounded-lg border border-red-border bg-red-dark px-3 py-2">
                  {deleteError}
                </p>
              )}

              <div className="flex gap-2.5">
                <button
                  type="button"
                  onClick={closeDeleteModal}
                  disabled={deleting}
                  className="flex-1 py-3 border border-border rounded-xl text-text-muted text-sm font-semibold hover:bg-bg transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDeleteBusiness}
                  disabled={deleting || !deleteNameMatches}
                  className="flex-[2] py-3 border border-red-border bg-red-dark rounded-xl text-red text-sm font-extrabold hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {deleting ? "Deleting..." : "Delete Business"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
