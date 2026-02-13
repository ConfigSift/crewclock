import { createAdminClient } from "@/lib/supabase/admin";
import {
  isInternalEmail,
  isValidEmail,
  jsonNoStore,
  normalizeEmail,
  requireOwnerOrAdminForTarget,
  serializeError,
} from "@/app/api/staff/_shared";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type Body = {
  email?: string;
};

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const userId = id?.trim();

  if (!userId) {
    return jsonNoStore({ error: "Staff id is required." }, 400);
  }

  const guard = await requireOwnerOrAdminForTarget(userId);
  if ("error" in guard) return guard.error;

  if (guard.target.role === "worker") {
    return jsonNoStore(
      { error: "Workers use phone + passcode and do not support email reset." },
      400
    );
  }

  const body = (await request.json().catch(() => ({}))) as Body;
  const bodyEmail = normalizeEmail(body.email ?? "");

  const admin = createAdminClient();
  const { data: authUser, error: authUserError } = await admin.auth.admin.getUserById(
    userId
  );

  if (authUserError) {
    return jsonNoStore(serializeError(authUserError), 400);
  }

  const email = bodyEmail || normalizeEmail(authUser.user?.email ?? "");
  if (!email || !isValidEmail(email)) {
    return jsonNoStore({ error: "No valid email is set for this account." }, 400);
  }

  if (isInternalEmail(email)) {
    return jsonNoStore(
      { error: "Set a real email before sending password reset." },
      400
    );
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  const redirectBase = appUrl || new URL(request.url).origin;

  // Use anon/session client for outbound reset email flow.
  const { error: resetError } = await guard.sessionClient.auth.resetPasswordForEmail(
    email,
    {
      redirectTo: `${redirectBase}/reset-password`,
    }
  );

  if (resetError) {
    return jsonNoStore(serializeError(resetError), 400);
  }

  return jsonNoStore(
    { message: "If the email exists, a reset link was sent." },
    200
  );
}
