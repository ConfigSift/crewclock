"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createClient } from "@/lib/supabase/client";
import { useAppStore } from "@/lib/store";

type UserRole = "admin" | "manager" | "worker";

type BusinessOption = {
  id: string;
  name: string;
  account_id: string;
};

type CreateBusinessInput = {
  name: string;
  address_line1?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
};

type CreateBusinessResult = {
  business: { id: string; name: string } | null;
  error: string | null;
};

type BusinessContextValue = {
  businesses: BusinessOption[];
  activeBusinessId: string | null;
  activeBusiness: BusinessOption | null;
  selectedBusinessName: string | null;
  setActiveBusinessId: (businessId: string) => void;
  loading: boolean;
  selectionHint: string | null;
  clearSelectionHint: () => void;
  refreshBusinesses: () => Promise<void>;
  createBusiness: (input: CreateBusinessInput) => Promise<CreateBusinessResult>;
};

type ProfileSnapshot = {
  id: string;
  role: UserRole;
  company_id: string;
  account_id: string | null;
  first_name: string;
  last_name: string;
  phone: string;
  is_active: boolean;
  created_at: string;
};

const STORAGE_KEY = "crewclock.activeBusinessId";

const BusinessContext = createContext<BusinessContextValue | undefined>(
  undefined
);

