import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";
import { isAllowedRunbookOrigin } from "../_shared/cors.ts";
import { buildActionEmail, createVerificationUrl } from "./email-template.js";

type HookPayload = {
  user?: { email?: string; new_email?: string; user_metadata?: { display_name?: string; full_name?: string } };
  email_data?: {
    token?: string;
    token_hash?: string;
    redirect_to?: string;
    email_action_type?: string;
    site_url?: string;
    token_new?: string;
    token_hash_new?: string;
  };
};

const DEFAULT_APP_URL = "https://rma-runbook.vercel.app";

function resolveRedirect(value: string | undefined, fallback: string, invitation = false) {
  let target: URL;
  try { target = new URL(value || fallback); } catch { throw new Error("Invalid email redirect URL."); }
  if (!isAllowedRunbookOrigin(target.origin) || target.username || target.password) throw new Error("Email redirect is not an approved RUNBOOK origin.");
  if (invitation) {
    // Auth may append query/hash data or a trailing slash to redirect_to. Invite
    // emails use an OTP, so only the approved origin matters; always canonicalize
    // the destination to the invitation page and discard unrelated URL state.
    target.pathname = "/accept-invite";
    target.search = "";
    target.hash = "";
  }
  return target.toString();
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function sendViaSendLiberty({ to, from, subject, html, text }: { to: string; from: string; subject: string; html: string; text: string }) {
  const apiKey = Deno.env.get("SENDLIBERTY_API_KEY");
  if (!apiKey) throw new Error("SendLiberty is not configured.");
  const response = await fetch("https://sendliberty.com/api/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, html, text }),
  });
  if (!response.ok) {
    // Do not log the response body: provider diagnostics can contain recipient or message details.
    console.error("SendLiberty delivery failed with status", response.status);
    throw new Error("Email delivery failed.");
  }
  console.info("[send-email] SendLiberty accepted the email request");
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  console.info("[send-email] Auth hook request received");

  const secret = Deno.env.get("SEND_EMAIL_HOOK_SECRET")?.replace(/^v1,whsec_/, "");
  const from = Deno.env.get("SENDLIBERTY_FROM_EMAIL");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!secret || !from || !supabaseUrl) return json({ error: "Email hook is not configured." }, 500);

  let payload: HookPayload;
  try {
    const rawBody = await request.text();
    const webhook = new Webhook(secret);
    payload = webhook.verify(rawBody, Object.fromEntries(request.headers)) as HookPayload;
  } catch {
    console.error("[send-email] Hook signature verification failed");
    return json({ error: "Invalid email hook signature." }, 401);
  }

  const recipient = payload.user?.email?.trim();
  const email = payload.email_data;
  if (!recipient || !email?.email_action_type) return json({ error: "Email event is missing required fields." }, 400);
  console.info("[send-email] Hook signature verified", { action: email.email_action_type });

  try {
    const action = email.email_action_type;
    const appBase = Deno.env.get("RUNBOOK_APP_URL") ?? DEFAULT_APP_URL;
    const fallbackPath = action === "invite" ? "/accept-invite" : action === "recovery" ? "/reset-password" : "/login";
    const appUrl = resolveRedirect(email.redirect_to, new URL(fallbackPath, appBase).toString(), action === "invite");
    const displayName = payload.user?.user_metadata?.display_name ?? payload.user?.user_metadata?.full_name;

    if (action === "email_change") {
      const newEmail = payload.user?.new_email;
      if (email.token_hash_new && email.token_hash && email.token && email.token_new && newEmail) {
        const currentAddressEmail = buildActionEmail({
          action,
          appUrl,
          displayName,
          verificationUrl: createVerificationUrl({ supabaseUrl, tokenHash: email.token_hash_new, type: action, redirectTo: appUrl }),
        });
        await sendViaSendLiberty({ to: recipient, from, ...currentAddressEmail });
        const newAddressEmail = buildActionEmail({
          action,
          appUrl,
          displayName,
          verificationUrl: createVerificationUrl({ supabaseUrl, tokenHash: email.token_hash, type: action, redirectTo: appUrl }),
        });
        await sendViaSendLiberty({ to: newEmail, from, ...newAddressEmail });
        return json({});
      }
      if (email.token_hash && newEmail) {
        const newAddressEmail = buildActionEmail({
          action,
          appUrl,
          displayName,
          verificationUrl: createVerificationUrl({ supabaseUrl, tokenHash: email.token_hash, type: action, redirectTo: appUrl }),
        });
        await sendViaSendLiberty({ to: newEmail, from, ...newAddressEmail });
        return json({});
      }
      if (email.token_hash_new) {
        const currentAddressEmail = buildActionEmail({
          action,
          appUrl,
          displayName,
          verificationUrl: createVerificationUrl({ supabaseUrl, tokenHash: email.token_hash_new, type: action, redirectTo: appUrl }),
        });
        await sendViaSendLiberty({ to: recipient, from, ...currentAddressEmail });
        return json({});
      }
    }

    const verificationType = action === "signup" ? "signup" : action;
    const tokenHash = email.token_hash;
    const verificationUrl = tokenHash && action !== "invite"
      ? createVerificationUrl({ supabaseUrl, tokenHash, type: verificationType, redirectTo: appUrl })
      : undefined;
    const message = buildActionEmail({ action, appUrl, displayName, code: email.token, verificationUrl });
    await sendViaSendLiberty({ to: recipient, from, ...message });
    return json({});
  } catch (error) {
    console.error("Auth email hook could not deliver the message.", error instanceof Error ? error.message : "unknown error");
    return json({ error: "Auth email could not be delivered." }, 502);
  }
});
