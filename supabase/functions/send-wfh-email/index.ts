import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Job = {
  id: string;
  recipient_user_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  attempts: number;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function escapeHtml(value: unknown) {
  const escaped: Record<string, string> = {
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  };
  return String(value ?? "").replace(/[&<>"']/g, (character) => escaped[character] ?? character);
}

function listDates(value: unknown) {
  if (!Array.isArray(value)) return "";
  return value.map((date) => String(date)).join(", ");
}

function buildEmail(job: Job) {
  const name = escapeHtml(job.payload.employee_name || "A RUNBOOK employee");
  const dates = escapeHtml(listDates(job.payload.dates));
  const requested = escapeHtml(listDates(job.payload.requested_dates));
  const approved = escapeHtml(listDates(job.payload.approved_dates));
  const days = escapeHtml(job.payload.days ?? "");
  const points = escapeHtml(job.payload.points_removed ?? "");
  const expires = escapeHtml(job.payload.expires_on ?? "");
  const returned = Boolean(job.payload.credit_returned);
  const messages: Record<string, { subject: string; body: string }> = {
    reward_awarded: { subject: "You received WFH days", body: `An administrator awarded you ${days} WFH day(s).${expires ? ` They expire on ${expires}.` : ""}` },
    request_submitted: { subject: "WFH request needs review", body: `${name} requested WFH for ${dates}.` },
    cancellation_requested: { subject: "WFH cancellation needs review", body: `${name} requested cancellation for ${dates}.` },
    request_approved: { subject: "Your WFH request was approved", body: `Your WFH dates were approved: ${approved || dates}.` },
    request_adjusted: { subject: "Your WFH dates were adjusted", body: `Requested: ${requested}. Approved: ${approved}.` },
    request_rejected: { subject: "Your WFH request was declined", body: `Your WFH request was declined.${dates ? ` Dates: ${dates}.` : ""}` },
    cancellation_approved: { subject: "Your WFH cancellation was approved", body: `Your cancellation was approved for ${dates}.${returned ? " The eligible WFH point was returned." : " The point was not returned because the reward is no longer eligible."}` },
    cancellation_rejected: { subject: "Your WFH cancellation was declined", body: `Your cancellation request was declined.${dates ? ` Dates: ${dates}.` : ""}` },
    approved_dates_revoked: { subject: "An approved WFH date changed", body: `An administrator revoked ${dates}.${returned ? " The eligible WFH point was returned." : " The point was not returned because the reward is no longer eligible."}` },
    reward_revoked: { subject: "A WFH reward was revoked", body: `An administrator revoked a WFH reward and removed ${escapeHtml(job.payload.days_removed ?? "") } available day(s).` },
    points_removed: { subject: "WFH points were removed", body: `An administrator removed ${points} WFH point(s) from your balance.` },
  };
  const message = messages[job.event_type];
  if (!message) throw new Error("Unsupported WFH email event.");
  return {
    subject: message.subject,
    text: `Hello,\n\n${message.body}\n\nOpen RUNBOOK to view WFH privileges.`,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.55;color:#171717"><p>Hello,</p><p>${message.body}</p><p>Open RUNBOOK to view WFH privileges.</p></div>`,
  };
}

async function sendEmail(job: Job, recipient: string, from: string, apiKey: string) {
  const message = buildEmail(job);
  const response = await fetch("https://sendliberty.com/api/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: recipient, ...message }),
  });
  if (!response.ok) {
    const retryHeader = response.headers.get("Retry-After");
    const retrySeconds = retryHeader ? Number(retryHeader) : Math.min(3600, 30 * (2 ** Math.min(job.attempts, 7)));
    throw Object.assign(new Error(`SendLiberty returned ${response.status}.`), {
      retrySeconds: Number.isFinite(retrySeconds) ? Math.max(1, retrySeconds) : 60,
      permanent: response.status >= 400 && response.status < 500 && response.status !== 429,
    });
  }
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const configuredSecret = Deno.env.get("WFH_EMAIL_DISPATCH_SECRET") ?? "";
  const providedSecret = request.headers.get("x-wfh-dispatch-secret") ?? "";
  if (!constantTimeEqual(configuredSecret, providedSecret)) return json({ error: "Unauthorized." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const apiKey = Deno.env.get("SENDLIBERTY_API_KEY");
  const from = Deno.env.get("SENDLIBERTY_FROM_EMAIL");
  if (!supabaseUrl || !serviceKey || !apiKey || !from) return json({ error: "WFH email service is not configured." }, 500);

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: jobs, error: claimError } = await admin.rpc("claim_wfh_email_outbox", { p_limit: 5 });
  if (claimError) {
    console.error("WFH email outbox claim failed.", claimError.code ?? "database_error");
    return json({ error: "Could not claim WFH email jobs." }, 500);
  }

  let sent = 0;
  for (const job of (jobs ?? []) as Job[]) {
    try {
      const { data: authResult, error: authError } = await admin.auth.admin.getUserById(job.recipient_user_id);
      const recipient = authResult?.user?.email;
      if (authError) throw new Error("Could not load recipient account.");
      if (!recipient) throw Object.assign(new Error("Recipient account has no email address."), { permanent: true });
      await sendEmail(job, recipient, from, apiKey);
      const { error } = await admin.from("wfh_email_outbox").update({ status: "sent", sent_at: new Date().toISOString(), locked_at: null, last_error: null }).eq("id", job.id);
      if (error) throw new Error("Could not mark WFH email as sent.");
      sent += 1;
    } catch (error) {
      const details = error instanceof Error ? error.message : "Delivery failed.";
      const permanent = Boolean((error as { permanent?: boolean })?.permanent);
      const retrySeconds = Number((error as { retrySeconds?: number })?.retrySeconds ?? Math.min(3600, 30 * (2 ** Math.min(job.attempts, 7))));
      const status = permanent || job.attempts >= 8 ? "failed" : "pending";
      const { error: updateError } = await admin.from("wfh_email_outbox").update({
        status,
        available_at: new Date(Date.now() + retrySeconds * 1000).toISOString(),
        locked_at: null,
        last_error: details.slice(0, 160),
      }).eq("id", job.id);
      if (updateError) console.error("WFH email retry state update failed.", updateError.code ?? "database_error");
      else console.error("WFH email delivery deferred.", { status, attempt: job.attempts });
    }
    // SendLiberty applies a one-message-per-second burst cap for personal Gmail.
    if (job !== (jobs ?? []).at(-1)) await new Promise((resolve) => setTimeout(resolve, 1100));
  }
  return json({ claimed: jobs?.length ?? 0, sent });
});

function constantTimeEqual(left: string, right: string) {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return difference === 0;
}
