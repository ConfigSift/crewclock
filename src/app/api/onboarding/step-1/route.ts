import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type StepOneBody = {
  first_name?: string;
  last_name?: string;
  business_name?: string;
  address_line1?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
};

type StepOneField = "first_name" | "last_name" | "business_name";
type FieldErrors = Partial<Record<StepOneField, string>>;

type StepOneRpcResult = {
  ok?: boolean;
  already_completed?: boolean;
  next_path?: string;
  onboarding_step_completed?: number;
  business_id?: string;
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

function trimToNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function validateRequired(body: StepOneBody): {
  values: {
    firstName: string;
    lastName: string;
    businessName: string;
  };
  fieldErrors: FieldErrors;
} {
  const firstName = (body.first_name ?? "").trim();
  const lastName = (body.last_name ?? "").trim();
  const businessName = (body.business_name ?? "").trim();

  const fieldErrors: FieldErrors = {};
  if (!firstName) fieldErrors.first_name = "First name is required.";
  if (!lastName) fieldErrors.last_name = "Last name is required.";
  if (!businessName) fieldErrors.business_name = "Business name is required.";

  return {
    values: { firstName, lastName, businessName },
    fieldErrors,
  };
}

function inferFieldErrorsFromMessage(message: string): FieldErrors {
  const fieldErrors: FieldErrors = {};
  if (message === "First name is required.") {
    fieldErrors.first_name = message;
  } else if (message === "Last name is required.") {
    fieldErrors.last_name = message;
  } else if (message === "Business name is required.") {
    fieldErrors.business_name = message;
  }
  return fieldErrors;
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return jsonNoStore({ error: "Unauthorized" }, 401);
    }

    const body = (await request.json().catch(() => ({}))) as StepOneBody;
    const validation = validateRequired(body);

    if (Object.keys(validation.fieldErrors).length > 0) {
      return jsonNoStore(
        {
          error: "Please correct the highlighted fields.",
          fieldErrors: validation.fieldErrors,
        },
        400
      );
    }

    const { data, error } = await supabase.rpc("complete_onboarding_step_1", {
      p_first_name: validation.values.firstName,
      p_last_name: validation.values.lastName,
      p_business_name: validation.values.businessName,
      p_address_line1: trimToNull(body.address_line1),
      p_city: trimToNull(body.city),
      p_state: trimToNull(body.state),
      p_postal_code: trimToNull(body.postal_code),
      p_country: trimToNull(body.country),
    });

    if (error) {
      const message = error.message ?? "Unable to complete onboarding step 1.";

      if (error.code === "23505" || message.includes("already exists")) {
        return jsonNoStore(
          {
            error: "A business with this name already exists in your account.",
            fieldErrors: {
              business_name: "A business with this name already exists in your account.",
            },
          },
          409
        );
      }

      if (message === "Unauthorized") {
        return jsonNoStore({ error: "Unauthorized" }, 401);
      }

      if (message === "Admin access required." || message === "Your account is inactive.") {
        return jsonNoStore({ error: message }, 403);
      }

      const fieldErrors = inferFieldErrorsFromMessage(message);
      if (Object.keys(fieldErrors).length > 0) {
        return jsonNoStore(
          {
            error: "Please correct the highlighted fields.",
            fieldErrors,
          },
          400
        );
      }

      return jsonNoStore({ error: message }, 400);
    }

    const payload = (data as StepOneRpcResult | null) ?? {};
    const nextPath =
      typeof payload.next_path === "string" && payload.next_path.startsWith("/")
        ? payload.next_path
        : "/onboarding/step-2";

    return jsonNoStore(
      {
        ok: true,
        nextPath,
        onboarding_step_completed: payload.onboarding_step_completed ?? 1,
        business_id: payload.business_id ?? null,
      },
      200
    );
  } catch {
    return jsonNoStore({ error: "Unexpected onboarding step 1 failure." }, 500);
  }
}
