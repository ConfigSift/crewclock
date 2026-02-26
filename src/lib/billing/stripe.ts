import "server-only";

import { createHmac, timingSafeEqual } from "crypto";

export type BillingPlan = "monthly" | "annual";

type StripeApiError = {
  error?: {
    message?: string;
    code?: string;
    type?: string;
  };
};

export type StripeCheckoutSession = {
  id: string;
  client_secret?: string | null;
  status?: string | null;
  payment_status?: string | null;
  customer?: string | null;
  subscription?: string | StripeSubscription | null;
  metadata?: Record<string, string> | null;
  client_reference_id?: string | null;
};

export type StripeSubscription = {
  id: string;
  status: string;
  customer: string | null;
  cancel_at_period_end?: boolean;
  current_period_start?: number | null;
  current_period_end?: number | null;
  metadata?: Record<string, string> | null;
  items?: {
    data?: Array<{
      price?: {
        id?: string | null;
      } | null;
    }>;
  } | null;
};

export type StripeWebhookEvent = {
  id: string;
  type: string;
  data: {
    object: Record<string, unknown>;
  };
};

function getStripeSecretKey(): string {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) {
    throw new Error("Missing STRIPE_SECRET_KEY");
  }
  return key;
}

export function getStripePublishableKey(): string {
  const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim();
  if (!key) {
    throw new Error("Missing NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY");
  }
  return key;
}

export function getStripePriceId(plan: BillingPlan): string {
  const monthly = process.env.STRIPE_PRICE_MONTHLY?.trim();
  const annual = process.env.STRIPE_PRICE_ANNUAL?.trim();

  if (!monthly) {
    throw new Error("Missing STRIPE_PRICE_MONTHLY");
  }
  if (!annual) {
    throw new Error("Missing STRIPE_PRICE_ANNUAL");
  }

  return plan === "annual" ? annual : monthly;
}

export function getSiteUrl(): string {
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!site) {
    throw new Error("Missing NEXT_PUBLIC_SITE_URL");
  }
  return site.replace(/\/$/, "");
}

