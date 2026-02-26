import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildRpcErrorPayload } from "@/lib/supabase/rpc-errors";

type Body = {
  employee_id?: string;
  project_id?: string;
  business_id?: string;
};

function jsonNoStore(payload: Record<string, unknown>, status: number) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      Pragma: "no-cache",
    },
  });
}

async function requireManagerAdminOrOwner() {
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

  if (actor.role === "manager" || actor.role === "admin") {
    return { sessionClient };
  }

  const { data: company } = await sessionClient
    .from("companies")
    .select("owner_user_id")
    .eq("id", actor.company_id)
    .single();

  if (company?.owner_user_id === actor.id) {
    return { sessionClient };
  }

  return {
    error: jsonNoStore({ error: "Manager/admin/owner access required." }, 403),
  };
}

export async function POST(request: Request) {
  const context = await requireManagerAdminOrOwner();
  if ("error" in context) return context.error;

  const body = (await request.json().catch(() => ({}))) as Body;
  const employeeId = (body.employee_id ?? "").trim();
  const projectId = (body.project_id ?? "").trim();
  const businessId = (body.business_id ?? "").trim();

  if (!employeeId || !projectId) {
    return jsonNoStore({ error: "employee_id and project_id are required." }, 400);
  }

  if (businessId) {
    const { data: project } = await context.sessionClient
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .eq("business_id", businessId)
      .maybeSingle();

    if (!project) {
      return jsonNoStore(
        { error: "Project not found in selected business." },
        404
      );
    }
  }

  const { data, error } = await context.sessionClient.rpc("manager_clock_out_entry", {
    p_employee_id: employeeId,
    p_project_id: projectId,
  });

  if (error) {
    return jsonNoStore(
      buildRpcErrorPayload(
        "manager_clock_out_entry",
        ["p_employee_id", "p_project_id"],
        error
      ),
      400
    );
  }

  return jsonNoStore((data ?? { success: true }) as Record<string, unknown>, 200);
}
