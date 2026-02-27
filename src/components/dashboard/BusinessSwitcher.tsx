"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  Plus,
  X,
} from "lucide-react";
import { useBusiness } from "@/contexts/BusinessContext";
import { useAppStore } from "@/lib/store";
import EmbeddedCheckoutModal from "@/components/billing/EmbeddedCheckoutModal";

const emptyCreateForm = {
  name: "",
  address_line1: "",
  city: "",
  state: "",
  postal_code: "",
  country: "",
};

type BusinessSwitcherProps = {
  mobile?: boolean;
  onCheckoutSuccess?: (business: { id: string; name: string }) => void;
  onCheckoutCanceled?: (draft: { name: string }) => void;
};

export default function BusinessSwitcher({
  mobile = false,
  onCheckoutSuccess,
  onCheckoutCanceled,
}: BusinessSwitcherProps) {
  const profile = useAppStore((s) => s.profile);
  const {
    businesses,
    activeBusinessId,
    setActiveBusinessId,
    loading,
    refreshBusinesses,
  } = useBusiness();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState(emptyCreateForm);
  const [createError, setCreateError] = useState("");
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [billingWarning, setBillingWarning] = useState<string | null>(null);
  const [checkoutModalOpen, setCheckoutModalOpen] = useState(false);
  const [pendingDraft, setPendingDraft] = useState<typeof emptyCreateForm | null>(null);

  const isAdmin = profile?.role === "admin";

  useEffect(() => {
    if (!toastMessage) return;
    const timeout = window.setTimeout(() => setToastMessage(null), 3000);
    return () => window.clearTimeout(timeout);
  }, [toastMessage]);

  const closeCreateModal = () => {
    setShowCreateModal(false);
    setCreateError("");
    setCreateForm(emptyCreateForm);
  };

  const handleOpenCheckoutForDraft = () => {
    if (!createForm.name.trim()) {
      setCreateError("Business name is required.");
      return;
    }

    setCreateError("");
    setPendingDraft({
      name: createForm.name.trim(),
      address_line1: createForm.address_line1.trim(),
      city: createForm.city.trim(),
      state: createForm.state.trim(),
      postal_code: createForm.postal_code.trim(),
      country: createForm.country.trim(),
    });
    setShowCreateModal(false);
    setCheckoutModalOpen(true);
    setBillingWarning(null);
    setToastMessage("Continue to payment to create this business.");
  };

  const labelClass = mobile
    ? "text-[10px] font-bold text-bg/80 uppercase tracking-widest mb-1"
    : "text-[10px] font-bold text-text-muted uppercase tracking-widest mb-1";
  const selectWrapClass = mobile
    ? "relative rounded-lg border border-bg/30 bg-bg/10 backdrop-blur-sm"
    : "relative rounded-lg border border-border bg-bg";
  const selectClass = mobile
    ? "w-full appearance-none bg-transparent px-3 py-2.5 pr-8 text-[13px] font-semibold text-bg outline-none"
    : "w-full appearance-none bg-transparent px-3 py-2.5 pr-8 text-[13px] font-semibold text-text outline-none";
  const iconClass = mobile
    ? "pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-bg/80"
    : "pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted";
  const createButtonClass = mobile
    ? "mt-2 inline-flex items-center gap-1.5 rounded-lg border border-bg/40 bg-bg/15 px-2.5 py-1.5 text-[11px] font-bold text-bg hover:bg-bg/25 transition-colors"
    : "mt-2 inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-[11px] font-bold text-text-muted hover:text-text hover:bg-bg transition-colors";

  return (
    <>
      <div>
        <p className={labelClass}>Business</p>
        <div className={selectWrapClass}>
          <select
            className={selectClass}
            value={activeBusinessId ?? ""}
            onChange={(event) => {
              const selectedId = event.target.value;
              setActiveBusinessId(selectedId);
            }}
            disabled={loading || businesses.length === 0}
            aria-label="Select active business"
          >
            {loading ? (
              <option value="">Loading businesses...</option>
            ) : businesses.length === 0 ? (
              <option value="">No business access</option>
            ) : (
              businesses.map((business) => (
                <option key={business.id} value={business.id}>
                  {business.name}
                </option>
              ))
            )}
          </select>
          <ChevronDown size={14} className={iconClass} />
        </div>
        {isAdmin && (
          <button
            type="button"
            onClick={() => {
              setCreateError("");
              setShowCreateModal(true);
            }}
            className={createButtonClass}
          >
            <Plus size={13} /> New Business
          </button>
        )}

        {billingWarning && (
          <p className="mt-2 text-[12px] font-semibold text-accent rounded-lg border border-accent/30 bg-accent/[0.09] px-3 py-2">
            {billingWarning}
          </p>
        )}
      </div>

      {showCreateModal && (
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center p-5"
          onClick={closeCreateModal}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            onClick={(event) => event.stopPropagation()}
            className="relative bg-card rounded-2xl border border-border w-full max-w-[520px] max-h-[90vh] overflow-auto animate-scale-in"
          >
            <div className="flex justify-between items-center px-6 py-4 border-b border-border">
              <h3 className="text-[17px] font-bold">Create New Business</h3>
              <button
                type="button"
                onClick={closeCreateModal}
                className="text-text-muted hover:text-text p-1"
              >
                <X size={20} />
              </button>
            </div>

            <div className="px-6 py-5">
              <label className="block text-[11px] font-bold text-text-muted uppercase tracking-widest mb-1.5">
                Business Name *
              </label>
              <input
                className="w-full p-3 bg-bg border border-border rounded-lg text-text text-sm mb-3.5 outline-none focus:border-accent"
                placeholder="e.g. Alpine Framing North"
                value={createForm.name}
                onChange={(event) =>
                  setCreateForm((prev) => ({ ...prev, name: event.target.value }))
                }
              />

              <label className="block text-[11px] font-bold text-text-muted uppercase tracking-widest mb-1.5">
                Address Line 1
              </label>
              <input
                className="w-full p-3 bg-bg border border-border rounded-lg text-text text-sm mb-3.5 outline-none focus:border-accent"
                placeholder="123 Main St"
                value={createForm.address_line1}
                onChange={(event) =>
                  setCreateForm((prev) => ({
                    ...prev,
                    address_line1: event.target.value,
                  }))
                }
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-3.5">
                <div>
                  <label className="block text-[11px] font-bold text-text-muted uppercase tracking-widest mb-1.5">
                    City
                  </label>
                  <input
                    className="w-full p-3 bg-bg border border-border rounded-lg text-text text-sm outline-none focus:border-accent"
                    placeholder="Denver"
                    value={createForm.city}
                    onChange={(event) =>
                      setCreateForm((prev) => ({ ...prev, city: event.target.value }))
                    }
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-text-muted uppercase tracking-widest mb-1.5">
                    State
                  </label>
                  <input
                    className="w-full p-3 bg-bg border border-border rounded-lg text-text text-sm outline-none focus:border-accent"
                    placeholder="CO"
                    value={createForm.state}
                    onChange={(event) =>
                      setCreateForm((prev) => ({ ...prev, state: event.target.value }))
                    }
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-3.5">
                <div>
                  <label className="block text-[11px] font-bold text-text-muted uppercase tracking-widest mb-1.5">
                    Postal Code
                  </label>
                  <input
                    className="w-full p-3 bg-bg border border-border rounded-lg text-text text-sm outline-none focus:border-accent"
                    placeholder="80202"
                    value={createForm.postal_code}
                    onChange={(event) =>
                      setCreateForm((prev) => ({
                        ...prev,
                        postal_code: event.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-text-muted uppercase tracking-widest mb-1.5">
                    Country
                  </label>
                  <input
                    className="w-full p-3 bg-bg border border-border rounded-lg text-text text-sm outline-none focus:border-accent"
                    placeholder="United States"
                    value={createForm.country}
                    onChange={(event) =>
                      setCreateForm((prev) => ({ ...prev, country: event.target.value }))
                    }
                  />
                </div>
              </div>

              {createError && (
                <p className="text-red text-sm font-semibold mb-3 rounded-lg border border-red-border bg-red-dark px-3 py-2">
                  {createError}
                </p>
              )}

              <div className="flex gap-2.5">
                <button
                  type="button"
                  onClick={closeCreateModal}
                  className="flex-1 py-3 border border-border rounded-xl text-text-muted text-sm font-semibold hover:bg-bg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleOpenCheckoutForDraft}
                  className="flex-[2] py-3 bg-gradient-to-br from-accent to-accent-dark rounded-xl text-bg text-sm font-extrabold shadow-[0_4px_20px_var(--color-accent-glow)] hover:-translate-y-0.5 transition-all"
                >
                  Continue to Payment
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {toastMessage && (
        <div className="fixed top-4 right-4 z-[1100]">
          <div className="animate-slide-in flex items-center gap-2 rounded-lg border border-green-border bg-green-dark px-3 py-2">
            <CheckCircle2 size={14} className="text-green" />
            <p className="text-[12px] font-semibold text-green">{toastMessage}</p>
          </div>
        </div>
      )}

      <EmbeddedCheckoutModal
        open={checkoutModalOpen}
        intent="new_business"
        businessName={pendingDraft?.name ?? null}
        businessDraft={pendingDraft}
        returnPath="/dashboard/account"
        onClose={() => {
          setCheckoutModalOpen(false);
        }}
        onCancel={() => {
          const draftName = pendingDraft?.name?.trim() ?? "Business";
          setBillingWarning(`${draftName} was not created. Complete checkout to create it.`);
          setCreateForm(
            pendingDraft ?? {
              ...emptyCreateForm,
            }
          );
          setShowCreateModal(true);
          onCheckoutCanceled?.({ name: draftName });
        }}
        onSuccess={async ({ sessionId }) => {
          const response = await fetch("/api/businesses/complete-from-checkout", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ checkout_session_id: sessionId }),
            cache: "no-store",
          });
          const payload = (await response.json().catch(() => null)) as
            | {
                error?: string;
                business?: { id?: string; name?: string };
              }
            | null;

          const createdBusinessId = payload?.business?.id;
          const createdBusinessName = payload?.business?.name;
          if (
            !response.ok ||
            typeof createdBusinessId !== "string" ||
            typeof createdBusinessName !== "string"
          ) {
            throw new Error(payload?.error ?? "Unable to create business from checkout.");
          }

          await refreshBusinesses();
          setActiveBusinessId(createdBusinessId);
          setBillingWarning(null);
          setPendingDraft(null);
          setCreateForm(emptyCreateForm);
          setToastMessage("Business created and subscribed.");
          onCheckoutSuccess?.({ id: createdBusinessId, name: createdBusinessName });
        }}
      />
    </>
  );
}
