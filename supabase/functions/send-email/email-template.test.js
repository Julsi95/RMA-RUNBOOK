import test from "node:test";
import assert from "node:assert/strict";
import { buildActionEmail, createVerificationUrl } from "./email-template.js";

test("invitation email contains a code and a plain route, not a tokenized verification link", () => {
  const email = buildActionEmail({ action: "invite", appUrl: "https://rma-runbook.vercel.app/accept-invite", code: "123456", displayName: "A <b>" });
  assert.match(email.subject, /invitation code/i);
  assert.match(email.text, /123456/);
  assert.match(email.html, /&lt;b&gt;/);
  assert.match(email.html, /https:\/\/rma-runbook\.vercel\.app\/accept-invite/);
  assert.doesNotMatch(email.html, /token_hash|auth\/v1\/verify/);
});

test("non-invitation actions can retain a Supabase verification link", () => {
  const url = createVerificationUrl({
    supabaseUrl: "https://example.supabase.co",
    tokenHash: "hash-value",
    type: "recovery",
    redirectTo: "https://rma-runbook.vercel.app/reset-password",
  });
  const parsed = new URL(url);
  assert.equal(parsed.origin, "https://example.supabase.co");
  assert.equal(parsed.searchParams.get("token"), "hash-value");
  assert.equal(parsed.searchParams.get("type"), "recovery");
  assert.equal(parsed.searchParams.get("redirect_to"), "https://rma-runbook.vercel.app/reset-password");
  assert.match(buildActionEmail({ action: "recovery", appUrl: "https://rma-runbook.vercel.app/reset-password", verificationUrl: url }).html, /auth\/v1\/verify/);
});
