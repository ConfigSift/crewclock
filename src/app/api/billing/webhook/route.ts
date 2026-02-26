import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getSubscriptionPriceId,
  mapStripeSubscriptionStatusToBillingStatus,
  retrieveSubscription,
  type StripeSubscription,
  verifyStripeWebhookSignature,
} from "@/lib/billing/stripe";

type BusinessRow = {
  id: string;
  billing_started_at: string | null;
};

type StripeCheckoutSessionObject = {
  id: string;
  metadata?: Record<string, string> | null;
  client_reference_id?: string | null;
  customer?: string | null;
  subscription?: string | StripeSubscription | null;
};

type StripeInvoiceObject = {
  id: string;
  customer?: string | null;
  subscription?: string | { id?: string | null } | null;
};

function unixSecondsToIso(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return new Date(value * 1000).toISOString();
}

async function syncBusinessFromSubscription(
  admin: ReturnType<typeof createAdminClient>,
  businessId: string,
  customerId: string | null | undefined,
  subscription: StripeSubscription
) {
  const { data: business } = await admin
    .from("businesses")
    .select("id, billing_started_at")
    .eq("id", businessId)
    .maybeSingle();

  if (!business) return;

  const businessRow = business as BusinessRow;
  const billingStatus = mapStripeSubscriptionStatusToBillingStatus(subscription.status);
  const priceId = getSubscriptionPriceId(subscription);

  const updates: Record<string, unknown> = {
    billing_status: billingStatus,
    stripe_customer_id: customerId ?? subscription.customer,
    stripe_subscription_id: subscription.id,
    stripe_price_id: priceId,
    cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
    current_period_start: unixSecondsToIso(subscription.current_period_start),
    current_period_end: unixSecondsToIso(subscription.current_period_end),
  };

  if (
    (billingStatus === "active" || billingStatus === "trialing") &&
    !businessRow.billing_started_at
  ) {
    updates.billing_started_at = new Date().toISOString();
  }

  if (billingStatus === "canceled" || billingStatus === "unpaid") {
    updates.billing_canceled_at = new Date().toISOString();
  } else {
    updates.billing_canceled_at = null;
  }

  await admin.from("businesses").update(updates).eq("id", businessId);
}

async function syncBusinessFromSubscriptionRecord(
  admin: ReturnType<typeof createAdminClient>,
  subscription: StripeSubscription,
  customerId?: string | null
) {
  const resolvedCustomerId = customerId ?? subscription.customer ?? null;
  const metadataBusinessId = subscription.metadata?.business_id ?? null;

  if (metadataBusinessId) {
    await syncBusinessFromSubscription(
      admin,
      metadataBusinessId,
      resolvedCustomerId,
      subscription
    );
    return;
  }

  const lookup = resolvedCustomerId
    ? `stripe_subscription_id.eq.${subscription.id},stripe_customer_id.eq.${resolvedCustomerId}`
    : `stripe_subscription_id.eq.${subscription.id}`;

  const { data: business } = await admin
    .from("businesses")
    .select("id")
    .or(lookup)
    .maybeSingle();

  const businessId = (business as { id?: string } | null)?.id ?? null;
  if (!businessId) return;

  await syncBusinessFromSubscription(
    admin,
    businessId,
    resolvedCustomerId,
    subscription
  );
}

async function syncBusinessFromSubscriptionId(
  admin: ReturnType<typeof createAdminClient>,
  subscriptionId: string,
  customerId?: string | null
) {
  const subscription = await retrieveSubscription(subscriptionId);
  await syncBusinessFromSubscriptionRecord(admin, subscription, customerId);
}

export async function POST(request: Request) {
  try {
    const payload = await request.text();
    const signature = request.headers.get("stripe-signature");
    const event = verifyStripeWebhookSignature(payload, signature);
    const admin = createAdminClient();

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as unknown as StripeCheckoutSessionObject;
      const businessId = session.metadata?.business_id ?? session.client_reference_id ?? null;
      const profileId = session.metadata?.profile_id ?? null;

      if (businessId && session.subscription) {
        const subscription =
          typeof session.subscription === "string"
            ? await retrieveSubscription(session.subscription)
            : session.subscription;
        await syncBusinessFromSubscription(
          admin,
          businessId,
          session.customer ?? null,
          subscription
        );
      }

      if (profileId) {
        await admin
          .from("profiles")
          .update({ onboarding_step_completed: 3 })
          .eq("id", profileId)
          .lt("onboarding_step_completed", 3);
      }
    }

    if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      const subscription = event.data.object as unknown as StripeSubscription;
      await syncBusinessFromSubscriptionRecord(admin, subscription, subscription.customer);
    }

    if (
      event.type === "invoice.payment_succeeded" ||
      event.type === "invoice.payment_failed"
    ) {
      const invoice = event.data.object as unknown as StripeInvoiceObject;
      const subscriptionId =
        typeof invoice.subscription === "string"
          ? invoice.subscription
          : invoice.subscription?.id ?? null;

      if (subscriptionId) {
        await syncBusinessFromSubscriptionId(admin, subscriptionId, invoice.customer ?? null);
      }
    }

    return NextResponse.json({ received: true }, { status: 200 });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unexpected Stripe webhook error.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
