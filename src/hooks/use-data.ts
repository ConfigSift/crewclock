"use client";

import { useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAppStore } from "@/lib/store";
import type { Profile } from "@/types/database";

// Load initial data scoped to active business
export function useInitialData(activeBusinessId: string | null = null) {
  const {
    profile,
    setProfile,
    setProjects,
    setActiveEntry,
    setTimeEntries,
    setEmployees,
    setActiveSessions,
  } = useAppStore();

  const loadData = useCallback(async () => {
    const supabase = createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setProjects([]);
      setActiveEntry(null);
      setTimeEntries([]);
      setEmployees([]);
      setActiveSessions([]);
      return;
    }

    const { data: prof } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    if (!prof) {
      setProjects([]);
      setActiveEntry(null);
      setTimeEntries([]);
      setEmployees([]);
      setActiveSessions([]);
      return;
    }

    setProfile(prof as Profile);

    const businessId = activeBusinessId ?? prof.company_id ?? null;

    if (!businessId) {
      setProjects([]);
      setActiveEntry(null);
      setTimeEntries([]);
      setEmployees([]);
      setActiveSessions([]);
      return;
    }

    const isManager = prof.role === "manager" || prof.role === "admin";

    if (isManager) {
      const { data: projects } = await supabase
        .from("projects")
        .select("*")
        .eq("business_id", businessId)
        .order("created_at", { ascending: false });
      setProjects(projects || []);
    } else {
      const { data: projects } = await supabase
        .from("projects")
        .select("*")
        .eq("business_id", businessId)
        .eq("status", "active")
        .order("name");
      setProjects(projects || []);
    }

    const { data: active } = await supabase
      .from("time_entries")
      .select("*")
      .eq("employee_id", user.id)
      .eq("business_id", businessId)
      .is("clock_out", null)
      .limit(1)
      .single();
    setActiveEntry(active || null);

    if (isManager) {
      const { data: entries } = await supabase
        .from("time_entries")
        .select("*, profiles(first_name, last_name, phone), projects(name, address)")
        .eq("business_id", businessId)
        .order("clock_in", { ascending: false })
        .limit(200);
      setTimeEntries(entries || []);

      const { data: memberships } = await supabase
        .from("business_memberships")
        .select("profiles(*)")
        .eq("business_id", businessId)
        .eq("is_active", true);

      const emps = (memberships ?? [])
        .map(
          (row) =>
            (row as { profiles: Profile | Profile[] | null }).profiles ?? null
        )
        .flat()
        .filter(Boolean) as Profile[];

      setEmployees(
        emps.sort((a, b) =>
          `${a.first_name} ${a.last_name}`.localeCompare(
            `${b.first_name} ${b.last_name}`
          )
        )
      );

      const { data: sessions } = await supabase
        .from("v_active_sessions")
        .select("*")
        .eq("business_id", businessId);
      setActiveSessions(sessions || []);
    } else {
      const { data: entries } = await supabase
        .from("time_entries")
        .select("*, projects(name, address)")
        .eq("employee_id", user.id)
        .eq("business_id", businessId)
        .order("clock_in", { ascending: false })
        .limit(100);
      setTimeEntries(entries || []);
      setEmployees([]);
      setActiveSessions([]);
    }
  }, [
    setProfile,
    setProjects,
    setActiveEntry,
    setTimeEntries,
    setEmployees,
    setActiveSessions,
    activeBusinessId,
  ]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  return { profile, reload: loadData };
}

// Real-time subscription for manager dashboard
export function useRealtimeSubscription(
  activeBusinessId: string | null,
  reload: () => Promise<void>
) {
  const profile = useAppStore((s) => s.profile);

  useEffect(() => {
    if (
      !profile ||
      !activeBusinessId ||
      (profile.role !== "manager" && profile.role !== "admin")
    ) {
      return;
    }

    const supabase = createClient();

    const channel = supabase
      .channel(`business-updates-${activeBusinessId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "time_entries",
          filter: `business_id=eq.${activeBusinessId}`,
        },
        () => {
          void reload();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "projects",
          filter: `business_id=eq.${activeBusinessId}`,
        },
        () => {
          void reload();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile, reload, activeBusinessId]);
}
