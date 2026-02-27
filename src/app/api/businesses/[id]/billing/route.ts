import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  mapStripeSubscriptionStatusToBillingStatus,
} from "@/lib/billing/stripe";

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

type ActorProfile = {
  id: string;
  role: "admin" | "manager" | "worker";
  company_id: string;
  account_id: string | null;
  is_active: boolean;
};

type BusinessRow = {
  id: string;
  name: string;
  account_id: string;
  billing_status:
    | "inactive"
    | "trialing"
    | "active"
    | "past_due"
    | "canceled"
    | "unpaid";
  stripe_price_id: string | null;
  stripe_subscription_id: string | null;
  stripe_customer_id: string | null;
  cancel_at_period_end: boolean;
  current_period_start: string | null;
  current_period_end: string | null;
  billing_started_at: string | null;
  billing_canceled_at: string | null;
};

function jsonNoStore(payload: Record<string, unknown>, status: number) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      Pragma: "no-cache",
      "X-CrewClock-Billing": "v1",
    },
  });
}

function unixSecondsToIso(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return new Date(value * 1000).toISOString();
}

function toUnixSeconds(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value;
}

function getStripeClient(): Stripe {
  const secret = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secret) {
    throw new Error("Missing STRIPE_SECRET_KEY");
  }
  return new Stripe(secret);
}

function resolvePlanLabel(priceId: string | null): string {
  if (!priceId) return "Not selected";
  const monthlyPriceId = process.env.STRIPE_PRICE_MONTHLY?.trim() ?? "";
  const annualPriceId = process.env.STRIPE_PRICE_ANNUAL?.trim() ?? "";
  if (monthlyPriceId && priceId === monthlyPriceId) return "Monthly ($19.99)";
  if (annualPriceId && priceId === annualPriceId) return "Annual ($199.99)";
  return "Custom";
}

