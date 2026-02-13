"use client";

import { createClient } from "@/lib/supabase/client";
import type {
  ClockInResponse,
  ClockOutResponse,
  Project,
} from "@/types/database";

type SupabaseError = {
  message: string;
  details?: string | null;
};

function formatSupabaseError(error: SupabaseError): string {
  const details = error.details?.trim();
  return details ? `${error.message} (${details})` : error.message;
}

export async function clockIn(
  projectId: string,
  lat: number,
  lng: number
): Promise<ClockInResponse> {
  const supabase = createClient();

  const { data, error } = await supabase.rpc("clock_in", {
    p_project_id: projectId,
    p_lat: lat,
    p_lng: lng,
  });

  if (error) {
    return { error: error.message };
  }

  return data as ClockInResponse;
}

export async function clockOut(
  lat?: number,
  lng?: number
): Promise<ClockOutResponse> {
  const supabase = createClient();

  const { data, error } = await supabase.rpc("clock_out", {
    p_lat: lat || null,
    p_lng: lng || null,
  });

  if (error) {
    return { error: error.message };
  }

  return data as ClockOutResponse;
}

export async function createProject(
  data: Omit<Project, "id" | "created_at" | "updated_at" | "created_by">
): Promise<{ project?: Project; error?: string }> {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: project, error } = await supabase
    .from("projects")
    .insert({ ...data, created_by: user.id })
    .select()
    .single();

  if (error) return { error: error.message };
  return { project: project as Project };
}

export async function updateProject(
  id: string,
  data: Partial<
    Pick<Project, "name" | "address" | "lat" | "lng" | "geo_radius_m" | "status">
  >
): Promise<{ project?: Project; error?: string }> {
  const supabase = createClient();

  const { data: project, error } = await supabase
    .from("projects")
    .update(data)
    .eq("id", id)
    .select()
    .single();

  if (error) return { error: error.message };
  return { project: project as Project };
}

export async function deleteProject(id: string): Promise<{ error?: string }> {
  const supabase = createClient();
  const { error } = await supabase.from("projects").delete().eq("id", id);
  if (error) return { error: error.message };
  return {};
}

export async function signIn(email: string, password: string) {
  const supabase = createClient();

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) return { error: formatSupabaseError(error) };
  return { user: data.user, session: data.session };
}

export async function signOut() {
  const supabase = createClient();
  await supabase.auth.signOut();
}
