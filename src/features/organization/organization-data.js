export const organizationRoles = [
  "Team Lead",
  "Campaign Specialist",
  "Senior Agent",
  "Customer Rep",
];

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
    node.mentorName = node.mentorId ? nodes.get(node.mentorId)?.name ?? null : null;
    if (manager && manager.id !== node.id) manager.children.push(node);
    else roots.push(node);
  }

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
