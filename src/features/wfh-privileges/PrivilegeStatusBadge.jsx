export function PrivilegeStatusBadge({ status }) {
  return <span className={`wfh-status wfh-status-${status}`}>{String(status).replaceAll("_", " ")}</span>;
}
