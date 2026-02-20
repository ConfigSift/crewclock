import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  clearEmployeeLoginFailures,
  getEmployeeLoginLimit,
  recordEmployeeLoginFailure,
} from "@/lib/auth-rate-limit";
import { isValidPasscode, normalizePhone } from "@/lib/staff-utils";
import { buildRpcErrorPayload } from "@/lib/supabase/rpc-errors";

type EmployeeLoginBody = {
  phone?: string;
  passcode?: string;
};

const EMPLOYEE_LOGIN_VERSION = "v2";
const EMPLOYEE_LOGIN_BUILD = "2026-02-20a";

function withVersion(res: NextResponse) {
  res.headers.set("X-CrewClock-EmployeeLogin", EMPLOYEE_LOGIN_VERSION);
  res.headers.set("X-CrewClock-EmployeeLogin-Build", EMPLOYEE_LOGIN_BUILD);
  return res;
}

function jsonNoStore(payload: Record<string, unknown>, status: number) {
  const res = NextResponse.json(payload, { status });
  res.headers.set("Cache-Control", "no-store, max-age=0");
  res.headers.set("Pragma", "no-cache");
  return withVersion(res);
}

function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

function lockoutMessage(retryAfterMs: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterMs / 60000));
  return `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as EmployeeLoginBody;

  const phone = normalizePhone(body.phone ?? "");
  const passcode = (body.passcode ?? "").trim();
  const ip = getClientIp(request);

  if (!phone || !isValidPasscode(passcode)) {
    return jsonNoStore(
      { code: "INVALID_INPUT", error: "Enter a valid phone and 6-digit passcode." },
      400
    );
  }

  const limitStatus = getEmployeeLoginLimit(ip, phone);
  if (!limitStatus.allowed) {
    return jsonNoStore(
      {
        code: "LOCKED_OUT",
        error: lockoutMessage(limitStatus.retryAfterMs),
        retry_after_seconds: Math.ceil(limitStatus.retryAfterMs / 1000),
      },
      429
    );
  }

  const admin = createAdminClient();

  const { data: verifiedUserId, error: verifyError } = await admin.rpc(
    "verify_staff_passcode",
    {
      p_phone: phone,
      p_passcode: passcode,
    }
  );

  if (verifyError) {
    return jsonNoStore(
      buildRpcErrorPayload(
        "verify_staff_passcode",
        ["p_phone", "p_passcode"],
        verifyError
      ),
      500
    );
  }

  if (!verifiedUserId) {
    const failure = recordEmployeeLoginFailure(ip, phone);
    if (!failure.allowed) {
      return jsonNoStore(
        {
          code: "LOCKED_OUT",
          error: lockoutMessage(failure.retryAfterMs),
          retry_after_seconds: Math.ceil(failure.retryAfterMs / 1000),
        },
        429
      );
    }
    return jsonNoStore(
      { code: "INVALID_CREDENTIALS", error: "Invalid phone number or passcode." },
      401
    );
  }

  const { data: userResult, error: userError } = await admin.auth.admin.getUserById(
    verifiedUserId
  );

  if (userError || !userResult.user?.email) {
    const failure = recordEmployeeLoginFailure(ip, phone);
    if (!failure.allowed) {
      return jsonNoStore(
        {
          code: "LOCKED_OUT",
          error: lockoutMessage(failure.retryAfterMs),
          retry_after_seconds: Math.ceil(failure.retryAfterMs / 1000),
        },
        429
      );
    }
    return jsonNoStore(
      { code: "INVALID_CREDENTIALS", error: "Invalid phone number or passcode." },
      401
    );
  }

  // Use SSR server client for employee sign-in so web auth cookies are written.
  const supabase = await createClient();
  const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
    email: userResult.user.email,
    password: passcode,
  });

  if (signInError) {
    const failure = recordEmployeeLoginFailure(ip, phone);
    if (!failure.allowed) {
      return jsonNoStore(
        {
          code: "LOCKED_OUT",
          error: lockoutMessage(failure.retryAfterMs),
          retry_after_seconds: Math.ceil(failure.retryAfterMs / 1000),
        },
        429
      );
    }

    return jsonNoStore(
      {
        code: "INVALID_CREDENTIALS",
        error: signInError.message || "Invalid phone number or passcode.",
      },
      401
    );
  }

  if (!signInData.session) {
    return jsonNoStore(
      {
        code: "TOKEN_MISSING",
        error: "Session missing after signInWithPassword",
      },
      500
    );
  }

  clearEmployeeLoginFailures(ip, phone);

  const accessToken = signInData.session.access_token;
  const refreshToken = signInData.session.refresh_token;

  if (!accessToken || !refreshToken) {
    return jsonNoStore(
      {
        code: "TOKEN_MISSING",
        error: "Employee login succeeded but tokens are missing.",
      },
      500
    );
  }

  return jsonNoStore(
    {
      success: true,
      access_token: accessToken,
      refresh_token: refreshToken,
    },
    200
  );
}

/*
Local verification:
- Correct creds -> 200 JSON includes: success, access_token, refresh_token
- Wrong creds -> 401 JSON includes: code, error
*/
