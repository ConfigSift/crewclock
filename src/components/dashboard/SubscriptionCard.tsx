"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BillingStatus } from "@/types/database";

type SubscriptionCardProps = {
  businessId: string | null;
  selectedBusinessName?: string | null;
  canManageBilling?: boolean;
  refreshToken?: number;
};

type BusinessBillingSnapshot = {
  id: string;
  business_id?: string;
  name?: string | null;
  billing_status: BillingStatus;
  plan_label: string;
  stripe_price_id: string | null;
  stripe_subscription_id: string | null;
  cancel_at_period_end: boolean;
  current_period_start: string | number | null;
  current_period_end: string | number | null;
  billing_started_at: string | null;
  billing_canceled_at: string | null;
};

type BillingActionPayload = {
  ok?: boolean;
  error?: string;
  cancel_at_period_end?: boolean;
  current_period_end?: string | number | null;
  current_period_start?: string | number | null;
  billing_status?: BillingStatus;
};

function labelForStatus(status: BillingStatus): string {
  return status.replace("_", " ");
}

function statusBadgeClass(status: BillingStatus): string {
  if (status === "active" || status === "trialing") {
    return "text-green border-green-border bg-green-dark";
  }
  if (status === "past_due" || status === "unpaid") {
    return "text-red border-red-border bg-red-dark";
  }
  return "text-text-muted border-border bg-bg";
}

