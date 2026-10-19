import { getOrganizationMembers } from "@/features/organization/organization-data";
import { supabase } from "@/lib/supabase";
import { assertBackendConfigured, createPrivateSignedUrlMap, throwIfError, throwIfErrors } from "./shared.js";

function normalizeEmployee(row, profile = {}) {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    hierarchyRoles: row.hierarchy_roles ?? row.profile?.hierarchy_roles ?? [],
    managerId: row.manager_id ?? row.managerId ?? null,
    mentorId: row.mentor_id ?? row.mentorId ?? null,
    sortOrder: Number(row.sort_order ?? row.sortOrder ?? 0),
    photo: row.photo_url ?? row.photo ?? "",
    photoPath: row.photo_path ?? "",
    profile: {
      birthday: profile.birthday ?? "",
      hireDate: profile.hire_date ?? profile.hireDate ?? "",
      personality: profile.personality ?? "",
      summary: profile.summary ?? "",
      fields: profile.custom_fields ?? profile.fields ?? {},
      visibility: {
        photo: profile.photo_public ?? profile.visibility?.photo ?? true,
        birthday: profile.birthday_public ?? profile.visibility?.birthday ?? false,
        hireDate: profile.hire_date_public ?? profile.visibility?.hireDate ?? false,
        personality: profile.personality_public ?? profile.visibility?.personality ?? false,
        summary: profile.summary_public ?? profile.visibility?.summary ?? false,
        fields: profile.custom_field_visibility ?? profile.visibility?.fields ?? {},
      },
    },
  };
}

async function addSignedPhotoUrls(members) {
  const signedPhotos = await createPrivateSignedUrlMap(members.map((member) => member.photoPath));
  return members.map((member) => ({
    ...member,
    photo: member.photoPath ? signedPhotos.get(member.photoPath) ?? "" : member.photo,
  }));
}

export async function loadRemoteRoster(canEdit) {
  if (!supabase) return { members: getOrganizationMembers(), profiles: {} };

  if (!canEdit) {
    const [directoryResult, definitionsResult] = await Promise.all([
      supabase.rpc("get_public_employee_directory"),
      supabase.from("agent_profile_field_definitions").select("id,label,field_type,sort_order").order("sort_order"),
    ]);
    throwIfErrors([directoryResult, definitionsResult]);
    const members = await addSignedPhotoUrls((directoryResult.data ?? []).map((row) => normalizeEmployee(row, row.profile ?? {})));
    return { members, profiles: Object.fromEntries(members.map((member) => [member.id, member.profile])), definitions: definitionsResult.data ?? [] };
  }

  const [employeesResult, profilesResult, definitionsResult] = await Promise.all([
    supabase.from("employees").select("id,name,role,hierarchy_roles,manager_id,mentor_id,photo_url,photo_path,sort_order").is("deleted_at", null).order("sort_order").order("name"),
    supabase.from("employee_profiles").select("employee_id,birthday,hire_date,personality,summary,photo_public,custom_fields,birthday_public,hire_date_public,personality_public,summary_public,custom_field_visibility"),
    supabase.from("agent_profile_field_definitions").select("id,label,field_type,sort_order").order("sort_order"),
  ]);
  throwIfErrors([employeesResult, profilesResult, definitionsResult]);
  const profileById = new Map((profilesResult.data ?? []).map((row) => [row.employee_id, row]));
  const members = await addSignedPhotoUrls((employeesResult.data ?? []).map((row) => normalizeEmployee(row, profileById.get(row.id))));
  return { members, profiles: Object.fromEntries(members.map((member) => [member.id, member.profile])), definitions: definitionsResult.data ?? [] };
}

