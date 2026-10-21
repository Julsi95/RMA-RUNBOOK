export const WFH_REQUEST_TYPES = Object.freeze({ USE: "use", CANCEL: "cancel" });
export const WFH_REQUEST_STATUS = Object.freeze({ PENDING: "pending", APPROVED: "approved", REJECTED: "rejected", CANCELLED: "cancelled" });
export const WFH_MAX_REQUEST_DAYS = 30;
export const WFH_LEAD_ROLES = Object.freeze(["Team Lead (TL)", "Senior Team Lead (STL)"]);

/** @typedef {"use" | "cancel"} WfhRequestType */
/** @typedef {"pending" | "approved" | "rejected" | "cancelled"} WfhRequestStatus */
/** @typedef {{ id: string, employee_id: string, request_type: WfhRequestType, requested_dates: string[], approved_dates: string[] | null, status: WfhRequestStatus, created_at: string }} WfhPrivilegeRequest */
/** @typedef {{ id: string, employee_id: string, days_awarded: number, days_available: number, expires_on: string, revoked_at: string | null }} WfhPrivilegeReward */
