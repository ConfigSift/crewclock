import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getSubscriptionPriceId,
  mapStripeSubscriptionStatusToBillingStatus,
  retrieveSubscription,
} from "@/lib/billing/stripe";

type ActorProfile = {
  id: string;
  role: "admin" | "manager" | "worker";
  company_id: string;
  account_id: string | null;
  is_active: boolean;
};

type BusinessRow = {
  id: string;
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
    },
  });
}

function resolvePlanLabel(priceId: string | null): string {
  if (!priceId) return "Not selected";
  const monthlyPriceId = process.env.STRIPE_PRICE_MONTHLY?.trim() ?? "";
  const annualPriceId = process.env.STRIPE_PRICE_ANNUAL?.trim() ?? "";
  if (monthlyPriceId && priceId === monthlyPriceId) return "Monthly ($19.99)";
  if (annualPriceId && priceId === annualPriceId) return "Annual ($199.99)";
  return "Custom";
}

function unixSecondsToIso(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return new Date(value * 1000).toISOString();
}

export async function GET(request: Request) {
  try {
    const requestUrl = new URL(request.url);
    const businessId = requestUrl.searchParams.get("business_id")?.trim() ?? "";
    if (!businessId) {
      return jsonNoStore({ error: "business_id is required." }, 400);
    }

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

    const admin = createAdminClient();
    const { data: business, error: businessError } = await admin
      .from("businesses")
      .select(
        "id, account_id, billing_status, stripe_price_id, stripe_subscription_id, cancel_at_period_end, current_period_start, current_period_end, billing_started_at, billing_canceled_at"
      )
      .eq("id", businessId)
      .single();

    if (businessError || !business) {
      return jsonNoStore({ error: "Business not found." }, 404);
    }

    const businessRow = business as BusinessRow;
    const actorAccountId = actorProfile.account_id ?? actorProfile.company_id;
    if (businessRow.account_id !== actorAccountId) {
      return jsonNoStore({ error: "You do not have access to that business." }, 403);
    }

    let resolvedBusiness = businessRow;

    if (!resolvedBusiness.current_period_end && resolvedBusiness.stripe_subscription_id) {
      try {
        const subscription = await retrieveSubscription(resolvedBusiness.stripe_subscription_id);
        const updatedBusinessFields = {
          cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
          current_period_start: unixSecondsToIso(subscription.current_period_start),
          current_period_end: unixSecondsToIso(subscription.current_period_end),
          billing_status: mapStripeSubscriptionStatusToBillingStatus(subscription.status),
          stripe_price_id: getSubscriptionPriceId(subscription),
          stripe_subscription_id: subscription.id,
        };

        const { data: refreshedBusiness, error: updateError } = await admin
          .from("businesses")
          .update(updatedBusinessFields)
          .eq("id", resolvedBusiness.id)
          .select(
            "id, account_id, billing_status, stripe_price_id, stripe_subscription_id, cancel_at_period_end, current_period_start, current_period_end, billing_started_at, billing_canceled_at"
          )
          .single();

        if (!updateError && refreshedBusiness) {
          resolvedBusiness = refreshedBusiness as BusinessRow;
        }
      } catch {
        // Keep existing DB values if Stripe backfill fails.
      }
    }

    return jsonNoStore(
      {
        subscription: {
          id: resolvedBusiness.id,
          billing_status: resolvedBusiness.billing_status,
          plan_label: resolvePlanLabel(resolvedBusiness.stripe_price_id),
          stripe_price_id: resolvedBusiness.stripe_price_id,
          stripe_subscription_id: resolvedBusiness.stripe_subscription_id,
          cancel_at_period_end: resolvedBusiness.cancel_at_period_end,
          current_period_start: resolvedBusiness.current_period_start,
          current_period_end: resolvedBusiness.current_period_end,
          billing_started_at: resolvedBusiness.billing_started_at,
          billing_canceled_at: resolvedBusiness.billing_canceled_at,
        },
      },
      200
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unexpected subscription lookup error.";
    return jsonNoStore({ error: message }, 500);
  }
}
