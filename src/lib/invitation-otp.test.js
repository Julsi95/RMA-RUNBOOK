import test from "node:test";
import assert from "node:assert/strict";
import { invitationOtpErrorMessage, isValidInvitationOtp, normalizeInvitationEmail, normalizeInvitationOtp } from "./invitation-otp.js";

test("normalizes invite identity and code without changing code digits", () => {
  assert.equal(normalizeInvitationEmail("  Person@Example.COM "), "person@example.com");
  assert.equal(normalizeInvitationOtp(" 123 456 "), "123456");
});

test("accepts standard six to eight digit invitation codes only", () => {
  assert.equal(isValidInvitationOtp("123456"), true);
  assert.equal(isValidInvitationOtp("12345678"), true);
  assert.equal(isValidInvitationOtp("12345"), false);
  assert.equal(isValidInvitationOtp("12a456"), false);
});

test("provides actionable messages for expired codes and rate limits", () => {
  assert.match(invitationOtpErrorMessage({ message: "invite_not_found" }), /expired|invalid/i);
  assert.match(invitationOtpErrorMessage({ message: "too many requests" }), /wait a few minutes/i);
});
