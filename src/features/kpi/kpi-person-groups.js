function nameParts(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
}

export function normalizeKpiPersonName(value) {
  return nameParts(value).join("");
}

export function abbreviatedKpiNameMatches(shortName, fullName) {
  const shortParts = nameParts(shortName);
  const fullParts = nameParts(fullName);
  if (shortParts.length < 2 || shortParts[0].length !== 1 || fullParts.length < 2) return false;
  if (shortParts[0] !== fullParts[0][0]) return false;
  const surnameParts = shortParts.slice(1);
  if (surnameParts.length > fullParts.length - 1) return false;
  const fullSurnameParts = fullParts.slice(-surnameParts.length);
  return surnameParts.every((part, index) => part === fullSurnameParts[index]);
}

export function findUniqueKpiPersonNameMatch(name, people) {
  const normalized = normalizeKpiPersonName(name);
  if (!normalized) return null;
  const exact = people.filter((person) => normalizeKpiPersonName(person.name) === normalized);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const abbreviated = people.filter((person) => abbreviatedKpiNameMatches(name, person.name));
  return abbreviated.length === 1 ? abbreviated[0] : null;
}

function identityQuality(name) {
  const parts = nameParts(name);
  return parts.length * 100 + String(name ?? "").length;
}

function chooseName(group, name, role) {
  if (identityQuality(name) > identityQuality(group.name)) {
    group.name = name;
    if (!group.rosterPerson && role) group.role = role;
  }
}

function recordQuality(record, directRosterMatch) {
  return (directRosterMatch ? 100_000 : 0) + identityQuality(record.memberName ?? "");
}

function addRecord(group, month, record, directRosterMatch) {
  const current = group.recordsByMonth[month];
  if (!current || recordQuality(record, directRosterMatch) > recordQuality(current.record, current.directRosterMatch)) {
    group.recordsByMonth[month] = { record, directRosterMatch };
  }
  group.aliases.add(record.memberName || "");
  chooseName(group, record.memberName || group.name, record.role);
}

export function buildKpiPersonGroups(months, monthlyData, people) {
  const rosterPeople = people.filter((person) => !person.historical);
  const rosterById = new Map(rosterPeople.map((person) => [String(person.id), person]));
  const groups = new Map();

  for (const month of months) {
    for (const [recordId, record] of Object.entries(monthlyData[month]?.records ?? {})) {
      const name = record.memberName || "Former roster member";
      const rosterPerson = rosterById.get(String(recordId)) ?? findUniqueKpiPersonNameMatch(name, rosterPeople);
      const groupKey = rosterPerson ? `roster:${rosterPerson.id}` : `history-id:${recordId}`;
      let group = groups.get(groupKey);
      if (!group) {
        group = {
          key: groupKey,
          id: rosterPerson?.id ?? groupKey,
          name: rosterPerson?.name ?? name,
          role: rosterPerson?.role ?? record.role ?? "Historical record",
          historical: !rosterPerson,
          rosterPerson: rosterPerson ?? null,
          recordsByMonth: {},
          aliases: new Set(),
        };
        groups.set(groupKey, group);
      }
      addRecord(group, month, record, Boolean(rosterById.has(String(recordId))));
    }
  }

  const historicalGroups = [...groups.values()].filter((group) => !group.rosterPerson);
  const merges = [];
  for (const abbreviatedGroup of historicalGroups) {
    const fullNameCandidates = new Set();
    for (const other of historicalGroups) {
      if (other === abbreviatedGroup) continue;
      const match = [...abbreviatedGroup.aliases].some((alias) => abbreviatedKpiNameMatches(alias, other.name));
      if (match) fullNameCandidates.add(other);
    }
    if (fullNameCandidates.size === 1) merges.push([abbreviatedGroup, [...fullNameCandidates][0]]);
  }

  for (const [source, target] of merges) {
    if (!groups.has(source.key)) continue;
    for (const [month, value] of Object.entries(source.recordsByMonth)) {
      addRecord(target, month, value.record, value.directRosterMatch);
    }
    for (const alias of source.aliases) target.aliases.add(alias);
    groups.delete(source.key);
  }

  return [...groups.values()].map(({ key, rosterPerson, recordsByMonth, aliases, ...person }) => ({
    ...person,
    recordsByMonth: Object.fromEntries(Object.entries(recordsByMonth).map(([month, value]) => [month, value.record])),
  }));
}
