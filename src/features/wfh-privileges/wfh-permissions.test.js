import test from "node:test";
import assert from "node:assert/strict";
import { canReviewWfhRequest, employeeIsWfhLead } from "./wfh-permissions.js";

const pendingRequest = { employee_id: "employee-2", status: "pending" };

test("TL and STL hierarchy roles can review pending requests", () => {
  assert.equal(employeeIsWfhLead({ hierarchyRoles: ["Team Lead (TL)"] }), true);
  assert.equal(employeeIsWfhLead({ hierarchyRoles: ["Senior Team Lead (STL)"] }), true);
  assert.equal(canReviewWfhRequest(pendingRequest, { employeeId: "lead-1", isLead: true }), true);
});

test("Super Admin can review requests without a linked employee record", () => {
  assert.equal(canReviewWfhRequest(pendingRequest, { employeeId: null, isLead: false, isSuperAdmin: true }), true);
});

test("regular admins and request owners cannot review their own request", () => {
  assert.equal(canReviewWfhRequest(pendingRequest, { employeeId: "admin-1", isLead: false }), false);
  assert.equal(canReviewWfhRequest(pendingRequest, { employeeId: "employee-2", isLead: true }), false);
});

test("only pending requests can be reviewed", () => {
  assert.equal(canReviewWfhRequest({ ...pendingRequest, status: "approved" }, { employeeId: "lead-1", isLead: true }), false);
});
