import { NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

type AuthMode = "bearer" | "cookie";

export async function getStaffAuth(req: NextRequest): Promise<{
  authMode: AuthMode;
  user: any | null;
  supabase: any;
}> {
  const authHeader = req.headers.get("authorization") ?? "";

  if (authHeader.startsWith("Bearer ")) {
    const supabase = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: { headers: { Authorization: authHeader } },
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      }
    );

    const { data, error } = await supabase.auth.getUser();
    if (error || !data?.user) return { authMode: "bearer", user: null, supabase };
    return { authMode: "bearer", user: data.user, supabase };
  }

  const supabase = await createServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) return { authMode: "cookie", user: null, supabase };
  return { authMode: "cookie", user: data.user, supabase };
}
