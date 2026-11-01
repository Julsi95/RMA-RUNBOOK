export const organizationRoles = [
  "Team Lead",
  "Campaign Specialist",
  "Senior Agent",
  "Customer Rep",
];
export const organizationTeams = ["RMA", "Contracts", "OM", "Petro Admin"];

export const organizationHierarchyRoles = [
  "Operational Manager (OM)",
  "Team Manager (TM)",
  "Senior Team Lead (STL)",
  "Team Lead (TL)",
];

const hierarchyRoleAliases = new Map([
  ["om", organizationHierarchyRoles[0]], ["operational manager", organizationHierarchyRoles[0]], ["operational manager (om)", organizationHierarchyRoles[0]],
  ["tm", organizationHierarchyRoles[1]], ["team manager", organizationHierarchyRoles[1]], ["team manager (tm)", organizationHierarchyRoles[1]],
  ["stl", organizationHierarchyRoles[2]], ["senior team lead", organizationHierarchyRoles[2]], ["senior team lead (stl)", organizationHierarchyRoles[2]],
  ["tl", organizationHierarchyRoles[3]], ["team lead", organizationHierarchyRoles[3]], ["team lead (tl)", organizationHierarchyRoles[3]],
]);

export function getHierarchyRoles(member) {
  const values = Array.isArray(member?.hierarchyRoles) ? member.hierarchyRoles : [];
  const cleaned = values.map((value) => hierarchyRoleAliases.get(String(value).trim().toLowerCase())).filter(Boolean);
  const legacyRole = hierarchyRoleAliases.get(String(member?.role ?? "").trim().toLowerCase());
  const canonical = [...new Set(legacyRole ? [...cleaned, legacyRole] : cleaned)];
  return canonical.sort((left, right) => organizationHierarchyRoles.indexOf(left) - organizationHierarchyRoles.indexOf(right));
}

export function getOrganizationRoleLabels(member) {
  const hierarchy = getHierarchyRoles(member);
  const original = String(member?.role ?? "").trim();
  const legacyEquivalent = hierarchyRoleAliases.get(original.toLowerCase());
  return [...hierarchy, ...(legacyEquivalent ? [] : [original])].filter((label, index, labels) => label && labels.indexOf(label) === index);
}

export function isOrganizationOnlyLeader(member) {
  const roles = getHierarchyRoles(member);
  const legacyRole = String(member?.role ?? "").trim().toLowerCase();
  const roleIsOnlyLeadership = !legacyRole || hierarchyRoleAliases.has(legacyRole);
  return roleIsOnlyLeadership && roles.length > 0 && roles.every((role) => role === organizationHierarchyRoles[0] || role === organizationHierarchyRoles[1]);
}

export function getOperationalRoster(members) {
  return (members ?? []).filter((member) => !isOrganizationOnlyLeader(member));
}

export function getReportingManagerIds(member) {
  const values = Array.isArray(member?.reportingManagerIds)
    ? member.reportingManagerIds
    : [member?.managerId, member?.coManagerId];
  return [...new Set(values.filter((id) => typeof id === "string" && id.length > 0))];
}

export const ORGANIZATION_STORAGE_KEY = "starter-app-organization-members-v2";

export const starterMembers = [
  { id: "team-lead", name: "Morgan Lee", role: "Team Lead", managerId: null, photo: "" },
  { id: "campaign-specialist-1", name: "Jordan Taylor", role: "Campaign Specialist", managerId: "team-lead", photo: "" },
  { id: "campaign-specialist-2", name: "Quinn Rivera", role: "Campaign Specialist", managerId: "team-lead", photo: "" },
  { id: "senior-agent-1", name: "Avery Chen", role: "Senior Agent", managerId: "team-lead", photo: "" },
  { id: "customer-rep-1", name: "Sam Rivera", role: "Customer Rep", managerId: "senior-agent-1", mentorId: null, photo: "" },
  { id: "customer-rep-2", name: "Casey Morgan", role: "Customer Rep", managerId: "senior-agent-1", mentorId: null, photo: "" },
  { id: "customer-rep-3", name: "Jamie Patel", role: "Customer Rep", managerId: "senior-agent-1", mentorId: null, photo: "" },
  { id: "customer-rep-4", name: "Alex Kim", role: "Customer Rep", managerId: "senior-agent-1", mentorId: null, photo: "" },
];

