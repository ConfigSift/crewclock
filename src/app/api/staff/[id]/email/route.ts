import { createAdminClient } from "@/lib/supabase/admin";
import {
  internalEmailFor,
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

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const userId = id?.trim();

  if (!userId) {
    return jsonNoStore({ error: "Staff id is required." }, 400);
  }

  const guard = await requireOwnerOrAdminForTarget(userId);
  if ("error" in guard) return guard.error;

  const body = (await request.json().catch(() => ({}))) as Body;
  const requestedEmail = normalizeEmail(body.email ?? "");
  let email = requestedEmail;

  if (guard.target.role === "worker" && !requestedEmail) {
    email = internalEmailFor(guard.target.phone, userId);
  }

  if (!email || !isValidEmail(email)) {
    return jsonNoStore({ error: "Valid email is required." }, 400);
  }

  if (guard.target.role !== "worker" && isInternalEmail(email)) {
    return jsonNoStore(
      { error: "Use a real email address, not the internal placeholder domain." },
      400
    );
  }

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.updateUserById(userId, { email });

  if (error) {
    return jsonNoStore(serializeError(error), 400);
  }

  return jsonNoStore(
    {
      email: data.user?.email ?? email,
      email_confirmed_at: data.user?.email_confirmed_at ?? null,
      message:
        data.user?.email_confirmed_at === null
          ? "Email updated. Confirmation may be required by your Supabase settings."
          : "Email updated successfully.",
    },
    200
  );
}
