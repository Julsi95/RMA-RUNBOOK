const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

export function buildInvitationEmail({ appUrl, code, displayName }) {
  const safeCode = escapeHtml(code);
  const safeName = displayName ? ` ${escapeHtml(displayName)}` : "";
  const safeUrl = escapeHtml(appUrl);
  return {
    subject: "Your RUNBOOK invitation code",
    text: `Hello${displayName ? ` ${displayName}` : ""},\n\nUse this one-time code to accept your RUNBOOK invitation: ${code}\n\nOpen ${appUrl} and enter the code. You can set your password after verification. If you did not expect this invitation, ignore this email.`,
    html: `<main style="font-family:Arial,sans-serif;line-height:1.5;color:#17202a;max-width:560px;margin:auto"><p>Hello${safeName},</p><p>Use this one-time code to accept your RUNBOOK invitation:</p><p style="font-size:30px;font-weight:700;letter-spacing:7px;padding:14px 18px;background:#f3f4f6;border-radius:10px;display:inline-block">${safeCode}</p><p><a href="${safeUrl}">Open RUNBOOK invitation page</a> and enter the code. You can set your password after verification.</p><p>If you did not expect this invitation, you can ignore this email.</p></main>`,
  };
}

export function buildActionEmail({ action, appUrl, displayName, code, verificationUrl }) {
  if (action === "invite") return buildInvitationEmail({ appUrl, code, displayName });

  const labels = {
    recovery: "Reset your RUNBOOK password",
    signup: "Confirm your RUNBOOK email",
    magiclink: "Sign in to RUNBOOK",
    email_change: "Confirm your RUNBOOK email change",
  };
  const subject = labels[action] ?? "RUNBOOK account notification";
  const safeName = displayName ? ` ${escapeHtml(displayName)}` : "";
  const safeUrl = verificationUrl ? escapeHtml(verificationUrl) : escapeHtml(appUrl);
  const instruction = verificationUrl
    ? `Use the secure link below to continue. If you did not request this, ignore this email.`
    : `There was an account security event for your RUNBOOK account. If you did not request this, contact your administrator.`;
  return {
    subject,
    text: `Hello${displayName ? ` ${displayName}` : ""},\n\n${instruction}${verificationUrl ? `\n\n${verificationUrl}` : ""}`,
    html: `<main style="font-family:Arial,sans-serif;line-height:1.5;color:#17202a;max-width:560px;margin:auto"><p>Hello${safeName},</p><p>${escapeHtml(instruction)}</p>${verificationUrl ? `<p><a href="${safeUrl}">Continue to RUNBOOK</a></p>` : ""}</main>`,
  };
}

export function createVerificationUrl({ supabaseUrl, tokenHash, type, redirectTo }) {
  const url = new URL("/auth/v1/verify", supabaseUrl);
  url.searchParams.set("token", tokenHash);
  url.searchParams.set("type", type);
  url.searchParams.set("redirect_to", redirectTo);
  return url.toString();
}