export function getOrganizationMembers() {
  try {
    const saved = localStorage.getItem(ORGANIZATION_STORAGE_KEY);
    if (!saved) return starterMembers;
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) return starterMembers;
    return parsed.map((member) => {
      const reportingManagerIds = getReportingManagerIds(member);
      const cleaned = { ...member, reportingManagerIds, managerId: reportingManagerIds[0] ?? null, coManagerId: reportingManagerIds[1] ?? null, mentorId: member.mentorId ?? null };
      delete cleaned.campaignReportToIds;
      return cleaned;
    });
  } catch {
    return starterMembers;
  }
}

export function buildOrganizationTree(members) {
  const nodes = new Map(members.map((member) => {
    const reportingManagerIds = getReportingManagerIds(member);
    return [member.id, { ...member, reportingManagerIds, managerId: reportingManagerIds[0] ?? null, coManagerId: reportingManagerIds[1] ?? null, children: [] }];
  }));
  const roots = [];

  for (const node of nodes.values()) {
    const managers = node.reportingManagerIds.map((id) => nodes.get(id)).filter(Boolean);
    node.reportingManagers = managers.map((manager) => ({ id: manager.id, name: manager.name, role: getOrganizationRoleLabels(manager).join(" / ") || manager.role }));
    const manager = managers[0] ?? null;
    node.managerName = manager?.name ?? null;
    node.managerRole = manager ? (getOrganizationRoleLabels(manager).join(" / ") || manager.role) : null;
    node.mentorName = node.mentorId ? nodes.get(node.mentorId)?.name ?? null : null;
    const coManager = managers[1] ?? null;
    node.coManagerName = coManager?.name ?? null;
    node.coManagerRole = coManager ? (getOrganizationRoleLabels(coManager).join(" / ") || coManager.role) : null;
    if (managers.length > 1) continue;
    if (manager && manager.id !== node.id) manager.children.push(node);
    else roots.push(node);
  }

  const rank = (member) => {
    const roleRank = new Map(organizationHierarchyRoles.map((role, index) => [role, index]));
    const selected = getHierarchyRoles(member).map((role) => roleRank.get(role)).filter(Number.isInteger);
    return selected.length ? Math.min(...selected) : organizationHierarchyRoles.length;
  };
  const sortBranches = (branches) => {
    branches.sort((left, right) => rank(left) - rank(right) || Number(left.sortOrder ?? 0) - Number(right.sortOrder ?? 0));
    branches.forEach((branch) => sortBranches(branch.children));
  };
  for (const report of nodes.values()) {
    const managerIds = report.reportingManagerIds;
    if (!["Customer Rep", "Senior Agent"].includes(report.role) || managerIds.length < 2) continue;
    const managers = managerIds.map((id) => nodes.get(id));
    if (managers.some((manager) => !manager)) continue;
    const commonParentIds = managers.map((manager) => getReportingManagerIds(manager).join("\u0000"));
    if (new Set(commonParentIds).size !== 1) continue;
    if (report.role === "Senior Agent" && managers.some((manager) => manager.role !== "Campaign Specialist")) continue;
    if (report.role === "Customer Rep" && managers.some((manager) => !["Campaign Specialist", "Senior Agent"].includes(manager.role))) continue;
    const commonParentId = getReportingManagerIds(managers[0])[0];
    const commonManager = commonParentId ? nodes.get(commonParentId) : null;
    if (!commonManager) continue;
    const key = [...managerIds].sort().join(":");
    commonManager.coManagedGroups ??= [];
    let group = commonManager.coManagedGroups.find((item) => item.key === key);
    if (!group) {
      group = { key, managerIds: [...managerIds], reports: [] };
      commonManager.coManagedGroups.push(group);
    }
    group.reports.push(report);
  }
  sortBranches(roots);

  return roots;
}

export function getDescendantIds(members, memberId) {
  const descendants = new Set();
  const pending = [memberId];

  while (pending.length) {
    const currentId = pending.pop();
    for (const member of members) {
      if (getReportingManagerIds(member).includes(currentId) && !descendants.has(member.id)) {
        descendants.add(member.id);
        pending.push(member.id);
      }
    }
  }

  return descendants;
}

export function createMemberId() {
  return globalThis.crypto?.randomUUID?.() ?? `member-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
