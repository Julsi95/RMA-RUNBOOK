export const organizationRoles = [
  "Team Lead",
  "Campaign Specialist",
  "Senior Agent",
  "Customer Rep",
];

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
      const cleaned = { ...member, mentorId: member.mentorId ?? null };
      delete cleaned.campaignReportToIds;
      return cleaned;
    });
  } catch {
    return starterMembers;
  }
}

export function buildOrganizationTree(members) {
  const nodes = new Map(members.map((member) => [member.id, { ...member, children: [] }]));
  const roots = [];

  for (const node of nodes.values()) {
    const manager = node.managerId ? nodes.get(node.managerId) : null;
    node.managerName = manager?.name ?? null;
    node.mentorName = node.mentorId ? nodes.get(node.mentorId)?.name ?? null : null;
    if (manager && manager.id !== node.id) manager.children.push(node);
    else roots.push(node);
  }

  const rank = (member) => {
    const roleRank = new Map(organizationHierarchyRoles.map((role, index) => [role, index]));
    const selected = getHierarchyRoles(member).map((role) => roleRank.get(role)).filter(Number.isInteger);
    return selected.length ? Math.min(...selected) : organizationHierarchyRoles.length;
  };
  const sortBranches = (branches) => {
    branches.sort((left, right) => rank(left) - rank(right) || Number(left.sortOrder ?? 0) - Number(right.sortOrder ?? 0) || left.name.localeCompare(right.name));
    branches.forEach((branch) => sortBranches(branch.children));
  };
  sortBranches(roots);

  return roots;
}

export function getDescendantIds(members, memberId) {
  const descendants = new Set();
  const pending = [memberId];

  while (pending.length) {
    const currentId = pending.pop();
    for (const member of members) {
      if (member.managerId === currentId && !descendants.has(member.id)) {
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
