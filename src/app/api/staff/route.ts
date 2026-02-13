import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  generatePasscode,
  isValidPasscode,
  normalizePhone,
} from "@/lib/staff-utils";
import { buildRpcErrorPayload } from "@/lib/supabase/rpc-errors";

type StaffRole = "worker" | "manager";

type CreateStaffBody = {
  first_name?: string;
  last_name?: string;
  phone?: string;
  role?: StaffRole;
  email?: string;
  passcode?: string;
};

type ErrorPayload = {
  error: string;
  status: number | null;
  code: string | null;
  details: string | null;
  hint: string | null;
  raw: string;
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

function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(
    value,
    (key, input) => {
      const lowered = key.toLowerCase();
      if (
        lowered.includes("password") ||
        lowered.includes("passcode") ||
        lowered.includes("secret") ||
        lowered.includes("token") ||
        lowered.includes("apikey") ||
        lowered.includes("key")
      ) {
        return "[REDACTED]";
      }

      if (typeof input === "object" && input !== null) {
        if (seen.has(input)) return "[Circular]";
        seen.add(input);
      }

      return input;
    },
    2
  );
}

function toErrorPayload(input: unknown): ErrorPayload {
  const errorObj =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};

  return {
    error:
      (typeof errorObj.message === "string" && errorObj.message) ||
      "Failed to create staff account.",
    status:
      typeof errorObj.status === "number"
        ? errorObj.status
        : typeof errorObj.statusCode === "number"
          ? errorObj.statusCode
          : null,
    code:
      (typeof errorObj.code === "string" && errorObj.code) ||
      (typeof errorObj.error_code === "string" && errorObj.error_code) ||
      (typeof errorObj.name === "string" && errorObj.name) ||
      null,
    details:
      (typeof errorObj.details === "string" && errorObj.details) ||
      (typeof errorObj.error_description === "string" &&
        errorObj.error_description) ||
      null,
    hint:
      (typeof errorObj.hint === "string" && errorObj.hint) ||
      (typeof errorObj.help === "string" && errorObj.help) ||
      null,
    raw: safeStringify(input),
  };
}

function authLogGuidance(): string {
  return "Supabase Dashboard -> Logs: check Auth and Postgres. Filter by 'Database error creating new user', request_id, and this request timestamp.";
}

function normalizeEmail(input: string): string | null {
  const email = input.trim().toLowerCase();
  if (!email) return null;
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  return valid ? email : null;
}

function internalEmailFor(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  const random = crypto.randomUUID().split("-")[0];
  return `staff-${digits}-${random}@internal.crewclock.local`;
}

async function getManagerContext() {
  const sessionClient = await createClient();

  const {
    data: { user },
  } = await sessionClient.auth.getUser();

  if (!user) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const { data: actorProfile, error: profileError } = await sessionClient
    .from("profiles")
    .select("id, company_id, role")
    .eq("id", user.id)
    .single();

  if (profileError || !actorProfile) {
    return {
      error: NextResponse.json(
        { error: "Unable to load your profile." },
        { status: 403 }
      ),
    };
  }

  if (actorProfile.role !== "manager" && actorProfile.role !== "admin") {
    return {
      error: NextResponse.json(
        { error: "Manager or admin access required." },
        { status: 403 }
      ),
    };
  }

  return { sessionClient, actorProfile };
}

export async function POST(request: Request) {
  try {
    const context = await getManagerContext();
    if ("error" in context) return context.error;

    const { sessionClient, actorProfile } = context;
    const admin = createAdminClient();

    const body = (await request.json().catch(() => ({}))) as CreateStaffBody;

    const firstName = (body.first_name ?? "").trim();
    const lastName = (body.last_name ?? "").trim();
    const phone = normalizePhone(body.phone ?? "");
    const role = body.role;
    const providedPasscode = (body.passcode ?? "").trim();

    if (
      !firstName ||
      !lastName ||
      !phone ||
      (role !== "worker" && role !== "manager")
    ) {
      return jsonNoStore(
        { error: "First name, last name, phone, and valid role are required." },
        400
      );
    }

    const requestedEmail = (body.email ?? "").trim();
    const normalizedEmail = normalizeEmail(requestedEmail);
    if (requestedEmail && !normalizedEmail) {
      return jsonNoStore({ error: "Email is invalid." }, 400);
    }

    const passcode = providedPasscode || generatePasscode();
    if (!isValidPasscode(passcode)) {
      return jsonNoStore({ error: "Passcode must be exactly 6 digits." }, 400);
    }

    const email = normalizedEmail ?? internalEmailFor(phone);

    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
    console.info("[staff.create] createUser input", {
      service_role_present: Boolean(serviceRoleKey),
      service_role_length: serviceRoleKey.length,
      email,
      role,
      company_id: actorProfile.company_id,
    });

    const { data: created, error: createError } =
      await admin.auth.admin.createUser({
        email,
        password: passcode,
        email_confirm: true,
        user_metadata: {
          company_id: actorProfile.company_id,
          first_name: firstName,
          last_name: lastName,
          phone,
          role,
        },
      });

    if (createError || !created.user) {
      const errorPayload = toErrorPayload(
        createError ?? new Error("Database error creating new user")
      );

      console.error("[staff.create] createUser failed", {
        ...errorPayload,
        email,
        role,
        company_id: actorProfile.company_id,
      });

      return jsonNoStore(
        {
          ...errorPayload,
          next_steps: authLogGuidance(),
        },
        errorPayload.status ?? 400
      );
    }

    const createdUserId = created.user.id;

    // IMPORTANT: use session-bound client for RPC so auth.uid() is the requester.
    console.info("[staff.create] set_staff_passcode via session client", {
      requester_id: actorProfile.id,
      target_user_id: createdUserId,
    });
    const { error: passcodeError } = await sessionClient.rpc(
      "set_staff_passcode",
      {
        p_user_id: createdUserId,
        p_phone: phone,
        p_passcode: passcode,
      }
    );

    if (passcodeError) {
      await admin.auth.admin.deleteUser(createdUserId);
      return jsonNoStore(
        buildRpcErrorPayload(
          "set_staff_passcode",
          ["p_user_id", "p_phone", "p_passcode"],
          passcodeError
        ),
        400
      );
    }

    const { data: profile } = await admin
      .from("profiles")
      .select(
        "id, company_id, first_name, last_name, phone, role, is_active, created_at"
      )
      .eq("id", createdUserId)
      .single();

    return jsonNoStore(
      {
        staff: profile ?? {
          id: createdUserId,
          company_id: actorProfile.company_id,
          first_name: firstName,
          last_name: lastName,
          phone,
          role,
          is_active: true,
          created_at: new Date().toISOString(),
        },
        passcode,
        generated: !providedPasscode,
      },
      200
    );
  } catch (error: unknown) {
    const errorPayload = toErrorPayload(error);
    console.error("[staff.create] unexpected failure", errorPayload);

    return jsonNoStore(
      {
        ...errorPayload,
        error: "Unexpected staff creation failure.",
        next_steps: authLogGuidance(),
      },
      500
    );
  }
}
