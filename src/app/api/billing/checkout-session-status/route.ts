import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getSubscriptionPriceId,
  mapStripeSubscriptionStatusToBillingStatus,
  retrieveCheckoutSession,
  retrieveSubscription,
  type StripeSubscription,
} from "@/lib/billing/stripe";

type ActorProfile = {
  id: string;
  role: "admin" | "manager" | "worker";
  company_id: string;
  account_id: string | null;
  is_active: boolean;
  onboarding_step_completed: number | null;
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
  billing_started_at: string | null;
};

function unixSecondsToIso(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return new Date(value * 1000).toISOString();
}

function jsonNoStore(payload: Record<string, unknown>, status: number) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      Pragma: "no-cache",
    },
  });
}

export async function GET(request: Request) {
  try {
    const requestUrl = new URL(request.url);
    const sessionId = requestUrl.searchParams.get("session_id")?.trim() ?? "";
    if (!sessionId) {
      return jsonNoStore({ error: "session_id is required." }, 400);
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
      .select("id, role, company_id, account_id, is_active, onboarding_step_completed")
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

    const checkoutSession = await retrieveCheckoutSession(sessionId);
    const checkoutIntent = checkoutSession.metadata?.intent ?? "existing_business";
    const businessId =
      checkoutSession.metadata?.business_id ??
      checkoutSession.client_reference_id ??
      null;
    const actorAccountId = actorProfile.account_id ?? actorProfile.company_id;

    const sessionComplete =
      checkoutSession.status === "complete" ||
      checkoutSession.payment_status === "paid";
    let subscription: StripeSubscription | null = null;

    if (sessionComplete) {
      if (typeof checkoutSession.subscription === "string") {
        subscription = await retrieveSubscription(checkoutSession.subscription);
      } else if (checkoutSession.subscription) {
        subscription = checkoutSession.subscription;
      }
    }

    if (checkoutIntent === "new_business") {
      const sessionAccountId = checkoutSession.metadata?.account_id ?? null;
      if (sessionAccountId && sessionAccountId !== actorAccountId) {
        return jsonNoStore(
          { error: "You do not have access to that checkout session." },
          403
        );
      }

      const billingStatus = subscription
        ? mapStripeSubscriptionStatusToBillingStatus(subscription.status)
        : null;
      const priceId = subscription ? getSubscriptionPriceId(subscription) : null;
      return jsonNoStore(
        {
          complete: Boolean(sessionComplete),
          status: checkoutSession.status ?? null,
          paymentStatus: checkoutSession.payment_status ?? null,
          billingStatus,
          subscriptionId: subscription?.id ?? null,
          priceId,
          intent: "new_business",
        },
        200
      );
    }

    if (!businessId) {
      return jsonNoStore({ error: "Could not resolve business for checkout session." }, 400);
    }

    const admin = createAdminClient();
    const { data: business, error: businessError } = await admin
      .from("businesses")
      .select("id, account_id, billing_status, billing_started_at")
      .eq("id", businessId)
      .single();

    if (businessError || !business) {
      return jsonNoStore({ error: "Business not found." }, 404);
    }

    const businessRow = business as BusinessRow;
    if (businessRow.account_id !== actorAccountId) {
      return jsonNoStore(
        { error: "You do not have access to that checkout session." },
        403
      );
    }

    if (sessionComplete && subscription) {
      const billingStatus = mapStripeSubscriptionStatusToBillingStatus(subscription.status);
      const priceId = getSubscriptionPriceId(subscription);
      const updates: Record<string, unknown> = {
        billing_status: billingStatus,
        stripe_customer_id:
          typeof checkoutSession.customer === "string"
            ? checkoutSession.customer
            : subscription.customer,
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

      const { error: updateBusinessError } = await admin
        .from("businesses")
        .update(updates)
        .eq("id", businessRow.id);

      if (updateBusinessError) {
        return jsonNoStore(
          {
            error: "Unable to update business billing status.",
            code: updateBusinessError.code ?? null,
            details: updateBusinessError.details ?? null,
            hint: updateBusinessError.hint ?? null,
          },
          400
        );
      }

      if ((actorProfile.onboarding_step_completed ?? 0) < 3) {
        await admin
          .from("profiles")
          .update({ onboarding_step_completed: 3 })
          .eq("id", actorProfile.id);
      }

      return jsonNoStore(
        {
          complete: true,
          nextPath: "/dashboard",
          billingStatus,
          subscriptionId: subscription.id,
          priceId,
        },
        200
      );
    }

    return jsonNoStore(
      {
        complete: false,
        status: checkoutSession.status ?? null,
        paymentStatus: checkoutSession.payment_status ?? null,
      },
      200
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unexpected billing status error.";
    return jsonNoStore({ error: message }, 500);
  }
}
