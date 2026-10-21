import { WFH_LEAD_ROLES, WFH_REQUEST_STATUS } from "./wfh-types.js";

const LEAD_ROLE_ALIASES = new Set(["team lead", "team lead (tl)", "tl", "senior team lead", "senior team lead (stl)", "stl"]);

export function employeeIsWfhLead(employee) {
  return (employee?.hierarchyRoles ?? []).some((role) => WFH_LEAD_ROLES.includes(role))
    || LEAD_ROLE_ALIASES.has(String(employee?.role ?? "").trim().toLowerCase());
}

export function canReviewWfhRequest(request, { employeeId, isLead, isSuperAdmin = false }) {
  return Boolean((isLead || isSuperAdmin) && request?.employee_id !== employeeId && request?.status === WFH_REQUEST_STATUS.PENDING);
}