function formatDate(value: string | number | null | undefined): string {
  if (!value) return "";
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function SubscriptionCard({
  businessId,
  selectedBusinessName,
  canManageBilling = false,
  refreshToken = 0,
}: SubscriptionCardProps) {
  const [snapshot, setSnapshot] = useState<BusinessBillingSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");
  const actionErrorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isDev = process.env.NODE_ENV !== "production";

  const fetchSubscription = useCallback(
    async (targetBusinessId: string): Promise<BusinessBillingSnapshot | null> => {
      const response = await fetch(
        `/api/businesses/${encodeURIComponent(targetBusinessId)}/billing`,
        { cache: "no-store" }
      );
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; business?: BusinessBillingSnapshot; error?: string }
        | null;

      if (!response.ok || payload?.ok !== true || !payload?.business) {
        setError(payload?.error ?? "Unable to load subscription details.");
        if (isDev) {
          console.log("[subscription] fetched business:", null);
        }
        return null;
      }

      const typed = payload.business;
      if (!typed.id) {
        setError("Business not found.");
        if (isDev) {
          console.log("[subscription] fetched business:", null);
        }
        return null;
      }

      if (isDev) {
        console.log("[subscription] fetched business:", {
          id: typed.id,
          cancel_at_period_end: typed.cancel_at_period_end,
          current_period_end: typed.current_period_end,
        });
      }

      return typed;
    },
    [isDev]
  );

  const refreshSubscription = useCallback(
    async (targetBusinessId: string): Promise<BusinessBillingSnapshot | null> => {
      const fetched = await fetchSubscription(targetBusinessId);
      if (!fetched) return null;
      setSnapshot(fetched);
      setError("");
      return fetched;
    },
    [fetchSubscription]
  );

  const showTimedActionError = useCallback((message: string) => {
    setActionError(message);
    if (actionErrorTimeoutRef.current) {
      clearTimeout(actionErrorTimeoutRef.current);
    }
    actionErrorTimeoutRef.current = setTimeout(() => {
      setActionError("");
      actionErrorTimeoutRef.current = null;
    }, 6000);
  }, []);

  useEffect(() => {
    return () => {
      if (actionErrorTimeoutRef.current) {
        clearTimeout(actionErrorTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!businessId) {
      setSnapshot(null);
      setLoading(false);
      setError("");
      setActionError("");
      setActionSuccess("");
      if (isDev) {
        console.log("[subscription] activeBusinessId:", businessId);
        console.log("[subscription] selectedBusinessName:", selectedBusinessName ?? null);
      }
      return;
    }

    let active = true;
    setLoading(true);
    setError("");

    if (isDev) {
      console.log("[subscription] activeBusinessId:", businessId);
      console.log("[subscription] selectedBusinessName:", selectedBusinessName ?? null);
    }

    const run = async () => {
      const fetched = await fetchSubscription(businessId);

      if (!active) return;

      if (!fetched) {
        setSnapshot(null);
        setLoading(false);
        return;
      }

      setSnapshot(fetched);
      setLoading(false);
    };

    void run();

    return () => {
      active = false;
    };
  }, [businessId, fetchSubscription, isDev, refreshToken, selectedBusinessName]);

  const planLabel = useMemo(() => snapshot?.plan_label ?? "Not selected", [snapshot?.plan_label]);
  const startedAt = useMemo(
    () => formatDate(snapshot?.billing_started_at ?? null),
    [snapshot?.billing_started_at]
  );
  const canceledAt = useMemo(
    () => formatDate(snapshot?.billing_canceled_at ?? null),
    [snapshot?.billing_canceled_at]
  );
  const statusLabel = useMemo(
    () => (snapshot ? labelForStatus(snapshot.billing_status) : ""),
    [snapshot]
  );
  const autoRenewIsOff = snapshot?.cancel_at_period_end ?? false;
  const periodEndRaw = snapshot?.current_period_end ?? null;
  const dateLabel = autoRenewIsOff ? "Access ends on" : "Renews on";
  const dateValue = formatDate(periodEndRaw);
  const isActiveOrTrialing =
    snapshot?.billing_status === "active" || snapshot?.billing_status === "trialing";
  const canManageAutoRenew =
    canManageBilling &&
    isActiveOrTrialing &&
    Boolean(snapshot?.stripe_subscription_id);

  useEffect(() => {
    if (!snapshot?.stripe_subscription_id) return;
    if (dateValue) return;
    if (isDev) {
      console.warn("[subscription] current_period_end is missing for active subscription", snapshot);
    }
  }, [dateValue, isDev, snapshot]);

  const handleToggleAutoRenew = async (cancelAtPeriodEnd: boolean) => {
    if (!businessId) {
      showTimedActionError("Select a business first.");
      return;
    }
    if (!snapshot?.stripe_subscription_id) {
      showTimedActionError("No Stripe subscription is set for this business.");
      return;
    }

    setActionLoading(true);
    setActionError("");
    setActionSuccess("");
    if (isDev) {
      console.log("[subscription] before action:", {
        cancel_at_period_end: snapshot.cancel_at_period_end,
        current_period_end: snapshot.current_period_end,
      });
    }

    try {
      const response = await fetch(
        cancelAtPeriodEnd
          ? "/api/billing/cancel-renewal"
          : "/api/billing/resume-renewal",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ business_id: businessId }),
          cache: "no-store",
        }
      );

      const payload = (await response.json().catch(() => null)) as
        | BillingActionPayload
        | null;
      if (isDev) {
        console.log("[billing] response", response.status, payload);
      }

      if (!response.ok || !payload?.ok) {
        showTimedActionError(payload?.error ?? `HTTP ${response.status}`);
        return;
      }

      const patchedCancelAtPeriodEnd = payload.cancel_at_period_end ?? cancelAtPeriodEnd;
      const patchedPeriodEnd = payload.current_period_end ?? snapshot.current_period_end;
      const patchedPeriodStart = payload.current_period_start ?? snapshot.current_period_start;
      const patchedBillingStatus = payload.billing_status ?? snapshot.billing_status;

      setSnapshot((current) => {
        if (!current) return current;
        return {
          ...current,
          cancel_at_period_end: patchedCancelAtPeriodEnd,
          current_period_end: patchedPeriodEnd,
          current_period_start: patchedPeriodStart,
          billing_status: patchedBillingStatus,
        };
      });

      if (actionErrorTimeoutRef.current) {
        clearTimeout(actionErrorTimeoutRef.current);
        actionErrorTimeoutRef.current = null;
      }

      if (isDev) {
        console.log("[billing] afterPatch", {
          cancel_at_period_end: patchedCancelAtPeriodEnd,
          current_period_end: patchedPeriodEnd,
        });
      }

      const nextPeriodEnd = formatDate(patchedPeriodEnd);
      setActionSuccess(
        patchedCancelAtPeriodEnd
          ? `Auto-renew canceled. Access remains through${
              nextPeriodEnd
                ? ` ${nextPeriodEnd}.`
                : " end of current period."
            }`
          : `Auto-renew re-enabled.${
              nextPeriodEnd
                ? ` Next renewal on ${nextPeriodEnd}.`
                : " Access remains through end of current period."
            }`
      );

      await refreshSubscription(businessId);
    } catch {
      showTimedActionError("Unable to update renewal settings.");
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="bg-card rounded-2xl border border-border p-5 mb-4">
      <p className="text-[11px] font-bold text-text-muted uppercase tracking-widest mb-3">
        Subscription
      </p>

      {!businessId && (
        <p className="text-[12px] text-text-muted">Select a business to view billing.</p>
      )}

      {businessId && loading && (
        <p className="text-[12px] text-text-muted">Loading subscription details...</p>
      )}

      {businessId && !loading && error && (
        <p className="text-red text-sm font-semibold rounded-lg border border-red-border bg-red-dark px-3 py-2">
          {error}
        </p>
      )}

      {businessId && !loading && !error && snapshot && (
        <>
          <div className="space-y-2.5 text-[13px]">
            <div className="flex items-center justify-between gap-3">
              <span className="text-text-muted">Plan</span>
              <span className="font-semibold text-text">{planLabel}</span>
            </div>

            <div className="flex items-center justify-between gap-3">
              <span className="text-text-muted">Status</span>
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[10px] uppercase tracking-widest font-bold ${statusBadgeClass(
                  snapshot.billing_status
                )}`}
              >
                {statusLabel}
              </span>
            </div>

            <div className="flex items-center justify-between gap-3 pt-1">
              <span className="text-text-muted">{dateLabel}</span>
              <span className="font-semibold text-text">{dateValue}</span>
            </div>

            <div className="flex items-center justify-between gap-3 pt-1">
              <span className="text-text-muted">Auto-renew</span>
              <span className="font-semibold text-text">{autoRenewIsOff ? "OFF" : "ON"}</span>
            </div>

            {(startedAt || canceledAt) && (
              <div className="pt-1 text-[12px] text-text-muted">
                {startedAt && <p>Started: {startedAt}</p>}
                {canceledAt && <p>Canceled: {canceledAt}</p>}
              </div>
            )}
          </div>

          {actionSuccess && (
            <p className="text-green text-sm font-semibold mt-3 rounded-lg border border-green-border bg-green-dark px-3 py-2">
              {actionSuccess}
            </p>
          )}
          {actionError && (
            <p className="text-red text-sm font-semibold mt-3 rounded-lg border border-red-border bg-red-dark px-3 py-2">
              {actionError}
            </p>
          )}

          {canManageAutoRenew && (
            <button
              type="button"
              onClick={() => handleToggleAutoRenew(!autoRenewIsOff)}
              disabled={actionLoading}
              className="mt-3 inline-flex items-center justify-center px-3 py-2 border border-border rounded-lg text-[12px] font-semibold text-text-muted hover:bg-bg hover:text-text transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {actionLoading
                ? "Please wait..."
                : autoRenewIsOff
                  ? "Resume auto-renew"
                  : "Cancel auto-renew"}
            </button>
          )}

          {canManageBilling && snapshot.billing_status === "inactive" && (
            <Link
              href="/onboarding/step-3"
              className="mt-3 inline-flex items-center justify-center px-3 py-2 border border-border rounded-lg text-[12px] font-semibold text-text-muted hover:bg-bg hover:text-text transition-colors"
            >
              Manage billing
            </Link>
          )}
        </>
      )}
    </div>
  );
}
