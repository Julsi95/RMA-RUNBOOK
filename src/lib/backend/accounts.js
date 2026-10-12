import { assertBackendConfigured, throwIfError } from "./shared.js";

export async function manageAccounts(payload) {
  const client = assertBackendConfigured();
  const { data, error } = await client.functions.invoke("manage-account", { body: payload });
  throwIfError(error);
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function uploadOwnProfilePhoto(file, userId, employeeId = null) {
  const client = assertBackendConfigured();
  if (!file || !/^image\/(jpeg|png|webp|gif)$/.test(file.type)) {
    throw new Error("Use a JPEG, PNG, WebP, or GIF image.");
  }
  if (file.size > 5 * 1024 * 1024) throw new Error("Profile images must be 5 MB or smaller.");
  const extension = file.type === "image/jpeg" ? "jpg" : file.type.split("/")[1];
  const folder = employeeId ? `employees/${employeeId}` : `accounts/${userId}`;
  const path = `${folder}/${crypto.randomUUID()}.${extension}`;
  const { error } = await client.storage.from("runbook-private").upload(path, file, { contentType: file.type, upsert: false });
  throwIfError(error);
  return path;
}

export async function signedOwnProfilePhoto(path) {
  if (!path) return "";
  const client = assertBackendConfigured();
  const { data, error } = await client.storage.from("runbook-private").createSignedUrl(path, 300);
  throwIfError(error);
  return data?.signedUrl ?? "";
}