async function stripeRequest<T>(
  path: string,
  options?: {
    method?: "GET" | "POST";
    form?: URLSearchParams;
    query?: URLSearchParams;
  }
): Promise<T> {
  const method = options?.method ?? "GET";
  const url = new URL(`https://api.stripe.com/v1/${path}`);
  if (options?.query) {
    options.query.forEach((value, key) => {
      url.searchParams.append(key, value);
    });
  }

  const response = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${getStripeSecretKey()}`,
      ...(options?.form
        ? { "Content-Type": "application/x-www-form-urlencoded" }
        : {}),
    },
    body: options?.form ? options.form.toString() : undefined,
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => null)) as
    | (StripeApiError & T)
    | null;

  if (!response.ok) {
    const message =
      payload?.error?.message ??
      `Stripe request failed (${response.status} ${response.statusText})`;
    const code = payload?.error?.code;
    const withCode = code ? `${message} [${code}]` : message;
    throw new Error(withCode);
  }

  if (!payload) {
    throw new Error("Stripe request returned no payload.");
  }

  return payload as T;
}

export async function createStripeCustomer(input: {
  email?: string | null;
  name?: string | null;
  metadata?: Record<string, string>;
}): Promise<{ id: string }> {
  const form = new URLSearchParams();
  if (input.email) form.set("email", input.email);
  if (input.name) form.set("name", input.name);
  if (input.metadata) {
    Object.entries(input.metadata).forEach(([key, value]) => {
      form.set(`metadata[${key}]`, value);
    });
  }
  return stripeRequest<{ id: string }>("customers", { method: "POST", form });
}

export async function createEmbeddedSubscriptionCheckoutSession(input: {
  customerId: string;
  businessId: string;
  accountId: string;
  profileId: string;
  plan: BillingPlan;
  priceId: string;
  returnUrl: string;
}): Promise<StripeCheckoutSession> {
  const form = new URLSearchParams();
  form.set("mode", "subscription");
  form.set("ui_mode", "embedded");
  form.set("customer", input.customerId);
  form.set("return_url", input.returnUrl);
  form.set("client_reference_id", input.businessId);
  form.set("line_items[0][price]", input.priceId);
  form.set("line_items[0][quantity]", "1");
  form.set("allow_promotion_codes", "true");
  form.set("metadata[business_id]", input.businessId);
  form.set("metadata[account_id]", input.accountId);
  form.set("metadata[profile_id]", input.profileId);
  form.set("metadata[plan]", input.plan);
  form.set("subscription_data[metadata][business_id]", input.businessId);
  form.set("subscription_data[metadata][account_id]", input.accountId);
  form.set("subscription_data[metadata][profile_id]", input.profileId);
  form.set("subscription_data[metadata][plan]", input.plan);

  return stripeRequest<StripeCheckoutSession>("checkout/sessions", {
    method: "POST",
    form,
  });
}

export async function retrieveCheckoutSession(
  sessionId: string
): Promise<StripeCheckoutSession> {
  const query = new URLSearchParams();
  query.append("expand[]", "subscription");
  return stripeRequest<StripeCheckoutSession>(`checkout/sessions/${sessionId}`, {
    method: "GET",
    query,
  });
}

export async function retrieveSubscription(
  subscriptionId: string
): Promise<StripeSubscription> {
  return stripeRequest<StripeSubscription>(`subscriptions/${subscriptionId}`, {
    method: "GET",
  });
}

export async function updateSubscriptionCancelAtPeriodEnd(
  subscriptionId: string,
  cancelAtPeriodEnd: boolean
): Promise<StripeSubscription> {
  const form = new URLSearchParams();
  form.set("cancel_at_period_end", cancelAtPeriodEnd ? "true" : "false");
  return stripeRequest<StripeSubscription>(`subscriptions/${subscriptionId}`, {
    method: "POST",
    form,
  });
}

export function verifyStripeWebhookSignature(
  payload: string,
  signatureHeader: string | null
): StripeWebhookEvent {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) {
    throw new Error("Missing STRIPE_WEBHOOK_SECRET");
  }

  if (!signatureHeader) {
    throw new Error("Missing Stripe signature header.");
  }

  const parts = signatureHeader.split(",").map((part) => part.trim());
  const timestampPart = parts.find((part) => part.startsWith("t="));
  const signatures = parts
    .filter((part) => part.startsWith("v1="))
    .map((part) => part.slice(3));

  if (!timestampPart || signatures.length === 0) {
    throw new Error("Invalid Stripe signature header.");
  }

  const timestamp = Number(timestampPart.slice(2));
  if (!Number.isFinite(timestamp)) {
    throw new Error("Invalid Stripe signature timestamp.");
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > 300) {
    throw new Error("Stripe signature timestamp is outside tolerance.");
  }

  const signedPayload = `${timestamp}.${payload}`;
  const expected = createHmac("sha256", secret)
    .update(signedPayload, "utf8")
    .digest("hex");

  const matched = signatures.some((candidate) => {
    const left = Buffer.from(candidate, "hex");
    const right = Buffer.from(expected, "hex");
    if (left.length !== right.length) return false;
    return timingSafeEqual(left, right);
  });

  if (!matched) {
    throw new Error("Stripe signature verification failed.");
  }

  return JSON.parse(payload) as StripeWebhookEvent;
}

export function mapStripeSubscriptionStatusToBillingStatus(
  subscriptionStatus: string | null | undefined
):
  | "inactive"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid" {
  if (subscriptionStatus === "trialing") return "trialing";
  if (subscriptionStatus === "active") return "active";
  if (subscriptionStatus === "past_due") return "past_due";
  if (subscriptionStatus === "canceled") return "canceled";
  if (subscriptionStatus === "unpaid") return "unpaid";
  return "inactive";
}

export function getSubscriptionPriceId(
  subscription: StripeSubscription | null | undefined
): string | null {
  return subscription?.items?.data?.[0]?.price?.id ?? null;
}
