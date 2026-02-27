import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { mapStripeSubscriptionStatusToBillingStatus } from "@/lib/billing/stripe";

type RequestBody = {
  checkout_session_id?: string;
};

type ActorProfile = {
  id: string;
  role: "admin" | "manager" | "worker";
  company_id: string;
  account_id: string | null;
  is_active: boolean;
};

function jsonNoStore(payload: Record<string, unknown>, status: number) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      Pragma: "no-cache",
    },
  });
}

function getStripeClient(): Stripe {
  const secret = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secret) {
    throw new Error("Missing STRIPE_SECRET_KEY");
  }
  return new Stripe(secret);
}

function optionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function unixToIso(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return new Date(value * 1000).toISOString();
}

function unixValue(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value;
}

export async function POST(request: Request) {
  try {
    const sessionClient = await createClient();
    const {
      data: { user },
    } = await sessionClient.auth.getUser();

    if (!user) {
      return jsonNoStore({ error: "Unauthorized" }, 401);
    }

    const { data: actor, error: actorError } = await sessionClient
      .from("profiles")
      .select("id, role, company_id, account_id, is_active")
      .eq("id", user.id)
      .single();

    if (actorError || !actor) {
      return jsonNoStore({ error: "Unable to load your profile." }, 403);
    }

    const actorProfile = actor as ActorProfile;
    if (!actorProfile.is_active) {
      return jsonNoStore({ error: "Your account is inactive." }, 403);
    }
    if (actorProfile.role !== "admin") {
      return jsonNoStore({ error: "Admin access required." }, 403);
    }

    const body = (await request.json().catch(() => ({}))) as RequestBody;
    const checkoutSessionId = (body.checkout_session_id ?? "").trim();
    if (!checkoutSessionId) {
      return jsonNoStore({ error: "checkout_session_id is required." }, 400);
    }

    const stripe = getStripeClient();
    const checkoutSession = await stripe.checkout.sessions.retrieve(checkoutSessionId, {
      expand: ["subscription", "customer", "line_items.data.price"],
    });

    if (checkoutSession.mode !== "subscription") {
      return jsonNoStore({ error: "Checkout session is not a subscription session." }, 400);
    }

    const sessionComplete =
      checkoutSession.status === "complete" || checkoutSession.payment_status === "paid";
    if (!sessionComplete) {
      return jsonNoStore(
        { error: "Checkout is not complete yet. Business was not created." },
        409
      );
    }

    const metadata = checkoutSession.metadata ?? {};
    const businessName = optionalString(metadata.business_name);
    if (!businessName) {
      return jsonNoStore({ error: "Checkout session is missing business_name metadata." }, 400);
    }

    const actorAccountId = actorProfile.account_id ?? actorProfile.company_id;
    const admin = createAdminClient();

    let subscription: Stripe.Subscription | null = null;
    if (typeof checkoutSession.subscription === "string") {
      subscription = await stripe.subscriptions.retrieve(checkoutSession.subscription, {
        expand: ["items.data.price"],
      });
    } else if (checkoutSession.subscription) {
      subscription = checkoutSession.subscription as Stripe.Subscription;
    }

    if (!subscription) {
      return jsonNoStore({ error: "Checkout session has no subscription object." }, 400);
    }

    const sub = subscription as Stripe.Subscription & {
      current_period_start?: number | null;
      current_period_end?: number | null;
    };
    const subItem = sub.items.data[0];
    const currentPeriodStartUnix =
      unixValue(sub.current_period_start) ?? unixValue(subItem?.current_period_start);
    const currentPeriodEndUnix =
      unixValue(sub.current_period_end) ?? unixValue(subItem?.current_period_end);
    const currentPeriodStart = unixToIso(currentPeriodStartUnix);
    const currentPeriodEnd = unixToIso(currentPeriodEndUnix);
    const cancelAtPeriodEnd = Boolean(sub.cancel_at_period_end);
    const billingStatus = mapStripeSubscriptionStatusToBillingStatus(sub.status);
    const stripePriceId =
      (typeof subItem?.price === "string" ? subItem.price : subItem?.price?.id) ?? null;
    const stripeCustomerId =
      typeof checkoutSession.customer === "string"
        ? checkoutSession.customer
        : checkoutSession.customer?.id ?? null;

    const { data: existingBySubscription } = await admin
      .from("businesses")
      .select(
        "id, name, account_id, billing_status, stripe_price_id, stripe_subscription_id, cancel_at_period_end, current_period_start, current_period_end"
      )
      .eq("account_id", actorAccountId)
      .eq("stripe_subscription_id", sub.id)
      .maybeSingle();

    if (existingBySubscription) {
      return jsonNoStore(
        {
          business: {
            id: existingBySubscription.id,
            name: existingBySubscription.name,
          },
          billing: {
            billing_status: existingBySubscription.billing_status,
            stripe_price_id: existingBySubscription.stripe_price_id,
            stripe_subscription_id: existingBySubscription.stripe_subscription_id,
            cancel_at_period_end: existingBySubscription.cancel_at_period_end,
            current_period_start: existingBySubscription.current_period_start,
            current_period_end: existingBySubscription.current_period_end,
          },
        },
        200
      );
    }

    const { data: existingByName, error: existingByNameError } = await admin
      .from("businesses")
      .select("id")
      .eq("account_id", actorAccountId)
      .ilike("name", businessName)
      .limit(1);

    if (existingByNameError) {
      return jsonNoStore({ error: "Unable to validate business name." }, 400);
    }
    if ((existingByName ?? []).length > 0) {
      return jsonNoStore({ error: "A business with that name already exists." }, 409);
    }

    const nowIso = new Date().toISOString();
    const { data: createdBusiness, error: createdBusinessError } = await admin
      .from("businesses")
      .insert({
        account_id: actorAccountId,
        name: businessName,
        address_line1: optionalString(metadata.address_line1),
        city: optionalString(metadata.city),
        state: optionalString(metadata.state),
        postal_code: optionalString(metadata.postal_code),
        country: optionalString(metadata.country),
        billing_status: billingStatus,
        stripe_customer_id: stripeCustomerId,
        stripe_subscription_id: sub.id,
        stripe_price_id: stripePriceId,
        cancel_at_period_end: cancelAtPeriodEnd,
        current_period_start: currentPeriodStart,
        current_period_end: currentPeriodEnd,
        billing_started_at: nowIso,
        billing_canceled_at:
          billingStatus === "canceled" || billingStatus === "unpaid" ? nowIso : null,
      })
      .select("id, name")
      .single();

    if (createdBusinessError || !createdBusiness) {
      return jsonNoStore(
        {
          error: "Unable to create business from completed checkout.",
          code: createdBusinessError?.code ?? null,
          details: createdBusinessError?.details ?? null,
          hint: createdBusinessError?.hint ?? null,
        },
        400
      );
    }

    const { error: membershipError } = await admin
      .from("business_memberships")
      .upsert(
        {
          business_id: createdBusiness.id,
          profile_id: actorProfile.id,
          role: "manager",
          is_active: true,
        },
        { onConflict: "business_id,profile_id" }
      );

    if (membershipError) {
      await admin.from("businesses").delete().eq("id", createdBusiness.id);
      return jsonNoStore(
        {
          error: "Business created from checkout but membership save failed.",
          code: membershipError.code ?? null,
          details: membershipError.details ?? null,
          hint: membershipError.hint ?? null,
        },
        400
      );
    }

    return jsonNoStore(
      {
        business: {
          id: createdBusiness.id,
          name: createdBusiness.name,
        },
        billing: {
          billing_status: billingStatus,
          stripe_price_id: stripePriceId,
          stripe_subscription_id: sub.id,
          cancel_at_period_end: cancelAtPeriodEnd,
          current_period_start: currentPeriodStart,
          current_period_end: currentPeriodEnd,
        },
      },
      200
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Unexpected complete-from-checkout error.";
    return jsonNoStore({ error: message }, 500);
  }
}
