import test from "node:test";
import assert from "node:assert/strict";
import { notificationHref } from "./notification-utils.js";

test("WFH request notifications open the matching approval context", () => {
  assert.equal(
    notificationHref({ category: "wfh-privilege", event_key: "wfh-request:request-123", href: "/wfh-privileges" }),
    "/wfh-privileges?request=request-123",
  );
});

test("other notification destinations retain their configured route", () => {
  assert.equal(notificationHref({ category: "wfh-privilege", event_key: "wfh-expiry:reward-123", href: "/wfh-privileges" }), "/wfh-privileges");
  assert.equal(notificationHref({ category: "dashboard", href: "/" }), "/");
});
