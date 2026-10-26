export function normalizeInvitationEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function normalizeInvitationOtp(value) {
  return String(value ?? "").replace(/\s/g, "");
}

export function isValidInvitationOtp(value) {
  return /^\d{6,8}$/.test(String(value ?? ""));
}

export function invitationOtpErrorMessage(error) {
  const message = String(error?.message ?? "").toLowerCase();
  if (/rate|too many|429/.test(message)) return "Too many attempts. Wait a few minutes before trying again, or ask an administrator to resend the invitation.";
  if (/expired|invalid|otp|token|not found|already|invite_not_found/.test(message)) return "This code is invalid, expired, or already used. Ask an administrator to send a new invitation.";
  return error?.message || "Invitation verification failed. Please try again.";
}
