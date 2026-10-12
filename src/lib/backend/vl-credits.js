import { assertBackendConfigured, createPrivateSignedUrlMap, throwIfError } from "./shared.js";
import { supabase } from "@/lib/supabase";

export async function loadVlCreditRecords() {
  assertBackendConfigured();
  const { data, error } = await supabase.rpc("get_public_vl_credit_entries");
  throwIfError(error);
  const rows = data ?? [];
  const photoPaths = [...new Set(rows.map((row) => row.employee_photo_snapshot ?? "").filter((value) => value && !/^https?:\/\//i.test(value)))];
  const signedPhotos = await createPrivateSignedUrlMap(photoPaths);
  return rows.map((row) => {
    const photoRef = row.employee_photo_snapshot ?? "";
    const externalPhoto = /^https?:\/\//i.test(photoRef);
    return {
      id: row.id, memberId: row.employee_id ?? "", name: row.employee_name_snapshot,
      role: row.employee_role_snapshot ?? "", photo: externalPhoto ? photoRef : signedPhotos.get(photoRef) ?? "",
      photoPath: externalPhoto ? "" : photoRef, value: row.credit_value ?? "",
      validFrom: row.valid_from ?? row.month_start ?? "",
      validTo: row.valid_to ?? row.month_start ?? "",
      updatedAt: row.updated_at ?? "",
    };
  }).filter((entry) => entry.validFrom && entry.validTo);
}

export async function saveVlCreditEntry(entry) {
  const client = assertBackendConfigured();
  const { error } = await client.rpc("save_vl_credit_entry", {
    p_entry: {
      id: entry.id, memberId: entry.memberId, value: entry.value,
      validFrom: entry.validFrom, validTo: entry.validTo,
    },
  });
  throwIfError(error);
}

export async function deleteVlCreditEntry(id) {
  const client = assertBackendConfigured();
  const { error } = await client.rpc("delete_vl_credit_entry", { p_id: id });
  throwIfError(error);
}