async function resolveRouteParams(
  context: RouteContext
): Promise<{ id: string }> {
  const params = await context.params;
  return params as { id: string };
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { id } = await resolveRouteParams(context);
    const businessId = id.trim();
    if (!businessId) {
      return jsonNoStore({ ok: false, error: "Business id is required." }, 400);
    }

    const sessionClient = await createClient();
    const {
      data: { user },
    } = await sessionClient.auth.getUser();

    if (!user) {
      return jsonNoStore({ ok: false, error: "Unauthorized" }, 401);
    }

    const { data: actor, error: actorError } = await sessionClient
      .from("profiles")
      .select("id, role, company_id, account_id, is_active")
      .eq("id", user.id)
      .single();

    if (actorError || !actor) {
      return jsonNoStore({ ok: false, error: "Unable to load your profile." }, 403);
    }

    const actorProfile = actor as ActorProfile;
    if (!actorProfile.is_active) {
      return jsonNoStore({ ok: false, error: "Your account is inactive." }, 403);
    }

    const admin = createAdminClient();
    const readBusiness = async () =>
      admin
        .from("businesses")
        .select(
          "id, name, account_id, billing_status, stripe_price_id, stripe_subscription_id, stripe_customer_id, cancel_at_period_end, current_period_start, current_period_end, billing_started_at, billing_canceled_at"
        )
        .eq("id", businessId)
        .single();

    const { data: business, error: businessError } = await readBusiness();
    if (businessError || !business) {
      return jsonNoStore({ ok: false, error: "Business not found." }, 404);
    }

    let businessRow = business as BusinessRow;
    const actorAccountId = actorProfile.account_id ?? actorProfile.company_id;
    if (businessRow.account_id !== actorAccountId) {
      return jsonNoStore(
        { ok: false, error: "You do not have access to that business." },
        403
      );
    }

    if (!businessRow.stripe_subscription_id) {
      return jsonNoStore(
        {
          ok: true,
          message: "No Stripe subscription is connected for this business yet.",
          business: {
            id: businessRow.id,
            business_id: businessRow.id,
            name: businessRow.name,
            billing_status: businessRow.billing_status,
            stripe_price_id: businessRow.stripe_price_id,
            stripe_subscription_id: businessRow.stripe_subscription_id,
            stripe_customer_id: businessRow.stripe_customer_id,
            cancel_at_period_end: businessRow.cancel_at_period_end,
            current_period_start: businessRow.current_period_start,
            current_period_end: businessRow.current_period_end,
            billing_started_at: businessRow.billing_started_at,
            billing_canceled_at: businessRow.billing_canceled_at,
            plan_label: resolvePlanLabel(businessRow.stripe_price_id),
          },
        },
        200
      );
    }

    try {
      const stripe = getStripeClient();
      const subscription = (await stripe.subscriptions.retrieve(
        businessRow.stripe_subscription_id,
        {
          expand: ["items.data.price"],
        }
      )) as Stripe.Subscription & {
        current_period_start?: number | null;
        current_period_end?: number | null;
      };
      const subscriptionItem = subscription.items.data[0];
      const cps =
        toUnixSeconds(subscription.current_period_start) ??
        toUnixSeconds(subscriptionItem?.current_period_start);
      const cpe =
        toUnixSeconds(subscription.current_period_end) ??
        toUnixSeconds(subscriptionItem?.current_period_end);
      const cap = Boolean(subscription.cancel_at_period_end);
      const currentPeriodStartIso = cps ? new Date(cps * 1000).toISOString() : null;
      const currentPeriodEndIso = cpe ? new Date(cpe * 1000).toISOString() : null;
      const stripePriceId =
        (typeof subscriptionItem?.price === "string"
          ? subscriptionItem.price
          : subscriptionItem?.price?.id) ?? businessRow.stripe_price_id;
      const updates = {
        cancel_at_period_end: cap,
        current_period_start: currentPeriodStartIso,
        current_period_end: currentPeriodEndIso,
        billing_status: mapStripeSubscriptionStatusToBillingStatus(subscription.status),
        stripe_price_id: stripePriceId,
        stripe_subscription_id: subscription.id,
      };

      if (process.env.NODE_ENV !== "production") {
        console.log("[billing] subscription period sync", {
          business_id: businessRow.id,
          has_stripe_subscription_id: Boolean(businessRow.stripe_subscription_id),
          stripe_current_period_end_typeof: typeof subscription.current_period_end,
          stripe_current_period_end_raw: subscription.current_period_end ?? null,
          stripe_item_current_period_end_raw: subscriptionItem?.current_period_end ?? null,
          stripe_current_period_end_iso: currentPeriodEndIso,
        });
      }

      const { data: updatedBusiness, error: updateError } = await admin
        .from("businesses")
        .update(updates)
        .eq("id", businessRow.id)
        .select(
          "id, name, account_id, billing_status, stripe_price_id, stripe_subscription_id, stripe_customer_id, cancel_at_period_end, current_period_start, current_period_end, billing_started_at, billing_canceled_at"
        )
        .single();

      if (updateError || !updatedBusiness) {
        return jsonNoStore(
          { ok: false, error: "Unable to persist refreshed Stripe subscription fields." },
          400
        );
      }

      businessRow = updatedBusiness as BusinessRow;
    } catch (error: unknown) {
      if (!businessRow.current_period_end || !businessRow.current_period_start) {
        const message =
          error instanceof Error
            ? error.message
            : "Unable to sync subscription period from Stripe.";
        return jsonNoStore({ ok: false, error: message }, 502);
      }
      // Keep DB values when Stripe sync fails but stored period values already exist.
    }

    return jsonNoStore(
      {
        ok: true,
        business: {
          id: businessRow.id,
          business_id: businessRow.id,
          name: businessRow.name,
          billing_status: businessRow.billing_status,
          stripe_price_id: businessRow.stripe_price_id,
          stripe_subscription_id: businessRow.stripe_subscription_id,
          stripe_customer_id: businessRow.stripe_customer_id,
          cancel_at_period_end: businessRow.cancel_at_period_end,
          current_period_start: businessRow.current_period_start,
          current_period_end: businessRow.current_period_end,
          billing_started_at: businessRow.billing_started_at,
          billing_canceled_at: businessRow.billing_canceled_at,
          plan_label: resolvePlanLabel(businessRow.stripe_price_id),
        },
      },
      200
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unexpected billing lookup error.";
    return jsonNoStore({ ok: false, error: message }, 500);
  }
}
