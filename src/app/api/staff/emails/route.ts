import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { jsonNoStore, serializeError } from "@/app/api/staff/_shared";

const MAX_IDS = 200;

type EmailMap = Record<
  string,
  {
    email: string | null;
    email_confirmed_at: string | null;
  }
>;

async function requireOwnerOrAdmin() {
  const sessionClient = await createClient();
  const {
    data: { user },
  } = await sessionClient.auth.getUser();

  if (!user) {
    return { error: jsonNoStore({ error: "Unauthorized" }, 401) };
  }

  const { data: actor } = await sessionClient
    .from("profiles")
    .select("id, role, company_id")
    .eq("id", user.id)
    .single();

  if (!actor) {
    return { error: jsonNoStore({ error: "Unable to load your profile." }, 403) };
  }

  const { data: company } = await sessionClient
    .from("companies")
    .select("owner_user_id")
    .eq("id", actor.company_id)
    .single();

  const isOwner = company?.owner_user_id === actor.id;
  const isAdmin = actor.role === "admin";

  if (!isOwner && !isAdmin) {
    return { error: jsonNoStore({ error: "Owner or admin access required." }, 403) };
  }

  return { sessionClient, companyId: actor.company_id as string };
}

export async function GET(request: Request) {
  const context = await requireOwnerOrAdmin();
  if ("error" in context) return context.error;

  const { sessionClient, companyId } = context;
  const { searchParams } = new URL(request.url);
  const ids = (searchParams.get("ids") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, MAX_IDS);

  if (ids.length === 0) {
    return jsonNoStore({ emails: {} }, 200);
  }

  const { data: companyProfiles, error: companyProfilesError } = await sessionClient
    .from("profiles")
    .select("id")
    .eq("company_id", companyId)
    .in("id", ids);

  if (companyProfilesError) {
    return jsonNoStore(serializeError(companyProfilesError), 400);
  }

  const allowedIds = (companyProfiles ?? []).map((profile) => profile.id);
  if (allowedIds.length === 0) {
    return jsonNoStore({ emails: {} }, 200);
  }

  const admin = createAdminClient();
  const emails: EmailMap = {};

  await Promise.all(
    allowedIds.map(async (id) => {
      const { data, error } = await admin.auth.admin.getUserById(id);
      if (error) return;
      emails[id] = {
        email: data.user?.email ?? null,
        email_confirmed_at: data.user?.email_confirmed_at ?? null,
      };
    })
  );

  return jsonNoStore({ emails }, 200);
}
