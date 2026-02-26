"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useBusiness } from "@/contexts/BusinessContext";

type BillingPlan = "monthly" | "annual";

type CreateCheckoutPayload = {
  clientSecret?: string;
  sessionId?: string;
  error?: string;
};

type CheckoutStatusPayload = {
  complete?: boolean;
  nextPath?: string;
  billingStatus?:
    | "inactive"
    | "trialing"
    | "active"
    | "past_due"
    | "canceled"
    | "unpaid"
    | null;
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

export default function StepThreeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { activeBusinessId, activeBusiness, loading: businessLoading } = useBusiness();

  const [selectedPlan, setSelectedPlan] = useState<BillingPlan>("monthly");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loadingCheckout, setLoadingCheckout] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";

  const checkoutKey = useMemo(
    () => `${selectedPlan}:${activeBusinessId ?? "no-business"}:${sessionId ?? "no-session"}`,
    [selectedPlan, activeBusinessId, sessionId]
  );

  const closeCheckoutModal = useCallback(() => {
    setIsModalOpen(false);
    setClientSecret(null);
    setSessionId(null);
    setLoadingCheckout(false);
  }, []);

  const handleOpenCheckout = useCallback(() => {
    if (businessLoading) return;
    if (!activeBusinessId) {
      setError("Select an active business before continuing to payment.");
      return;
    }
    if (!publishableKey) {
      setError("Missing NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY.");
      return;
    }
    setError("");
    setNotice("");
    setIsModalOpen(true);
  }, [activeBusinessId, businessLoading, publishableKey]);

  const handleSelectPlan = useCallback(
    (plan: BillingPlan) => {
      setSelectedPlan(plan);
      if (isModalOpen) {
        closeCheckoutModal();
        setNotice("Plan updated. Click Continue to Payment to reopen checkout.");
      }
    },
    [closeCheckoutModal, isModalOpen]
  );

  useEffect(() => {
    if (!isModalOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeCheckoutModal();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [closeCheckoutModal, isModalOpen]);

  useEffect(() => {
    if (!isModalOpen) return;
    if (!activeBusinessId || businessLoading) return;

    if (!publishableKey) {
      setError("Missing NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY.");
      return;
    }

    let active = true;
    setError("");
    setLoadingCheckout(true);
    setClientSecret(null);

    const run = async () => {
      try {
        const response = await fetch("/api/billing/create-embedded-checkout-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            business_id: activeBusinessId,
            plan: selectedPlan,
          }),
        });

        const payload = (await response.json().catch(() => null)) as
          | CreateCheckoutPayload
          | null;

        if (!active) return;

        if (!response.ok || !payload?.clientSecret || !payload.sessionId) {
          setError(payload?.error ?? "Unable to initialize checkout.");
          setLoadingCheckout(false);
          return;
        }

        setSessionId(payload.sessionId);
        setClientSecret(payload.clientSecret);
        setLoadingCheckout(false);
      } catch {
        if (!active) return;
        setError("Unable to initialize checkout.");
        setLoadingCheckout(false);
      }
    };

    void run();
    return () => {
      active = false;
    };
  }, [activeBusinessId, businessLoading, isModalOpen, publishableKey, selectedPlan]);

  useEffect(() => {
    const returnedSessionId = searchParams.get("session_id")?.trim() ?? "";
    if (!returnedSessionId) return;
    setSessionId((current) => current ?? returnedSessionId);
  }, [searchParams]);

  useEffect(() => {
    if (!sessionId) {
      setLoadingStatus(false);
      return;
    }

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
          router.replace(payload.nextPath ?? "/dashboard");
          router.refresh();
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
  }, [router, sessionId]);

  return (
    <>
      <p className="text-xs text-text-muted mb-5">
        Business:{" "}
        <span className="font-semibold text-text">
          {businessLoading
            ? "Loading..."
            : activeBusiness?.name ?? "No active business selected"}
        </span>
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
        {PLAN_OPTIONS.map((plan) => {
          const selected = selectedPlan === plan.id;
          return (
            <button
              key={plan.id}
              type="button"
              onClick={() => handleSelectPlan(plan.id)}
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

      <button
        type="button"
        onClick={handleOpenCheckout}
        disabled={businessLoading || loadingCheckout}
        className="w-full p-3.5 bg-gradient-to-br from-accent to-accent-dark rounded-xl text-bg text-[15px] font-extrabold shadow-[0_4px_20px_var(--color-accent-glow)] hover:shadow-[0_6px_28px_var(--color-accent-glow)] hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Continue to Payment
      </button>

      {notice && (
        <p className="text-sm font-semibold text-text-muted mt-4 rounded-lg border border-border bg-bg px-3 py-2">
          {notice}
        </p>
      )}

      {loadingStatus && (
        <p className="text-xs text-text-muted mt-3">Checking payment status...</p>
      )}

      {!isModalOpen && error && (
        <p className="text-red text-sm font-semibold mt-4 rounded-lg border border-red-border bg-red-dark px-3 py-2">
          {error}
        </p>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 z-[1100] flex items-center justify-center p-4 sm:p-6">
          <button
            type="button"
            aria-label="Close checkout"
            className="absolute inset-0 bg-black/65 backdrop-blur-sm"
            onClick={closeCheckoutModal}
          />

          <div
            role="dialog"
            aria-modal="true"
            aria-label="Secure checkout"
            className="relative flex w-full max-w-[560px] max-h-[90vh] flex-col overflow-hidden rounded-2xl border border-border bg-card"
          >
            <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-text-muted">
                  Secure Checkout
                </p>
                <p className="text-sm font-semibold text-text">
                  {selectedPlan === "annual"
                    ? "Annual plan selected"
                    : "Monthly plan selected"}
                </p>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={closeCheckoutModal}
                className="rounded-lg border border-border px-2.5 py-1.5 text-sm font-bold text-text-muted hover:bg-bg transition-colors"
              >
                X
              </button>
            </div>

            <div className="overflow-y-auto px-4 py-4 sm:px-5">
              {loadingCheckout && (
                <div className="rounded-xl border border-border bg-bg px-4 py-5 text-center">
                  <p className="text-sm font-semibold text-text-muted">Loading checkout...</p>
                </div>
              )}

              {!loadingCheckout && clientSecret && publishableKey && (
                <EmbeddedCheckoutMount
                  key={checkoutKey}
                  clientSecret={clientSecret}
                  publishableKey={publishableKey}
                />
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
                onClick={closeCheckoutModal}
                className="w-full py-3 border border-border rounded-xl text-text-muted text-sm font-semibold hover:bg-bg transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
