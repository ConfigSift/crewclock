"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type BillingPlan = "monthly" | "annual";
type BillingStatus =
  | "inactive"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | null;

type CreateCheckoutPayload = {
  clientSecret?: string;
  sessionId?: string;
  error?: string;
};

type CheckoutStatusPayload = {
  complete?: boolean;
  nextPath?: string;
  billingStatus?: BillingStatus;
  error?: string;
};

type StripeEmbeddedCheckoutInstance = {
  mount: (selector: string | HTMLElement) => void;
  destroy?: () => void;
  unmount?: () => void;
};

type StripeClient = {
  initEmbeddedCheckout: (options: {
    clientSecret: string;
  }) => Promise<StripeEmbeddedCheckoutInstance>;
};

type StripeConstructor = (publishableKey: string) => StripeClient;

type EmbeddedCheckoutModalProps = {
  open: boolean;
  businessId: string | null;
  businessName?: string | null;
  onClose: () => void;
  onCancel?: () => void;
  onSuccess?: (payload: {
    businessId: string;
    businessName?: string | null;
    billingStatus: BillingStatus;
    sessionId: string;
    plan: BillingPlan;
  }) => Promise<void> | void;
  returnPath?: string;
  initialPlan?: BillingPlan;
};

declare global {
  interface Window {
    Stripe?: StripeConstructor;
  }
}

const PLAN_OPTIONS: Array<{
  id: BillingPlan;
  title: string;
  price: string;
  period: string;
  badge?: string;
}> = [
  {
    id: "monthly",
    title: "Monthly",
    price: "$19.99",
    period: "/month",
  },
  {
    id: "annual",
    title: "Annual",
    price: "$199.99",
    period: "/year",
    badge: "Save ~17%",
  },
];

let stripeScriptPromise: Promise<void> | null = null;

function loadStripeScript(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Stripe script can only load in the browser."));
  }

  if (window.Stripe) {
    return Promise.resolve();
  }

  if (stripeScriptPromise) {
    return stripeScriptPromise;
  }

  stripeScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(
      'script[src="https://js.stripe.com/v3/"]'
    ) as HTMLScriptElement | null;

    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("Failed to load Stripe.js.")),
        { once: true }
      );
      return;
    }

    const script = document.createElement("script");
    script.src = "https://js.stripe.com/v3/";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Stripe.js."));
    document.head.appendChild(script);
  });

  return stripeScriptPromise;
}

function EmbeddedCheckoutMount({
  clientSecret,
  publishableKey,
}: {
  clientSecret: string;
  publishableKey: string;
}) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [mountError, setMountError] = useState("");

  useEffect(() => {
    let active = true;
    let embedded: StripeEmbeddedCheckoutInstance | null = null;

    const run = async () => {
      try {
        await loadStripeScript();
        if (!active) return;

        const stripeFactory = window.Stripe;
        if (!stripeFactory) {
          throw new Error("Stripe.js is unavailable.");
        }

        const stripe = stripeFactory(publishableKey);
        embedded = await stripe.initEmbeddedCheckout({ clientSecret });
        if (!active || !mountRef.current) return;
        embedded.mount(mountRef.current);
      } catch (error: unknown) {
        if (!active) return;
        setMountError(
          error instanceof Error ? error.message : "Unable to load checkout."
        );
      }
    };

    void run();

    return () => {
      active = false;
      if (embedded?.destroy) {
        embedded.destroy();
      } else if (embedded?.unmount) {
        embedded.unmount();
      }
    };
  }, [clientSecret, publishableKey]);

  if (mountError) {
    return (
      <p className="text-red text-sm font-semibold rounded-lg border border-red-border bg-red-dark px-3 py-2">
        {mountError}
      </p>
    );
  }

  return <div ref={mountRef} className="min-h-[480px]" />;
}