function normalizeBusinessRows(rows: unknown[]): BusinessOption[] {
  const mapped = rows
    .map((row) => row as { id?: string; name?: string; account_id?: string })
    .filter(
      (row) =>
        typeof row.id === "string" &&
        typeof row.name === "string" &&
        typeof row.account_id === "string"
    )
    .map((row) => ({
      id: row.id as string,
      name: row.name as string,
      account_id: row.account_id as string,
    }));

  const deduped = new Map<string, BusinessOption>();
  mapped.forEach((row) => deduped.set(row.id, row));
  return Array.from(deduped.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function BusinessProvider({ children }: { children: React.ReactNode }) {
  const setProfile = useAppStore((s) => s.setProfile);
  const [businesses, setBusinesses] = useState<BusinessOption[]>([]);
  const [actorAccountId, setActorAccountId] = useState<string | null>(null);
  const [activeBusinessIdState, setActiveBusinessIdState] = useState<string | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [selectionHint, setSelectionHint] = useState<string | null>(null);

  const clearSelectionHint = useCallback(() => {
    setSelectionHint(null);
  }, []);

  const refreshBusinesses = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setProfile(null);
      setBusinesses([]);
      setActorAccountId(null);
      setActiveBusinessIdState(null);
      setLoading(false);
      return;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    if (!profile) {
      setProfile(null);
      setBusinesses([]);
      setActorAccountId(null);
      setActiveBusinessIdState(null);
      setLoading(false);
      return;
    }

    const actor = profile as ProfileSnapshot;
    setProfile(actor);

    const actorAccountId = actor.account_id ?? actor.company_id;
    setActorAccountId(actorAccountId);
    let nextBusinesses: BusinessOption[] = [];

    if (actor.role === "admin") {
      const { data: allBusinesses } = await supabase
        .from("businesses")
        .select("id, name, account_id")
        .eq("account_id", actorAccountId)
        .order("name");

      nextBusinesses = normalizeBusinessRows((allBusinesses ?? []) as unknown[]);
    } else {
      const { data: memberships } = await supabase
        .from("business_memberships")
        .select("business:businesses!inner(id, name, account_id)")
        .eq("profile_id", actor.id)
        .eq("is_active", true);

      const rawBusinesses = (memberships ?? [])
        .map(
          (row) =>
            (
              row as {
                business:
                  | { id: string; name: string; account_id: string }
                  | { id: string; name: string; account_id: string }[]
                  | null;
              }
            ).business ?? null
        )
        .flat()
        .filter(Boolean) as unknown[];

      nextBusinesses = normalizeBusinessRows(rawBusinesses);
    }

    setBusinesses(nextBusinesses);

    setActiveBusinessIdState((current) => {
      if (nextBusinesses.length === 0) {
        setSelectionHint(null);
        return null;
      }

      const currentValid =
        typeof current === "string" &&
        nextBusinesses.some((business) => business.id === current);
      if (currentValid) {
        return current;
      }

      const persisted =
        typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
      const persistedValid =
        typeof persisted === "string" &&
        nextBusinesses.some((business) => business.id === persisted);

      if (persistedValid) {
        setSelectionHint(null);
        return persisted;
      }

      const firstBusiness = nextBusinesses[0];
      if (nextBusinesses.length > 1) {
        setSelectionHint(`Viewing ${firstBusiness.name}. Use the switcher to change.`);
      } else {
        setSelectionHint(null);
      }
      return firstBusiness.id;
    });

    setLoading(false);
  }, [setProfile]);

  const createBusiness = useCallback(
    async (input: CreateBusinessInput): Promise<CreateBusinessResult> => {
      try {
        const name = input.name.trim();
        if (!name) {
          return { business: null, error: "Business name is required." };
        }

        const response = await fetch("/api/businesses", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            address_line1: input.address_line1 ?? "",
            city: input.city ?? "",
            state: input.state ?? "",
            postal_code: input.postal_code ?? "",
            country: input.country ?? "",
          }),
        });

        const payload = (await response.json().catch(() => null)) as
          | { error?: string; business?: { id?: string; name?: string } }
          | null;

        const createdId = payload?.business?.id;
        const createdName = payload?.business?.name;

        if (
          !response.ok ||
          typeof createdId !== "string" ||
          typeof createdName !== "string"
        ) {
          return {
            business: null,
            error: payload?.error ?? "Failed to create business.",
          };
        }

        const nextAccountId = actorAccountId ?? businesses[0]?.account_id ?? null;
        if (nextAccountId) {
          setBusinesses((current) =>
            normalizeBusinessRows([
              ...current,
              {
                id: createdId,
                name: createdName,
                account_id: nextAccountId,
              },
            ])
          );
        }

        setSelectionHint(null);
        setActiveBusinessIdState(createdId);
        await refreshBusinesses();

        return {
          business: { id: createdId, name: createdName },
          error: null,
        };
      } catch {
        return {
          business: null,
          error: "Failed to create business.",
        };
      }
    },
    [actorAccountId, businesses, refreshBusinesses]
  );

  useEffect(() => {
    void refreshBusinesses();
  }, [refreshBusinesses]);

  const setActiveBusinessId = useCallback(
    (businessId: string) => {
      const next = businessId.trim();
      if (!next) return;
      if (!businesses.some((business) => business.id === next)) return;
      setSelectionHint(null);
      setActiveBusinessIdState(next);
    },
    [businesses]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (!activeBusinessIdState) {
      window.localStorage.removeItem(STORAGE_KEY);
      document.cookie = `${STORAGE_KEY}=; path=/; max-age=0; samesite=lax`;
      return;
    }

    window.localStorage.setItem(STORAGE_KEY, activeBusinessIdState);
    document.cookie = `${STORAGE_KEY}=${encodeURIComponent(
      activeBusinessIdState
    )}; path=/; max-age=31536000; samesite=lax`;
  }, [activeBusinessIdState]);

  const activeBusiness = useMemo(
    () =>
      activeBusinessIdState
        ? businesses.find((business) => business.id === activeBusinessIdState) ?? null
        : null,
    [businesses, activeBusinessIdState]
  );
  const selectedBusinessName = activeBusiness?.name ?? null;

  const value = useMemo<BusinessContextValue>(
    () => ({
      businesses,
      activeBusinessId: activeBusinessIdState,
      activeBusiness,
      selectedBusinessName,
      setActiveBusinessId,
      loading,
      selectionHint,
      clearSelectionHint,
      refreshBusinesses,
      createBusiness,
    }),
    [
      businesses,
      activeBusinessIdState,
      activeBusiness,
      selectedBusinessName,
      setActiveBusinessId,
      loading,
      selectionHint,
      clearSelectionHint,
      refreshBusinesses,
      createBusiness,
    ]
  );

  return (
    <BusinessContext.Provider value={value}>{children}</BusinessContext.Provider>
  );
}

export function useBusiness() {
  const context = useContext(BusinessContext);
  if (!context) {
    throw new Error("useBusiness must be used within BusinessProvider");
  }
  return context;
}
