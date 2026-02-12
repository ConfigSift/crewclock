"use client";

import { useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAppStore } from "@/lib/store";
import type { Profile } from "@/types/database";

// ─── Load initial data based on role ─────────────────
export function useInitialData() {
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

    // Get current user
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    // Get profile
    const { data: prof } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();
    if (!prof) return;
    setProfile(prof as Profile);

    const isManager = prof.role === "manager" || prof.role === "admin";

    // Load projects
    if (isManager) {
      const { data: projects } = await supabase
        .from("projects")
        .select("*")
        .eq("company_id", prof.company_id)
        .order("created_at", { ascending: false });
      setProjects(projects || []);
    } else {
      const { data: projects } = await supabase
        .from("projects")
        .select("*")
        .eq("company_id", prof.company_id)
        .eq("status", "active")
        .order("name");
      setProjects(projects || []);
    }

    // Load active entry (worker)
    const { data: active } = await supabase
      .from("time_entries")
      .select("*")
      .eq("employee_id", user.id)
      .is("clock_out", null)
      .limit(1)
      .single();
    setActiveEntry(active || null);

    // Load recent time entries
    if (isManager) {
      const { data: entries } = await supabase
        .from("time_entries")
        .select("*, profiles(first_name, last_name, phone), projects(name, address)")
        .eq("company_id", prof.company_id)
        .order("clock_in", { ascending: false })
        .limit(200);
      setTimeEntries(entries || []);

      // Load employees
      const { data: emps } = await supabase
        .from("profiles")
        .select("*")
        .eq("company_id", prof.company_id)
        .eq("is_active", true)
        .order("first_name");
      setEmployees(emps || []);

      // Load active sessions
      const { data: sessions } = await supabase
        .from("v_active_sessions")
        .select("*")
        .eq("company_id", prof.company_id);
      setActiveSessions(sessions || []);
    } else {
      const { data: entries } = await supabase
        .from("time_entries")
        .select("*, projects(name, address)")
        .eq("employee_id", user.id)
        .order("clock_in", { ascending: false })
        .limit(100);
      setTimeEntries(entries || []);
    }
  }, [
    setProfile,
    setProjects,
    setActiveEntry,
    setTimeEntries,
    setEmployees,
    setActiveSessions,
  ]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  return { profile, reload: loadData };
}

// ─── Real-time subscription for manager dashboard ────
export function useRealtimeSubscription() {
  const profile = useAppStore((s) => s.profile);
  const reload = useInitialData().reload;

  useEffect(() => {
    if (!profile || (profile.role !== "manager" && profile.role !== "admin"))
      return;

    const supabase = createClient();

    const channel = supabase
      .channel("company-updates")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "time_entries",
          filter: `company_id=eq.${profile.company_id}`,
        },
        () => {
          // Reload all data on any time entry change
          reload();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "projects",
          filter: `company_id=eq.${profile.company_id}`,
        },
        () => {
          reload();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile, reload]);
}