export default function EmbeddedCheckoutModal({
  open,
  businessId,
  businessName,
  onClose,
  onCancel,
  onSuccess,
  returnPath = "/dashboard/account",
  initialPlan = "monthly",
}: EmbeddedCheckoutModalProps) {
  const [selectedPlan, setSelectedPlan] = useState<BillingPlan>(initialPlan);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loadingCheckout, setLoadingCheckout] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const closingRef = useRef(false);

  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
  const checkoutKey = useMemo(
    () => `${selectedPlan}:${businessId ?? "no-business"}:${sessionId ?? "no-session"}`,
    [selectedPlan, businessId, sessionId]
  );

  const resetCheckoutState = useCallback(() => {
    setClientSecret(null);
    setSessionId(null);
    setLoadingCheckout(false);
    setLoadingStatus(false);
    setError("");
    setNotice("");
  }, []);

  useEffect(() => {
    if (!open) {
      closingRef.current = false;
      resetCheckoutState();
      setSelectedPlan(initialPlan);
    }
  }, [initialPlan, open, resetCheckoutState]);

  const closeAsCancel = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    resetCheckoutState();
    onClose();
    onCancel?.();
  }, [onCancel, onClose, resetCheckoutState]);

  const closeAfterSuccess = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    resetCheckoutState();
    onClose();
  }, [onClose, resetCheckoutState]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeAsCancel();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [closeAsCancel, open]);

  const initializeCheckout = useCallback(async () => {
    if (!open) return;
    if (!businessId) {
      setError("No business selected for checkout.");
      return;
    }
    if (!publishableKey) {
      setError("Missing NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY.");
      return;
    }

    setError("");
    setNotice("");
    setLoadingCheckout(true);
    setClientSecret(null);
    setSessionId(null);

    try {
      const response = await fetch("/api/billing/create-embedded-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_id: businessId,
          plan: selectedPlan,
          return_path: returnPath,
        }),
        cache: "no-store",
      });

      const payload = (await response.json().catch(() => null)) as
        | CreateCheckoutPayload
        | null;

      if (!response.ok || !payload?.clientSecret || !payload.sessionId) {
        setError(payload?.error ?? "Unable to initialize checkout.");
        setLoadingCheckout(false);
        return;
      }

      setSessionId(payload.sessionId);
      setClientSecret(payload.clientSecret);
      setLoadingCheckout(false);
    } catch {
      setError("Unable to initialize checkout.");
      setLoadingCheckout(false);
    }
  }, [businessId, open, publishableKey, returnPath, selectedPlan]);

  useEffect(() => {
    if (!open || !sessionId || !businessId) return;

    let active = true;
    let nextTimer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (!active) return;
      setLoadingStatus(true);
      setError("");

      try {
        const response = await fetch(
          `/api/billing/checkout-session-status?session_id=${encodeURIComponent(sessionId)}`,
          { cache: "no-store" }
        );

        const payload = (await response.json().catch(() => null)) as
          | CheckoutStatusPayload
          | null;

        if (!active) return;

        if (!response.ok) {
          setError(payload?.error ?? "Unable to verify checkout status.");
          setLoadingStatus(false);
          return;
        }

        const billingStatus = payload?.billingStatus ?? null;
        const billingIsActive =
          billingStatus === "active" || billingStatus === "trialing";

        if (payload?.complete && (billingIsActive || billingStatus === null)) {
          setLoadingStatus(false);
          await onSuccess?.({
            businessId,
            businessName,
            billingStatus,
            sessionId,
            plan: selectedPlan,
          });
          closeAfterSuccess();
          return;
        }
      } catch {
        if (!active) return;
        setError("Unable to verify checkout status.");
        setLoadingStatus(false);
        return;
      }

      setLoadingStatus(false);
      if (!active) return;
      nextTimer = setTimeout(() => {
        void poll();
      }, 2500);
    };

    void poll();

    return () => {
      active = false;
      if (nextTimer) {
        clearTimeout(nextTimer);
      }
      setLoadingStatus(false);
    };
  }, [
    businessId,
    businessName,
    closeAfterSuccess,
    onSuccess,
    open,
    selectedPlan,
    sessionId,
  ]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center p-4 sm:p-6">
      <button
        type="button"
        aria-label="Close checkout"
        className="absolute inset-0 bg-black/65 backdrop-blur-sm"
        onClick={closeAsCancel}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Business subscription checkout"
        className="relative flex w-full max-w-[560px] max-h-[90vh] flex-col overflow-hidden rounded-2xl border border-border bg-card"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-text-muted">
              Secure Checkout
            </p>
            <p className="text-sm font-semibold text-text">
              {businessName ? `Subscribe ${businessName}` : "Subscribe Business"}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={closeAsCancel}
            className="rounded-lg border border-border px-2.5 py-1.5 text-sm font-bold text-text-muted hover:bg-bg transition-colors"
          >
            X
          </button>
        </div>

        <div className="overflow-y-auto px-4 py-4 sm:px-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            {PLAN_OPTIONS.map((plan) => {
              const selected = selectedPlan === plan.id;
              return (
                <button
                  key={plan.id}
                  type="button"
                  onClick={() => {
                    setSelectedPlan(plan.id);
                    setError("");
                    if (clientSecret || sessionId) {
                      setClientSecret(null);
                      setSessionId(null);
                      setNotice(
                        "Plan updated. Click Continue to Secure Checkout to reload checkout."
                      );
                    }
                  }}
                  className={`relative rounded-xl border p-4 text-left transition-colors ${
                    selected
                      ? "border-accent bg-accent/[0.08]"
                      : "border-border bg-bg hover:border-accent/50"
                  }`}
                >
                  {plan.badge && (
                    <span className="absolute right-3 top-3 text-[10px] font-bold uppercase tracking-wider text-accent">
                      {plan.badge}
                    </span>
                  )}
                  <p className="text-sm font-bold text-text mb-1">{plan.title}</p>
                  <p className="text-[24px] font-black text-text leading-none">
                    {plan.price}
                    <span className="text-sm font-semibold text-text-muted ml-1">
                      {plan.period}
                    </span>
                  </p>
                </button>
              );
            })}
          </div>

          {!clientSecret && (
            <button
              type="button"
              onClick={initializeCheckout}
              disabled={loadingCheckout}
              className="w-full p-3.5 bg-gradient-to-br from-accent to-accent-dark rounded-xl text-bg text-[15px] font-extrabold shadow-[0_4px_20px_var(--color-accent-glow)] hover:shadow-[0_6px_28px_var(--color-accent-glow)] hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loadingCheckout ? "Loading checkout..." : "Continue to Secure Checkout"}
            </button>
          )}

          {loadingCheckout && (
            <div className="rounded-xl border border-border bg-bg px-4 py-5 text-center mt-4">
              <p className="text-sm font-semibold text-text-muted">Loading checkout...</p>
            </div>
          )}

          {!loadingCheckout && clientSecret && publishableKey && (
            <div className="mt-4">
              <EmbeddedCheckoutMount
                key={checkoutKey}
                clientSecret={clientSecret}
                publishableKey={publishableKey}
              />
            </div>
          )}

          {notice && (
            <p className="text-sm font-semibold text-text-muted mt-4 rounded-lg border border-border bg-bg px-3 py-2">
              {notice}
            </p>
          )}

          {loadingStatus && (
            <p className="text-xs text-text-muted mt-3">Checking payment status...</p>
          )}

          {error && (
            <p className="text-red text-sm font-semibold mt-4 rounded-lg border border-red-border bg-red-dark px-3 py-2">
              {error}
            </p>
          )}
        </div>

        <div className="border-t border-border px-4 py-3 sm:px-5">
          <button
            type="button"
            onClick={closeAsCancel}
            className="w-full py-3 border border-border rounded-xl text-text-muted text-sm font-semibold hover:bg-bg transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
