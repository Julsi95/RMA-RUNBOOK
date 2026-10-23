import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, isAllowedOrigin } from "../_shared/cors.ts";

function response(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...Object.fromEntries(corsHeaders(request)), "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  const headers = corsHeaders(request);
  if (!isAllowedOrigin(request)) return new Response("Origin not allowed.", { status: 403, headers });
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  if (request.method !== "POST") return response(request, { error: "Method not allowed." }, 405);

  const authorization = request.headers.get("Authorization") ?? "";
  const jwt = authorization.replace(/^Bearer\s+/i, "");
  if (!jwt) return response(request, { error: "Sign in with an administrator account." }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) return response(request, { error: "Account management is not configured on the server." }, 500);

  const callerClient = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const { data: authData, error: authError } = await callerClient.auth.getUser(jwt);
  if (authError || !authData.user) return response(request, { error: "Your session is invalid or expired." }, 401);
  const { data: sessionIsCurrent, error: sessionError } = await callerClient.rpc("is_current_runbook_session");
  if (sessionError || !sessionIsCurrent) return response(request, { error: "This session is no longer active. Sign in again." }, 401);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: account, error: accountError } = await admin.from("app_accounts").select("role").eq("user_id", authData.user.id).maybeSingle();
  if (accountError || !["admin", "super_admin"].includes(account?.role ?? "")) return response(request, { error: "Administrator access is required." }, 403);
  const isSuperAdmin = account?.role === "super_admin";

  async function recordAccessEvent(action: "create" | "update" | "delete", entityId: string, summary: string) {
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
    if (error) {
      console.error("Could not record account management history", error.message);
      if (action === "delete") throw error;
    }
  }

  try {
    const body = await request.json();
    if (body.action === "list") {
      const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (error) throw error;
      const { data: mappings, error: mappingsError } = await admin.from("app_accounts").select("user_id,employee_id,display_name,role");
      if (mappingsError) throw mappingsError;
      const byId = new Map((mappings ?? []).map((row) => [row.user_id, row]));
      return response(request, { accounts: (data.users ?? []).map((user) => ({
        userId: user.id,
        email: user.email ?? "",
        createdAt: user.created_at ?? null,
        lastSignInAt: user.last_sign_in_at ?? null,
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
      if (!/^\S+@\S+\.\S+$/.test(email)) return response(request, { error: "Enter a valid email address." }, 400);
      if (!displayName || displayName.length > 80) return response(request, { error: "Enter a display name up to 80 characters." }, 400);
      if (role === "admin" && !body.confirmAdmin) return response(request, { error: "Confirm the administrator role." }, 400);
      if (employeeId) {
        const { data: employee, error } = await admin.from("employees").select("id").eq("id", employeeId).is("deleted_at", null).maybeSingle();
        if (error) throw error;
        if (!employee) return response(request, { error: "Select an active employee record." }, 400);
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
      return response(request, { userId: invitation.user.id, message: "Invitation sent. The employee will set their password from the email." }, 201);
    }

    if (body.action === "create-with-password") {
      if (!isSuperAdmin) return response(request, { error: "Only the Super Admin can create accounts with a password." }, 403);
      const email = String(body.email ?? "").trim().toLowerCase();
      const displayName = String(body.displayName ?? "").trim();
      const password = typeof body.password === "string" ? body.password : "";
      const role = body.role === "admin" ? "admin" : "user";
      const employeeId = body.employeeId ? String(body.employeeId) : null;
      if (!/^\S+@\S+\.\S+$/.test(email)) return response(request, { error: "Enter a valid email address." }, 400);
      if (!displayName || displayName.length > 80) return response(request, { error: "Enter a display name up to 80 characters." }, 400);
      if (password.length < 8 || password.length > 128) return response(request, { error: "Use a password between 8 and 128 characters." }, 400);
      if (role === "admin" && !body.confirmAdmin) return response(request, { error: "Confirm the administrator role." }, 400);
      if (employeeId) {
        const { data: employee, error } = await admin.from("employees").select("id").eq("id", employeeId).is("deleted_at", null).maybeSingle();
        if (error) throw error;
        if (!employee) return response(request, { error: "Select an active employee record." }, 400);
      }
      const { data: created, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { display_name: displayName },
      });
      if (error) throw error;
      if (!created.user) throw new Error("The account could not be created.");
      const { error: mappingError } = await admin.from("app_accounts").upsert({
        user_id: created.user.id, employee_id: employeeId, display_name: displayName, role,
        can_edit: role === "admin", updated_at: new Date().toISOString(),
      });
      if (mappingError) {
        await admin.auth.admin.deleteUser(created.user.id);
        throw mappingError;
      }
      await recordAccessEvent("create", created.user.id, `Created ${email} with ${role} access and a Super Admin supplied password.`);
      return response(request, { userId: created.user.id, message: `Account created for ${email}. The user can sign in with the supplied password.` }, 201);
    }

    if (body.action === "set-password") {
      if (!isSuperAdmin) return response(request, { error: "Only the Super Admin can set another account's password." }, 403);
      const userId = String(body.userId ?? "");
      const password = typeof body.password === "string" ? body.password : "";
      if (!userId) return response(request, { error: "Account ID is required." }, 400);
      if (password.length < 8 || password.length > 128) return response(request, { error: "Use a password between 8 and 128 characters." }, 400);
      const { data: target, error: targetError } = await admin.from("app_accounts").select("role").eq("user_id", userId).maybeSingle();
      if (targetError) throw targetError;
      if (!target) return response(request, { error: "Account was not found." }, 404);
      if (target.role === "super_admin") return response(request, { error: "Use the Super Admin's own password settings to change that password." }, 403);
      const { error } = await admin.auth.admin.updateUserById(userId, { password });
      if (error) throw error;
      await recordAccessEvent("update", userId, "Super Admin changed this account's password.");
      return response(request, { message: "Password updated. The user can sign in with the new password." });
    }

    if (body.action === "update") {
      const userId = String(body.userId ?? "");
      const role = body.role === "admin" ? "admin" : "user";
      const employeeId = body.employeeId ? String(body.employeeId) : null;
      if (!userId) return response(request, { error: "Account ID is required." }, 400);
      if (userId === authData.user.id && role !== "admin") return response(request, { error: "You cannot remove your own administrator access." }, 400);
      if (role === "admin" && !body.confirmAdmin) return response(request, { error: "Confirm the administrator role." }, 400);
      if (employeeId) {
        const { data: employee, error } = await admin.from("employees").select("id").eq("id", employeeId).is("deleted_at", null).maybeSingle();
        if (error) throw error;
        if (!employee) return response(request, { error: "Select an active employee record." }, 400);
      }
      const { data: prior, error: priorError } = await admin.from("app_accounts").select("role,employee_id").eq("user_id", userId).maybeSingle();
      if (priorError) throw priorError;
      if (prior?.role === "super_admin") return response(request, { error: "The protected Super Admin account cannot be edited." }, 403);
      const { error } = await admin.from("app_accounts").update({ role, can_edit: role === "admin", employee_id: employeeId, updated_at: new Date().toISOString() }).eq("user_id", userId);
      if (error) throw error;
      await recordAccessEvent("update", userId, `Changed account access from ${prior?.role ?? "unknown"} to ${role}${employeeId ? " and updated its employee link" : ""}.`);
      return response(request, { message: "Account access updated." });
    }

    if (body.action === "suspend" || body.action === "restore") {
      const userId = String(body.userId ?? "");
      if (!userId) return response(request, { error: "Account ID is required." }, 400);
      if (userId === authData.user.id) return response(request, { error: "You cannot suspend your own account." }, 400);
      const { data: target, error: targetError } = await admin.from("app_accounts").select("role").eq("user_id", userId).maybeSingle();
      if (targetError) throw targetError;
      if (target?.role === "super_admin") return response(request, { error: "The protected Super Admin account cannot be suspended." }, 403);
      const { error } = await admin.auth.admin.updateUserById(userId, {
        ban_duration: body.action === "suspend" ? "876000h" : "none",
      });
      if (error) throw error;
      const { error: mappingError } = await admin.from("app_accounts").update({ updated_at: new Date().toISOString() }).eq("user_id", userId);
      if (mappingError) throw mappingError;
      await recordAccessEvent("update", userId, `${body.action === "suspend" ? "Suspended" : "Restored"} account sign-in access.`);
      return response(request, { message: body.action === "suspend" ? "Account access suspended." : "Account access restored." });
    }

    if (body.action === "delete") {
      const userId = String(body.userId ?? "");
      if (!userId) return response(request, { error: "Account ID is required." }, 400);
      if (userId === authData.user.id) return response(request, { error: "You cannot delete the account you are currently using." }, 400);
      const { data: target, error: targetError } = await admin.from("app_accounts").select("role,employee_id,display_name").eq("user_id", userId).maybeSingle();
      if (targetError) throw targetError;
      if (target?.role === "super_admin") return response(request, { error: "The protected Super Admin account cannot be deleted." }, 403);
      if (target?.role === "admin" && !isSuperAdmin) return response(request, { error: "Only the Super Admin can delete another administrator account." }, 403);
      const { data: authTarget, error: authTargetError } = await admin.auth.admin.getUserById(userId);
      if (authTargetError) throw authTargetError;
      if (!authTarget.user) return response(request, { error: "Account was not found." }, 404);
      const email = authTarget.user.email ?? userId;
      const { data: profile, error: profileError } = await admin.from("account_profiles").select("photo_path").eq("user_id", userId).maybeSingle();
      if (profileError) throw profileError;
      const ownedPhotoPath = profile?.photo_path?.startsWith(`accounts/${userId}/`) ? profile.photo_path : null;
      await recordAccessEvent("delete", userId, `Permanently deleted the RUNBOOK sign-in account for ${email}. Its employee record, if linked, was retained.`);
      const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
      if (deleteError) throw deleteError;
      let cleanupPending = false;
      if (ownedPhotoPath) {
        const { error: storageError } = await admin.storage.from("runbook-private").remove([ownedPhotoPath]);
        if (storageError) {
          cleanupPending = true;
          console.error("Deleted account profile photo cleanup failed", storageError.message);
        }
      }
      return response(request, { message: cleanupPending
        ? `Account ${email} was deleted. Its profile image could not be removed automatically and needs storage cleanup.`
        : `Account ${email} was permanently deleted. Its linked employee record and operational records were retained.` });
    }

    return response(request, { error: "Unsupported account action." }, 400);
  } catch (error) {
    return response(request, { error: error instanceof Error ? error.message : "Account management failed." }, 400);
  }
});
