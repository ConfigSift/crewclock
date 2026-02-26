import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

type ProvisionResult = {
  ok: boolean;
  error?: string;
  onboardingStepCompleted?: number | null;
};

type ProfileRow = {
  id: string;
  role: "admin" | "manager" | "worker";
  company_id: string | null;
  account_id: string | null;
  is_active: boolean | null;
  onboarding_step_completed: number | null;
};

type CompanyRow = {
  id: string;
  name: string | null;
};

type AccountRow = {
  id: string;
};

function toSlug(input: string): string {
  const normalized = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "crewclock-account";
}

function displayNameFromEmail(email: string | null | undefined): string {
  if (!email) return "CrewClock Company";
  const local = email.split("@")[0] ?? "";
  const spaced = local.replace(/[._-]+/g, " ").trim();
  if (!spaced) return "CrewClock Company";
  return spaced
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function internalPhoneForUser(userId: string): string {
  const seed = userId.replace(/-/g, "").toLowerCase();
  const digits = seed
    .split("")
    .map((ch) => {
      if (/[0-9]/.test(ch)) return ch;
      return String((ch.charCodeAt(0) - 87) % 10);
    })
    .join("");

  const body = `9${digits}`.slice(0, 15);
  const padded = body.length < 8 ? `${body}${"7".repeat(8 - body.length)}` : body;
  return `+${padded}`;
}

async function upsertProfileWithFallback(
  admin: ReturnType<typeof createAdminClient>,
  payload: Record<string, unknown>
) {
  const withOnboarding = await admin
    .from("profiles")
    .upsert(payload, { onConflict: "id" })
    .select("id, role, company_id, account_id, is_active, onboarding_step_completed")
    .single();

  if (!withOnboarding.error) return withOnboarding;

  const message = withOnboarding.error.message ?? "";
  const onboardingColumnMissing =
    withOnboarding.error.code === "PGRST204" ||
    message.toLowerCase().includes("onboarding_step_completed");

  if (!onboardingColumnMissing) return withOnboarding;

  const { onboarding_step_completed: _ignored, ...withoutOnboarding } = payload;
  return admin
    .from("profiles")
    .upsert(withoutOnboarding, { onConflict: "id" })
    .select("id, role, company_id, account_id, is_active")
    .single();
}

async function updateProfileWithFallback(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  payload: Record<string, unknown>
) {
  const withOnboarding = await admin
    .from("profiles")
    .update(payload)
    .eq("id", userId)
    .select("id, role, company_id, account_id, is_active, onboarding_step_completed")
    .single();

  if (!withOnboarding.error) return withOnboarding;

  const message = withOnboarding.error.message ?? "";
  const onboardingColumnMissing =
    withOnboarding.error.code === "PGRST204" ||
    message.toLowerCase().includes("onboarding_step_completed");

  if (!onboardingColumnMissing) return withOnboarding;

  const { onboarding_step_completed: _ignored, ...withoutOnboarding } = payload;
  return admin
    .from("profiles")
    .update(withoutOnboarding)
    .eq("id", userId)
    .select("id, role, company_id, account_id, is_active")
    .single();
}

async function ensureCompany(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  email?: string
): Promise<CompanyRow | null> {
  const { data: ownedCompany } = await admin
    .from("companies")
    .select("id, name")
    .eq("owner_user_id", userId)
    .maybeSingle();

  if (ownedCompany) return ownedCompany as CompanyRow;

  const baseName = displayNameFromEmail(email);
  const slugBase = toSlug(baseName);
  const slug = `${slugBase}-${userId.slice(0, 8)}`;

  const { data: created, error } = await admin
    .from("companies")
    .insert({
      name: baseName,
      slug,
      owner_user_id: userId,
    })
    .select("id, name")
    .single();

  if (!error && created) return created as CompanyRow;

  const { data: fallbackCompany } = await admin
    .from("companies")
    .select("id, name")
    .eq("slug", slug)
    .maybeSingle();

  return (fallbackCompany as CompanyRow | null) ?? null;
}

async function ensureAccount(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  companyId: string | null,
  existingAccountId: string | null
): Promise<string | null> {
  if (existingAccountId) {
    await admin
      .from("accounts")
      .upsert(
        { id: existingAccountId, owner_profile_id: userId },
        { onConflict: "id" }
      );
    return existingAccountId;
  }

  const { data: ownedAccount } = await admin
    .from("accounts")
    .select("id")
    .eq("owner_profile_id", userId)
    .maybeSingle();

  if (ownedAccount?.id) return (ownedAccount as AccountRow).id;

  if (companyId) {
    const { data: companyLinkedAccount } = await admin
      .from("accounts")
      .upsert(
        { id: companyId, owner_profile_id: userId },
        { onConflict: "id" }
      )
      .select("id")
      .single();

    if (companyLinkedAccount?.id) {
      return (companyLinkedAccount as AccountRow).id;
    }
  }

  const { data: createdAccount } = await admin
    .from("accounts")
    .insert({ owner_profile_id: userId })
    .select("id")
    .single();

  return (createdAccount as AccountRow | null)?.id ?? null;
}

async function ensureDefaultBusiness(
  admin: ReturnType<typeof createAdminClient>,
  accountId: string,
  companyId: string | null,
  fallbackName: string
): Promise<boolean> {
  const { data: existing } = await admin
    .from("businesses")
    .select("id")
    .eq("account_id", accountId)
    .limit(1);

  if ((existing ?? []).length > 0) return true;

  const insertPayload: Record<string, unknown> = {
    account_id: accountId,
    name: fallbackName || "Main Business",
    billing_status: "inactive",
  };

  if (companyId) {
    insertPayload.id = companyId;
  }

  const { error: insertError } = await admin.from("businesses").insert(insertPayload);
  if (!insertError) return true;

  if (!companyId) return false;

  const { id: _ignored, ...retryPayload } = insertPayload;
  const { error: retryError } = await admin.from("businesses").insert(retryPayload);
  return !retryError;
}

export async function ensureAdminProvisionedForUser(
  userId: string,
  email?: string
): Promise<ProvisionResult> {
  try {
    const admin = createAdminClient();

    const { data: existingProfile, error: profileLookupError } = await admin
      .from("profiles")
      .select("id, role, company_id, account_id, is_active, onboarding_step_completed")
      .eq("id", userId)
      .maybeSingle();

    if (profileLookupError) {
      return { ok: false, error: "Unable to load user profile." };
    }

    let profile = (existingProfile as ProfileRow | null) ?? null;

    if (!profile) {
      const company = await ensureCompany(admin, userId, email);
      if (!company?.id) {
        return { ok: false, error: "Unable to provision company." };
      }

      const accountId = await ensureAccount(admin, userId, company.id, null);
      if (!accountId) {
        return { ok: false, error: "Unable to provision account." };
      }

      const upsertResult = await upsertProfileWithFallback(admin, {
        id: userId,
        role: "admin",
        company_id: company.id,
        account_id: accountId,
        onboarding_step_completed: 0,
        is_active: true,
        first_name: "",
        last_name: "",
        phone: internalPhoneForUser(userId),
      });

      if (upsertResult.error || !upsertResult.data) {
        return { ok: false, error: "Unable to provision admin profile." };
      }

      profile = upsertResult.data as ProfileRow;
      const businessReady = await ensureDefaultBusiness(
        admin,
        accountId,
        company.id,
        company.name ?? "Main Business"
      );
      if (!businessReady) {
        return { ok: false, error: "Unable to provision default business." };
      }

      return {
        ok: true,
        onboardingStepCompleted: profile.onboarding_step_completed ?? 0,
      };
    }

    const companyId = profile.company_id ?? null;
    const accountId = await ensureAccount(
      admin,
      userId,
      companyId,
      profile.account_id ?? null
    );

    if (!accountId) {
      return { ok: false, error: "Unable to backfill account." };
    }

    const profileUpdate: Record<string, unknown> = {};
    if (!profile.account_id) profileUpdate.account_id = accountId;
    if (profile.is_active === false) profileUpdate.is_active = true;
    if (profile.onboarding_step_completed === null) {
      profileUpdate.onboarding_step_completed = 0;
    }

    if (Object.keys(profileUpdate).length > 0) {
      const updateResult = await updateProfileWithFallback(admin, userId, profileUpdate);
      if (!updateResult.error && updateResult.data) {
        profile = updateResult.data as ProfileRow;
      }
    }

    const fallbackBusinessName = displayNameFromEmail(email);
    const businessReady = await ensureDefaultBusiness(
      admin,
      accountId,
      companyId,
      fallbackBusinessName
    );
    if (!businessReady) {
      return { ok: false, error: "Unable to provision default business." };
    }

    return {
      ok: true,
      onboardingStepCompleted: profile.onboarding_step_completed,
    };
  } catch {
    return { ok: false, error: "Unexpected provisioning failure." };
  }
}
