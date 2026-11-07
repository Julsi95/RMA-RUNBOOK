import { assertBackendConfigured, createPrivateSignedUrlMap, throwIfError } from "./shared.js";
import { functionErrorMessage } from "./function-error.js";
import { compressProfileImage } from "./profile-image.js";

export async function manageAccounts(payload) {
  const client = assertBackendConfigured();
  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  throwIfError(sessionError);
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) throw new Error("Your RUNBOOK sign-in session is missing or expired. Sign in again, then retry.");

  const { data, error } = await client.functions.invoke("manage-account", {
    body: payload,
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (error?.name === "FunctionsFetchError") {
    const origin = typeof window === "undefined" ? "this site" : window.location.origin;
    console.error("[RUNBOOK account request] Function could not be reached", {
      action: payload?.action ?? "unknown",
      origin: typeof window === "undefined" ? undefined : window.location.origin,
      errorName: error.name,
    });
    throw new Error(`Could not reach the account-management function from ${origin}. Check that the Supabase manage-account function is deployed and this site origin is allowed by its CORS settings.`);
  }
  if (error?.name === "FunctionsHttpError") {
    const message = await functionErrorMessage(error);
    const safeMessage = message.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted email]");
    console.error("[RUNBOOK account request] Function returned an error", {
      action: payload?.action ?? "unknown",
      status: error.context?.status ?? null,
      message: safeMessage,
    });
    throw new Error(message);
  }
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
  const image = await compressProfileImage(file);
  const extension = image.type === "image/jpeg" ? "jpg" : image.type === "image/png" ? "png" : image.type === "image/gif" ? "gif" : "webp";
  const folder = employeeId ? `employees/${employeeId}` : `accounts/${userId}`;
  const path = `${folder}/${crypto.randomUUID()}.${extension}`;
  const { error } = await client.storage.from("runbook-private").upload(path, image, { contentType: image.type, cacheControl: "3300", upsert: false });
  throwIfError(error);
  return path;
}

export async function signedOwnProfilePhoto(path, expiresIn = 3600) {
  if (!path) return "";
  const signedUrls = await createPrivateSignedUrlMap([path], expiresIn);
  return signedUrls.get(path) ?? "";
}