async function storeEmployeePhoto(photo, currentPath, employeeId) {
  if (!photo) return { photoUrl: "", photoPath: null };
  if (currentPath) return { photoUrl: "", photoPath: currentPath };
  if (photo.includes("/storage/v1/object/sign/runbook-private/")) {
    const signedPath = photo.split("/storage/v1/object/sign/runbook-private/")[1]?.split("?")[0];
    if (signedPath) {
      const path = decodeURIComponent(signedPath);
      if (path.startsWith(`employees/${employeeId}/`)) return { photoUrl: "", photoPath: path };
      throw new Error("This private profile photo could not be matched to its employee. Re-upload the photo before saving.");
    }
  }
  if (!photo.startsWith("data:")) {
    return { photoUrl: photo, photoPath: null };
  }

  const blob = await (await fetch(photo)).blob();
  const extension = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : blob.type === "image/gif" ? "gif" : "jpg";
  const path = `employees/${employeeId}/${crypto.randomUUID()}.${extension}`;
  const { error } = await assertBackendConfigured().storage.from("runbook-private").upload(path, blob, { contentType: blob.type, upsert: false });
  throwIfError(error);
  return { photoUrl: "", photoPath: path };
}

export async function saveRemoteMembers(currentMembers, nextMembers, deletedId) {
  const currentById = new Map(currentMembers.map((member) => [member.id, member]));
  const currentOrder = new Map(currentMembers.map((member, index) => [member.id, Number(member.sortOrder ?? index)]));
  const nextSortOrder = Math.max(-1, ...currentOrder.values()) + 1;
  const rows = await Promise.all(nextMembers.map(async (member) => {
    const previous = currentById.get(member.id);
    const photo = await storeEmployeePhoto(member.photo, member.photoPath ?? previous?.photoPath, member.id);
    const row = {
      id: member.id, name: member.name, role: member.role,
      hierarchy_roles: [...new Set(member.hierarchyRoles ?? [])],
      manager_id: member.managerId || null, mentor_id: member.mentorId || null,
      photo_url: photo.photoUrl, photo_path: photo.photoPath,
      sort_order: currentOrder.get(member.id) ?? nextSortOrder,
    };
    const unchanged = previous
      && previous.name === row.name
      && previous.role === row.role
      && JSON.stringify([...new Set(previous.hierarchyRoles ?? [])].sort()) === JSON.stringify([...row.hierarchy_roles].sort())
      && (previous.managerId || null) === row.manager_id
      && (previous.mentorId || null) === row.mentor_id
      && (photo.photoPath ? previous.photoPath === photo.photoPath : (previous.photo ?? "") === row.photo_url)
      && currentOrder.get(member.id) === row.sort_order;
    return unchanged ? null : row;
  }));

  const changedRows = rows.filter(Boolean);
  if (changedRows.length) {
    const { error } = await assertBackendConfigured().from("employees").upsert(changedRows);
    throwIfError(error);
  }
  if (deletedId) {
    const { error } = await assertBackendConfigured().rpc("soft_delete_employee", { p_id: deletedId });
    throwIfError(error);
  }
}

export async function saveRemoteEmployeeProfile(employeeId, profile) {
  const visibility = profile.visibility ?? {};
  const { error } = await assertBackendConfigured().from("employee_profiles").upsert({
    employee_id: employeeId,
    photo_public: visibility.photo !== false,
    birthday: profile.birthday || null,
    hire_date: profile.hireDate || null,
    personality: profile.personality || "",
    summary: profile.summary || "",
    custom_fields: profile.fields ?? {},
    birthday_public: Boolean(visibility.birthday),
    hire_date_public: Boolean(visibility.hireDate),
    personality_public: Boolean(visibility.personality),
    summary_public: Boolean(visibility.summary),
    custom_field_visibility: visibility.fields ?? {},
  });
  throwIfError(error);
}

export async function saveRemoteProfileFieldDefinitions(definitions) {
  const client = assertBackendConfigured();
  const { data: existing, error: readError } = await client.from("agent_profile_field_definitions").select("id");
  throwIfError(readError);
  const keep = new Set(definitions.map((field) => field.id));
  const removeIds = (existing ?? []).map((field) => field.id).filter((id) => !keep.has(id));
  if (removeIds.length) {
    const { error } = await client.from("agent_profile_field_definitions").delete().in("id", removeIds);
    throwIfError(error);
  }
  if (definitions.length) {
    const { error } = await client.from("agent_profile_field_definitions").upsert(definitions.map((field, sort_order) => ({
      id: field.id, label: field.label, field_type: field.type, sort_order,
    })));
    throwIfError(error);
  }
}
