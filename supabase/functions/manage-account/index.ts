import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return response({ error: "Method not allowed." }, 405);

  const authorization = request.headers.get("Authorization") ?? "";
  const jwt = authorization.replace(/^Bearer\s+/i, "");
  if (!jwt) return response({ error: "Sign in with an administrator account." }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) return response({ error: "Account management is not configured on the server." }, 500);

  const callerClient = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const { data: authData, error: authError } = await callerClient.auth.getUser(jwt);
  if (authError || !authData.user) return response({ error: "Your session is invalid or expired." }, 401);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: account, error: accountError } = await admin.from("app_accounts").select("role").eq("user_id", authData.user.id).maybeSingle();
  if (accountError || !["admin", "super_admin"].includes(account?.role ?? "")) return response({ error: "Administrator access is required." }, 403);

  async function recordAccessEvent(action: "create" | "update", entityId: string, summary: string) {
    const { error } = await admin.from("history_events").insert({
      actor_id: authData.user.id,
      actor_label: authData.user.email ?? "RUNBOOK administrator",
      module: "Settings",
      entity_type: "app_accounts",
      entity_id: entityId,
      action,
      summary,
      recoverable: false,
    });
    if (error) console.error("Could not record account management history", error.message);
  }

  try {
    const body = await request.json();
    if (body.action === "list") {
      const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (error) throw error;
      const { data: mappings, error: mappingsError } = await admin.from("app_accounts").select("user_id,employee_id,display_name,role");
      if (mappingsError) throw mappingsError;
      const byId = new Map((mappings ?? []).map((row) => [row.user_id, row]));
      return response({ accounts: (data.users ?? []).map((user) => ({
        userId: user.id,
        email: user.email ?? "",
        confirmed: Boolean(user.email_confirmed_at),
        bannedUntil: user.banned_until ?? null,
        ...(byId.get(user.id) ?? { employee_id: null, display_name: user.email ?? "RUNBOOK user", role: "user" }),
      })).filter((user) => user.role !== "super_admin") });
    }

    if (body.action === "invite") {
      const email = String(body.email ?? "").trim().toLowerCase();
      const displayName = String(body.displayName ?? "").trim();
      const role = body.role === "admin" ? "admin" : "user";
      const employeeId = body.employeeId ? String(body.employeeId) : null;
      if (!/^\S+@\S+\.\S+$/.test(email)) return response({ error: "Enter a valid email address." }, 400);
      if (!displayName || displayName.length > 80) return response({ error: "Enter a display name up to 80 characters." }, 400);
      if (role === "admin" && !body.confirmAdmin) return response({ error: "Confirm the administrator role." }, 400);
      if (employeeId) {
        const { data: employee, error } = await admin.from("employees").select("id").eq("id", employeeId).is("deleted_at", null).maybeSingle();
        if (error) throw error;
        if (!employee) return response({ error: "Select an active employee record." }, 400);
      }
      const { data: invitation, error } = await admin.auth.admin.inviteUserByEmail(email, {
        data: { display_name: displayName },
        redirectTo: typeof body.redirectTo === "string" ? body.redirectTo : undefined,
      });
      if (error) throw error;
      if (!invitation.user) throw new Error("The invitation did not return an account.");
      const { error: mappingError } = await admin.from("app_accounts").upsert({
        user_id: invitation.user.id, employee_id: employeeId, display_name: displayName, role,
        can_edit: role === "admin", updated_at: new Date().toISOString(),
      });
      if (mappingError) throw mappingError;
      await recordAccessEvent("create", invitation.user.id, `Invited ${email} with ${role} access.`);
      return response({ userId: invitation.user.id, message: "Invitation sent. The employee will set their password from the email." }, 201);
    }

    if (body.action === "update") {
      const userId = String(body.userId ?? "");
      const role = body.role === "admin" ? "admin" : "user";
      const employeeId = body.employeeId ? String(body.employeeId) : null;
      if (!userId) return response({ error: "Account ID is required." }, 400);
      if (userId === authData.user.id && role !== "admin") return response({ error: "You cannot remove your own administrator access." }, 400);
      if (role === "admin" && !body.confirmAdmin) return response({ error: "Confirm the administrator role." }, 400);
      if (employeeId) {
        const { data: employee, error } = await admin.from("employees").select("id").eq("id", employeeId).is("deleted_at", null).maybeSingle();
        if (error) throw error;
        if (!employee) return response({ error: "Select an active employee record." }, 400);
      }
      const { data: prior, error: priorError } = await admin.from("app_accounts").select("role,employee_id").eq("user_id", userId).maybeSingle();
      if (priorError) throw priorError;
      if (prior?.role === "super_admin") return response({ error: "The protected Super Admin account cannot be edited." }, 403);
      const { error } = await admin.from("app_accounts").update({ role, can_edit: role === "admin", employee_id: employeeId, updated_at: new Date().toISOString() }).eq("user_id", userId);
      if (error) throw error;
      await recordAccessEvent("update", userId, `Changed account access from ${prior?.role ?? "unknown"} to ${role}${employeeId ? " and updated its employee link" : ""}.`);
      return response({ message: "Account access updated." });
    }

    if (body.action === "suspend" || body.action === "restore") {
      const userId = String(body.userId ?? "");
      if (!userId) return response({ error: "Account ID is required." }, 400);
      if (userId === authData.user.id) return response({ error: "You cannot suspend your own account." }, 400);
      const { data: target, error: targetError } = await admin.from("app_accounts").select("role").eq("user_id", userId).maybeSingle();
      if (targetError) throw targetError;
      if (target?.role === "super_admin") return response({ error: "The protected Super Admin account cannot be suspended." }, 403);
      const { error } = await admin.auth.admin.updateUserById(userId, {
        ban_duration: body.action === "suspend" ? "876000h" : "none",
      });
      if (error) throw error;
      const { error: mappingError } = await admin.from("app_accounts").update({ updated_at: new Date().toISOString() }).eq("user_id", userId);
      if (mappingError) throw mappingError;
      await recordAccessEvent("update", userId, `${body.action === "suspend" ? "Suspended" : "Restored"} account sign-in access.`);
      return response({ message: body.action === "suspend" ? "Account access suspended." : "Account access restored." });
    }

    return response({ error: "Unsupported account action." }, 400);
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : "Account management failed." }, 400);
  }
});
