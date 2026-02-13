import { createAdminClient } from "@/lib/supabase/admin";
import {
  jsonNoStore,
  requireOwnerOrAdminForTarget,
  serializeError,
} from "@/app/api/staff/_shared";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const userId = id?.trim();

  if (!userId) {
    return jsonNoStore({ error: "Staff id is required." }, 400);
  }

  const guard = await requireOwnerOrAdminForTarget(userId);
  if ("error" in guard) return guard.error;

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.getUserById(userId);

  if (error) {
    return jsonNoStore(serializeError(error), 400);
  }

  return jsonNoStore(
    {
      email: data.user?.email ?? null,
      email_confirmed_at: data.user?.email_confirmed_at ?? null,
    },
    200
  );
}
